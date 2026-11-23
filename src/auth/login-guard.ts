import { createHmac, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../http.js';
import { captchaRequired } from '../security/captcha.js';
import { BCRYPT_ROUNDS, sessionUser } from './credentials.js';

export const MAX_LOGIN_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const FAILURE_WINDOW_MS = 15 * 60_000;

type Attempt = { failures: number; lockedUntil: Date | null; expiresAt: Date; now: Date };
type LoginResult = { outcome: 'accepted' | 'invalid' | 'captcha' } | { outcome: 'locked'; retryAfter: number };

export function loginKey(secret: string, email: string): string {
  return createHmac('sha256', secret).update(`login:${email}`).digest('hex');
}

function retryAfter({ lockedUntil, now }: Attempt): number {
  return lockedUntil ? Math.max(0, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000)) : 0;
}

async function recordLock(client: Db | Prisma.TransactionClient, action: 'LOGIN_LOCKED' | 'LOGIN_BLOCKED',
                          key: string, failures: number, seconds: number, subjectUserId?: string) {
  await client.auditLog.create({ data: { action, subjectUserId, details: { accountKey: key, failures, retryAfter: seconds } } });
}

export async function loginGuard(db: Db, config: Config) {
  const dummyPassword = randomBytes(32).toString('base64url');
  const dummyHash = await bcrypt.hash(dummyPassword, BCRYPT_ROUNDS);
  const challengeAfter = config.captcha?.loginAfter ?? MAX_LOGIN_FAILURES;

  return async function login(email: string, password: string, reply: FastifyReply, verifyCaptcha: () => Promise<void>) {
    const key = loginKey(config.jwtSecret, email);
    function locked(seconds: number): never {
      reply.header('Retry-After', seconds);
      throw new HttpError(429, 'LOGIN_LOCKED', 'Login temporariamente bloqueado. Tente novamente mais tarde.');
    }

    const [recent] = await db.$queryRaw<Attempt[]>`
      SELECT failures, locked_until AS "lockedUntil", expires_at AS "expiresAt", statement_timestamp() AS now
      FROM login_attempts WHERE key = ${key} AND expires_at > statement_timestamp()
    `;
    let captchaVerified = false;
    if (recent) {
      const seconds = retryAfter(recent);
      if (seconds > 0) {
        await recordLock(db, 'LOGIN_BLOCKED', key, recent.failures, seconds);
        locked(seconds);
      }
      if (recent.failures >= challengeAfter) {
        await verifyCaptcha();
        captchaVerified = true;
      }
    }

    const account = await db.user.findUnique({ where: { email }, select: { ...sessionUser, passwordHash: true } });
    const oversized = bcrypt.truncates(password);
    const matches = await bcrypt.compare(oversized ? dummyPassword : password, account?.passwordHash ?? dummyHash);

    // Recheck under a row lock so concurrent requests share the same consecutive failure count.
    const result = await db.$transaction(async (tx): Promise<LoginResult> => {
      const [state] = await tx.$queryRaw<[Attempt]>`
        INSERT INTO login_attempts (key, expires_at) VALUES (${key}, clock_timestamp())
        ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key
        RETURNING failures, locked_until AS "lockedUntil", expires_at AS "expiresAt", clock_timestamp() AS now
      `;
      const seconds = retryAfter(state);
      if (seconds > 0) {
        await recordLock(tx, 'LOGIN_BLOCKED', key, state.failures, seconds, account?.id);
        return { outcome: 'locked', retryAfter: seconds };
      }

      const failures = state.expiresAt > state.now ? state.failures : 0;
      if (failures >= challengeAfter && !captchaVerified) return { outcome: 'captcha' };
      if (!oversized && matches && account?.passwordHash) {
        await tx.loginAttempt.delete({ where: { key } });
        return { outcome: 'accepted' };
      }

      const count = failures + 1;
      const lockedUntil = count >= MAX_LOGIN_FAILURES ? new Date(state.now.getTime() + LOCK_MS) : null;
      await tx.loginAttempt.update({ where: { key }, data: {
        failures: count, lockedUntil, expiresAt: lockedUntil ?? new Date(state.now.getTime() + FAILURE_WINDOW_MS),
      } });
      if (!lockedUntil) return { outcome: 'invalid' };
      await recordLock(tx, 'LOGIN_LOCKED', key, count, LOCK_MS / 1000, account?.id);
      return { outcome: 'locked', retryAfter: LOCK_MS / 1000 };
    });

    if (result.outcome === 'locked') locked(result.retryAfter);
    if (result.outcome === 'captcha') throw captchaRequired();
    if (result.outcome !== 'accepted' || !account) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
    }
    return account;
  };
}
