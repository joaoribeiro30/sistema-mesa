import { Type } from '@fastify/type-provider-typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Sessions } from '../auth/session.js';
import type { Db } from '../db.js';
import { closedObject, uuid } from '../events/contracts.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { EventImageKind } from '../generated/prisma/enums.js';
import { HttpError } from '../http.js';
import { adminMutation, auditMutation } from './mutations.js';

export const imageFields = {
  cover: { kind: 'COVER', field: 'coverImageUrl' },
  banner: { kind: 'BANNER', field: 'bannerImageUrl' },
  'floor-plan': { kind: 'FLOOR_PLAN', field: 'floorPlanImageUrl' },
} as const;
const imageParams = Type.Object({
  eventId: uuid, kind: Type.Union([Type.Literal('cover'), Type.Literal('banner'), Type.Literal('floor-plan')]),
}, closedObject);
const imageSelect = {
  id: true, status: true, startsAt: true, coverImageUrl: true, bannerImageUrl: true, floorPlanImageUrl: true,
} satisfies Prisma.EventSelect;
const MAX_UPLOAD = 2 * 1024 * 1024;
const mediaTypes = ['image/png', 'image/jpeg', 'image/webp'];
const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex');
const pngEnd = Buffer.from('0000000049454e44ae426082', 'hex');

export const imageUrl = Type.Union([Type.String({ minLength: 9, maxLength: 2048, pattern: '^https://[^\\s<>]+$' }), Type.Null()]);

export function verifyImageUrl(value: string | null | undefined) {
  if (typeof value !== 'string') return value;
  if (value.includes('\\')) throw invalidUrl();
  const url = URL.parse(value);
  if (!url || url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw invalidUrl();
  return value;
}

function invalidUrl() {
  return new HttpError(400, 'INVALID_IMAGE_URL', 'Informe uma URL HTTPS de imagem, sem credenciais.');
}

function matchesImageType(type: string, body: Buffer): boolean {
  switch (type) {
    case 'image/png':
      return body.length >= 45 && body.subarray(0, 8).equals(pngHeader) &&
        body.readUInt32BE(8) === 13 && body.toString('ascii', 12, 16) === 'IHDR' && body.subarray(-12).equals(pngEnd);
    case 'image/jpeg':
      return body.length >= 12 && body.readUInt16BE(0) === 0xffd8 && body[2] === 0xff && body.readUInt16BE(body.length - 2) === 0xffd9;
    case 'image/webp':
      return body.length >= 20 && body.toString('ascii', 0, 4) === 'RIFF' && body.readUInt32LE(4) === body.length - 8 &&
        body.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(body.toString('ascii', 12, 16));
    default: return false;
  }
}

export async function removeUploads(tx: Prisma.TransactionClient, eventId: string, kinds: EventImageKind[]) {
  if (kinds.length) await tx.eventImage.deleteMany({ where: { eventId, kind: { in: kinds } } });
}

export function registerEventImages(app: FastifyInstance, db: Db, sessions: Sessions) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get('/events/:eventId/images/:kind', { schema: { params: imageParams } }, async (request, reply) => {
    const eventId = request.params.eventId.toLowerCase();
    const { kind, field } = imageFields[request.params.kind];
    const path = `/events/${eventId}/images/${request.params.kind}`;
    const isAdmin = (await sessions.identify(request))?.role === 'ADMIN';
    const image = await db.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id: eventId }, select: imageSelect });
      if (!event || event[field] !== path || (!isAdmin && (event.status !== 'PUBLISHED' || event.startsAt <= new Date()))) return null;
      return tx.eventImage.findUnique({ where: { eventId_kind: { eventId, kind } }, select: { content: true, mediaType: true } });
    }, { isolationLevel: 'RepeatableRead' });
    if (!image) throw new HttpError(404, 'IMAGE_NOT_FOUND', 'Imagem não encontrada.');
    return reply.header('Cache-Control', 'no-store').type(image.mediaType).send(Buffer.from(image.content));
  });

  app.register(async (uploads) => {
    uploads.addContentTypeParser(mediaTypes, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    uploads.withTypeProvider<TypeBoxTypeProvider>().post('/admin/events/:eventId/images/:kind', {
      onRequest: sessions.requireRole('ADMIN'),
      bodyLimit: MAX_UPLOAD,
      schema: { params: imageParams },
    }, async (request, reply) => {
      const content = request.body;
      const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
      if (!mediaType || !mediaTypes.includes(mediaType)) {
        throw new HttpError(415, 'INVALID_IMAGE_TYPE', 'Envie uma imagem PNG, JPEG ou WebP.');
      }
      if (!Buffer.isBuffer(content) || !matchesImageType(mediaType, content)) {
        throw new HttpError(400, 'INVALID_IMAGE_CONTENT', 'O conteúdo não corresponde ao formato da imagem.');
      }
      const eventId = request.params.eventId.toLowerCase();
      const { kind, field } = imageFields[request.params.kind];
      const url = `/events/${eventId}/images/${request.params.kind}`;
      const image = { mediaType, content: new Uint8Array(content) };
      await adminMutation(db, eventId, async (tx) => {
        await tx.eventImage.upsert({
          where: { eventId_kind: { eventId, kind } },
          create: { eventId, kind, ...image }, update: image,
        });
        await tx.event.update({ where: { id: eventId }, data: { [field]: url } });
        await auditMutation(tx, request.account!.id, eventId, 'ADMIN_EVENT_IMAGE_UPLOADED', { kind, mediaType });
      });
      return reply.code(201).send({ image: { kind, url, mediaType } });
    });
  });
}
