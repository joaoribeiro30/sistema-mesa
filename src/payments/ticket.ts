import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { UUID } from './gateway.js';

const VERSION = 'mesa-ticket-v1';

export function createTicket(key: Buffer, reservationId: string, eventId: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(VERSION));
  const payload = Buffer.concat([cipher.update(JSON.stringify({ reservationId, eventId }), 'utf8'), cipher.final()]);
  return [VERSION, nonce.toString('base64url'), payload.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

function decodePart(part: string): Buffer {
  const decoded = Buffer.from(part, 'base64url');
  if (decoded.toString('base64url') !== part) throw new Error('Codificação inválida.');
  return decoded;
}

export function readTicket(key: Buffer, token: string): { reservationId: string; eventId: string } | null {
  const [version, noncePart, bodyPart, tagPart, ...extra] = token.split('.');
  if (token.length > 512 || version !== VERSION || !noncePart || !bodyPart || !tagPart || extra.length) return null;
  try {
    const nonce = decodePart(noncePart);
    const body = decodePart(bodyPart);
    const tag = decodePart(tagPart);
    if (nonce.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(VERSION));
    decipher.setAuthTag(tag);
    const data: unknown = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
    if (!data || typeof data !== 'object' || Object.keys(data).length !== 2 ||
        !('reservationId' in data) || !('eventId' in data) ||
        typeof data.reservationId !== 'string' || typeof data.eventId !== 'string' ||
        !UUID.test(data.reservationId) || !UUID.test(data.eventId)) return null;
    return { reservationId: data.reservationId.toLowerCase(), eventId: data.eventId.toLowerCase() };
  } catch {
    return null;
  }
}

export function qrCode(value: string): Promise<string> {
  return QRCode.toDataURL(value, { width: 320, errorCorrectionLevel: 'M' });
}
