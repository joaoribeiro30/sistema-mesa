import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../http.js';

export const BCRYPT_ROUNDS = 12;
export const publicUser = {
  id: true, email: true, name: true, role: true, emailVerifiedAt: true,
} satisfies Prisma.UserSelect;

export const sessionUser = { ...publicUser, sessionVersion: true } satisfies Prisma.UserSelect;
export type SessionUser = Prisma.UserGetPayload<{ select: typeof sessionUser }>;

export function userResponse({ id, email, name, role, emailVerifiedAt }: SessionUser) {
  return { id, email, name, role, emailVerifiedAt };
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const MIN_PASSWORD_LENGTH = 15;
const COMMON_PASSWORDS = new Set([
  'password', 'passwordpassword', 'mypassword', 'admin', 'administrator', 'adminadmin',
  'senha', 'minhasenha', 'senhasenha', 'sistemamesa', 'qwerty', 'qwertyuiop', 'iloveyou',
  'letmein', 'changeme', 'correcthorsebatterystaple', '123456789012345', '012345678901234',
]);

export async function hashPassword(password: string): Promise<string> {
  if (Array.from(password).length < MIN_PASSWORD_LENGTH || bcrypt.truncates(password) || /[\p{Cc}\p{Cs}]/u.test(password)) {
    throw new HttpError(400, 'INVALID_PASSWORD', 'Use ao menos 15 caracteres e no máximo 72 bytes UTF-8, sem caracteres de controle.');
  }
  const compact = password.toLowerCase().replace(/[\p{P}\p{Z}\p{S}]+/gu, '');
  if (!compact || COMMON_PASSWORDS.has(compact) || COMMON_PASSWORDS.has(compact.replace(/[0-9]+$/, '')) ||
      /^(.{1,3})\1{4,}$/u.test(compact)) {
    throw new HttpError(400, 'INVALID_PASSWORD', 'Escolha uma senha menos previsível.');
  }
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function opaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
