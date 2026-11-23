import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Sessions } from '../auth/session.js';
import type { Db } from '../db.js';
import { HttpError } from '../http.js';
import { pagination } from '../security/pagination.js';
import { cancelHold, holdTable, reservationResponse } from './service.js';

const UUID = Type.String({ format: 'uuid' });

export function registerReservationRoutes(app: FastifyInstance, db: Db, sessions: Sessions) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const customer = sessions.requireRole('CUSTOMER');

  api.post('/reservations', {
    preHandler: customer,
    schema: {
      headers: Type.Object({ 'idempotency-key': UUID }),
      body: Type.Object({ eventId: UUID, tableId: UUID, guestCount: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }) },
        { additionalProperties: false }),
    },
    config: { securityLimits: { ip: 30, user: 15 } },
  }, async (request, reply) => {
    const account = request.account!;
    if (!account.emailVerifiedAt) throw new HttpError(403, 'EMAIL_UNVERIFIED', 'Verifique seu e-mail para reservar.');
    const { eventId, tableId, guestCount } = request.body;
    const { reservation, created } = await holdTable(db, account.id, request.headers['idempotency-key'].toLowerCase(), {
      eventId: eventId.toLowerCase(), tableId: tableId.toLowerCase(), guestCount,
    });
    return reply.code(created ? 201 : 200).send({ reservation: reservationResponse(reservation) });
  });

  api.get('/reservations/me', {
    preHandler: customer,
    schema: { querystring: pagination },
  }, async (request) => {
    const reservations = await db.reservation.findMany({
      where: { userId: request.account!.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Number(request.query.limit ?? 20),
      skip: Number(request.query.offset ?? 0),
      include: {
        event: { select: { slug: true, title: true, venue: true, city: true, startsAt: true } },
        table: { select: { label: true, sector: { select: { name: true } } } },
      },
    });
    return { reservations: reservations.map(reservationResponse) };
  });

  api.delete('/reservations/:id', {
    preHandler: customer, schema: { params: Type.Object({ id: UUID }) },
  }, async (request, reply) => {
    await cancelHold(db, request.account!.id, request.params.id);
    return reply.code(204).send();
  });
}
