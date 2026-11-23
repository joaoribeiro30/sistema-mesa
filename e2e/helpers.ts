import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';

export const API_URL =
  process.env.E2E_API_URL ||
  `http://localhost:${process.env.E2E_API_PORT || '3001'}`;

export function getAdminCredentials(): { email: string; password: string } {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.test';
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error('SEED_ADMIN_PASSWORD não configurada no .env.');
  }
  return { email, password };
}

export function createE2eDb() {
  const config = loadConfig();
  return { db: createDb(config.databaseUrl), config };
}

/**
 * Clears rate-limit buckets and login attempts so consecutive local E2E runs
 * from 127.0.0.1 never fail due to prior test runs.
 */
export async function resetLocalRateLimits() {
  const { db } = createE2eDb();
  try {
    await db.$transaction([
      db.rateLimitBucket.deleteMany(),
      db.loginAttempt.deleteMany(),
    ]);
  } finally {
    await db.$disconnect();
  }
}

/**
 * Finds the latest email verification token written to `.local/mail/` for `email`.
 */
export async function waitForVerificationToken(
  email: string,
  timeoutMs = 10_000,
): Promise<string> {
  const mailDir = join(process.cwd(), '.local', 'mail');
  const target = email.trim().toLowerCase();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const files = await readdir(mailDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const raw = await readFile(join(mailDir, file), 'utf8');
        const parsed = JSON.parse(raw) as { to?: string; text?: string };
        if (parsed.to?.toLowerCase() === target && parsed.text) {
          const match = /([A-Za-z0-9_-]{43})/.exec(parsed.text);
          if (match?.[1]) {
            return match[1];
          }
        }
      }
    } catch {
      // Directory may not exist yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Token de verificação não encontrado em .local/mail para ${email}`);
}

/**
 * Sends a real HMAC-SHA256 signed webhook to `POST /webhooks/payment` for the mock gateway.
 */
export async function sendSignedMockWebhook(input: {
  paymentId: string;
  method: 'PIX' | 'CREDIT_CARD';
  amountMinor: number;
  currency?: string;
  outcome: 'APPROVED' | 'DECLINED' | 'CANCELLED';
}): Promise<{ status: number; body: unknown }> {
  const config = loadConfig();
  const payloadObj: Record<string, unknown> = {
    eventId: `e2e_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    paymentId: input.paymentId,
    method: input.method,
    amountMinor: input.amountMinor,
    currency: input.currency ?? 'BRL',
    outcome: input.outcome,
  };
  if (input.outcome === 'APPROVED') {
    payloadObj.approvedAt = new Date().toISOString();
  }

  const rawBody = JSON.stringify(payloadObj);
  const signature = createHmac('sha256', config.payments.webhookSecret)
    .update(rawBody)
    .digest('hex');

  const response = await fetch(`${API_URL}/webhooks/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': signature,
    },
    body: rawBody,
  });

  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

/**
 * Updates `reservations.expires_at` directly in PostgreSQL so E2E tests can verify
 * real countdown expiration and backend worker release without waiting 10 minutes.
 */
export async function shortenReservationExpiry(
  reservationId: string,
  secondsFromNow: number,
): Promise<string> {
  const { db } = createE2eDb();
  try {
    const [row] = await db.$queryRaw<[{ expiresAt: Date }]>`
      UPDATE reservations
      SET expires_at = statement_timestamp() + make_interval(secs => ${secondsFromNow}::double precision),
          updated_at = statement_timestamp()
      WHERE id = ${reservationId}::uuid
      RETURNING expires_at AS "expiresAt"
    `;
    if (!row) {
      throw new Error(`Reserva ${reservationId} não encontrada no banco.`);
    }
    return row.expiresAt.toISOString();
  } finally {
    await db.$disconnect();
  }
}

/**
 * Cleans up E2E test records from PostgreSQL.
 */
export async function cleanupE2eFixtures(params: {
  eventSlugs?: string[];
  userEmails?: string[];
}) {
  const { db } = createE2eDb();
  try {
    const events = params.eventSlugs?.length
      ? await db.event.findMany({
          where: { slug: { in: params.eventSlugs } },
          select: { id: true },
        })
      : [];
    const eventIds = events.map((e) => e.id);

    const users = params.userEmails?.length
      ? await db.user.findMany({
          where: { email: { in: params.userEmails.map((e) => e.toLowerCase()) } },
          select: { id: true },
        })
      : [];
    const userIds = users.map((u) => u.id);

    const reservations =
      eventIds.length || userIds.length
        ? await db.reservation.findMany({
            where: {
              OR: [
                ...(eventIds.length ? [{ eventId: { in: eventIds } }] : []),
                ...(userIds.length ? [{ userId: { in: userIds } }] : []),
              ],
            },
            select: { id: true },
          })
        : [];
    const reservationIds = reservations.map((r) => r.id);

    await db.$transaction(async (tx) => {
      if (reservationIds.length) {
        const payments = await tx.payment.findMany({
          where: { reservationId: { in: reservationIds } },
          select: { id: true },
        });
        const paymentIds = payments.map((p) => p.id);
        if (paymentIds.length) {
          await tx.paymentWebhookEvent.deleteMany({
            where: { paymentId: { in: paymentIds } },
          });
        }
        await tx.payment.deleteMany({
          where: { reservationId: { in: reservationIds } },
        });
      }

      if (eventIds.length || userIds.length || reservationIds.length) {
        await tx.auditLog.deleteMany({
          where: {
            OR: [
              ...(eventIds.length ? [{ eventId: { in: eventIds } }] : []),
              ...(reservationIds.length
                ? [{ reservationId: { in: reservationIds } }]
                : []),
              ...(userIds.length
                ? [
                    { actorUserId: { in: userIds } },
                    { subjectUserId: { in: userIds } },
                  ]
                : []),
            ],
          },
        });
      }

      if (reservationIds.length) {
        await tx.reservation.deleteMany({
          where: { id: { in: reservationIds } },
        });
      }
      if (eventIds.length) {
        await tx.eventTable.deleteMany({ where: { eventId: { in: eventIds } } });
        await tx.sector.deleteMany({ where: { eventId: { in: eventIds } } });
        await tx.event.deleteMany({ where: { id: { in: eventIds } } });
      }
      if (userIds.length) {
        await tx.accountToken.deleteMany({ where: { userId: { in: userIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
      }
    });
  } finally {
    await db.$disconnect();
  }
}
