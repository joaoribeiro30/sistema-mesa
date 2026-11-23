import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { ChargeRejected, UUID, gatewayUnavailable, verifySignature, type PaymentGateway } from './gateway.js';

const API = 'https://api.mercadopago.com/v1';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function paymentNumber(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9][0-9]{0,24}$/.test(value)) return value;
  throw gatewayUnavailable();
}

function minorUnits(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d{1,10}(\.\d{1,2})?$/.test(String(value))) {
    throw gatewayUnavailable();
  }
  const [whole, fraction = ''] = String(value).split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function mercadoPagoGateway(accessToken: string, secret: string, http = fetch): PaymentGateway {
  let creditMethods: { ids: Set<string>; expiresAt: number } | undefined;

  async function request(path: string, body?: unknown, paymentId?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await http(`${API}/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json',
          ...(paymentId && { 'Content-Type': 'application/json', 'X-Idempotency-Key': paymentId }),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8_000), redirect: 'error',
      });
    } catch {
      throw gatewayUnavailable();
    }
    if (body && [400, 422].includes(response.status)) throw new ChargeRejected();
    if (!response.ok) throw gatewayUnavailable();
    return response.json().catch(() => { throw gatewayUnavailable(); });
  }

  async function requireCreditMethod(id: string) {
    if (!creditMethods || creditMethods.expiresAt <= Date.now()) {
      const list = await request('payment_methods');
      if (!Array.isArray(list)) throw gatewayUnavailable();
      const ids = new Set<string>();
      for (const item of list) {
        const method = record(item);
        if (method?.payment_type_id === 'credit_card' && method.status === 'active' && typeof method.id === 'string') {
          ids.add(method.id);
        }
      }
      creditMethods = { ids, expiresAt: Date.now() + 5 * 60_000 };
    }
    if (!creditMethods.ids.has(id)) throw new ChargeRejected('Meio de pagamento de crédito indisponível.');
  }

  return {
    name: 'mercado_pago',
    async createCharge({ paymentId, amountMinor, currency, expiresAt, email, details }) {
      if (currency !== 'BRL') throw new ChargeRejected('Este gateway aceita cobranças em BRL.');
      if (details.method === 'PIX' && !details.identification) throw new ChargeRejected('Informe o CPF ou CNPJ para pagar via Pix.');
      if (details.method === 'CREDIT_CARD') await requireCreditMethod(details.paymentMethodId);
      if (expiresAt.getTime() <= Date.now()) throw new HttpError(409, 'RESERVATION_INACTIVE', 'O prazo de pagamento terminou.');
      const payload = {
        transaction_amount: amountMinor / 100,
        external_reference: paymentId,
        description: 'Reserva de mesa',
        payer: { email, identification: details.identification },
        ...(details.method === 'PIX' ? {
          payment_method_id: 'pix',
          // Base this on the reservation deadline to keep provider retries identical and above its 30-minute minimum.
          date_of_expiration: new Date(expiresAt.getTime() + 31 * 60_000).toISOString(),
        } : {
          token: details.cardToken, payment_method_id: details.paymentMethodId,
          issuer_id: details.issuerId, installments: details.installments,
        }),
      };
      const charge = record(await request('payments', payload, paymentId));
      if (!charge) throw gatewayUnavailable();
      const providerPaymentId = paymentNumber(charge.id);
      const declined = charge.status === 'rejected' || charge.status === 'cancelled';
      if (details.method === 'CREDIT_CARD' || declined) return { providerPaymentId, declined };
      const pixCode = record(record(charge.point_of_interaction)?.transaction_data)?.qr_code;
      if (typeof pixCode !== 'string' || !pixCode.trim() || pixCode.length > 2_048) throw gatewayUnavailable();
      return { providerPaymentId, pixCode };
    },
    async readWebhook({ headers, query }) {
      const invalid = () => new HttpError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Assinatura do webhook inválida.');
      const signature = headers['x-signature'];
      const requestId = headers['x-request-id'];
      const id = query.get('data.id');
      if (typeof signature !== 'string') throw invalid();
      const fields = new Map<string, string>();
      for (const part of signature.split(',')) {
        const [key = '', value = '', ...extra] = part.split('=').map((field) => field.trim());
        if (!key || !value || extra.length || fields.has(key)) throw invalid();
        fields.set(key, value);
      }
      const ts = fields.get('ts');
      if (!id || query.getAll('data.id').length !== 1 || !/^[1-9][0-9]{0,24}$/.test(id) ||
          typeof requestId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(requestId) || !ts || !/^\d{10,13}$/.test(ts)) {
        throw invalid();
      }
      verifySignature(secret, `id:${id};request-id:${requestId};ts:${ts};`, fields.get('v1'));
      // The notification body is not signed by this gateway. Read the payment from its authenticated API.
      const charge = record(await request(`payments/${id}`));
      if (!charge || paymentNumber(charge.id) !== id) throw gatewayUnavailable();
      if (typeof charge.external_reference !== 'string' || !UUID.test(charge.external_reference)) return null;
      if (charge.status !== 'approved' && charge.status !== 'rejected' && charge.status !== 'cancelled') return null;
      const method = charge.payment_method_id === 'pix' ? 'PIX' : charge.payment_type_id === 'credit_card' ? 'CREDIT_CARD' : undefined;
      if (!method || typeof charge.currency_id !== 'string' || typeof charge.date_last_updated !== 'string') throw gatewayUnavailable();
      const event = {
        eventId: createHash('sha256').update(JSON.stringify([id, charge.status, charge.date_last_updated])).digest('hex'),
        paymentId: charge.external_reference.toLowerCase(), providerPaymentId: id, method,
        amountMinor: minorUnits(charge.transaction_amount), currency: charge.currency_id,
      } as const;
      if (charge.status !== 'approved') {
        return { ...event, outcome: charge.status === 'rejected' ? 'DECLINED' : 'CANCELLED' };
      }
      const approvedAt = new Date(typeof charge.date_approved === 'string' ? charge.date_approved : NaN);
      if (!Number.isFinite(approvedAt.getTime())) throw gatewayUnavailable();
      return { ...event, outcome: 'APPROVED', approvedAt };
    },
  };
}
