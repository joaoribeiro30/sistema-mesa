import type { Prisma } from '../generated/prisma/client.js';
import type { ReservationStatus } from '../generated/prisma/enums.js';

export type Availability = 'AVAILABLE' | 'RESERVED' | 'SOLD';

export function activeReservation(now: Date): Prisma.ReservationWhereInput {
  return { OR: [{ status: 'CONFIRMED' }, { status: 'PENDING_PAYMENT', expiresAt: { gt: now } }] };
}

export function publicEvent(now: Date): Prisma.EventWhereInput {
  return { status: 'PUBLISHED', startsAt: { gt: now } };
}

export function tableAvailability(reservations: { status: ReservationStatus; expiresAt: Date }[]) {
  const reservation = reservations[0];
  const status: Availability = reservation?.status === 'CONFIRMED' ? 'SOLD' : reservation ? 'RESERVED' : 'AVAILABLE';
  return { status, available: status === 'AVAILABLE', expiresAt: status === 'RESERVED' ? reservation!.expiresAt : null };
}

export function inventorySelection(now: Date) {
  return {
    where: activeReservation(now), select: { status: true, expiresAt: true }, take: 1,
  } satisfies Prisma.EventTable$reservationsArgs;
}
