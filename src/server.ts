import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(config);
try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

const shutdown = () => { void app.close(); };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
