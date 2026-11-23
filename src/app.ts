import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { registerCheckIn } from './admin/check-in.js';
import { registerDashboard } from './admin/dashboard.js';
import { registerAdminEvents } from './admin/events.js';
import { registerEventImages } from './admin/images.js';
import { registerAdminInventory } from './admin/inventory.js';
import { configuredGoogle, type GoogleProvider } from './auth/google.js';
import { registerAuthRoutes } from './auth/routes.js';
import { configureSessions } from './auth/session.js';
import type { Config } from './config.js';
import { createDb } from './db.js';
import { registerEventRoutes } from './events/routes.js';
import { registerEventStream } from './events/stream.js';
import { HttpError } from './http.js';
import { registerPaymentRoutes } from './payments/routes.js';
import { registerReservationExpiration } from './reservations/expiration.js';
import { registerReservationRoutes } from './reservations/routes.js';
import { registerSecurityCleanup } from './security/cleanup.js';
import { registerRateLimits } from './security/rate-limits.js';

export async function buildApp(config: Config, options: { logger?: boolean; google?: GoogleProvider; captchaFetch?: typeof fetch } = {}) {
  const app = Fastify({
    bodyLimit: 32_768,
    trustProxy: config.trustedProxies.length ? config.trustedProxies : false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    logger: options.logger === false ? false : {
      serializers: { req: (request) => ({ method: request.method, path: request.url?.split('?')[0] }) },
    },
  });
  const db = createDb(config.databaseUrl);
  if (config.demoMode) {
    app.log.warn({ smtpConfigured: Boolean(config.smtpUrl) }, 'Modo demonstração com pagamentos simulados ativo');
  }
  app.addHook('onClose', () => db.$disconnect());
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: {
      defaultSrc: ["'none'"], baseUri: ["'none'"], frameAncestors: ["'none'"], formAction: ["'none'"],
    } },
    xFrameOptions: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    strictTransportSecurity: config.secureCookies ? { maxAge: 31_536_000, includeSubDomains: false } : false,
  });

  const allowedOrigins = new Set(config.corsOrigins ?? [config.appOrigin]);
  app.addHook('onSend', async (request, reply, payload) => {
    const origin = request.headers.origin;
    reply.header('Vary', 'Origin');
    if (origin && allowedOrigins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Expose-Headers', 'Date, Retry-After, RateLimit, RateLimit-Policy');
    }
    return payload;
  });

  app.options('/*', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      return reply.code(403).send({ code: 'CORS_ORIGIN_DENIED', message: 'Origem não permitida.' });
    }
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, Last-Event-ID');
    reply.header('Access-Control-Max-Age', '600');
    return reply.code(204).send();
  });

  app.addHook('onRequest', async (request, reply) => {
    if (['/auth/', '/reservations', '/admin/', '/webhooks/'].some((prefix) => request.url.startsWith(prefix))) {
      reply.header('Cache-Control', 'no-store');
    }
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({
    code: 'NOT_FOUND', message: 'Rota não encontrada.',
  }));
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    if (typeof error === 'object' && error && 'statusCode' in error &&
        typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      const message = error.statusCode === 429 ? 'Muitas requisições. Tente novamente em instantes.' : 'Requisição inválida.';
      return reply.code(error.statusCode).send({ code: 'REQUEST_ERROR', message });
    }
    request.log.error({ errorName: error instanceof Error ? error.name : 'Unknown' }, 'Erro interno');
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Erro interno.' });
  });
  const sessions = await configureSessions(app, db, config);
  registerRateLimits(app, db, sessions, config.jwtSecret);
  registerSecurityCleanup(app, db);

  app.get('/health', async (_request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return reply.code(503).send({ status: 'unavailable', database: 'down' });
    }
  });

  await registerAuthRoutes(app, db, config, sessions, options.google ?? configuredGoogle(config), options.captchaFetch);
  registerEventRoutes(app, db);
  registerEventStream(app, db);
  registerEventImages(app, db, sessions);
  registerAdminEvents(app, db, sessions);
  registerAdminInventory(app, db, sessions);
  registerDashboard(app, db, sessions);
  registerCheckIn(app, db, sessions, config.payments.ticketKey);
  registerReservationRoutes(app, db, sessions);
  registerPaymentRoutes(app, db, sessions, config);
  registerReservationExpiration(app, db);
  app.get('/admin/overview', { preHandler: sessions.requireRole('ADMIN') }, async (request) => {
    const [events, reservations] = await db.$transaction([
      db.event.count(),
      db.reservation.count(),
      db.auditLog.create({ data: { action: 'ADMIN_OVERVIEW_VIEWED', actorUserId: request.account!.id, details: {} } }),
    ]);
    return { events, reservations };
  });

  return app;
}
