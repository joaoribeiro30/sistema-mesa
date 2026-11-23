import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/credentials.js';
import { loginKey } from '../src/auth/login-guard.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';

function testIp() {
  const id = randomUUID();
  return `2001:db8:${id.slice(0, 4)}:${id.slice(4, 8)}::1`;
}

test('hardening da API com PostgreSQL compartilhado', async (t) => {
  const frontendOrigin = 'https://mesas.example.test';
  const extraOrigin = 'https://catalogo.example.test';
  const config = {
    ...loadConfig(), trustedProxies: [], captcha: undefined, secureCookies: true,
    appOrigin: 'https://api.mesas.example.test', frontendOrigin, corsOrigins: [frontendOrigin, extraOrigin],
  };
  assert.equal(new URL(config.databaseUrl).hostname, '127.0.0.1');
  const db = createDb(config.databaseUrl);
  const app = await buildApp(config, { logger: false });
  const replica = await buildApp(config, { logger: false });
  app.get('/test-internal-error', async () => {
    throw new Error('diagnóstico privado');
  });
  const password = 'Luzes da varanda azul';
  const passwordHash = await hashPassword(password);
  const userIds = new Set<string>();
  const keys = new Set<string>();

  t.after(async () => {
    try {
      await Promise.all([app.close(), replica.close()]);
      const ids = [...userIds];
      await db.$transaction([
        db.auditLog.deleteMany({ where: { OR: [
          { actorUserId: { in: ids } }, { subjectUserId: { in: ids } },
          ...[...keys].map((key) => ({ details: { path: ['accountKey'], equals: key } })),
        ] } }),
        db.loginAttempt.deleteMany({ where: { key: { in: [...keys] } } }),
        db.user.deleteMany({ where: { id: { in: ids } } }),
      ]);
    } finally {
      await db.$disconnect();
    }
  });

  async function createUser(role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') {
    const email = `seguranca-${randomUUID()}@example.test`;
    const user = await db.user.create({ data: { email, name: 'Teste', role, emailVerifiedAt: new Date(), passwordHash } });
    userIds.add(user.id);
    keys.add(loginKey(config.jwtSecret, email));
    return user;
  }

  function login(email: string, secret: string, instance = app, remoteAddress = testIp()) {
    return instance.inject({ method: 'POST', url: '/auth/login', remoteAddress, payload: { email, password: secret } });
  }

  async function token(email: string) {
    const response = await login(email, password);
    assert.equal(response.statusCode, 200, response.body);
    return response.json().accessToken as string;
  }

  await t.test('CORS varia por origem e respostas de erro omitem detalhes internos', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS', url: '/reservations', headers: {
        origin: frontendOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, idempotency-key',
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], frontendOrigin);
    assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
    assert.match(String(preflight.headers['access-control-allow-headers']), /Idempotency-Key/);
    const denied = await app.inject({ method: 'OPTIONS', url: '/reservations', headers: { origin: 'https://fora.example.test' } });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
    assert.equal(denied.headers.vary, 'Origin');
    const failed = await app.inject({ url: '/test-internal-error', headers: { origin: frontendOrigin } });
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.headers['access-control-allow-origin'], frontendOrigin);
    assert.deepEqual(failed.json(), { code: 'INTERNAL_ERROR', message: 'Erro interno.' });
    const missing = await app.inject({ url: '/rota-inexistente?detalhe=privado' });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.headers.vary, 'Origin');
    assert.deepEqual(missing.json(), { code: 'NOT_FOUND', message: 'Rota não encontrada.' });
  });

  await t.test('lockout por conta sob concorrência, expiração e auditoria', async () => {
    const user = await createUser();
    const wrong = 'senha incorreta';
    assert.equal((await login(user.email, wrong)).statusCode, 401);
    assert.equal((await login(user.email, password)).statusCode, 200);
    const failed = await Promise.all([app, replica, app, replica].map((instance) => login(user.email, wrong, instance)));
    assert.ok(failed.every((response) => response.statusCode === 401), failed.map((response) => response.body).join(', '));

    const locked = await login(user.email.toUpperCase(), wrong, replica);
    assert.equal(locked.statusCode, 429, locked.body);
    assert.equal(locked.json().code, 'LOGIN_LOCKED');
    assert.equal(Number(locked.headers['retry-after']), 900);
    const blocked = await login(user.email, password, app);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().code, 'LOGIN_LOCKED');

    const key = loginKey(config.jwtSecret, user.email);
    const audit = await db.auditLog.findMany({ where: { details: { path: ['accountKey'], equals: key } }, orderBy: { id: 'asc' } });
    assert.deepEqual(audit.map(({ action }) => action), ['LOGIN_LOCKED', 'LOGIN_BLOCKED']);
    assert.equal(audit[0]?.subjectUserId, user.id);
    assert.deepEqual(audit[0]?.details, { accountKey: key, failures: 5, retryAfter: 900 });
    assert.ok(!JSON.stringify(audit.map(({ details }) => details)).includes(user.email));

    const expired = new Date(Date.now() - 1000);
    await db.loginAttempt.update({ where: { key }, data: { lockedUntil: expired, expiresAt: expired } });
    assert.equal((await login(user.email, password, replica)).statusCode, 200);
  });

  await t.test('429 por IP real, conta verificada e rota de webhook', async () => {
    const user = await createUser();
    const accessToken = await token(user.email);
    const authorization = `Bearer ${accessToken}`;
    const sourceIp = testIp();
    const publicRequest = (instance: typeof app, remoteAddress: string) => instance.inject({
      method: 'POST', url: '/auth/email/resend', remoteAddress,
      payload: { email: `ausente-${randomUUID()}@example.test` },
      headers: { 'x-forwarded-for': testIp() },
    });
    for (let hit = 0; hit < 5; hit++) {
      assert.equal((await publicRequest(hit % 2 ? app : replica, sourceIp)).statusCode, 202);
    }
    const ipLimited = await publicRequest(replica, sourceIp);
    assert.equal(ipLimited.statusCode, 429);
    assert.equal(ipLimited.json().code, 'RATE_LIMIT_EXCEEDED');
    assert.match(String(ipLimited.headers.ratelimit), /^"ip";r=0;t=\d+$/);
    assert.equal(ipLimited.headers['ratelimit-policy'], '"ip";q=5;w=60');
    assert.ok(Number(ipLimited.headers['retry-after']) > 0);
    assert.equal((await publicRequest(app, sourceIp.replace(/::1$/, '::2'))).statusCode, 429);
    assert.equal((await publicRequest(app, testIp())).statusCode, 202);

    const authenticatedAuth = () => app.inject({
      method: 'POST', url: '/auth/email/resend', remoteAddress: testIp(),
      headers: { authorization }, payload: { email: user.email },
    });
    for (let hit = 0; hit < 3; hit++) assert.equal((await authenticatedAuth()).statusCode, 202);
    assert.equal((await authenticatedAuth()).statusCode, 429);

    const reservation = (instance: typeof app) => instance.inject({
      method: 'POST', url: '/reservations', remoteAddress: testIp(),
      headers: { authorization, 'idempotency-key': randomUUID() },
      payload: { eventId: randomUUID(), tableId: randomUUID(), guestCount: 2 },
    });
    for (let hit = 0; hit < 15; hit++) assert.equal((await reservation(hit % 2 ? app : replica)).statusCode, 404);
    const userLimited = await reservation(replica);
    assert.equal(userLimited.statusCode, 429);
    assert.match(String(userLimited.headers.ratelimit), /"user";r=0;t=\d+/);

    const checkout = () => app.inject({
      method: 'POST', url: `/reservations/${randomUUID()}/checkout`, remoteAddress: testIp(),
      headers: { authorization, 'idempotency-key': randomUUID() }, payload: { method: 'PIX' },
    });
    for (let hit = 0; hit < 10; hit++) assert.equal((await checkout()).statusCode, 404);
    assert.equal((await checkout()).statusCode, 429);

    const webhookIp = testIp();
    const webhook = (instance: typeof app) => instance.inject({
      method: 'POST', url: '/webhooks/payment', remoteAddress: webhookIp, payload: {},
    });
    for (let hit = 0; hit < 120; hit++) assert.equal((await webhook(app)).statusCode, 401);
    const webhookLimited = await webhook(replica);
    assert.equal(webhookLimited.statusCode, 429);
    assert.equal(webhookLimited.headers['ratelimit-policy'], '"ip";q=120;w=60');
    assert.ok(Number(webhookLimited.headers['retry-after']) > 0);
  });

  await t.test('CAPTCHA condicional valida ação e hostname', async () => {
    const user = await createUser();
    const captchaApp = await buildApp({ ...config, captcha: {
      secret: 'fixture-secret', hostname: 'mesas.example.test', loginAfter: 2,
    } }, { logger: false, captchaFetch: async (url, options) => {
      assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      assert.ok(options?.body instanceof URLSearchParams);
      assert.equal(options.body.get('secret'), 'fixture-secret');
      const response = options.body.get('response');
      return Response.json({
        success: true, action: response === 'other-action' ? 'register' : 'login',
        hostname: response === 'other-host' ? 'outro.example.test' : 'mesas.example.test',
      });
    } });
    try {
      const register = await captchaApp.inject({
        method: 'POST', url: '/auth/register', remoteAddress: testIp(),
        payload: { email: user.email, name: 'CAPTCHA', password },
      });
      assert.equal(register.statusCode, 403);
      assert.equal(register.json().code, 'CAPTCHA_REQUIRED');
      assert.equal((await login(user.email, 'errada', captchaApp)).statusCode, 401);
      assert.equal((await login(user.email, 'errada', captchaApp)).statusCode, 401);
      const required = await login(user.email, password, captchaApp);
      assert.equal(required.statusCode, 403);
      assert.equal(required.json().code, 'CAPTCHA_REQUIRED');
      const withCaptcha = (captchaToken: string) => captchaApp.inject({
        method: 'POST', url: '/auth/login', remoteAddress: testIp(), payload: { email: user.email, password, captchaToken },
      });
      for (const invalid of ['other-action', 'other-host']) {
        const response = await withCaptcha(invalid);
        assert.equal(response.statusCode, 403);
        assert.equal(response.json().code, 'CAPTCHA_INVALID');
      }
      assert.equal((await withCaptcha('valid-login')).statusCode, 200);
      assert.equal((await login(user.email, password, captchaApp)).statusCode, 200);
    } finally {
      await captchaApp.close();
    }
  });

  await t.test('Helmet, CSRF de cookie, tipos estritos e RBAC carregado do banco', async () => {
    const user = await createUser('ADMIN');
    const accessToken = await token(user.email);
    const authorization = `Bearer ${accessToken}`;
    const allowed = await app.inject({ url: '/admin/overview', headers: { authorization } });
    assert.equal(allowed.statusCode, 200);
    assert.match(String(allowed.headers['content-security-policy']), /default-src 'none'.*frame-ancestors 'none'/);
    assert.equal(allowed.headers['x-content-type-options'], 'nosniff');
    assert.equal(allowed.headers['strict-transport-security'], 'max-age=31536000');
    assert.equal(allowed.headers['cache-control'], 'no-store');
    assert.ok(await db.auditLog.findFirst({ where: { actorUserId: user.id, action: 'ADMIN_OVERVIEW_VIEWED' } }));

    await db.user.update({ where: { id: user.id }, data: { role: 'CUSTOMER' } });
    assert.equal((await app.inject({ url: '/admin/overview', headers: { authorization } })).statusCode, 403);
    const roleAudit = await db.auditLog.findMany({ where: { subjectUserId: user.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(roleAudit.map(({ action }) => action), ['ADMIN_CREATED', 'USER_ROLE_CHANGED']);
    assert.deepEqual(roleAudit[1]?.details, { previousRole: 'ADMIN', role: 'CUSTOMER' });

    const cookieRequest = (origin?: string, guestCount: number | string = 2) => app.inject({
      method: 'POST', url: '/reservations', remoteAddress: testIp(),
      cookies: { mesa_session: accessToken },
      headers: { ...(origin ? { origin } : {}), 'idempotency-key': randomUUID() },
      payload: { eventId: randomUUID(), tableId: randomUUID(), guestCount },
    });
    for (const origin of [undefined, 'https://fora.example.test', extraOrigin]) {
      const blocked = await cookieRequest(origin);
      assert.equal(blocked.statusCode, 403);
      assert.equal(blocked.json().code, 'INVALID_ORIGIN');
    }
    assert.equal((await cookieRequest(config.appOrigin, '2')).statusCode, 400);
    assert.equal((await cookieRequest(config.appOrigin)).statusCode, 404);
    assert.equal((await cookieRequest(frontendOrigin)).statusCode, 404);
  });
});
