import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Sessions } from '../auth/session.js';
import { databaseNow, type Db } from '../db.js';
import { closedObject, eventIdParams, eventNotFound } from '../events/contracts.js';
import { pagination } from '../security/pagination.js';
import { eventSettlementSchedule, eventSettlementTotals } from './settlement.js';

type InventoryTotals = { available: bigint; reserved: bigint; sold: bigint; disabled: bigint; checkedIn: bigint };
const querystring = Type.Object(pagination.properties, closedObject);

export function registerDashboard(app: FastifyInstance, db: Db, sessions: Sessions) {
  app.withTypeProvider<TypeBoxTypeProvider>().get('/admin/events/:eventId/dashboard', {
    onRequest: sessions.requireRole('ADMIN'), schema: { params: eventIdParams, querystring },
  }, async (request) => {
    const { eventId } = request.params;
    const limit = Number(request.query.limit ?? 20);
    const offset = Number(request.query.offset ?? 0);
    return db.$transaction(async (tx) => {
      const event = await tx.event.findUnique({
        where: { id: eventId }, select: { id: true, currency: true, createdAt: true, endsAt: true },
      });
      if (!event) throw eventNotFound();
      const asOf = await databaseNow(tx);
      const [inventory] = await tx.$queryRaw<[InventoryTotals]>`
        SELECT
          count(*) FILTER (WHERE reservation.id IS NULL AND inventory.is_enabled) AS available,
          count(*) FILTER (WHERE reservation.status = 'PENDING_PAYMENT') AS reserved,
          count(*) FILTER (WHERE reservation.status = 'CONFIRMED') AS sold,
          count(*) FILTER (WHERE reservation.id IS NULL AND NOT inventory.is_enabled) AS disabled,
          count(*) FILTER (WHERE reservation.checked_in_at IS NOT NULL) AS "checkedIn"
        FROM tables AS inventory
        LEFT JOIN reservations AS reservation ON reservation.table_id = inventory.id AND reservation.event_id = inventory.event_id
          AND (reservation.status = 'CONFIRMED' OR (reservation.status = 'PENDING_PAYMENT' AND reservation.expires_at > ${asOf}))
        WHERE inventory.event_id = ${eventId}::uuid
      `;
      const settlement = await eventSettlementTotals(tx, eventId);
      const total = await tx.reservation.count({ where: { eventId } });
      const reservations = await tx.reservation.findMany({
        where: { eventId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, skip: offset,
        select: {
          id: true, guestCount: true, createdAt: true, expiresAt: true, confirmedAt: true, amountMinor: true,
          status: true, checkedInAt: true, table: { select: { id: true, label: true } },
          user: { select: { id: true, name: true, email: true } },
          payments: { where: { status: 'SUCCEEDED' }, select: { amountMinor: true, settlement: true } },
        },
      });
      return { dashboard: {
        eventId: event.id, asOf, currency: event.currency,
        totals: {
          available: Number(inventory.available), reserved: Number(inventory.reserved), sold: Number(inventory.sold),
          disabled: Number(inventory.disabled), checkedIn: Number(inventory.checkedIn), confirmedRevenueMinor: settlement.totals.grossMinor,
        },
        settlement: { ...settlement, schedule: eventSettlementSchedule(event.createdAt, event.endsAt) },
        reservations: reservations.map(({ user, payments: [payment], ...record }) => {
          const financials = record.status === 'CONFIRMED' ? payment?.settlement : null;
          return {
            ...record, buyer: user,
            status: record.status === 'PENDING_PAYMENT' && record.expiresAt <= asOf ? 'EXPIRED' : record.status,
            settlement: payment && financials ? { ...financials, grossMinor: payment.amountMinor } : null,
          };
        }),
        pagination: { limit, offset, total },
      } };
    }, { isolationLevel: 'RepeatableRead' });
  });
}
