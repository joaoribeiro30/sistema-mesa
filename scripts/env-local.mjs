import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const example = await readFile('.env.example', 'utf8');
const config = example
  .replace('JWT_SECRET=', `JWT_SECRET=${randomBytes(48).toString('base64url')}`)
  .replace('SEED_ADMIN_PASSWORD=', `SEED_ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}`)
  .replace('mesa:mesa_local@', `mesa:${randomBytes(24).toString('base64url')}@`);

try {
  await writeFile('.env', config, { flag: 'wx', mode: 0o600 });
  console.log('.env criado. As credenciais locais ficam nesse arquivo.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env já existe.');
}
