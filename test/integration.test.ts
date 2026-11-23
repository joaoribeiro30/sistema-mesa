import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/credentials.js';
import { configuredGoogle } from '../src/auth/google.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';

test('API, PostgreSQL e OAuth', async (t) => {
  const config = { ...loadConfig(), captcha: undefined };
  assert.match(config.appOrigin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  assert.equal(new URL(config.databaseUrl).hostname, '127.0.0.1');
  assert.ok(!config.smtpUrl, 'Use a caixa de saída local durante o teste.');
  const db = createDb(config.databaseUrl);
  const id = randomUUID();
  const app = await buildApp({ ...config, trustedProxies: ['127.0.0.1'] }, { logger: false });
  t.after(() => app.close());
  const apiUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  const clientIp = `2001:db8:${id.slice(0, 4)}:${id.slice(4, 8)}::1`;
  const email = `cliente-${id}@example.test`;
  const buyerEmail = `comprador-${id}@example.test`;
  const googleEmail = `google-${id}@gmail.com`;
  const password = 'Mesas & Eventos 2026!';
  const newPassword = 'Reserva Nova 2026!';
  const fixture = `test-${id}`;
  const expirationFixture = `${fixture}-expiration`;
  const mailDirectory = join('.local', 'mail');
  const mailFiles = new Set<string>();

  async function codeFromMail(subject: string) {
    for (const file of await readdir(mailDirectory)) {
      const path = join(mailDirectory, file);
      const message = JSON.parse(await readFile(path, 'utf8'));
      if (message.to === email && message.subject.startsWith(subject)) {
        mailFiles.add(path);
        const token = /[A-Za-z0-9_-]{43}/.exec(message.text)?.[0];
        if (token) return token;
      }
    }
    throw new Error(`Mensagem de teste ausente: ${subject}`);
  }

  const request = (path: string, method = 'GET', body?: object, extra: Record<string, string> = {}) =>
    fetch(`${apiUrl}${path}`, {
      method, redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { 'x-forwarded-for': clientIp, ...extra, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.test';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  assert.ok(adminPassword);
  let token = '';
  let userId = '';

  t.after(async () => {
    try {
      const events = await db.event.findMany({
        where: { slug: { in: [fixture, `${fixture}-other`, expirationFixture] } }, select: { id: true },
      });
      const eventIds = events.map(({ id: eventId }) => eventId);
      await db.$transaction([
        db.payment.deleteMany({ where: { reservation: { eventId: { in: eventIds } } } }),
        db.reservation.deleteMany({ where: { eventId: { in: eventIds } } }),
        db.eventTable.deleteMany({ where: { eventId: { in: eventIds } } }),
        db.sector.deleteMany({ where: { eventId: { in: eventIds } } }),
        db.event.deleteMany({ where: { id: { in: eventIds } } }),
        db.auditLog.deleteMany({ where: { subjectUserId: { in: userId ? [userId] : [] }, action: { in: ['PASSWORD_RESET', 'GOOGLE_LINKED'] } } }),
        db.user.deleteMany({ where: { email: { in: [email, buyerEmail, googleEmail] } } }),
      ]);
      await Promise.all([...mailFiles].map((file) => unlink(file)));
    } finally {
      await db.$disconnect();
    }
  });

  await t.test('healthcheck, cadastro, JWT, verificação, recuperação e RBAC', async () => {
    assert.deepEqual(await (await request('/health')).json(), { status: 'ok', database: 'up' });
    assert.equal((await request('/auth/me')).status, 401);
    const registration = { name: 'Cliente Teste', email, password };
    assert.equal((await request('/auth/register', 'POST', { ...registration, role: 'ADMIN' })).status, 400);
    assert.equal((await request('/auth/register', 'POST', { ...registration, name: '<script>alert(1)</script>' })).status, 400);
    const weak = await request('/auth/register', 'POST', { ...registration, password: 'Password12345678!' });
    assert.equal(weak.status, 400);
    assert.equal((await weak.json()).code, 'INVALID_PASSWORD');
    const register = await request('/auth/register', 'POST', registration);
    assert.equal(register.status, 201, await register.clone().text());
    const { user } = await register.json();
    assert.equal(user.role, 'CUSTOMER');
    userId = user.id;
    assert.equal((await request('/auth/login', 'POST', { email, password: 'senha errada' })).status, 401);
    const login = await request('/auth/login', 'POST', { email: email.toUpperCase(), password });
    assert.equal(login.status, 200);
    const oldToken = (await login.json()).accessToken;
    assert.equal((await request('/auth/me', 'GET', undefined, auth(oldToken))).status, 200);
    assert.equal((await request('/auth/me', 'GET', undefined, auth(`${oldToken}x`))).status, 401);
    assert.equal((await request('/admin/overview', 'GET', undefined, auth(oldToken))).status, 403);

    const verification = await codeFromMail('Verifique');
    assert.equal((await request('/auth/email/verify', 'POST', { token: verification })).status, 204);
    assert.equal((await request('/auth/email/verify', 'POST', { token: verification })).status, 400);
    assert.equal((await request('/auth/password/forgot', 'POST', { email })).status, 202);
    const reset = await codeFromMail('Redefina');
    const weakReset = await request('/auth/password/reset', 'POST', { token: reset, password: 'curta' });
    assert.equal(weakReset.status, 400);
    assert.equal((await weakReset.json()).code, 'INVALID_PASSWORD');
    assert.equal((await request('/auth/password/reset', 'POST', { token: reset, password: newPassword })).status, 204);
    assert.equal((await request('/auth/me', 'GET', undefined, auth(oldToken))).status, 401);
    const refreshed = await request('/auth/login', 'POST', { email, password: newPassword });
    assert.equal(refreshed.status, 200);
    token = (await refreshed.json()).accessToken;

    const admin = await request('/auth/login', 'POST', { email: adminEmail, password: adminPassword });
    assert.equal(admin.status, 200);
    const account = await admin.json();
    assert.equal(account.user.role, 'ADMIN');
    assert.equal((await request('/admin/overview', 'GET', undefined, auth(account.accessToken))).status, 200);
    assert.ok(await db.auditLog.findFirst({ where: { action: 'PASSWORD_RESET', actorUserId: userId } }));
  });

  await t.test('estoque independente por evento, concorrência, idempotência e FKs', async () => {
    assert.ok(token && userId);
    const startsAt = new Date(Date.now() + 3_600_000);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);
    const eventData = { title: 'Concorrência', venue: 'Sala', currency: 'BRL', status: 'PUBLISHED', startsAt, endsAt } as const;
    const event = await db.event.create({ data: { ...eventData, slug: fixture } });
    const other = await db.event.create({ data: { ...eventData, slug: `${fixture}-other` } });
    const sector = await db.sector.create({ data: { eventId: event.id, name: 'Terraço' } });
    await assert.rejects(db.eventTable.create({ data: {
      sectorId: sector.id, eventId: other.id, label: 'X', capacity: 4, priceMinor: 10000,
    } }), { code: 'P2003' });
    const table = await db.eventTable.create({ data: { sectorId: sector.id, eventId: event.id, label: 'T01', capacity: 4, priceMinor: 10000 } });
    const order = { eventId: event.id, tableId: table.id, guestCount: 4 };
    const reserve = (key: string, booking = order) => request('/reservations', 'POST', booking, { ...auth(token), 'idempotency-key': key });
    assert.equal((await reserve(randomUUID(), { ...order, eventId: other.id })).status, 404);

    const attempts = await Promise.all(Array.from({ length: 6 }, async () => {
      const key = randomUUID();
      return { key, response: await reserve(key) };
    }));
    assert.deepEqual(attempts.map(({ response }) => response.status).sort(), [201, 409, 409, 409, 409, 409]);
    const winner = attempts.find(({ response }) => response.status === 201)!;
    const { reservation } = await winner.response.json();
    assert.equal(reservation.amountMinor, 10000);
    assert.equal(reservation.status, 'PENDING_PAYMENT');
    assert.ok(Date.parse(reservation.expiresAt) > Date.now());
    const replay = await reserve(winner.key);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).reservation.id, reservation.id);
    assert.equal((await reserve(winner.key, { ...order, guestCount: 3 })).status, 409);

    await assert.rejects(db.reservation.create({ data: {
      ...order, userId, idempotencyKey: randomUUID(), capacity: 4, amountMinor: 10000,
      currency: 'BRL', expiresAt: new Date(Date.now() + 30_000),
    } }), { code: 'P2002' });
    await assert.rejects(db.payment.create({ data: {
      reservationId: reservation.id, provider: 'test', idempotencyKey: randomUUID(), amountMinor: 1, currency: 'BRL',
    } }), { code: 'P2003' });
    const eventResponse = await request(`/events/${fixture}`);
    assert.equal((await eventResponse.json()).event.sectors[0].tables[0].available, false);

    const otherSector = await db.sector.create({ data: { eventId: other.id, name: sector.name } });
    const otherTable = await db.eventTable.create({ data: {
      sectorId: otherSector.id, eventId: other.id, label: table.label, capacity: 4, priceMinor: 10000,
    } });
    assert.equal((await reserve(randomUUID(), { eventId: other.id, tableId: otherTable.id, guestCount: 4 })).status, 201);

    await db.$executeRaw`UPDATE reservations SET created_at = clock_timestamp() - interval '2 minutes',
      expires_at = clock_timestamp() - interval '1 minute' WHERE id = ${reservation.id}::uuid`;
    const next = await reserve(randomUUID());
    assert.equal(next.status, 201, await next.clone().text());
    const nextId = (await next.json()).reservation.id;
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, 'EXPIRED');
    assert.equal((await request(`/reservations/${nextId}`, 'DELETE', undefined, auth(token))).status, 204);
    assert.equal((await (await request(`/events/${fixture}`)).json()).event.sectors[0].tables[0].available, true);
  });

  await t.test('worker expira o bloqueio e libera a mesa para outro comprador', async () => {
    assert.ok(token && userId);
    const buyer = await db.user.create({ data: {
      email: buyerEmail, name: 'Comprador Teste', passwordHash: await hashPassword(password), emailVerifiedAt: new Date(),
    } });
    const login = await request('/auth/login', 'POST', { email: buyerEmail, password });
    assert.equal(login.status, 200);
    const buyerToken = (await login.json()).accessToken;

    const startsAt = new Date(Date.now() + 2 * 60_000);
    const event = await db.event.create({ data: {
      slug: expirationFixture, title: 'Expiração', venue: 'Sala', currency: 'BRL', status: 'PUBLISHED',
      startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000),
    } });
    const sector = await db.sector.create({ data: { eventId: event.id, name: 'Terraço' } });
    const tableData = { sectorId: sector.id, eventId: event.id, capacity: 4, priceMinor: 10000 };
    const table = await db.eventTable.create({ data: { ...tableData, label: 'T01' } });
    const soldTable = await db.eventTable.create({ data: { ...tableData, label: 'T02' } });
    const createdAt = new Date(Date.now() - 11 * 60_000);
    const sold = await db.reservation.create({ data: {
      tableId: soldTable.id, eventId: event.id, userId, idempotencyKey: randomUUID(), guestCount: 4,
      capacity: 4, amountMinor: 10000, currency: 'BRL', status: 'CONFIRMED',
      createdAt, confirmedAt: createdAt, expiresAt: new Date(createdAt.getTime() + 600_000),
    } });
    const reserve = (bearer: string, key = randomUUID()) => request('/reservations', 'POST', {
      eventId: event.id, tableId: table.id, guestCount: 4,
    }, { ...auth(bearer), 'idempotency-key': key });
    const firstKey = randomUUID();
    const first = await reserve(token, firstKey);
    assert.equal(first.status, 201, await first.clone().text());
    const { reservation } = await first.json();
    assert.equal(reservation.status, 'PENDING_PAYMENT');
    assert.equal(Date.parse(reservation.expiresAt) - Date.parse(reservation.createdAt), 600_000);
    assert.ok(Date.parse(reservation.expiresAt) > startsAt.getTime());
    assert.equal((await reserve(buyerToken)).status, 409);

    await db.$executeRaw`UPDATE reservations
      SET created_at = statement_timestamp() - interval '10 minutes 1 second',
          expires_at = statement_timestamp() - interval '1 second'
      WHERE id = ${reservation.id}::uuid`;
    // Read PostgreSQL directly so a new booking cannot trigger the fallback expiration.
    const deadline = performance.now() + 12_000;
    let status = 'PENDING_PAYMENT';
    while (performance.now() < deadline && status === 'PENDING_PAYMENT') {
      const stored = await db.reservation.findUniqueOrThrow({ where: { id: reservation.id }, select: { status: true } });
      status = stored.status;
      if (status === 'PENDING_PAYMENT') await delay(100);
    }
    assert.equal(status, 'EXPIRED');
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: sold.id } })).status, 'CONFIRMED');

    const { event: details } = await (await request(`/events/${expirationFixture}`)).json();
    assert.deepEqual(details.sectors[0].tables.map(({ available }: { available: boolean }) => available), [true, false]);
    const next = await reserve(buyerToken);
    assert.equal(next.status, 201, await next.clone().text());
    const { reservation: bought } = await next.json();
    assert.equal(bought.userId, buyer.id);
    assert.equal(bought.tableId, table.id);
    assert.equal(bought.status, 'PENDING_PAYMENT');
    const retry = await reserve(token, firstKey);
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).reservation.status, 'EXPIRED');
  });

  await t.test('Google com PKCE, callback de uso único e vínculo explícito', async () => {
    const google = configuredGoogle({ ...config, google: { clientId: 'test', clientSecret: 'test' } })!;
    let challenge = '';
    let expectedNonce = '';
    let profile = { subject: id, email: googleEmail, name: 'Google Teste', authoritativeEmail: true };
    const frontendOrigin = 'http://localhost:5173';
    const app = await buildApp({ ...config, frontendOrigin }, { logger: false, google: {
      authorizationUrl(state, nonce, codeChallenge) {
        challenge = codeChallenge;
        expectedNonce = nonce;
        return google.authorizationUrl(state, nonce, codeChallenge);
      },
      async exchange(code, verifier, nonce) {
        assert.equal(code, 'code-test');
        assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge);
        assert.equal(nonce, expectedNonce);
        return profile;
      },
    } });
    try {
      const start = await app.inject('/auth/google');
      assert.equal(start.statusCode, 302, start.body);
      const googleAuth = new URL(start.headers.location!);
      assert.equal(googleAuth.origin, 'https://accounts.google.com');
      assert.equal(googleAuth.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(googleAuth.searchParams.get('nonce'), expectedNonce);
      assert.equal(googleAuth.searchParams.get('redirect_uri'), `${config.appOrigin}/auth/google/callback`);
      const state = googleAuth.searchParams.get('state');
      const url = `/auth/google/callback?state=${state}&code=code-test`;
      const binding = start.cookies[0]!;
      assert.equal((await app.inject(url)).statusCode, 400);
      const cookies = { [binding.name]: binding.value };
      const callback = await app.inject({ url, cookies });
      assert.equal(callback.statusCode, 303, callback.body);
      assert.equal(callback.headers.location, `${frontendOrigin}/auth/callback`);
      const session = callback.cookies.find(({ name }) => name === 'mesa_session')!;
      assert.equal(session.httpOnly, true);
      const current = await app.inject({ url: '/auth/me', cookies: { [session.name]: session.value } });
      assert.equal(current.statusCode, 200, current.body);
      assert.equal(current.json().user.email, googleEmail);
      assert.equal(current.json().user.role, 'CUSTOMER');
      assert.equal((await app.inject({ url, cookies })).statusCode, 400);

      profile = { subject: `${id}-admin`, email: adminEmail, name: 'Admin Teste', authoritativeEmail: true };
      const collision = await app.inject('/auth/google');
      const collisionState = new URL(collision.headers.location!).searchParams.get('state');
      const collisionBinding = collision.cookies[0]!;
      const rejected = await app.inject({
        url: `/auth/google/callback?state=${collisionState}&code=code-test`,
        cookies: { [collisionBinding.name]: collisionBinding.value },
      });
      assert.equal(rejected.statusCode, 409, rejected.body);
      assert.ok(rejected.cookies.every(({ name }) => name !== 'mesa_session'));

      profile = { subject: `${id}-linked`, email, name: 'Cliente Teste', authoritativeEmail: false };
      assert.equal((await app.inject({
        method: 'POST', url: '/auth/google/link', cookies: { [session.name]: session.value },
      })).statusCode, 403);
      const link = await app.inject({ method: 'POST', url: '/auth/google/link', headers: auth(token) });
      assert.equal(link.statusCode, 200, link.body);
      const linkState = new URL(link.json().authorizationUrl).searchParams.get('state');
      const linkBinding = link.cookies[0]!;
      const linked = await app.inject({
        url: `/auth/google/callback?state=${linkState}&code=code-test`,
        cookies: { [linkBinding.name]: linkBinding.value },
      });
      assert.equal(linked.statusCode, 303, linked.body);
      const linkedSession = linked.cookies.find(({ name }) => name === 'mesa_session')!;
      const linkedAccount = await app.inject({ url: '/auth/me', cookies: { [linkedSession.name]: linkedSession.value } });
      assert.equal(linkedAccount.json().user.id, userId);
    } finally {
      await app.close();
    }
  });
});
