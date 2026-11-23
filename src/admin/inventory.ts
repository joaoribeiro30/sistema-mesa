import { Type, type Static, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Sessions } from '../auth/session.js';
import type { Db } from '../db.js';
import { closedObject, eventIdParams, eventNotFound, normalizeText, plainText, uuid } from '../events/contracts.js';
import { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../http.js';
import { imageUrl, removeUploads, verifyImageUrl } from './images.js';
import { adminMutation, auditMutation } from './mutations.js';

const sectorParams = Type.Object({ eventId: uuid, sectorId: uuid }, closedObject);
const tableParams = Type.Object({ ...sectorParams.properties, tableId: uuid }, closedObject);
const positiveInt = Type.Integer({ minimum: 1, maximum: 2_147_483_647 });
const sectorBody = Type.Object({
  name: plainText(120), description: Type.Optional(Type.Union([plainText(4000, true), Type.Null()])),
  basePriceMinor: positiveInt,
}, closedObject);
const sectorPatch = Type.Partial(sectorBody, { ...closedObject, minProperties: 1 });
const tableBody = Type.Object({
  label: plainText(60), capacity: positiveInt, priceMinor: Type.Optional(positiveInt), isEnabled: Type.Optional(Type.Boolean()),
}, closedObject);
const tablePatch = Type.Partial(Type.Object({ ...tableBody.properties, sectorId: uuid }), { ...closedObject, minProperties: 1 });
const batchBody = Type.Object({
  startNumber: Type.Integer({ minimum: 1, maximum: 999_999 }), count: Type.Integer({ minimum: 1, maximum: 250 }),
  prefix: Type.Optional(Type.String({ maxLength: 45, pattern: '^[A-Za-z0-9_-]*$' })),
  capacity: positiveInt, priceMinor: Type.Optional(positiveInt), isEnabled: Type.Optional(Type.Boolean()),
}, closedObject);
const coordinate = Type.Number({ minimum: 0, maximum: 100 });
const layoutBody = Type.Object({
  floorPlanImageUrl: Type.Optional(imageUrl),
  tables: Type.Array(Type.Union([
    Type.Object({ tableId: uuid, x: coordinate, y: coordinate }, closedObject),
    Type.Object({ tableId: uuid, x: Type.Null(), y: Type.Null() }, closedObject),
  ]), { maxItems: 250 }),
}, closedObject);

function sectorNotFound() {
  return new HttpError(404, 'SECTOR_NOT_FOUND', 'Setor não encontrado neste evento.');
}

function tableNotFound() {
  return new HttpError(404, 'TABLE_NOT_FOUND', 'Mesa não encontrada no escopo informado.');
}

function sectorFields(body: Static<typeof sectorPatch>) {
  return { ...body, name: body.name && normalizeText(body.name), description: body.description && normalizeText(body.description) };
}

async function findSector(tx: Prisma.TransactionClient, eventId: string, sectorId: string) {
  const sector = await tx.sector.findUnique({ where: { id_eventId: { id: sectorId, eventId } } });
  if (!sector) throw sectorNotFound();
  return sector;
}

function tablePrice(explicit: number | undefined, base: number) {
  const price = explicit ?? base;
  if (price <= 0) throw new HttpError(400, 'INVALID_TABLE_PRICE', 'Informe um preço ou configure o preço base do setor.');
  return price;
}

export function registerAdminInventory(app: FastifyInstance, db: Db, sessions: Sessions) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const admin = sessions.requireRole('ADMIN');
  const sectorsPath = '/admin/events/:eventId/sectors';
  const sectorPath = '/admin/events/:eventId/sectors/:sectorId';
  const tablesPath = '/admin/events/:eventId/sectors/:sectorId/tables';
  const tablePath = '/admin/events/:eventId/sectors/:sectorId/tables/:tableId';

  api.get(sectorsPath, { onRequest: admin, schema: { params: eventIdParams } }, async (request) => {
    const event = await db.event.findUnique({
      where: { id: request.params.eventId }, select: { sectors: { orderBy: { name: 'asc' } } },
    });
    if (!event) throw eventNotFound();
    return { sectors: event.sectors };
  });

  api.get(sectorPath, { onRequest: admin, schema: { params: sectorParams } }, async (request) => {
    const { eventId, sectorId } = request.params;
    const sector = await db.sector.findUnique({
      where: { id_eventId: { id: sectorId, eventId } }, include: { tables: { orderBy: { label: 'asc' } } },
    });
    if (!sector) throw sectorNotFound();
    return { sector };
  });

  api.post(sectorsPath, { onRequest: admin, schema: { params: eventIdParams, body: sectorBody } }, async (request, reply) => {
    const { eventId } = request.params;
    const sector = await adminMutation(db, eventId, async (tx) => {
      const created = await tx.sector.create({ data: { ...sectorFields(request.body), eventId, name: normalizeText(request.body.name) } });
      await auditMutation(tx, request.account!.id, eventId, 'ADMIN_SECTOR_CREATED', { sectorId: created.id });
      return created;
    });
    return reply.code(201).send({ sector });
  });

  api.patch(sectorPath, { onRequest: admin, schema: { params: sectorParams, body: sectorPatch } }, async (request) => {
    const { eventId, sectorId } = request.params;
    const sector = await adminMutation(db, eventId, async (tx) => {
      const existing = await findSector(tx, eventId, sectorId);
      const updated = await tx.sector.update({ where: { id: existing.id }, data: sectorFields(request.body) });
      await auditMutation(tx, request.account!.id, eventId, 'ADMIN_SECTOR_UPDATED', { sectorId, fields: Object.keys(request.body) });
      return updated;
    });
    return { sector };
  });

  api.delete(sectorPath, { onRequest: admin, schema: { params: sectorParams } }, async (request, reply) => {
    const { eventId, sectorId } = request.params;
    await adminMutation(db, eventId, async (tx) => {
      await findSector(tx, eventId, sectorId);
      await tx.eventTable.deleteMany({ where: { eventId, sectorId } });
      await tx.sector.delete({ where: { id: sectorId } });
      await auditMutation(tx, request.account!.id, eventId, 'ADMIN_SECTOR_DELETED', { sectorId });
    });
    return reply.code(204).send();
  });

  api.get(tablePath, { onRequest: admin, schema: { params: tableParams } }, async (request) => {
    const { eventId, sectorId, tableId } = request.params;
    const table = await db.eventTable.findFirst({ where: { id: tableId, eventId, sectorId } });
    if (!table) throw tableNotFound();
    return { table };
  });

  api.post(tablesPath, { onRequest: admin, schema: { params: sectorParams, body: tableBody } }, async (request, reply) => {
    const { eventId, sectorId } = request.params;
    const table = await adminMutation(db, eventId, async (tx) => {
      const sector = await findSector(tx, eventId, sectorId);
      const created = await tx.eventTable.create({ data: {
        ...request.body, eventId, sectorId, label: normalizeText(request.body.label),
        priceMinor: tablePrice(request.body.priceMinor, sector.basePriceMinor),
      } });
      await auditMutation(tx, request.account!.id, eventId, 'ADMIN_TABLE_CREATED', { sectorId, tableId: created.id });
      return created;
    });
    return reply.code(201).send({ table });
  });

  api.post(`${tablesPath}/batch`, { onRequest: admin, schema: { params: sectorParams, body: batchBody } }, async (request, reply) => {
    const { eventId, sectorId } = request.params;
    const { prefix = '', startNumber, count, capacity, isEnabled } = request.body;
    const tables = await adminMutation(db, eventId, async (tx) => {
      const sector = await findSector(tx, eventId, sectorId);
      const priceMinor = tablePrice(request.body.priceMinor, sector.basePriceMinor);
      const data = Array.from({ length: count }, (_, index) => ({
        eventId, sectorId, label: `${prefix}${startNumber + index}`, capacity, priceMinor, isEnabled,
      }));
      const created = await tx.eventTable.createManyAndReturn({ data });
      await auditMutation(tx, request.account!.id, eventId, 'ADMIN_TABLES_CREATED', { sectorId, tableIds: created.map(({ id }) => id) });
      const byLabel = new Map(created.map((table) => [table.label, table]));
      return data.map(({ label }) => byLabel.get(label)!);
    });
    return reply.code(201).send({ tables });
  });

  api.patch(tablePath, { onRequest: admin, schema: { params: tableParams, body: tablePatch } }, async (request) => {
    const { eventId, sectorId, tableId } = request.params;
    const table = await adminMutation(db, eventId, async (tx) => {
      const existing = await tx.eventTable.findFirst({ where: { id: tableId, eventId, sectorId } });
      if (!existing) throw tableNotFound();
      const destination = request.body.sectorId;
      if (destination) await findSector(tx, eventId, destination);
      const updated = await tx.eventTable.update({ where: { id: tableId }, data: {
        ...request.body, label: request.body.label && normalizeText(request.body.label),
      } });
      await auditMutation(tx, request.account!.id, eventId, 'ADMIN_TABLE_UPDATED', {
        sectorId, tableId, destinationSectorId: updated.sectorId, fields: Object.keys(request.body),
      });
      return updated;
    });
    return { table };
  });

  api.delete(tablePath, { onRequest: admin, schema: { params: tableParams } }, async (request, reply) => {
    const { eventId, sectorId, tableId } = request.params;
    await adminMutation(db, eventId, async (tx) => {
      const removed = await tx.eventTable.deleteMany({ where: { id: tableId, eventId, sectorId } });
      if (!removed.count) throw tableNotFound();
      await auditMutation(tx, request.account!.id, eventId, 'ADMIN_TABLE_DELETED', { sectorId, tableId });
    });
    return reply.code(204).send();
  });

  api.put('/admin/events/:eventId/layout', { onRequest: admin, schema: { params: eventIdParams, body: layoutBody } }, async (request) => {
    const { eventId } = request.params;
    const { tables } = request.body;
    const floorPlanImageUrl = verifyImageUrl(request.body.floorPlanImageUrl);
    const ids = new Set(tables.map(({ tableId }) => tableId.toLowerCase()));
    if (ids.size !== tables.length || (!tables.length && floorPlanImageUrl === undefined)) {
      throw new HttpError(400, 'INVALID_EVENT_LAYOUT', 'Envie alterações sem repetir identificadores de mesas.');
    }
    return adminMutation(db, eventId, async (tx) => {
      if (tables.length) {
        const values = tables.map(({ tableId, x, y }) => Prisma.sql`(${tableId}::uuid, ${x}::double precision, ${y}::double precision)`);
        const updated = await tx.$executeRaw`
          UPDATE tables AS table_record SET x = layout.x, y = layout.y
          FROM (VALUES ${Prisma.join(values)}) AS layout(table_id, x, y)
          WHERE table_record.event_id = ${eventId}::uuid AND table_record.id = layout.table_id
        `;
        if (updated !== tables.length) throw tableNotFound();
      }
      const event = floorPlanImageUrl === undefined
        ? await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { floorPlanImageUrl: true } })
        : await tx.event.update({ where: { id: eventId }, data: { floorPlanImageUrl }, select: { floorPlanImageUrl: true } });
      if (floorPlanImageUrl !== undefined) await removeUploads(tx, eventId, ['FLOOR_PLAN']);
      await auditMutation(tx, request.account!.id, eventId, 'ADMIN_EVENT_LAYOUT_UPDATED', {
        tableIds: [...ids], imageChanged: floorPlanImageUrl !== undefined,
      });
      return { layout: { eventId, floorPlanImageUrl: event.floorPlanImageUrl, tables } };
    });
  });
}
