import { databaseNow, type Db } from '../db.js';
import type { EventStatus, ReservationStatus } from '../generated/prisma/enums.js';
import { HttpError } from '../http.js';
import { isUniqueViolation } from '../auth/credentials.js';

const HOLD_MS = 10 * 60 * 1000;
type Booking = { eventId: string; tableId: string; guestCount: number };
type LockedEvent = { currency: string; status: EventStatus; startsAt: Date };
type LockedTable = { capacity: number; priceMinor: number; isEnabled: boolean };

export function reservationResponse<T extends { status: ReservationStatus; expiresAt: Date }>(reservation: T) {
  const status = reservation.status === 'PENDING_PAYMENT' && reservation.expiresAt <= new Date() ? 'EXPIRED' : reservation.status;
  return { ...reservation, status };
}

function sameBooking(existing: Booking, requested: Booking) {
  if (existing.eventId !== requested.eventId || existing.tableId !== requested.tableId || existing.guestCount !== requested.guestCount) {
    throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'A chave já foi usada com outros dados.');
  }
}

function unavailable() {
  return new HttpError(409, 'TABLE_UNAVAILABLE', 'Mesa indisponível.');
}

export async function holdTable(db: Db, userId: string, idempotencyKey: string, requested: Booking) {
  const { eventId, tableId, guestCount } = requested;
  const where = { userId_idempotencyKey: { userId, idempotencyKey } };
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.reservation.findUnique({ where });
      if (existing) {
        sameBooking(existing, requested);
        return { reservation: existing, created: false };
      }

      const [event] = await tx.$queryRaw<LockedEvent[]>`
        SELECT currency, status::text, starts_at AS "startsAt"
        FROM events WHERE id = ${eventId}::uuid FOR SHARE
      `;
      if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Evento não encontrado.');

      const [table] = await tx.$queryRaw<LockedTable[]>`
        SELECT capacity, price_minor AS "priceMinor", is_enabled AS "isEnabled"
        FROM tables WHERE id = ${tableId}::uuid AND event_id = ${eventId}::uuid FOR UPDATE
      `;
      if (!table) throw new HttpError(404, 'TABLE_NOT_FOUND', 'Mesa não encontrada neste evento.');

      const replay = await tx.reservation.findUnique({ where });
      if (replay) {
        sameBooking(replay, requested);
        return { reservation: replay, created: false };
      }

      const now = await databaseNow(tx);
      if (event.status !== 'PUBLISHED' || event.startsAt <= now || !table.isEnabled) throw unavailable();
      if (guestCount > table.capacity) throw new HttpError(422, 'TABLE_CAPACITY', 'A quantidade excede a capacidade da mesa.');

      await tx.reservation.updateMany({
        where: { tableId, status: 'PENDING_PAYMENT', expiresAt: { lte: now } }, data: { status: 'EXPIRED' },
      });
      const reservation = await tx.reservation.create({ data: {
        userId, tableId, eventId, idempotencyKey, guestCount, capacity: table.capacity, status: 'PENDING_PAYMENT',
        amountMinor: table.priceMinor, currency: event.currency,
        expiresAt: new Date(now.getTime() + HOLD_MS), createdAt: now,
      } });
      return { reservation, created: true };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.reservation.findUnique({ where });
    if (!existing) throw unavailable();
    sameBooking(existing, requested);
    return { reservation: existing, created: false };
  }
}

export async function cancelHold(db: Db, userId: string, id: string) {
  const count = await db.$executeRaw`
    UPDATE reservations
    SET status = 'CANCELLED', cancelled_at = statement_timestamp(), updated_at = statement_timestamp()
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
      AND status = 'PENDING_PAYMENT' AND expires_at > clock_timestamp()
  `;
  if (count === 1) return;
  const reservation = await db.reservation.findFirst({ where: { id, userId }, select: { status: true } });
  if (!reservation) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Reserva não encontrada.');
  if (reservation.status !== 'CANCELLED') throw new HttpError(409, 'RESERVATION_INACTIVE', 'O bloqueio da mesa já terminou.');
}
