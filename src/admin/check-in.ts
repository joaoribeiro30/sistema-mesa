import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Sessions } from '../auth/session.js';
import { databaseNow, type Db } from '../db.js';
import { closedObject, uuid } from '../events/contracts.js';
import { HttpError } from '../http.js';
import { readTicket } from '../payments/ticket.js';

const body = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_.-]+$' }),
  eventId: Type.Optional(uuid),
}, closedObject);

function badTicket() {
  return new HttpError(400, 'INVALID_TICKET', 'Ingresso inválido.');
}

export function registerCheckIn(app: FastifyInstance, db: Db, sessions: Sessions, ticketKey: Buffer) {
  app.withTypeProvider<TypeBoxTypeProvider>().post('/admin/check-in', {
    onRequest: sessions.requireRole('ADMIN'),
    config: { securityLimits: { ip: 180, user: 90 } },
    schema: { body },
  }, async (request) => {
    const { token, eventId } = request.body;
    const ticket = readTicket(ticketKey, token);
    if (!ticket) throw badTicket();
    if (eventId && eventId.toLowerCase() !== ticket.eventId) {
      throw new HttpError(409, 'TICKET_EVENT_MISMATCH', 'O ingresso pertence a outro evento.');
    }
    const actorUserId = request.account!.id;

    return db.$transaction(async (tx) => {
      const where = { id: ticket.reservationId, eventId: ticket.eventId, ticketToken: token };
      const [admission] = await tx.reservation.updateManyAndReturn({
        where: { ...where, status: 'CONFIRMED', checkedInAt: null },
        data: { checkedInAt: await databaseNow(tx), checkedInById: actorUserId },
        select: { id: true, userId: true, eventId: true, tableId: true, guestCount: true, checkedInAt: true },
      });
      if (!admission) {
        const reservation = await tx.reservation.findFirst({ where, select: { status: true, checkedInAt: true } });
        if (!reservation) throw badTicket();
        if (reservation.checkedInAt) throw new HttpError(409, 'TICKET_ALREADY_USED', 'A entrada já foi registrada.');
        throw new HttpError(409, 'RESERVATION_NOT_CONFIRMED', 'A reserva ainda não está confirmada.');
      }
      await tx.auditLog.create({ data: {
        action: 'RESERVATION_CHECKED_IN', actorUserId, subjectUserId: admission.userId, eventId: admission.eventId,
        reservationId: admission.id, details: { tableId: admission.tableId, guestCount: admission.guestCount },
      } });
      const { id, eventId: admittedEventId, tableId, guestCount, checkedInAt } = admission;
      return { checkIn: { reservationId: id, eventId: admittedEventId, tableId, guestCount, checkedInAt } };
    });
  });
}
