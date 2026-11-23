import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/credentials.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { createTicket } from '../src/payments/ticket.js';

async function openStream(url: string, cursor?: string) {
  const response = await fetch(url, {
    headers: cursor ? { 'last-event-id': cursor } : {}, signal: AbortSignal.timeout(16_000),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  return {
    close: () => reader.cancel(),
    async next() {
      while (true) {
        const end = pending.indexOf('\n\n');
        if (end !== -1) {
          const message = new Map(pending.slice(0, end).split('\n').map((line) => {
            const separator = line.indexOf(': ');
            return [line.slice(0, separator), line.slice(separator + 2)];
          }));
          pending = pending.slice(end + 2);
          const type = message.get('event');
          if (type) return { type, id: message.get('id')!, data: JSON.parse(message.get('data')!) };
        } else {
          const item = await reader.read();
          assert.ok(!item.done, 'SSE encerrou antes do próximo evento');
          pending += decoder.decode(item.value, { stream: true });
        }
      }
    },
  };
}

test('gestão administrativa, disponibilidade ao vivo e portaria', async (t) => {
  const config = { ...loadConfig(), captcha: undefined, trustedProxies: [] };
  assert.equal(new URL(config.databaseUrl).hostname, '127.0.0.1');
  assert.equal(config.payments.provider, 'mock');
  const db = createDb(config.databaseUrl);
  const app = await buildApp(config, { logger: false });
  const replica = await buildApp(config, { logger: false });
  const eventIds = new Set<string>();
  const userIds = new Set<string>();
  t.after(async () => {
    try {
      await Promise.all([app.close(), replica.close()]);
      const events = [...eventIds];
      const users = [...userIds];
      const fixtures = await db.reservation.findMany({ where: { eventId: { in: events } }, select: { id: true } });
      const reservationIds = fixtures.map(({ id }) => id);
      await db.$transaction([
        db.auditLog.deleteMany({ where: { OR: [
          { eventId: { in: events } }, { reservationId: { in: reservationIds } },
          { actorUserId: { in: users } }, { subjectUserId: { in: users } },
        ] } }),
        db.payment.deleteMany({ where: { reservationId: { in: reservationIds } } }),
        db.reservation.deleteMany({ where: { id: { in: reservationIds } } }),
        db.eventTable.deleteMany({ where: { eventId: { in: events } } }),
        db.sector.deleteMany({ where: { eventId: { in: events } } }),
        db.event.deleteMany({ where: { id: { in: events } } }),
        db.user.deleteMany({ where: { id: { in: users } } }),
      ]);
    } finally {
      await db.$disconnect();
    }
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const fixture = randomUUID();
  const remoteAddress = `2001:db8:${fixture.slice(0, 4)}:${fixture.slice(4, 8)}::1`;
  const inject = (request: InjectOptions, instance = app) => instance.inject({ remoteAddress, ...request });
  const password = 'Mapa e portaria do parque';
  const passwordHash = await hashPassword(password);
  async function user(role: 'ADMIN' | 'CUSTOMER') {
    const email = `${role.toLowerCase()}-${fixture}@example.test`;
    const account = await db.user.create({ data: { email, role, passwordHash, name: role, emailVerifiedAt: new Date() } });
    userIds.add(account.id);
    const result = await inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(result.statusCode, 200, result.body);
    return { ...account, authorization: `Bearer ${result.json().accessToken}` };
  }
  const admin = await user('ADMIN');
  const buyer = await user('CUSTOMER');
  const adminCall = (method: InjectOptions['method'], path: string, payload?: object, instance = app) =>
    inject({ method, url: path, payload, headers: { authorization: admin.authorization } }, instance);

  const slug = `operacao-${fixture}`;
  const eventInput = {
    slug, title: 'Noite na Serra', description: 'Música e cultura\nPortas às 19h.',
    startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: new Date(Date.now() + 7_200_000).toISOString(),
    venue: 'Armazém Serra', city: 'Nova Serra', category: 'Música', displayMode: 'MAP',
  };
  let eventId = '';
  let eventPath = '';
  let tablePath = '';
  let sellTable = '';
  let expireTable = '';
  let pendingTable = '';
  let soldReservationId = '';
  let pendingReservationId = '';
  let floorImageUrl = '';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNioAAAAASUVORK5CYII=', 'base64');

  await t.test('CRUD de eventos, setores e mesas, planta, imagens e auditoria', async () => {
    assert.equal((await inject({ method: 'POST', url: '/admin/events', payload: eventInput })).statusCode, 401);
    assert.equal((await inject({ method: 'POST', url: '/admin/events', payload: eventInput,
      headers: { authorization: buyer.authorization } })).statusCode, 403);
    assert.equal((await adminCall('POST', '/admin/events', { ...eventInput, endsAt: eventInput.startsAt })).statusCode, 400);
    assert.equal((await adminCall('POST', '/admin/events', { ...eventInput, coverImageUrl: 'javascript:alert(1)' })).statusCode, 400);
    const created = await adminCall('POST', '/admin/events', { ...eventInput, bannerImageUrl: 'https://example.test/banner.webp' });
    assert.equal(created.statusCode, 201, created.body);
    eventId = created.json().event.id;
    eventIds.add(eventId);
    eventPath = `/admin/events/${eventId}`;
    assert.equal(created.json().event.status, 'DRAFT');
    const repeated = await adminCall('POST', '/admin/events', eventInput);
    assert.equal(repeated.statusCode, 409, repeated.body);
    const list = await adminCall('GET', '/admin/events?status=DRAFT');
    assert.ok(list.json().events.some((event: { id: string }) => event.id === eventId));
    assert.equal((await inject({ url: `/events/${slug}` })).statusCode, 404);
    assert.equal((await inject({ url: `/events/${eventId}/stream` })).statusCode, 404);

    const other = await adminCall('POST', '/admin/events', { ...eventInput, slug: `${slug}-outro` });
    assert.equal(other.statusCode, 201, other.body);
    const otherId = other.json().event.id;
    eventIds.add(otherId);
    const otherPath = `/admin/events/${otherId}`;
    const sectorInput = { name: 'Pista', description: 'Fileiras perto do palco', basePriceMinor: 10000 };
    const otherSector = await adminCall('POST', `${otherPath}/sectors`, sectorInput);
    assert.equal(otherSector.statusCode, 201, otherSector.body);
    const otherSectorId = otherSector.json().sector.id;
    const otherTable = await adminCall('POST', `${otherPath}/sectors/${otherSectorId}/tables`, { label: 'X1', capacity: 2 });
    assert.equal(otherTable.statusCode, 201, otherTable.body);

    const newSector = await adminCall('POST', `${eventPath}/sectors`, sectorInput);
    assert.equal(newSector.statusCode, 201, newSector.body);
    const sectorId = newSector.json().sector.id;
    const sectorPath = `${eventPath}/sectors/${sectorId}`;
    tablePath = `${sectorPath}/tables`;
    const changedSector = await adminCall('PATCH', sectorPath, { name: 'Pista Central', basePriceMinor: 12000 });
    assert.equal(changedSector.statusCode, 200, changedSector.body);
    assert.equal((await adminCall('GET', `${eventPath}/sectors`)).json().sectors[0].name, 'Pista Central');
    assert.equal((await adminCall('PATCH', `${otherPath}/sectors/${sectorId}`, { name: 'Outro' })).statusCode, 404);

    const single = await adminCall('POST', tablePath, { label: 'P1', capacity: 4 });
    assert.equal(single.statusCode, 201, single.body);
    assert.equal(single.json().table.priceMinor, 12000);
    sellTable = single.json().table.id;
    assert.equal((await adminCall('PATCH', `${tablePath}/${sellTable}`, { priceMinor: 22000 })).statusCode, 200);
    assert.equal((await adminCall('PATCH', `${tablePath}/${sellTable}`, { sectorId: otherSectorId })).statusCode, 404);
    assert.equal((await adminCall('POST', `${tablePath}/batch`, { prefix: 'P', startNumber: 1, count: 2, capacity: 4 })).statusCode, 409);
    assert.equal((await adminCall('GET', sectorPath)).json().sector.tables.length, 1);
    const batch = await adminCall('POST', `${tablePath}/batch`, { prefix: 'P', startNumber: 2, count: 3, capacity: 4 });
    assert.equal(batch.statusCode, 201, batch.body);
    assert.deepEqual(batch.json().tables.map((table: { label: string }) => table.label), ['P2', 'P3', 'P4']);
    [expireTable, pendingTable] = batch.json().tables.map((table: { id: string }) => table.id);
    assert.equal((await adminCall('PATCH', `${tablePath}/${batch.json().tables[2].id}`, { isEnabled: false })).statusCode, 200);
    const disposable = await adminCall('POST', tablePath, { label: 'Remover', capacity: 2 });
    assert.equal((await adminCall('DELETE', `${tablePath}/${disposable.json().table.id}`)).statusCode, 204);
    assert.equal((await adminCall('GET', `${tablePath}/${disposable.json().table.id}`)).statusCode, 404);

    const layout = { floorPlanImageUrl: 'https://example.test/planta.png', tables: [{ tableId: sellTable, x: 40.5, y: 25 }] };
    const foreign = await adminCall('PUT', `${eventPath}/layout`, {
      ...layout, tables: [...layout.tables, { tableId: otherTable.json().table.id, x: 15, y: 16 }],
    });
    assert.equal(foreign.statusCode, 404, foreign.body);
    assert.equal((await adminCall('GET', `${tablePath}/${sellTable}`)).json().table.x, null);
    assert.equal((await adminCall('PUT', `${eventPath}/layout`, layout)).statusCode, 200);
    assert.equal((await adminCall('GET', eventPath)).json().event.sectors[0].tables[0].x, 40.5);

    const upload = (kind: string, mediaType: string) => inject({
      method: 'POST', url: `${eventPath}/images/${kind}`, payload: png,
      headers: { authorization: admin.authorization, 'content-type': mediaType },
    });
    assert.equal((await upload('floor-plan', 'image/jpeg')).statusCode, 400);
    assert.equal((await upload('floor-plan', 'image/svg+xml')).statusCode, 415);
    const uploaded = await upload('floor-plan', 'image/png');
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    floorImageUrl = uploaded.json().image.url;
    assert.equal((await inject({ url: floorImageUrl })).statusCode, 404);
    const preview = await adminCall('GET', floorImageUrl);
    assert.equal(preview.headers['content-type'], 'image/png');
    assert.deepEqual(preview.rawPayload, png);

    assert.equal((await adminCall('DELETE', `${otherPath}/sectors/${otherSectorId}`)).statusCode, 204);
    assert.equal((await adminCall('DELETE', otherPath)).statusCode, 204);
    assert.equal((await adminCall('GET', otherPath)).statusCode, 404);
    const publish = await adminCall('PATCH', eventPath, { status: 'PUBLISHED', displayMode: 'BOTH', coverImageUrl: 'https://example.test/capa.png' });
    assert.equal(publish.statusCode, 200, publish.body);
    assert.equal(publish.json().event.displayMode, 'BOTH');
    assert.equal((await inject({ url: floorImageUrl })).statusCode, 200);
    const filters = new URLSearchParams({
      city: 'nova serra', venue: eventInput.venue, category: eventInput.category, startsTo: eventInput.endsAt,
      minPriceMinor: '12000', maxPriceMinor: '22000', availability: 'AVAILABLE',
    });
    const publicList = await inject({ url: `/events?${filters}` });
    assert.equal(publicList.statusCode, 200, publicList.body);
    assert.ok(publicList.json().events.some((event: { id: string }) => event.id === eventId));
    filters.set('city', 'Outra cidade');
    assert.equal((await inject({ url: `/events?${filters}` })).json().events.length, 0);
    const audit = await db.auditLog.findMany({ where: { eventId: { in: [eventId, otherId] }, actorUserId: admin.id } });
    const actions = new Set(audit.map(({ action }) => action));
    for (const action of [
      'ADMIN_EVENT_CREATED', 'ADMIN_EVENT_UPDATED', 'ADMIN_EVENT_DELETED', 'ADMIN_SECTOR_CREATED',
      'ADMIN_SECTOR_UPDATED', 'ADMIN_SECTOR_DELETED', 'ADMIN_TABLE_CREATED', 'ADMIN_TABLE_UPDATED',
      'ADMIN_TABLE_DELETED', 'ADMIN_TABLES_CREATED', 'ADMIN_EVENT_LAYOUT_UPDATED', 'ADMIN_EVENT_IMAGE_UPLOADED',
    ] as const) assert.ok(actions.has(action), action);
  });

  await t.test('SSE entre instâncias, retomada, expiração, venda, filtros e dashboard', async () => {
    assert.ok(eventId && expireTable && pendingTable);
    const eventsUrl = `${url}/events/${eventId}/stream`;
    const stream = await openStream(eventsUrl);
    try {
      const snapshot = await stream.next();
      assert.equal(snapshot.type, 'snapshot');
      assert.equal(snapshot.data.tables.length, 3);
      assert.ok(snapshot.data.tables.every((item: { available: boolean }) => item.available));
      async function reserve(tableId: string): Promise<string> {
        const result = await inject({ method: 'POST', url: '/reservations', payload: { eventId, tableId, guestCount: 2 },
          headers: { authorization: buyer.authorization, 'idempotency-key': randomUUID() } }, replica);
        assert.equal(result.statusCode, 201, result.body);
        return result.json().reservation.id;
      }
      const cancelled = await reserve(sellTable);
      const locked = await stream.next();
      assert.equal(locked.type, 'table.locked');
      assert.equal(locked.data.tableId, sellTable);
      assert.equal(locked.data.available, false);
      assert.ok(Date.parse(locked.data.expiresAt) > Date.now());
      assert.equal((await inject({ method: 'DELETE', url: `/reservations/${cancelled}`,
        headers: { authorization: buyer.authorization } }, replica)).statusCode, 204);
      const released = await stream.next();
      assert.equal(released.type, 'table.released');
      assert.equal(released.data.available, true);
      assert.equal(BigInt(released.id), BigInt(locked.id) + 1n);
      const replay = await openStream(eventsUrl, locked.id);
      try { assert.deepEqual(await replay.next(), released); } finally { await replay.close(); }

      const expires = await reserve(expireTable);
      assert.equal((await stream.next()).type, 'table.locked');
      await db.$executeRaw`UPDATE reservations SET created_at = statement_timestamp() - interval '11 minutes',
        expires_at = statement_timestamp() - interval '1 minute' WHERE id = ${expires}::uuid`;
      const expired = await stream.next();
      assert.equal(expired.type, 'table.released');
      assert.equal(expired.data.tableId, expireTable);
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: expires } })).status, 'EXPIRED');

      soldReservationId = await reserve(sellTable);
      pendingReservationId = await reserve(pendingTable);
      assert.equal((await stream.next()).data.tableId, sellTable);
      assert.equal((await stream.next()).data.tableId, pendingTable);
      const charge = await inject({ method: 'POST', url: `/reservations/${soldReservationId}/checkout`, payload: { method: 'PIX' },
        headers: { authorization: buyer.authorization, 'idempotency-key': randomUUID() } }, replica);
      assert.equal(charge.statusCode, 201, charge.body);
      const webhook = JSON.stringify({ eventId: randomUUID(), paymentId: charge.json().payment.id, method: 'PIX',
        amountMinor: 22000, currency: 'BRL', outcome: 'APPROVED', approvedAt: new Date().toISOString() });
      const notify = () => inject({ method: 'POST', url: '/webhooks/payment', payload: webhook,
        headers: { 'content-type': 'application/json',
          'x-signature': createHmac('sha256', config.payments.webhookSecret).update(webhook).digest('hex') } }, replica);
      assert.equal((await notify()).statusCode, 200);
      const sold = await stream.next();
      assert.deepEqual({ type: sold.type, data: sold.data }, {
        type: 'table.sold', data: { eventId, tableId: sellTable, status: 'SOLD', available: false, expiresAt: null },
      });
      assert.equal((await notify()).json().duplicate, true);
      assert.equal(await db.eventTableChange.count({ where: { eventId, tableId: sellTable, kind: 'SOLD' } }), 1);

      const available = await inject({ url: `/events/${slug}?availability=AVAILABLE&minPriceMinor=10000&maxPriceMinor=15000` });
      assert.deepEqual(available.json().event.sectors[0].tables.map(({ id }: { id: string }) => id), [expireTable]);
      const soldCatalog = await inject({ url: `/events/${slug}?availability=SOLD` });
      const soldTables = soldCatalog.json().event.sectors[0].tables;
      assert.equal(soldTables.length, 1);
      assert.equal(soldTables[0].id, sellTable);
      assert.equal(soldTables[0].available, false);
      const page = await adminCall('GET', `${eventPath}/dashboard?limit=2`);
      assert.equal(page.statusCode, 200, page.body);
      const { dashboard } = page.json();
      assert.deepEqual(dashboard.totals, { available: 1, sold: 1, reserved: 1, disabled: 1, checkedIn: 0, confirmedRevenueMinor: '22000' });
      assert.deepEqual(dashboard.pagination, { limit: 2, offset: 0, total: 4 });
      assert.ok(dashboard.reservations.every(({ buyer: person }: { buyer: { id: string } }) => person.id === buyer.id));
      assert.equal(page.body.includes('ticketToken'), false);
      assert.equal((await inject({ url: `${eventPath}/dashboard`, headers: { authorization: buyer.authorization } })).statusCode, 403);
      assert.equal((await adminCall('DELETE', `${tablePath}/${sellTable}`)).statusCode, 409);
      assert.equal((await adminCall('DELETE', eventPath)).statusCode, 409);
    } finally {
      await stream.close();
    }
  });

  await t.test('QR Code autenticado, escopo do evento, concorrência na portaria e auditoria', async () => {
    assert.ok(soldReservationId && pendingReservationId);
    const receipt = await inject({ url: `/reservations/${soldReservationId}/receipt`, headers: { authorization: buyer.authorization } });
    assert.equal(receipt.statusCode, 200, receipt.body);
    const token: string = receipt.json().receipt.ticket.token;
    const counter = (data: { token: string; eventId?: string }, instance = app) => adminCall('POST', '/admin/check-in', data, instance);
    assert.equal((await inject({ method: 'POST', url: '/admin/check-in', payload: { token },
      headers: { authorization: buyer.authorization } })).statusCode, 403);
    const parts = token.split('.');
    parts[1] = (parts[1]![0] === 'A' ? 'B' : 'A') + parts[1]!.slice(1);
    assert.equal((await counter({ token: parts.join('.') })).json().code, 'INVALID_TICKET');
    assert.equal((await counter({ token, eventId: randomUUID() })).json().code, 'TICKET_EVENT_MISMATCH');
    const otherToken = createTicket(config.payments.ticketKey, soldReservationId, eventId);
    assert.equal((await counter({ token: otherToken })).json().code, 'INVALID_TICKET');
    assert.equal((await counter({ token: createTicket(config.payments.ticketKey, pendingReservationId, eventId) })).statusCode, 400);

    const scans = await Promise.all([counter({ token, eventId }), counter({ token, eventId }, replica)]);
    assert.deepEqual(scans.map(({ statusCode }) => statusCode).sort(), [200, 409], scans.map(({ body }) => body).join(' '));
    assert.equal(scans.find(({ statusCode }) => statusCode === 409)!.json().code, 'TICKET_ALREADY_USED');
    const { checkIn } = scans.find(({ statusCode }) => statusCode === 200)!.json();
    assert.equal(checkIn.reservationId, soldReservationId);
    assert.equal(checkIn.guestCount, 2);
    assert.ok(Date.parse(checkIn.checkedInAt));
    const audit = await db.auditLog.findMany({ where: { eventId, reservationId: soldReservationId, action: 'RESERVATION_CHECKED_IN' } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.actorUserId, admin.id);
    assert.equal(audit[0]!.subjectUserId, buyer.id);
    assert.equal(JSON.stringify(audit[0]!.details).includes(token), false);
    assert.equal((await adminCall('GET', `${eventPath}/dashboard`)).json().dashboard.totals.checkedIn, 1);

    const closed = await adminCall('PATCH', eventPath, { status: 'CLOSED' });
    assert.equal(closed.statusCode, 200, closed.body);
    assert.equal((await inject({ url: `/events/${slug}` })).statusCode, 404);
    assert.equal((await inject({ url: floorImageUrl })).statusCode, 404);
    assert.equal((await adminCall('GET', `${eventPath}/dashboard`)).statusCode, 200);
  });
});
