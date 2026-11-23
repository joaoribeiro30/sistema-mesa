import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import type { TableChangeKind } from '../generated/prisma/enums.js';
import { HttpError } from '../http.js';
import { inventorySelection, publicEvent, tableAvailability } from './availability.js';
import { eventIdParams, eventNotFound } from './contracts.js';

const POLL_MS = 1_000;
const HEARTBEAT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_REPLAY = 500n;
const MAX_STREAMS = 100;
const STREAMS_PER_IP = 5;

const changes = {
  LOCKED: { name: 'table.locked', status: 'RESERVED' },
  RELEASED: { name: 'table.released', status: 'AVAILABLE' },
  SOLD: { name: 'table.sold', status: 'SOLD' },
} as const;

type ChangeRow = {
  version: bigint | null; tableId: string | null; kind: TableChangeKind | null; enabled: boolean | null; expiresAt: Date | null;
};

function parseCursor(header?: string): bigint | undefined {
  if (!header) return;
  if (/^(?:0|[1-9][0-9]{0,18})$/.test(header)) {
    const cursor = BigInt(header);
    if (cursor <= 9_223_372_036_854_775_807n) return cursor;
  }
  throw new HttpError(400, 'INVALID_STREAM_CURSOR', 'Last-Event-ID inválido.');
}

function frame(name: string, version: bigint, data: object): string {
  return `id: ${version}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function startStream(db: Db, eventId: string, previous: bigint | undefined) {
  return db.$transaction(async (tx) => {
    const now = new Date();
    const event = await tx.event.findFirst({
      where: { id: eventId, ...publicEvent(now) },
      select: { stream: { select: { version: true } } },
    });
    if (!event) throw eventNotFound();
    const head = event.stream?.version ?? 0n;
    if (previous !== undefined && previous <= head && head - previous <= MAX_REPLAY) {
      return { cursor: previous, snapshot: null };
    }
    const tables = await tx.eventTable.findMany({
      where: { eventId, isEnabled: true }, orderBy: { id: 'asc' },
      select: { id: true, reservations: inventorySelection(now) },
    });
    return { cursor: head, snapshot: tables.map(({ id, reservations }) => ({ tableId: id, ...tableAvailability(reservations) })) };
  }, { isolationLevel: 'RepeatableRead' });
}

function afterCursor(db: Db, eventId: string, cursor: bigint) {
  return db.$queryRaw<ChangeRow[]>`
    SELECT change.version, change.table_id AS "tableId", change.kind, change.expires_at AS "expiresAt", inventory.is_enabled AS enabled
    FROM events AS event
    LEFT JOIN LATERAL (
      SELECT version, table_id, kind, expires_at FROM event_table_changes
      WHERE event_id = event.id AND version > ${cursor}::bigint ORDER BY version LIMIT ${PAGE_SIZE}
    ) AS change ON true
    LEFT JOIN tables AS inventory ON inventory.id = change.table_id AND inventory.event_id = event.id
    WHERE event.id = ${eventId}::uuid AND event.status = 'PUBLISHED' AND event.starts_at > statement_timestamp()
    ORDER BY change.version
  `;
}

export function registerEventStream(app: FastifyInstance, db: Db) {
  const streams = new Map<AbortController, { ip: string; response: ServerResponse }>();
  app.addHook('preClose', async () => {
    for (const [abort, { response }] of streams) {
      abort.abort();
      response.destroy();
    }
  });

  app.withTypeProvider<TypeBoxTypeProvider>().get('/events/:eventId/stream', {
    exposeHeadRoute: false,
    config: { securityLimits: { ip: 60 } },
    schema: { params: eventIdParams },
  }, async (request, reply) => {
    const previous = parseCursor(request.headers['last-event-id'] as string | undefined);
    const clientStreams = [...streams.values()].filter(({ ip }) => ip === request.ip).length;
    if (streams.size >= MAX_STREAMS || clientStreams >= STREAMS_PER_IP) {
      reply.header('Retry-After', 5);
      throw new HttpError(429, 'STREAM_LIMIT_EXCEEDED', 'Limite de conexões em tempo real atingido.');
    }
    const eventId = request.params.eventId.toLowerCase();
    const abort = new AbortController();
    streams.set(abort, { ip: request.ip, response: reply.raw });
    const release = () => {
      streams.delete(abort);
      abort.abort();
    };
    reply.raw.once('close', release);

    try {
      const initial = await startStream(db, eventId, previous);
      async function* messages() {
        let { cursor } = initial;
        let lastFrameAt = Date.now();
        try {
          yield 'retry: 1500\n: conectado\n\n';
          if (initial.snapshot) yield frame('snapshot', cursor, { eventId, tables: initial.snapshot });
          while (!abort.signal.aborted) {
            const page = await afterCursor(db, eventId, cursor);
            if (!page.length) return;
            for (const { version, tableId, kind, enabled, expiresAt } of page) {
              if (version === null || !kind) continue;
              cursor = version;
              const { name, status } = changes[kind];
              yield frame(name, version, { eventId, tableId, status, available: status === 'AVAILABLE' && enabled === true, expiresAt });
              lastFrameAt = Date.now();
            }
            if (Date.now() - lastFrameAt >= HEARTBEAT_MS) {
              yield ': heartbeat\n\n';
              lastFrameAt = Date.now();
            }
            if (page.length < PAGE_SIZE) await delay(POLL_MS, undefined, { signal: abort.signal });
          }
        } catch (error) {
          if (!abort.signal.aborted) {
            request.log.error({ errorName: error instanceof Error ? error.name : 'Unknown' }, 'Falha na transmissão de disponibilidade');
          }
        } finally {
          release();
        }
      }

      return reply.type('text/event-stream; charset=utf-8')
        .header('Cache-Control', 'no-store, no-transform')
        .header('X-Accel-Buffering', 'no')
        .send(Readable.from(messages(), { objectMode: false }));
    } catch (error) {
      release();
      throw error;
    }
  });
}
