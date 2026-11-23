import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Sessions } from '../auth/session.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { HttpError } from '../http.js';
import type { CheckoutDetails } from './gateway.js';
import { mercadoPagoGateway } from './mercado-pago.js';
import { mockGateway } from './mock.js';
import { checkoutService } from './service.js';
import { qrCode } from './ticket.js';

const UUID = Type.String({ format: 'uuid' });
const reservationParams = Type.Object({ id: UUID });
const paymentParams = Type.Object({ id: UUID, paymentId: UUID });
const closed = { additionalProperties: false } as const;
const identification = Type.Optional(Type.Union([
  Type.Object({ type: Type.Literal('CPF'), number: Type.String({ pattern: '^[0-9]{11}$' }) }, closed),
  Type.Object({ type: Type.Literal('CNPJ'), number: Type.String({ pattern: '^[0-9]{14}$' }) }, closed),
]));
const cardFields = {
  identification,
  cardToken: Type.String({ minLength: 16, maxLength: 256, pattern: '^(?![0-9]+$)[A-Za-z0-9_-]+$' }),
  paymentMethodId: Type.String({ minLength: 1, maxLength: 40, pattern: '^[a-z0-9_-]+$' }),
  issuerId: Type.Optional(Type.String({ pattern: '^[0-9]{1,30}$' })),
};
const checkoutBody = Type.Union([
  Type.Object({ method: Type.Literal('PIX'), identification }, closed),
  Type.Object({
    ...cardFields, method: Type.Literal('CREDIT_CARD'),
    installments: Type.Integer({ minimum: 1, maximum: 24 }),
  }, closed),
  Type.Object({ ...cardFields, method: Type.Literal('DEBIT_CARD'), installments: Type.Literal(1) }, closed),
]);

export function registerPaymentRoutes(app: FastifyInstance, db: Db, sessions: Sessions, config: Config) {
  const { payments } = config;
  const gateway = payments.provider === 'mercado_pago'
    ? mercadoPagoGateway(payments.accessToken, payments.webhookSecret)
    : mockGateway(payments.webhookSecret);
  const service = checkoutService(db, gateway, payments.ticketKey, payments.creditAdvance);
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const customer = sessions.requireRole('CUSTOMER');

  api.post('/reservations/:id/checkout', {
    preHandler: customer,
    schema: { params: reservationParams, headers: Type.Object({ 'idempotency-key': UUID }), body: checkoutBody },
    config: { securityLimits: { ip: 20, user: 10 } },
  }, async (request, reply) => {
    const details: CheckoutDetails = request.body;
    if (details.method !== 'PIX' && details.paymentMethodId === 'pix') {
      throw new HttpError(400, 'INVALID_CARD_DETAILS', 'Informe o token, a bandeira e o número de parcelas do cartão.');
    }
    const result = await service.checkout(request.account!, request.params.id, request.headers['idempotency-key'], details);
    return reply.code(result.created ? 201 : 200).send({
      payment: { ...result.payment, canSimulate: config.demoMode && result.payment.status === 'PENDING' },
    });
  });

  api.get('/reservations/:id/payments/:paymentId', {
    preHandler: customer,
    schema: { params: paymentParams },
  }, async (request) => {
    const payment = await db.payment.findFirst({
      where: { id: request.params.paymentId, reservationId: request.params.id, reservation: { userId: request.account!.id } },
      select: { id: true, method: true, status: true, amountMinor: true, currency: true, paidAt: true, provider: true },
    });
    if (!payment) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Pagamento não encontrado.');
    const { provider, ...data } = payment;
    return { payment: { ...data, canSimulate: config.demoMode && provider === 'mock' && data.status === 'PENDING' } };
  });

  if (config.demoMode) {
    api.post('/reservations/:id/payments/:paymentId/simulate', {
      preHandler: customer,
      schema: { params: paymentParams },
      config: { securityLimits: { ip: 20, user: 10 } },
    }, async (request, reply) => {
      await service.simulatePayment(request.account!.id, request.params.id, request.params.paymentId);
      return reply.code(204).send();
    });
  }

  api.get('/reservations/:id/receipt', { preHandler: customer, schema: { params: reservationParams } }, async (request) => {
    const reservation = await db.reservation.findFirst({
      where: { id: request.params.id, userId: request.account!.id, status: 'CONFIRMED' },
      select: {
        id: true, confirmedAt: true, checkedInAt: true, guestCount: true, ticketToken: true,
        event: { select: { id: true, title: true, venue: true, city: true, startsAt: true } },
        table: { select: { label: true, sector: { select: { name: true } } } },
        payments: { where: { status: 'SUCCEEDED' }, take: 1, select: {
          id: true, amountMinor: true, currency: true, method: true, paidAt: true,
        } },
      },
    });
    const payment = reservation?.payments[0];
    if (!reservation?.ticketToken || !payment) throw new HttpError(404, 'RECEIPT_NOT_FOUND', 'Comprovante indisponível.');
    return { receipt: {
      reservationId: reservation.id, guestCount: reservation.guestCount, confirmedAt: reservation.confirmedAt,
      checkedInAt: reservation.checkedInAt,
      event: reservation.event, table: reservation.table, payment,
      ticket: { token: reservation.ticketToken, qrCode: await qrCode(reservation.ticketToken) },
    } };
  });

  app.register(async (webhooks) => {
    webhooks.removeContentTypeParser('application/json');
    webhooks.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    webhooks.post<{ Body: Buffer }>('/webhooks/payment', { config: { securityLimits: { ip: 120 } } }, async (request) => {
      if (request.body !== undefined && !Buffer.isBuffer(request.body)) {
        throw new HttpError(415, 'INVALID_CONTENT_TYPE', 'Envie a notificação como application/json.');
      }
      const query = new URL(request.url, config.appOrigin).searchParams;
      const event = await gateway.readWebhook({ headers: request.headers, query, body: request.body ?? Buffer.alloc(0) });
      if (!event) return { received: true };
      const result = await service.applyNotification(event);
      if (result === 'refund_required') {
        request.log.warn({ paymentId: event.paymentId, providerPaymentId: event.providerPaymentId }, 'Pagamento requer reembolso');
      }
      return { received: true, duplicate: result === 'duplicate' };
    });
  });
}
