import { isUniqueViolation } from '../auth/credentials.js';
import type { Db } from '../db.js';
import { eventNotFound } from '../events/contracts.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AuditAction } from '../generated/prisma/enums.js';
import { HttpError } from '../http.js';

export async function adminMutation<T>(db: Db, eventId: string | undefined, mutation: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await db.$transaction(async (tx) => {
      if (eventId) {
        const [event] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE`;
        if (!event) throw eventNotFound();
      }
      return mutation(tx);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, 'ADMIN_RESOURCE_CONFLICT', 'Já existe um recurso com esses dados.');
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw hasReservations();
    throw error;
  }
}

export function auditMutation(tx: Prisma.TransactionClient, actorUserId: string, eventId: string, action: AuditAction,
                              details: Prisma.InputJsonObject = {}) {
  return tx.auditLog.create({ data: { actorUserId, eventId, action, details }, select: { id: true } });
}

export function hasReservations() {
  return new HttpError(409, 'RESERVATION_HISTORY_EXISTS', 'O histórico de reservas impede esta alteração.');
}
