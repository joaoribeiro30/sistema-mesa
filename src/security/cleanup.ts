import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';

export function registerSecurityCleanup(app: FastifyInstance, db: Db) {
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<void> | undefined;

  async function clean() {
    await db.$executeRaw`
      DELETE FROM rate_limit_buckets WHERE key IN (
        SELECT key FROM rate_limit_buckets WHERE expires_at <= statement_timestamp()
        ORDER BY expires_at LIMIT 5000 FOR UPDATE SKIP LOCKED
      )
    `;
    await db.$executeRaw`
      DELETE FROM login_attempts WHERE key IN (
        SELECT key FROM login_attempts WHERE expires_at <= statement_timestamp()
        ORDER BY expires_at LIMIT 5000 FOR UPDATE SKIP LOCKED
      )
    `;
  }

  app.addHook('onListen', async () => {
    timer = setInterval(() => {
      pending ??= clean()
        .catch(() => { app.log.error('Falha ao limpar contadores de segurança expirados'); })
        .finally(() => { pending = undefined; });
    }, 60_000).unref();
  });

  app.addHook('preClose', async () => {
    clearInterval(timer);
    await pending;
  });
}
