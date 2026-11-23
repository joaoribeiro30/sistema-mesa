import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export function createDb(connectionString: string) {
  const url = new URL(connectionString);
  // Prisma exchanges timestamps as UTC with the driver. Match the PostgreSQL session to that convention.
  const existingOptions = url.searchParams.get('options');
  url.searchParams.set('options', [existingOptions, '-c timezone=UTC'].filter(Boolean).join(' '));
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString(), connectionTimeoutMillis: 4000 }),
  });
}

export type Db = ReturnType<typeof createDb>;

export async function databaseNow(db: Pick<Db, '$queryRaw'>): Promise<Date> {
  const [clock] = await db.$queryRaw<[{ now: Date }]>`
    SELECT date_trunc('milliseconds', clock_timestamp()) AS now
  `;
  return clock.now;
}
