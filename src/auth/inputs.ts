import { Type } from '@fastify/type-provider-typebox';

const ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_\x60{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_\x60{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const UNSAFE_NAME = /[<>\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

export const Email = Type.String({ format: 'email', maxLength: 254, pattern: ADDRESS.source });

export function validEmail(value: string): boolean {
  return value.length <= 254 && ADDRESS.test(value);
}

export function cleanName(value: string): string | undefined {
  if (UNSAFE_NAME.test(value)) return;
  return value.normalize('NFC').trim() || undefined;
}
