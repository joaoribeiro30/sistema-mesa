import { hashPassword, normalizeEmail } from '../src/auth/credentials.js';
import { databaseUrl } from '../src/config.js';
import { createDb } from '../src/db.js';

const email = normalizeEmail(process.env.SEED_ADMIN_EMAIL ?? 'admin@example.test');
const password = process.env.SEED_ADMIN_PASSWORD;
const seedDemo = process.argv.includes('--demo');
if (seedDemo && process.env.PAYMENT_PROVIDER?.trim() !== 'mock') {
  throw new Error('O seed de demonstração requer PAYMENT_PROVIDER=mock.');
}
const adminOnly = process.argv.includes('--admin-only') || (process.env.NODE_ENV === 'production' && !seedDemo);
if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_EMAIL?.trim()) {
  throw new Error('Configure SEED_ADMIN_EMAIL explicitamente em produção.');
}
if (!password) throw new Error('Configure SEED_ADMIN_PASSWORD antes do seed.');
if (email.length > 254 || !/^[!-~]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('SEED_ADMIN_EMAIL inválido.');

const passwordHash = await hashPassword(password);
const db = createDb(databaseUrl());
try {
  await db.$transaction(async (tx) => {
    const admin = await tx.user.upsert({
      where: { email }, update: {},
      create: { email, name: 'Admin Sistema Mesa', passwordHash, role: 'ADMIN', emailVerifiedAt: new Date() },
      select: { role: true, passwordHash: true },
    });
    if (admin.role !== 'ADMIN' || !admin.passwordHash) throw new Error('O e-mail do seed já pertence a outra conta.');
    if (adminOnly) return;

    const startsAt = new Date(Date.now() + 30 * 86_400_000);
    const endsAt = new Date(startsAt.getTime() + 6 * 3_600_000);
    await tx.event.upsert({
      where: { slug: 'noite-aurora' }, update: {},
      create: {
        slug: 'noite-aurora', title: 'Noite Aurora', venue: 'Galpão Aurora',
        description: 'Evento de demonstração com mesas nos setores Pista e Terraço.',
        currency: 'BRL', status: 'PUBLISHED', startsAt, endsAt,
        sectors: { create: [
          { name: 'Pista', tables: { create: [
            { label: 'P01', capacity: 4, priceMinor: 24000 },
            { label: 'P02', capacity: 4, priceMinor: 24000 },
            { label: 'P03', capacity: 6, priceMinor: 34000 },
          ] } },
          { name: 'Terraço', tables: { create: [
            { label: 'T01', capacity: 6, priceMinor: 45000 },
            { label: 'T02', capacity: 8, priceMinor: 58000 },
          ] } },
        ] },
      },
    });
  });
  console.log(adminOnly ? 'Seed concluído. Admin configurado.' : 'Seed concluído. Admin e evento Noite Aurora configurados.');
} finally {
  await db.$disconnect();
}
