import 'dotenv/config';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const url = new URL(process.env.DATABASE_URL ?? '');
const database = decodeURIComponent(url.pathname.slice(1));
if (!['postgresql:', 'postgres:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || !url.port || !url.username || !url.password || !/^[a-z][a-z0-9_]*$/.test(database)) {
  throw new Error('DATABASE_URL deve apontar para o PostgreSQL local em 127.0.0.1, com porta e credenciais.');
}

const directory = resolve('.local', 'postgres');
await mkdir(resolve('.local'), { recursive: true });
const postgres = new EmbeddedPostgres({
  databaseDir: directory,
  port: Number(url.port),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8'],
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
});

try {
  await stat(resolve(directory, 'PG_VERSION'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await postgres.initialise();
}

await postgres.start();
const client = postgres.getPgClient('postgres', '127.0.0.1');
try {
  await client.connect();
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (!result.rowCount) await client.query(`CREATE DATABASE "${database}"`);
} catch (error) {
  await postgres.stop();
  throw error;
} finally {
  await client.end();
}

console.log(`PostgreSQL local pronto em 127.0.0.1:${url.port}/${database}.`);
