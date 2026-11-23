import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { AccountTokenKind } from '../generated/prisma/enums.js';
import { HttpError } from '../http.js';
import { opaqueToken, sha256, type SessionUser } from './credentials.js';
import { loginKey } from './login-guard.js';

export function accountTokens(db: Db, config: Config, log: FastifyBaseLogger) {
  const mailer = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : undefined;

  async function send(account: SessionUser, kind: AccountTokenKind) {
    if (config.demoMode && !mailer) return;
    try {
      const token = opaqueToken();
      const verification = kind === 'VERIFY_EMAIL';
      const expiresInMinutes = verification ? 24 * 60 : 30;
      const now = new Date();
      await db.$transaction([
        db.accountToken.deleteMany({ where: { expiresAt: { lte: now } } }),
        db.accountToken.create({ data: {
          tokenHash: sha256(token), userId: account.id, kind, sessionVersion: account.sessionVersion,
          expiresAt: new Date(now.getTime() + expiresInMinutes * 60_000),
        } }),
      ]);
      const message = {
        from: config.mailFrom,
        to: account.email,
        subject: verification ? 'Verifique seu e-mail no Sistema Mesa' : 'Redefina sua senha no Sistema Mesa',
        text: `Seu código de uso único é ${token}. Validade de ${expiresInMinutes} minutos.`,
      };
      if (mailer) {
        await mailer.sendMail(message);
        return;
      }

      const directory = join('.local', 'mail');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, `${randomUUID()}.json`), JSON.stringify(message, null, 2), { mode: 0o600 });
    } catch {
      log.error({ kind }, 'Falha ao preparar ou entregar mensagem de autenticação');
    }
  }

  function invalidToken() {
    return new HttpError(400, 'INVALID_TOKEN', 'Código inválido, utilizado ou expirado.');
  }

  async function consume(token: string, kind: AccountTokenKind, passwordHash?: string) {
    await db.$transaction(async (tx) => {
      const now = new Date();
      const tokenHash = sha256(token);
      const record = await tx.accountToken.findUnique({ where: { tokenHash } });
      if (!record || record.kind !== kind) throw invalidToken();
      const claimed = await tx.accountToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now },
      });
      if (claimed.count !== 1) throw invalidToken();

      const updated = kind === 'VERIFY_EMAIL'
        ? await tx.user.updateMany({
          where: { id: record.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now },
        })
        : await tx.user.updateMany({
          where: { id: record.userId, sessionVersion: record.sessionVersion },
          data: { passwordHash, sessionVersion: { increment: 1 } },
        });
      if (updated.count !== 1) throw invalidToken();
      if (kind === 'RESET_PASSWORD') {
        const { email } = await tx.user.findUniqueOrThrow({ where: { id: record.userId }, select: { email: true } });
        await tx.loginAttempt.deleteMany({ where: { key: loginKey(config.jwtSecret, email) } });
        await tx.auditLog.create({ data: {
          action: 'PASSWORD_RESET', actorUserId: record.userId, subjectUserId: record.userId, details: {},
        } });
      }
    });
  }

  return {
    send,
    verifyEmail: (token: string) => consume(token, 'VERIFY_EMAIL'),
    resetPassword: (token: string, passwordHash: string) => consume(token, 'RESET_PASSWORD', passwordHash),
  };
}
