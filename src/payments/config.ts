import { hkdfSync } from 'node:crypto';

export function loadPaymentConfig(production: boolean, jwtSecret: string) {
  const configuredProvider = process.env.PAYMENT_PROVIDER?.trim();
  if (production && !configuredProvider) throw new Error('Configure PAYMENT_PROVIDER explicitamente em produção.');
  const provider = configuredProvider || 'mock';
  if (provider !== 'mock' && provider !== 'mercado_pago') throw new Error('PAYMENT_PROVIDER inválido.');
  const advance = process.env.PAYMENT_CREDIT_ADVANCE?.trim() || 'false';
  if (advance !== 'true' && advance !== 'false') throw new Error('PAYMENT_CREDIT_ADVANCE deve ser true ou false.');
  const creditAdvance = advance === 'true';

  const derive = (purpose: string) => Buffer.from(hkdfSync('sha256', jwtSecret, '', `sistemamesa.${purpose}.v1`, 32));
  const configuredSecret = process.env.PAYMENT_WEBHOOK_SECRET?.trim();
  if (provider === 'mercado_pago' && !configuredSecret) throw new Error('Configure PAYMENT_WEBHOOK_SECRET.');
  const webhookSecret = configuredSecret || derive('mock-webhook').toString('base64url');
  const encodedKey = process.env.TICKET_ENCRYPTION_KEY?.trim();
  const ticketKey = encodedKey ? Buffer.from(encodedKey, 'base64url') : derive('dev-ticket');
  if ((production && !encodedKey) || ticketKey.length !== 32 || (encodedKey && ticketKey.toString('base64url') !== encodedKey)) {
    throw new Error('TICKET_ENCRYPTION_KEY deve usar 32 bytes em base64url.');
  }
  if (provider === 'mock') return { provider, webhookSecret, ticketKey, creditAdvance } as const;
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error('Configure MERCADO_PAGO_ACCESS_TOKEN.');
  return { provider, webhookSecret, ticketKey, creditAdvance, accessToken } as const;
}

export type PaymentConfig = ReturnType<typeof loadPaymentConfig>;
