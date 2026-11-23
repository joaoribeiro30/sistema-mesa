import { createHmac, hkdfSync } from 'node:crypto';
import { databaseNow, type Db } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { ReservationStatus } from '../generated/prisma/enums.js';
import { HttpError } from '../http.js';
import { ChargeRejected, gatewayUnavailable, type CheckoutDetails, type PaymentGateway, type PaymentNotification } from './gateway.js';
import { calculateSettlement } from './settlement.js';
import { createTicket, qrCode } from './ticket.js';

type LockedReservation = {
  id: string; eventId: string; status: ReservationStatus; expiresAt: Date; amountMinor: number; currency: string;
};

async function lockReservation(tx: Prisma.TransactionClient, id: string, userId?: string) {
  const [reservation] = await tx.$queryRaw<LockedReservation[]>`
    SELECT id, event_id AS "eventId", status::text, expires_at AS "expiresAt", amount_minor AS "amountMinor", currency
    FROM reservations WHERE id = ${id}::uuid AND (${userId ?? null}::uuid IS NULL OR user_id = ${userId ?? null}::uuid)
    FOR UPDATE
  `;
  return reservation;
}

function inactiveReservation() {
  return new HttpError(409, 'RESERVATION_INACTIVE', 'O prazo de pagamento da reserva terminou ou a reserva já foi encerrada.');
}

export function checkoutService(db: Db, gateway: PaymentGateway, ticketKey: Buffer, creditAdvance: boolean) {
  const requestKey = Buffer.from(hkdfSync('sha256', ticketKey, '', 'sistemamesa.checkout.request.v1', 32));

  async function checkout(user: { id: string; email: string }, reservationId: string, idempotencyKey: string, details: CheckoutDetails) {
    const requestHash = createHmac('sha256', requestKey).update(JSON.stringify([
      details.method, details.identification?.type, details.identification?.number,
      ...(details.method !== 'PIX' ? [details.cardToken, details.paymentMethodId, details.installments, details.issuerId] : []),
    ])).digest('hex');

    const attempt = await db.$transaction(async (tx) => {
      const reservation = await lockReservation(tx, reservationId, user.id);
      if (!reservation) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Reserva não encontrada.');
      const now = await databaseNow(tx);
      if (reservation.status !== 'PENDING_PAYMENT' || reservation.expiresAt <= now) throw inactiveReservation();
      if (reservation.amountMinor <= 0) throw new HttpError(422, 'INVALID_PAYMENT_AMOUNT', 'O valor da cobrança deve ser positivo.');

      const keyed = await tx.payment.findUnique({ where: { provider_idempotencyKey: { provider: gateway.name, idempotencyKey } } });
      if (keyed) {
        if (keyed.reservationId !== reservation.id || keyed.requestHash !== requestHash) {
          throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'A chave já foi usada com outros dados.');
        }
        return { payment: keyed, expiresAt: reservation.expiresAt, created: false };
      }

      // Create the local reference before contacting the provider so early webhooks can be processed.
      const created = await tx.payment.createMany({ skipDuplicates: true, data: {
        reservationId, provider: gateway.name, idempotencyKey, requestHash, method: details.method,
        amountMinor: reservation.amountMinor, currency: reservation.currency,
      } });
      if (created.count === 0) {
        const duplicate = await tx.payment.findUnique({ where: { provider_idempotencyKey: { provider: gateway.name, idempotencyKey } } });
        if (duplicate) throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'A chave já foi usada com outros dados.');
        throw new HttpError(409, 'PAYMENT_IN_PROGRESS', 'Já existe uma cobrança pendente para a reserva.');
      }
      const payment = await tx.payment.findUniqueOrThrow({ where: { provider_idempotencyKey: { provider: gateway.name, idempotencyKey } } });
      await tx.paymentSettlement.create({ data: {
        paymentId: payment.id, ...calculateSettlement(payment.amountMinor, details.method, creditAdvance),
      } });
      return { payment, expiresAt: reservation.expiresAt, created: true };
    });

    const { payment, expiresAt } = attempt;
    if (payment.status === 'PENDING' && (!payment.providerPaymentId || (payment.method === 'PIX' && !payment.pixCode))) {
      if (expiresAt <= await databaseNow(db)) throw inactiveReservation();
      const charge = await gateway.createCharge({
        paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency, expiresAt, email: user.email, details,
      }).catch(async (error: unknown) => {
        if (error instanceof ChargeRejected) {
          await db.payment.updateMany({ where: { id: payment.id, providerPaymentId: null, status: 'PENDING' }, data: { status: 'FAILED' } });
        }
        throw error;
      });

      await db.$transaction(async (tx) => {
        const saved = await tx.payment.updateMany({
          where: { id: payment.id, OR: [{ providerPaymentId: null }, { providerPaymentId: charge.providerPaymentId }] },
          data: { providerPaymentId: charge.providerPaymentId, pixCode: charge.pixCode },
        });
        if (saved.count !== 1) throw gatewayUnavailable();
        if (charge.declined) await tx.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      });
    }

    const current = await db.payment.findUniqueOrThrow({
      where: { id: payment.id }, include: { reservation: { select: { status: true } } },
    });
    if (current.status === 'PENDING' && (current.reservation.status !== 'PENDING_PAYMENT' || expiresAt <= await databaseNow(db))) {
      throw inactiveReservation();
    }
    const pix = current.status === 'PENDING' && current.pixCode
      ? { copyPasteCode: current.pixCode, qrCode: await qrCode(current.pixCode) }
      : undefined;
    return { created: attempt.created, payment: {
      id: current.id, provider: current.provider, providerPaymentId: current.providerPaymentId,
      method: current.method, status: current.status, amountMinor: current.amountMinor, currency: current.currency, expiresAt, pix,
    } };
  }

  async function simulatePayment(userId: string, reservationId: string, paymentId: string) {
    const payment = await db.payment.findFirst({
      where: { id: paymentId, reservationId, provider: 'mock', reservation: { userId } },
      select: { id: true, providerPaymentId: true, method: true, amountMinor: true, currency: true },
    });
    if (!payment) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Pagamento não encontrado.');
    if (!payment.providerPaymentId || !payment.method) {
      throw new HttpError(409, 'PAYMENT_IN_PROGRESS', 'Aguarde a criação da cobrança simulada.');
    }
    const result = await applyNotification({
      eventId: `demo-${payment.id}`, paymentId: payment.id, providerPaymentId: payment.providerPaymentId,
      method: payment.method, amountMinor: payment.amountMinor, currency: payment.currency,
      outcome: 'APPROVED', approvedAt: await databaseNow(db),
    }, true);
    if (result === 'ignored') throw inactiveReservation();
  }

  async function applyNotification(event: PaymentNotification, simulation = false) {
    return db.$transaction(async (tx) => {
      const reference = await tx.payment.findUnique({ where: { id: event.paymentId }, select: { reservationId: true, provider: true } });
      if (reference?.provider !== gateway.name) return 'ignored';

      // The reservation lock serializes approval with checkout, cleanup and cancellation.
      const reservation = await lockReservation(tx, reference.reservationId);
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payments WHERE id = ${event.paymentId}::uuid FOR UPDATE`;
      if (!reservation || !locked) return 'ignored';
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: locked.id } });
      if (payment.method === null) return 'ignored';
      if (payment.amountMinor !== event.amountMinor || payment.currency !== event.currency || payment.method !== event.method ||
          (payment.providerPaymentId !== null && payment.providerPaymentId !== event.providerPaymentId)) {
        throw new HttpError(422, 'PAYMENT_EVENT_MISMATCH', 'Os dados da cobrança não conferem.');
      }

      const simulationTime = simulation ? await databaseNow(tx) : undefined;
      if (simulationTime) {
        if (payment.status === 'SUCCEEDED') return 'duplicate';
        if (payment.status !== 'PENDING' || reservation.status !== 'PENDING_PAYMENT' || reservation.expiresAt <= simulationTime) {
          throw inactiveReservation();
        }
      }

      const claimed = await tx.paymentWebhookEvent.createMany({ skipDuplicates: true, data: {
        provider: gateway.name, eventId: event.eventId, paymentId: payment.id,
      } });
      if (claimed.count === 0) return 'duplicate';
      if (payment.paidAt !== null) return 'ignored';
      if (event.outcome !== 'APPROVED') {
        if (payment.status === 'PENDING') await tx.payment.update({ where: { id: payment.id }, data: {
          providerPaymentId: event.providerPaymentId, status: event.outcome === 'DECLINED' ? 'FAILED' : 'CANCELLED',
        } });
        return 'processed';
      }

      const now = simulationTime ?? await databaseNow(tx);
      const approvedAt = simulationTime ?? event.approvedAt;
      const expired = reservation.expiresAt <= now;
      const canConfirm = reservation.status === 'PENDING_PAYMENT' && !expired && approvedAt < reservation.expiresAt;
      await tx.payment.update({ where: { id: payment.id }, data: {
        providerPaymentId: event.providerPaymentId,
        status: canConfirm ? 'SUCCEEDED' : 'REFUND_REQUIRED',
        paidAt: new Date(Math.max(approvedAt.getTime(), payment.createdAt.getTime())),
      } });
      if (canConfirm) {
        await tx.reservation.update({ where: { id: reservation.id }, data: {
          status: 'CONFIRMED', confirmedAt: now, ticketToken: createTicket(ticketKey, reservation.id, reservation.eventId),
        } });
        return 'processed';
      }
      if (expired && reservation.status === 'PENDING_PAYMENT') {
        await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'EXPIRED' } });
      }
      return 'refund_required';
    });
  }

  return { checkout, applyNotification, simulatePayment };
}
