import { Type, type Static, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Sessions } from '../auth/session.js';
import type { Db } from '../db.js';
import { closedObject, dateTime, eventIdParams, eventNotFound, eventStatus, normalizeText, parseDate, plainText, slug } from '../events/contracts.js';
import { compareTablesByLabel } from '../events/tableOrder.js';
import { HttpError } from '../http.js';
import { pagination } from '../security/pagination.js';
import { imageFields, imageUrl, removeUploads, verifyImageUrl } from './images.js';
import { adminMutation, auditMutation, hasReservations } from './mutations.js';

const eventBody = Type.Object({
  slug, title: plainText(160), description: Type.Optional(Type.Union([plainText(8000, true), Type.Null()])),
  startsAt: dateTime, endsAt: dateTime, venue: plainText(160), city: plainText(120), category: plainText(120),
  status: Type.Optional(eventStatus), currency: Type.Optional(Type.String({ pattern: '^[A-Z]{3}$' })),
  displayMode: Type.Optional(Type.Union([Type.Literal('MAP'), Type.Literal('LIST'), Type.Literal('BOTH')])),
  coverImageUrl: Type.Optional(imageUrl), bannerImageUrl: Type.Optional(imageUrl), floorPlanImageUrl: Type.Optional(imageUrl),
}, closedObject);
const eventPatch = Type.Partial(eventBody, { ...closedObject, minProperties: 1 });
const listQuery = Type.Object({ ...pagination.properties, status: Type.Optional(eventStatus) }, closedObject);

function eventFields(body: Static<typeof eventPatch>) {
  const { title, venue, city, category, description, coverImageUrl, bannerImageUrl, floorPlanImageUrl, startsAt, endsAt, ...fields } = body;
  return {
    ...fields,
    title: title && normalizeText(title), venue: venue && normalizeText(venue), city: city && normalizeText(city),
    category: category && normalizeText(category), description: description && normalizeText(description),
    coverImageUrl: verifyImageUrl(coverImageUrl), bannerImageUrl: verifyImageUrl(bannerImageUrl),
    floorPlanImageUrl: verifyImageUrl(floorPlanImageUrl),
    startsAt: startsAt ? parseDate(startsAt) : undefined, endsAt: endsAt ? parseDate(endsAt) : undefined,
  };
}

function validateSchedule(startsAt: Date, endsAt: Date) {
  if (startsAt >= endsAt) throw new HttpError(400, 'INVALID_EVENT_SCHEDULE', 'O término deve ser posterior ao início.');
}

export function registerAdminEvents(app: FastifyInstance, db: Db, sessions: Sessions) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const admin = sessions.requireRole('ADMIN');

  api.get('/admin/events', { onRequest: admin, schema: { querystring: listQuery } }, async (request) => ({
    events: await db.event.findMany({
      where: { status: request.query.status },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: Number(request.query.limit ?? 20), skip: Number(request.query.offset ?? 0),
    }),
  }));

  api.get('/admin/events/:eventId', { onRequest: admin, schema: { params: eventIdParams } }, async (request) => {
    const event = await db.event.findUnique({
      where: { id: request.params.eventId },
      include: { sectors: { orderBy: { name: 'asc' }, include: { tables: true } } },
    });
    if (!event) throw eventNotFound();
    for (const sector of event.sectors) sector.tables.sort(compareTablesByLabel);
    return { event };
  });

  api.post('/admin/events', { onRequest: admin, schema: { body: eventBody } }, async (request, reply) => {
    const data = eventFields(request.body);
    validateSchedule(data.startsAt!, data.endsAt!);
    const event = await adminMutation(db, undefined, async (tx) => {
      const { slug, title, venue, city, category } = request.body;
      const created = await tx.event.create({ data: {
        ...data, slug, title: normalizeText(title), venue: normalizeText(venue), city: normalizeText(city),
        category: normalizeText(category), startsAt: data.startsAt!, endsAt: data.endsAt!, currency: data.currency ?? 'BRL',
      } });
      await auditMutation(tx, request.account!.id, created.id, 'ADMIN_EVENT_CREATED', { status: created.status });
      return created;
    });
    return reply.code(201).send({ event });
  });

  api.patch('/admin/events/:eventId', { onRequest: admin, schema: { params: eventIdParams, body: eventPatch } }, async (request) => {
    const { eventId } = request.params;
    const data = eventFields(request.body);
    const event = await adminMutation(db, eventId, async (tx) => {
      const current = await tx.event.findUniqueOrThrow({
        where: { id: eventId }, select: { startsAt: true, endsAt: true, status: true, currency: true },
      });
      validateSchedule(data.startsAt ?? current.startsAt, data.endsAt ?? current.endsAt);
      if (data.currency !== undefined && data.currency !== current.currency && await tx.reservation.count({ where: { eventId } })) {
        throw hasReservations();
      }
      const updated = await tx.event.update({ where: { id: eventId }, data });
      const changedImages = Object.values(imageFields).filter(({ field }) => data[field] !== undefined);
      await removeUploads(tx, eventId, changedImages.map(({ kind }) => kind));
      await auditMutation(tx, request.account!.id, eventId, 'ADMIN_EVENT_UPDATED', {
        fields: Object.keys(request.body), previousStatus: current.status, status: updated.status,
      });
      return updated;
    });
    return { event };
  });

  api.delete('/admin/events/:eventId', { onRequest: admin, schema: { params: eventIdParams } }, async (request, reply) => {
    const { eventId } = request.params;
    await adminMutation(db, eventId, async (tx) => {
      if (await tx.reservation.count({ where: { eventId } })) throw hasReservations();
      await tx.eventTable.deleteMany({ where: { eventId } });
      await tx.sector.deleteMany({ where: { eventId } });
      await tx.event.delete({ where: { id: eventId } });
      await auditMutation(tx, request.account!.id, eventId, 'ADMIN_EVENT_DELETED');
    });
    return reply.code(204).send();
  });
}
