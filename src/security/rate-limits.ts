import { createHmac } from 'node:crypto';
import { SocketAddress } from 'node:net';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Sessions } from '../auth/session.js';
import type { Db } from '../db.js';
import { HttpError } from '../http.js';

type Limits = { ip: number; user?: number };
type Quota = { scope: 'ip' | 'user'; limit: number; remaining: number; seconds: number; exceeded: boolean };
const WINDOW_SECONDS = 60;

declare module 'fastify' {
  interface FastifyContextConfig { securityLimits?: Limits }
}

function networkKey(ip: string): string {
  const address = ip.includes(':') ? SocketAddress.parse(`[${ip}]:0`)?.address : undefined;
  if (!address) return ip;
  if (address.startsWith('::ffff:')) return address.slice(7);
  const [prefix = '', suffix] = address.split('::');
  const parts = prefix ? prefix.split(':') : [];
  if (suffix !== undefined) {
    const tail = suffix ? suffix.split(':') : [];
    parts.push(...Array<string>(8 - parts.length - tail.length).fill('0'), ...tail);
  }
  return `${parts.slice(0, 4).join(':')}::/64`;
}

function sendQuotaHeaders(reply: FastifyReply, quotas: Quota[]) {
  reply.header('RateLimit-Policy', quotas.map(({ scope, limit }) => `"${scope}";q=${limit};w=${WINDOW_SECONDS}`).join(', '));
  reply.header('RateLimit', quotas.map(({ scope, remaining, seconds }) => `"${scope}";r=${remaining};t=${seconds}`).join(', '));
  const primary = quotas.find(({ exceeded }) => exceeded)
    ?? quotas.reduce((first, quota) => quota.remaining < first.remaining ? quota : first);
  reply.header('X-RateLimit-Limit', primary.limit);
  reply.header('X-RateLimit-Remaining', primary.remaining);
  reply.header('X-RateLimit-Reset', primary.seconds);
  if (primary.exceeded) {
    reply.header('Retry-After', primary.seconds);
    throw new HttpError(429, 'RATE_LIMIT_EXCEEDED', 'Muitas requisições. Tente novamente em instantes.');
  }
}

export function registerRateLimits(app: FastifyInstance, db: Db, sessions: Sessions, secret: string) {
  async function consume(route: string, scope: Quota['scope'], subject: string, limit: number): Promise<Quota> {
    const key = createHmac('sha256', secret).update(JSON.stringify(['rate', route, scope, subject])).digest('hex');
    const [bucket] = await db.$queryRaw<[{ hits: number; seconds: number }]>`
      INSERT INTO rate_limit_buckets (key, hits, expires_at)
      VALUES (${key}, 1, statement_timestamp() + make_interval(secs => ${WINDOW_SECONDS}::int))
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limit_buckets.expires_at <= statement_timestamp() THEN 1
          ELSE LEAST(rate_limit_buckets.hits + 1, ${limit + 1}::int) END,
        expires_at = CASE WHEN rate_limit_buckets.expires_at <= statement_timestamp()
          THEN statement_timestamp() + make_interval(secs => ${WINDOW_SECONDS}::int)
          ELSE rate_limit_buckets.expires_at END
      RETURNING hits, GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at - clock_timestamp())))::int AS seconds
    `;
    return { scope, limit, remaining: Math.max(0, limit - bucket.hits), seconds: bucket.seconds, exceeded: bucket.hits > limit };
  }

  app.addHook('onRoute', (route) => {
    const limits = route.config?.securityLimits ?? (route.url.startsWith('/auth/') ? { ip: 30, user: 20 } : undefined);
    if (!limits) return;
    const routeKey = `${route.method === 'HEAD' ? 'GET' : route.method} ${route.url}`;
    const limitRequest = async (request: FastifyRequest, reply: FastifyReply) => {
      const ip = await consume(routeKey, 'ip', networkKey(request.ip), limits.ip);
      const quotas = [ip];
      if (!ip.exceeded && limits.user !== undefined) {
        const account = await sessions.identify(request);
        if (account) quotas.push(await consume(routeKey, 'user', account.id, limits.user));
      }
      sendQuotaHeaders(reply, quotas);
    };
    const existing = route.onRequest ?? [];
    route.onRequest = [limitRequest, ...[existing].flat()];
  });
}
