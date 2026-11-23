import assert from 'node:assert/strict';
import { createDecipheriv, createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/credentials.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { mercadoPagoGateway } from '../src/payments/mercado-pago.js';

test('checkout, webhooks e comprovantes no PostgreSQL', async (t) => {
  const config = { ...loadConfig(), captcha: undefined, trustedProxies: [] };
  assert.equal(config.payments.provider, 'mock');
  assert.equal(new URL(config.databaseUrl).hostname, '127.0.0.1');
  const db = createDb(config.databaseUrl);
  const app = await buildApp(config, { logger: false });
  const testId = randomUUID();
  const fixture = `checkout-${testId}`;
  const remoteAddress = `2001:db8:${testId.slice(0, 4)}:${testId.slice(4, 8)}::1`;
  const inject = (input: InjectOptions) => app.inject({ remoteAddress, ...input });
  const emails = [`${fixture}@example.test`, `${fixture}-outro@example.test`];
  t.after(async () => {
    try {
      await app.close();
      const event = await db.event.findUnique({ where: { slug: fixture }, select: { id: true } });
      if (event) {
        const reservations = await db.reservation.findMany({ where: { eventId: event.id }, select: { id: true } });
        await db.$transaction([
          db.auditLog.deleteMany({ where: { reservationId: { in: reservations.map(({ id }) => id) } } }),
          db.payment.deleteMany({ where: { reservation: { eventId: event.id } } }),
          db.reservation.deleteMany({ where: { eventId: event.id } }),
          db.eventTable.deleteMany({ where: { eventId: event.id } }),
          db.sector.deleteMany({ where: { eventId: event.id } }),
          db.event.delete({ where: { id: event.id } }),
        ]);
      }
      await db.user.deleteMany({ where: { email: { in: emails } } });
    } finally {
      await db.$disconnect();
    }
  });

  const password = 'Checkout de Teste 2026!';
  const passwordHash = await hashPassword(password);
  async function login(email: string) {
    const account = await db.user.create({ data: { email, name: 'Comprador', emailVerifiedAt: new Date(), passwordHash } });
    const loginResponse = await inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(loginResponse.statusCode, 200);
    return { id: account.id, authorization: `Bearer ${loginResponse.json().accessToken}` };
  }
  const customer = await login(emails[0]!);
  const other = await login(emails[1]!);
  const event = await db.event.create({ data: {
    slug: fixture, title: 'Checkout', venue: 'Sala', currency: 'BRL', status: 'PUBLISHED',
    startsAt: new Date(Date.now() + 3_600_000), endsAt: new Date(Date.now() + 7_200_000),
  } });
  const sector = await db.sector.create({ data: { eventId: event.id, name: 'Pista' } });

  function reserve(tableId: string, owner = customer) {
    return inject({ method: 'POST', url: '/reservations',
      headers: { authorization: owner.authorization, 'idempotency-key': randomUUID() },
      payload: { eventId: event.id, tableId, guestCount: 2 },
    });
  }

  async function newReservation(label: string) {
    const table = await db.eventTable.create({ data: {
      label, eventId: event.id, sectorId: sector.id, capacity: 4, priceMinor: 9950,
    } });
    const response = await reserve(table.id);
    assert.equal(response.statusCode, 201, response.body);
    return { table, reservationId: response.json().reservation.id as string };
  }

  function checkout(reservationId: string, payload: object, key = randomUUID(), owner = customer) {
    return inject({ method: 'POST', url: `/reservations/${reservationId}/checkout`, payload,
      headers: { authorization: owner.authorization, 'idempotency-key': key },
    });
  }

  function webhook(payload: object, valid = true) {
    const body = JSON.stringify(payload, null, 2);
    return inject({ method: 'POST', url: '/webhooks/payment', payload: body,
      headers: { 'content-type': 'application/json',
        'x-signature': createHmac('sha256', config.payments.webhookSecret).update(valid ? body : `${body} `).digest('hex'),
      },
    });
  }

  async function publicStatus(tableId: string, status: string, available: boolean) {
    const catalog = await app.inject(`/events/${fixture}`);
    assert.equal(catalog.statusCode, 200);
    const tables: Array<{ id: string; status: string; available: boolean }> = catalog.json().event.sectors[0].tables;
    const table = tables.find(({ id }) => id === tableId);
    assert.equal(table?.status, status);
    assert.equal(table?.available, available);
  }

  await t.test('Pix gera QR e copia-e-cola e confirma uma vez por webhook assinado', async () => {
    const { table, reservationId } = await newReservation('PIX');
    const key = randomUUID();
    const pix = { method: 'PIX' };
    assert.equal((await inject({ method: 'DELETE', url: `/reservations/${reservationId}`,
      headers: { authorization: other.authorization } })).statusCode, 404);
    assert.equal((await checkout(reservationId, pix, randomUUID(), other)).statusCode, 404);
    assert.equal((await checkout(reservationId, { ...pix, identification: { type: 'CPF', number: '12345678901', role: 'ADMIN' } })).statusCode, 400);
    const first = await checkout(reservationId, pix, key);
    assert.equal(first.statusCode, 201, first.body);
    const { payment } = first.json();
    assert.equal(payment.method, 'PIX');
    assert.equal(payment.status, 'PENDING');
    assert.equal(payment.amountMinor, 9950);
    assert.match(payment.pix.copyPasteCode, /^PIX-SIMULADO-SEM-VALOR:/);
    assert.match(payment.pix.qrCode, /^data:image\/png;base64,/);
    const replay = await checkout(reservationId, pix, key);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().payment.id, payment.id);
    assert.equal((await checkout(reservationId, pix)).statusCode, 409);
    await publicStatus(table.id, 'RESERVED', false);

    const eventPayload = { eventId: randomUUID(), paymentId: payment.id, method: 'PIX', amountMinor: 9950,
      currency: 'BRL', outcome: 'APPROVED', approvedAt: new Date().toISOString() };
    assert.equal((await webhook(eventPayload, false)).statusCode, 401);
    assert.equal((await webhook({ ...eventPayload, status: 'SUCCEEDED' })).statusCode, 400);
    assert.equal((await webhook({ ...eventPayload, amountMinor: 1 })).statusCode, 422);
    assert.equal(await db.paymentWebhookEvent.count({ where: { paymentId: payment.id } }), 0);
    const replies = await Promise.all(Array.from({ length: 4 }, () => webhook(eventPayload)));
    assert.ok(replies.every(({ statusCode }) => statusCode === 200), replies.map(({ body }) => body).join('\n'));
    assert.equal(replies.filter((reply) => reply.json().duplicate).length, 3);
    assert.equal(await db.paymentWebhookEvent.count({ where: { paymentId: payment.id } }), 1);
    const paid = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(paid.status, 'SUCCEEDED');
    const confirmed = await db.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.ok(confirmed.ticketToken && confirmed.confirmedAt);
    await publicStatus(table.id, 'SOLD', false);
    assert.equal((await reserve(table.id, other)).statusCode, 409);

    const receiptPath = `/reservations/${reservationId}/receipt`;
    assert.equal((await app.inject({ url: receiptPath, headers: { authorization: other.authorization } })).statusCode, 404);
    const receipt = await app.inject({ url: receiptPath, headers: { authorization: customer.authorization } });
    assert.equal(receipt.statusCode, 200, receipt.body);
    const { ticket } = receipt.json().receipt;
    assert.equal(ticket.token, confirmed.ticketToken);
    assert.match(ticket.qrCode, /^data:image\/png;base64,/);
    assert.equal(ticket.token.includes(reservationId), false);
    const [version, nonce, encrypted, tag] = confirmed.ticketToken.split('.');
    assert.equal(version, 'mesa-ticket-v1');
    const decipher = createDecipheriv('aes-256-gcm', config.payments.ticketKey, Buffer.from(nonce!, 'base64url'));
    decipher.setAAD(Buffer.from(version));
    decipher.setAuthTag(Buffer.from(tag!, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted!, 'base64url')), decipher.final()]);
    assert.deepEqual(JSON.parse(plaintext.toString('utf8')), { reservationId, eventId: event.id });
    assert.equal((await webhook({ ...eventPayload, eventId: randomUUID() })).statusCode, 200);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservationId } })).ticketToken, ticket.token);
    const audit = await db.auditLog.findMany({ where: { action: 'PAYMENT_STATUS_CHANGED', paymentId: payment.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(audit.map(({ details }) => details), [
      { provider: 'mock', previousStatus: null, status: 'PENDING', amountMinor: 9950, currency: 'BRL' },
      { provider: 'mock', previousStatus: 'PENDING', status: 'SUCCEEDED', amountMinor: 9950, currency: 'BRL' },
    ]);
    assert.ok(audit.every((entry) => entry.reservationId === reservationId));
  });

  await t.test('cartão tokenizado pode ser recusado e repetido dentro do prazo', async () => {
    const { reservationId, table } = await newReservation('CARTAO');
    const card = { method: 'CREDIT_CARD', cardToken: 'mock-card-test-token', paymentMethodId: 'visa', installments: 1 };
    assert.equal((await checkout(reservationId, { ...card, cardToken: '4111111111111111' })).statusCode, 400);
    const first = await checkout(reservationId, card);
    assert.equal(first.statusCode, 201, first.body);
    const { payment } = first.json();
    assert.equal(payment.method, 'CREDIT_CARD');
    assert.equal(payment.pix, undefined);
    assert.equal(first.body.includes(card.cardToken), false);
    const refused = { eventId: randomUUID(), paymentId: payment.id, method: card.method, amountMinor: 9950,
      currency: 'BRL', outcome: 'DECLINED' };
    assert.equal((await webhook(refused)).statusCode, 200);
    const progress = await app.inject({ url: `/reservations/${reservationId}/payments/${payment.id}`,
      headers: { authorization: customer.authorization } });
    assert.equal(progress.json().payment.status, 'FAILED');
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservationId } })).ticketToken, null);
    await publicStatus(table.id, 'RESERVED', false);
    const retry = await checkout(reservationId, { ...card, cardToken: 'mock-new-card-token' });
    assert.equal(retry.statusCode, 201, retry.body);
    const approval = await webhook({ ...refused, eventId: randomUUID(), paymentId: retry.json().payment.id,
      outcome: 'APPROVED', approvedAt: new Date().toISOString() });
    assert.equal(approval.statusCode, 200, approval.body);
    await publicStatus(table.id, 'SOLD', false);
  });

  await t.test('aprovação tardia registra reembolso e preserva a mesa do novo comprador', async () => {
    const { reservationId, table } = await newReservation('EXPIRADA');
    const charge = await checkout(reservationId, { method: 'PIX' });
    assert.equal(charge.statusCode, 201, charge.body);
    await db.$executeRaw`UPDATE reservations SET created_at = statement_timestamp() - interval '11 minutes',
      expires_at = statement_timestamp() - interval '1 minute' WHERE id = ${reservationId}::uuid`;
    assert.equal((await checkout(reservationId, { method: 'PIX' })).statusCode, 409);
    await publicStatus(table.id, 'AVAILABLE', true);
    const next = await reserve(table.id, other);
    assert.equal(next.statusCode, 201, next.body);
    const late = await webhook({ eventId: randomUUID(), paymentId: charge.json().payment.id, method: 'PIX',
      amountMinor: 9950, currency: 'BRL', outcome: 'APPROVED', approvedAt: new Date().toISOString() });
    assert.equal(late.statusCode, 200, late.body);
    const payment = await db.payment.findUniqueOrThrow({ where: { id: charge.json().payment.id } });
    assert.equal(payment.status, 'REFUND_REQUIRED');
    assert.ok(payment.paidAt);
    await db.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED', refundedAt: new Date() } });
    const audit = await db.auditLog.findMany({ where: { paymentId: payment.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(audit.map(({ details }) => (details as { status: string }).status), ['PENDING', 'REFUND_REQUIRED', 'REFUNDED']);
    const expired = await db.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    assert.equal(expired.status, 'EXPIRED');
    assert.equal(expired.ticketToken, null);
    const replacement = await db.reservation.findUniqueOrThrow({ where: { id: next.json().reservation.id } });
    assert.equal(replacement.userId, other.id);
    assert.equal(replacement.status, 'PENDING_PAYMENT');
    await publicStatus(table.id, 'RESERVED', false);
  });

  await t.test('demo online aceita Netlify, separa cotas por cliente e confirma o Pix do titular', async () => {
    const frontendOrigin = 'https://mesa-demo.netlify.app';
    const env = {
      NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock', SMTP_URL: '', TURNSTILE_SECRET_KEY: '',
      APP_ORIGIN: '', RENDER_EXTERNAL_URL: 'https://mesa-demo.onrender.com', FRONTEND_ORIGIN: frontendOrigin,
      CORS_ORIGINS: 'https://outro-site.netlify.app', TRUSTED_PROXIES: '10.20.30.40',
      TICKET_ENCRYPTION_KEY: config.payments.ticketKey.toString('base64url'),
    };
    const previous = Object.entries(env).map(([key, value]) => {
      const before = process.env[key];
      process.env[key] = value;
      return [key, before] as const;
    });
    const demo = await buildApp((() => {
      try {
        process.env.CORS_ORIGINS = 'https://*.netlify.app';
        assert.throws(loadConfig, /CORS_ORIGINS.*explícitas/);
        process.env.CORS_ORIGINS = env.CORS_ORIGINS;
        process.env.PAYMENT_PROVIDER = '';
        assert.throws(loadConfig, /Configure PAYMENT_PROVIDER/);
        process.env.PAYMENT_PROVIDER = 'mock';
        return loadConfig();
      } finally {
        for (const [key, value] of previous) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    })(), { logger: false });

    const email = `${fixture}-demo@example.test`;
    emails.push(email);
    const proxyRequest = (input: InjectOptions, clientIp = '192.0.2.51', claimedIp = '198.51.100.9') => demo.inject({
      ...input, remoteAddress: '10.20.30.40',
      headers: { origin: frontendOrigin, 'x-forwarded-for': `${claimedIp}, ${clientIp}`, ...input.headers },
    });
    try {
      const preflight = await proxyRequest({ method: 'OPTIONS', url: '/auth/register',
        headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
      assert.equal(preflight.statusCode, 204);
      assert.equal(preflight.headers['access-control-allow-origin'], frontendOrigin);
      const denied = await proxyRequest({ method: 'OPTIONS', url: '/auth/register', headers: { origin: 'https://outra-conta.netlify.app' } });
      assert.equal(denied.statusCode, 403);
      assert.equal(denied.headers['access-control-allow-origin'], undefined);

      const registered = await proxyRequest({ method: 'POST', url: '/auth/register', payload: { email, name: 'Demo online', password } });
      assert.equal(registered.statusCode, 201, registered.body);
      const { user } = registered.json();
      assert.ok(user.emailVerifiedAt);
      assert.equal(user.role, 'CUSTOMER');
      assert.equal(await db.accountToken.count({ where: { userId: user.id } }), 0);
      const invalid = { method: 'POST', url: '/auth/register', payload: {} } as const;
      assert.equal((await proxyRequest(invalid, '192.0.2.51', '198.51.100.10')).headers['x-ratelimit-remaining'], '3');
      assert.equal((await proxyRequest(invalid, '192.0.2.52')).headers['x-ratelimit-remaining'], '4');

      const login = await proxyRequest({ method: 'POST', url: '/auth/login', payload: { email, password } });
      assert.equal(login.statusCode, 200, login.body);
      const authorization = `Bearer ${login.json().accessToken}`;
      const table = await db.eventTable.create({ data: { label: 'DEMO', eventId: event.id, sectorId: sector.id, capacity: 4, priceMinor: 9950 } });
      const reserved = await proxyRequest({ method: 'POST', url: '/reservations',
        headers: { authorization, 'idempotency-key': randomUUID() },
        payload: { eventId: event.id, tableId: table.id, guestCount: 2 },
      });
      assert.equal(reserved.statusCode, 201, reserved.body);
      const reservationUrl = `/reservations/${reserved.json().reservation.id}`;
      const charge = await proxyRequest({ method: 'POST', url: `${reservationUrl}/checkout`,
        headers: { authorization, 'idempotency-key': randomUUID() }, payload: { method: 'PIX' },
      });
      assert.equal(charge.statusCode, 201, charge.body);
      assert.equal(charge.json().payment.canSimulate, true);
      assert.match(charge.json().payment.pix.copyPasteCode, /^PIX-SIMULADO/);
      const url = `${reservationUrl}/payments/${charge.json().payment.id}/simulate`;
      assert.equal((await app.inject({ method: 'POST', url, headers: { authorization } })).statusCode, 404);
      assert.equal((await proxyRequest({ method: 'POST', url, headers: { authorization: other.authorization } })).statusCode, 404);
      const simulations = await Promise.all([1, 2].map(() => proxyRequest({ method: 'POST', url, headers: { authorization } })));
      assert.deepEqual(simulations.map(({ statusCode }) => statusCode), [204, 204]);
      const receipt = await proxyRequest({ url: `${reservationUrl}/receipt`, headers: { authorization } });
      assert.equal(receipt.statusCode, 200, receipt.body);
      assert.match(receipt.json().receipt.ticket.qrCode, /^data:image\/png/);
      await publicStatus(table.id, 'SOLD', false);
    } finally {
      await demo.close();
    }
  });
});

test('adaptador Mercado Pago usa cobrança idempotente e valida a notificação com a API', async () => {
  const paymentId = randomUUID();
  const secret = 'fixture-mercado-pago';
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/payment_methods')) return Response.json([
      { id: 'visa', status: 'active', payment_type_id: 'credit_card' },
      { id: 'debvisa', status: 'active', payment_type_id: 'debit_card' },
    ]);
    if (init?.method === 'POST') return Response.json({ id: 123456, status: 'pending',
      point_of_interaction: { transaction_data: { qr_code: 'pix-provedor' } } });
    return Response.json({ id: 123456, external_reference: paymentId, status: 'approved', payment_method_id: 'pix',
      transaction_amount: '99.50', currency_id: 'BRL', date_approved: '2026-11-22T10:00:00Z', date_last_updated: '2026-11-22T10:00:01Z' });
  };
  const gateway = mercadoPagoGateway('test-access-token', secret, fakeFetch);
  const request = { paymentId, amountMinor: 9950, currency: 'BRL', expiresAt: new Date(Date.now() + 600_000), email: 'buyer@example.test' };
  assert.deepEqual(await gateway.createCharge({ ...request, details: { method: 'PIX', identification: { type: 'CPF', number: '00000000000' } } }),
    { providerPaymentId: '123456', pixCode: 'pix-provedor' });
  await gateway.createCharge({ ...request, details: {
    method: 'CREDIT_CARD', cardToken: 'fake-provider-card-token', paymentMethodId: 'visa', installments: 2,
  } });
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://api.mercadopago.com/v1/payments', 'https://api.mercadopago.com/v1/payment_methods', 'https://api.mercadopago.com/v1/payments',
  ]);
  assert.equal(new Headers(calls[0]?.init?.headers).get('x-idempotency-key'), paymentId);
  const pixRequest = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(pixRequest.external_reference, paymentId);
  assert.equal(pixRequest.transaction_amount, 99.5);
  const cardRequest = JSON.parse(String(calls[2]?.init?.body));
  assert.equal(cardRequest.token, 'fake-provider-card-token');
  assert.equal(cardRequest.installments, 2);
  await assert.rejects(gateway.createCharge({ ...request, details: {
    method: 'CREDIT_CARD', cardToken: 'fake-provider-card-token', paymentMethodId: 'debvisa', installments: 1,
  } }), { code: 'CHARGE_REJECTED' });

  const ts = '1795341600';
  const requestId = 'request-123';
  const signature = createHmac('sha256', secret).update(`id:123456;request-id:${requestId};ts:${ts};`).digest('hex');
  const notification = { query: new URLSearchParams({ 'data.id': '123456' }), body: Buffer.from('{"status":"rejected"}'),
    headers: { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${signature}` } };
  await assert.rejects(gateway.readWebhook({ ...notification, query: new URLSearchParams({ 'data.id': '123457' }) }), { statusCode: 401 });
  await assert.rejects(gateway.readWebhook({ ...notification, headers: {
    ...notification.headers, 'x-signature': `ts=${ts},v1=${signature},v1=${signature}`,
  } }), { statusCode: 401 });
  assert.equal(calls.length, 3);
  const verified = await gateway.readWebhook(notification);
  assert.equal(calls[3]?.url, 'https://api.mercadopago.com/v1/payments/123456');
  assert.equal(verified?.outcome, 'APPROVED');
  assert.equal(verified?.amountMinor, 9950);
});
