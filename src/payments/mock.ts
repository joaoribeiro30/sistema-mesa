import { HttpError } from '../http.js';
import { UUID, verifySignature, type PaymentGateway } from './gateway.js';

const EVENT_FIELDS = new Set(['eventId', 'paymentId', 'method', 'amountMinor', 'currency', 'outcome', 'approvedAt']);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export function mockGateway(secret: string): PaymentGateway {
  return {
    name: 'mock',
    async createCharge({ paymentId, details }) {
      return {
        providerPaymentId: `mock_${paymentId}`,
        pixCode: details.method === 'PIX' ? `PIX-SIMULADO-SEM-VALOR:${paymentId}` : undefined,
      };
    },
    async readWebhook({ headers, body }) {
      const signature = headers['x-signature'];
      verifySignature(secret, body, typeof signature === 'string' ? signature : undefined);
      const invalid = () => new HttpError(400, 'INVALID_PAYMENT_EVENT', 'Evento de pagamento inválido.');
      let raw: unknown;
      try {
        raw = JSON.parse(utf8.decode(body));
      } catch {
        throw invalid();
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !EVENT_FIELDS.has(key))) throw invalid();
      const data = raw as Record<string, unknown>;
      if (typeof data.eventId !== 'string' || !/^[a-z0-9_-]{1,120}$/i.test(data.eventId) ||
          typeof data.paymentId !== 'string' || !UUID.test(data.paymentId) ||
          (data.method !== 'PIX' && data.method !== 'CREDIT_CARD') ||
          typeof data.amountMinor !== 'number' || !Number.isInteger(data.amountMinor) ||
          data.amountMinor <= 0 || data.amountMinor > 2_147_483_647 ||
          typeof data.currency !== 'string' || !/^[A-Z]{3}$/.test(data.currency)) throw invalid();
      const event = {
        eventId: data.eventId, paymentId: data.paymentId.toLowerCase(), providerPaymentId: `mock_${data.paymentId.toLowerCase()}`,
        method: data.method, amountMinor: data.amountMinor, currency: data.currency,
      } as const;
      if (data.approvedAt === undefined && (data.outcome === 'DECLINED' || data.outcome === 'CANCELLED')) {
        return { ...event, outcome: data.outcome };
      }
      if (data.outcome !== 'APPROVED' || typeof data.approvedAt !== 'string' || !ISO_TIMESTAMP.test(data.approvedAt)) throw invalid();
      const approvedAt = new Date(data.approvedAt);
      if (!Number.isFinite(approvedAt.getTime())) throw invalid();
      return { ...event, outcome: 'APPROVED', approvedAt };
    },
  };
}
