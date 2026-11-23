import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 250;

export function registerReservationExpiration(app: FastifyInstance, db: Db) {
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<void> | undefined;
  let closing = false;

  async function expireBatches() {
    while (!closing) {
      const count = await db.$executeRaw`
        WITH next_event AS (
          SELECT event_id FROM reservations
          WHERE status = 'PENDING_PAYMENT' AND expires_at <= statement_timestamp()
          ORDER BY expires_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
        ), due AS (
          SELECT id FROM reservations
          WHERE event_id = (SELECT event_id FROM next_event)
            AND status = 'PENDING_PAYMENT' AND expires_at <= statement_timestamp()
          ORDER BY expires_at, id
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE reservations AS reservation
        SET status = 'EXPIRED', updated_at = statement_timestamp()
        FROM due
        WHERE reservation.id = due.id
      `;
      if (count === 0) return;
    }
  }

  function tick() {
    if (pending) return;
    pending = expireBatches()
      .catch((error: unknown) => {
        app.log.error({ errorName: error instanceof Error ? error.name : 'Unknown' }, 'Falha ao expirar reservas');
      })
      .finally(() => { pending = undefined; });
  }

  app.addHook('onListen', async () => {
    if (closing) return;
    timer = setInterval(tick, POLL_INTERVAL_MS).unref();
    tick();
  });

  app.addHook('preClose', async () => {
    closing = true;
    clearInterval(timer);
    await pending;
  });
}
