import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { PaymentMethod } from '../generated/prisma/enums.js';
import { HttpError } from '../http.js';

export type Identification = { type: 'CPF' | 'CNPJ'; number: string };
export type CheckoutDetails = { identification?: Identification } & (
  | { method: 'PIX' }
  | ({ cardToken: string; paymentMethodId: string; issuerId?: string } & (
    | { method: 'CREDIT_CARD'; installments: number }
    | { method: 'DEBIT_CARD'; installments: 1 }
  ))
);

export type ChargeRequest = {
  paymentId: string;
  amountMinor: number;
  currency: string;
  expiresAt: Date;
  email: string;
  details: CheckoutDetails;
};

export type Charge = { providerPaymentId: string; pixCode?: string; declined?: boolean };

export type PaymentNotification = {
  eventId: string;
  paymentId: string;
  providerPaymentId: string;
  method: PaymentMethod;
  amountMinor: number;
  currency: string;
} & ({ outcome: 'APPROVED'; approvedAt: Date } | { outcome: 'DECLINED' | 'CANCELLED' });

export interface PaymentGateway {
  readonly name: string;
  createCharge(request: ChargeRequest): Promise<Charge>;
  readWebhook(input: { headers: IncomingHttpHeaders; query: URLSearchParams; body: Buffer }): Promise<PaymentNotification | null>;
}

export class ChargeRejected extends HttpError {
  constructor(message = 'O provedor rejeitou os dados da cobrança.') {
    super(422, 'CHARGE_REJECTED', message);
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function verifySignature(secret: string, input: Buffer | string, signature: string | undefined) {
  const expected = createHmac('sha256', secret).update(input).digest();
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature) || !timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
    throw new HttpError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Assinatura do webhook inválida.');
  }
}

export function gatewayUnavailable() {
  return new HttpError(502, 'PAYMENT_GATEWAY_UNAVAILABLE', 'Não foi possível consultar ou iniciar a cobrança.');
}
