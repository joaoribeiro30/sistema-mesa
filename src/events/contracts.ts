import { Type } from '@fastify/type-provider-typebox';
import { HttpError } from '../http.js';

export const closedObject = { additionalProperties: false } as const;
export const uuid = Type.String({ format: 'uuid' });
export const slug = Type.String({ maxLength: 120, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' });
export const dateTime = Type.String({
  format: 'date-time',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,3})?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$',
});
export const eventStatus = Type.Union([Type.Literal('DRAFT'), Type.Literal('PUBLISHED'), Type.Literal('CLOSED')]);
export const eventIdParams = Type.Object({ eventId: uuid }, closedObject);

export function parseDate(value: string): Date {
  const date = new Date(value);
  const calendarDay = new Date(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(calendarDay.getTime()) ||
      calendarDay.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new HttpError(400, 'INVALID_DATE', 'Informe uma data ISO 8601 válida.');
  }
  return date;
}

export function plainText(maxLength: number, multiline = false) {
  const disallowed = multiline ? '\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f' : '\\u0000-\\u001f';
  return Type.String({ minLength: 1, maxLength, pattern: `^(?=[\\s\\S]*\\S)[^<>${disallowed}\\u007f-\\u009f\\p{Cf}\\p{Cs}]+$` });
}

export function normalizeText(text: string): string {
  return text.normalize('NFC').trim();
}

export function eventNotFound() {
  return new HttpError(404, 'EVENT_NOT_FOUND', 'Evento não encontrado.');
}
