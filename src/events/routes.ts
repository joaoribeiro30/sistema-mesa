import { Type, type Static, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../http.js';
import { pagination } from '../security/pagination.js';
import { activeReservation, inventorySelection, publicEvent, tableAvailability } from './availability.js';
import { closedObject, dateTime, eventNotFound, normalizeText, parseDate, plainText, slug } from './contracts.js';

const eventSummary = {
  id: true, slug: true, title: true, venue: true, city: true, category: true, currency: true,
  startsAt: true, endsAt: true, displayMode: true, coverImageUrl: true, bannerImageUrl: true,
} satisfies Prisma.EventSelect;

const price = Type.String({ pattern: '^(?:0|[1-9][0-9]{0,9})$' });
const filters = Type.Object({
  startsFrom: Type.Optional(dateTime), startsTo: Type.Optional(dateTime),
  city: Type.Optional(plainText(120)), venue: Type.Optional(plainText(160)), category: Type.Optional(plainText(120)),
  minPriceMinor: Type.Optional(price), maxPriceMinor: Type.Optional(price),
  availability: Type.Optional(Type.Union([Type.Literal('AVAILABLE'), Type.Literal('RESERVED'), Type.Literal('SOLD')])),
}, closedObject);
const catalogQuery = Type.Object({ ...filters.properties, ...pagination.properties }, closedObject);

function catalogFilters(query: Static<typeof filters>, now: Date) {
  const from = query.startsFrom ? parseDate(query.startsFrom) : undefined;
  const to = query.startsTo ? parseDate(query.startsTo) : undefined;
  const min = query.minPriceMinor === undefined ? undefined : Number(query.minPriceMinor);
  const max = query.maxPriceMinor === undefined ? undefined : Number(query.maxPriceMinor);
  const maxInt = 2_147_483_647;
  if ((from && to && from > to) || (min ?? 0) > (max ?? maxInt) || (max ?? 0) > maxInt) {
    throw new HttpError(400, 'INVALID_FILTER_RANGE', 'Intervalo inválido de data ou preço.');
  }

  const event: Prisma.EventWhereInput = {
    ...publicEvent(now),
    startsAt: { gt: now, gte: from, lte: to },
    city: query.city ? { equals: normalizeText(query.city), mode: 'insensitive' } : undefined,
    venue: query.venue ? { equals: normalizeText(query.venue), mode: 'insensitive' } : undefined,
    category: query.category ? { equals: normalizeText(query.category), mode: 'insensitive' } : undefined,
  };
  const table: Prisma.EventTableWhereInput = { isEnabled: true };
  if (min !== undefined || max !== undefined) table.priceMinor = { gte: min, lte: max };
  switch (query.availability) {
    case 'AVAILABLE': table.reservations = { none: activeReservation(now) }; break;
    case 'RESERVED': table.reservations = { some: { status: 'PENDING_PAYMENT', expiresAt: { gt: now } } }; break;
    case 'SOLD': table.reservations = { some: { status: 'CONFIRMED' } }; break;
  }
  const hasTableFilters = query.availability !== undefined || min !== undefined || max !== undefined;
  return { event, table, hasTableFilters };
}

export function registerEventRoutes(app: FastifyInstance, db: Db) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get('/events', { schema: { querystring: catalogQuery } }, async (request) => {
    const { event, table, hasTableFilters } = catalogFilters(request.query, new Date());
    return { events: await db.event.findMany({
      where: { ...event, sectors: hasTableFilters ? { some: { tables: { some: table } } } : undefined },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: Number(request.query.limit ?? 20),
      skip: Number(request.query.offset ?? 0),
      select: eventSummary,
    }) };
  });

  api.get('/events/:slug', { schema: { params: Type.Object({ slug }, closedObject), querystring: filters } }, async (request) => {
    const now = new Date();
    const { event: where, table, hasTableFilters } = catalogFilters(request.query, now);
    const event = await db.$transaction((tx) => tx.event.findFirst({
      where: { ...where, slug: request.params.slug },
      select: {
        ...eventSummary, description: true, floorPlanImageUrl: true,
        sectors: {
          where: hasTableFilters ? { tables: { some: table } } : undefined,
          orderBy: { name: 'asc' },
          select: {
            id: true, name: true, description: true, basePriceMinor: true,
            tables: { where: table, orderBy: { label: 'asc' }, select: {
              id: true, label: true, capacity: true, priceMinor: true, x: true, y: true,
              reservations: inventorySelection(now),
            } },
          },
        },
      },
    }), { isolationLevel: 'RepeatableRead' });
    if (!event) throw eventNotFound();
    return { event: {
      ...event,
      sectors: event.sectors.map((sector) => ({
        ...sector,
        tables: sector.tables.map(({ reservations, ...table }) => ({ ...table, ...tableAvailability(reservations) })),
      })),
    } };
  });
}
