/**
 * Card validation and tokenization helpers for checkout.
 *
 * Raw card data never leaves the browser towards the Sistema Mesa API: the
 * backend only receives `cardToken`, `paymentMethodId`, `installments` and
 * optionally `issuerId` / `identification`, as defined in the API contract.
 *
 * - When `VITE_MERCADO_PAGO_PUBLIC_KEY` is set, the official Mercado Pago JS SDK
 *   (v2) is loaded and used to create the card token, detect the brand/issuer
 *   and list installments.
 * - Otherwise a simulated tokenizer is used, compatible with the backend
 *   `PAYMENT_PROVIDER=mock` gateway (local development only).
 */
import type { PayerIdentification } from '@/types/api';

export const MERCADO_PAGO_PUBLIC_KEY =
  (import.meta.env.VITE_MERCADO_PAGO_PUBLIC_KEY as string | undefined)?.trim() || '';

export const IS_SIMULATED_GATEWAY = !MERCADO_PAGO_PUBLIC_KEY;

/** The Mercado Pago gateway requires CPF/CNPJ for Pix. */
export const REQUIRES_PAYER_IDENTIFICATION = !IS_SIMULATED_GATEWAY;

export const onlyDigits = (value: string) => value.replace(/\D/g, '');

// ---------------------------------------------------------------------------
// Brand detection
// ---------------------------------------------------------------------------

export type CardBrand = 'visa' | 'master' | 'amex' | 'elo' | 'hipercard' | 'diners';

export const CARD_BRAND_LABEL: Record<CardBrand, string> = {
  visa: 'Visa',
  master: 'Mastercard',
  amex: 'American Express',
  elo: 'Elo',
  hipercard: 'Hipercard',
  diners: 'Diners Club',
};

const BRAND_RULES: Array<{ brand: CardBrand; pattern: RegExp }> = [
  {
    brand: 'elo',
    pattern:
      /^(401178|401179|431274|438935|451416|457393|457631|457632|504175|506699|5067[0-7]\d|509\d{3}|627780|636297|636368|650(0[3-9]|[1-4]\d|5[0-1])|6504[0-9]|6505[0-3]|6507|6509|6516|6550)/,
  },
  { brand: 'hipercard', pattern: /^(606282|3841(0|4|6)0)/ },
  { brand: 'amex', pattern: /^3[47]/ },
  { brand: 'diners', pattern: /^3(0[0-5]|[68])/ },
  { brand: 'visa', pattern: /^4/ },
  { brand: 'master', pattern: /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/ },
];

export function detectCardBrand(cardNumber: string): CardBrand | null {
  const digits = onlyDigits(cardNumber);
  if (digits.length < 1) return null;
  return BRAND_RULES.find((rule) => rule.pattern.test(digits))?.brand ?? null;
}

export function cvvLength(brand: CardBrand | null): number {
  return brand === 'amex' ? 4 : 3;
}

export function formatCardNumber(value: string): string {
  const digits = onlyDigits(value).slice(0, 19);
  if (detectCardBrand(digits) === 'amex') {
    return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)]
      .filter(Boolean)
      .join(' ');
  }
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function formatExpiry(value: string): string {
  const digits = onlyDigits(value).slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function formatDocument(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function luhnValid(cardNumber: string): boolean {
  const digits = onlyDigits(cardNumber);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export function parseExpiry(value: string): { month: number; year: number } | null {
  const match = /^(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { month, year };
}

function isCpfValid(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

function isCnpjValid(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len: number) => {
    const weights = len === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(cnpj[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

/** Returns an identification payload, `null` when empty, or throws a message. */
export function parseIdentification(raw: string): PayerIdentification | null {
  const digits = onlyDigits(raw);
  if (!digits) return null;
  if (digits.length === 11 && isCpfValid(digits)) return { type: 'CPF', number: digits };
  if (digits.length === 14 && isCnpjValid(digits)) return { type: 'CNPJ', number: digits };
  throw new Error('Informe um CPF ou CNPJ válido.');
}

export interface CardFormValues {
  number: string;
  holder: string;
  expiry: string;
  cvv: string;
  document: string;
  installments: number;
}

export type CardFormErrors = Partial<Record<keyof CardFormValues, string>>;

export function validateCardForm(
  values: CardFormValues,
  nowMs = Date.now(),
): CardFormErrors {
  const errors: CardFormErrors = {};
  const digits = onlyDigits(values.number);
  const brand = detectCardBrand(digits);

  if (!digits) errors.number = 'Informe o número do cartão.';
  else if (!luhnValid(digits)) errors.number = 'Número de cartão inválido.';
  else if (!brand) errors.number = 'Bandeira não aceita.';

  const holder = values.holder.trim();
  if (holder.length < 3) errors.holder = 'Informe o nome impresso no cartão.';
  else if (!/^[A-Za-zÀ-ÿ' .-]+$/.test(holder)) errors.holder = 'Use apenas letras no nome do titular.';
  else if (holder.split(/\s+/).length < 2) errors.holder = 'Informe nome e sobrenome.';

  const exp = parseExpiry(values.expiry);
  if (!exp) {
    errors.expiry = 'Use o formato MM/AA.';
  } else {
    const now = new Date(nowMs);
    const current = now.getFullYear() * 12 + now.getMonth();
    const candidate = exp.year * 12 + (exp.month - 1);
    if (candidate < current) errors.expiry = 'Cartão vencido.';
    else if (candidate > current + 20 * 12) errors.expiry = 'Validade inválida.';
  }

  const cvv = onlyDigits(values.cvv);
  if (cvv.length !== cvvLength(brand)) {
    errors.cvv = `O CVV tem ${cvvLength(brand)} dígitos.`;
  }

  try {
    const id = parseIdentification(values.document);
    if (!id && REQUIRES_PAYER_IDENTIFICATION) errors.document = 'Informe o CPF ou CNPJ do titular.';
  } catch (err) {
    errors.document = (err as Error).message;
  }

  if (!Number.isInteger(values.installments) || values.installments < 1 || values.installments > 24) {
    errors.installments = 'Selecione o número de parcelas.';
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Mercado Pago SDK (loaded on demand)
// ---------------------------------------------------------------------------

interface MercadoPagoInstance {
  createCardToken(input: {
    cardNumber: string;
    cardholderName: string;
    cardExpirationMonth: string;
    cardExpirationYear: string;
    securityCode: string;
    identificationType?: string;
    identificationNumber?: string;
  }): Promise<{ id: string }>;
  getPaymentMethods(input: { bin: string }): Promise<{
    results: Array<{ id: string; payment_type_id: string; issuer?: { id: number | string } }>;
  }>;
  getInstallments(input: { amount: string; bin: string; paymentTypeId?: string }): Promise<
    Array<{
      payment_method_id: string;
      issuer?: { id: number | string };
      payer_costs: Array<{ installments: number; recommended_message: string }>;
    }>
  >;
}

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options?: { locale?: string }) => MercadoPagoInstance;
  }
}

let sdkPromise: Promise<MercadoPagoInstance> | null = null;

function loadMercadoPago(): Promise<MercadoPagoInstance> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<MercadoPagoInstance>((resolve, reject) => {
    const create = () => {
      if (!window.MercadoPago) {
        reject(new Error('SDK de pagamento indisponível.'));
        return;
      }
      resolve(new window.MercadoPago(MERCADO_PAGO_PUBLIC_KEY, { locale: 'pt-BR' }));
    };
    if (window.MercadoPago) {
      create();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.async = true;
    script.onload = create;
    script.onerror = () => reject(new Error('Não foi possível carregar o SDK de pagamento.'));
    document.head.appendChild(script);
  }).catch((err) => {
    sdkPromise = null;
    throw err;
  });
  return sdkPromise;
}

export interface InstallmentOption {
  installments: number;
  label: string;
}

export function simulatedInstallments(
  amountMinor: number,
  format: (minor: number) => string,
  max = 12,
): InstallmentOption[] {
  const options: InstallmentOption[] = [];
  for (let n = 1; n <= max; n += 1) {
    const per = Math.ceil(amountMinor / n);
    // Keep a minimum installment of R$ 5,00
    if (n > 1 && per < 500) break;
    options.push({
      installments: n,
      label: n === 1 ? `1x de ${format(amountMinor)} (à vista)` : `${n}x de ${format(per)} sem juros`,
    });
  }
  return options;
}

export async function fetchInstallments(
  amountMinor: number,
  cardNumber: string,
): Promise<InstallmentOption[] | null> {
  if (IS_SIMULATED_GATEWAY) return null;
  const bin = onlyDigits(cardNumber).slice(0, 8);
  if (bin.length < 6) return null;
  try {
    const mp = await loadMercadoPago();
    const [first] = await mp.getInstallments({
      amount: (amountMinor / 100).toFixed(2),
      bin,
      paymentTypeId: 'credit_card',
    });
    if (!first?.payer_costs?.length) return null;
    return first.payer_costs.map((cost) => ({
      installments: cost.installments,
      label: cost.recommended_message,
    }));
  } catch {
    return null;
  }
}

export interface TokenizedCard {
  cardToken: string;
  paymentMethodId: string;
  issuerId?: string;
  brand: CardBrand | null;
  lastFour: string;
}

function randomTokenSuffix(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function tokenizeCard(values: CardFormValues): Promise<TokenizedCard> {
  const digits = onlyDigits(values.number);
  const brand = detectCardBrand(digits);
  const exp = parseExpiry(values.expiry);
  if (!exp) throw new Error('Validade inválida.');
  const identification = parseIdentification(values.document);
  const lastFour = digits.slice(-4);

  if (IS_SIMULATED_GATEWAY) {
    // Simulated tokenization for the local mock gateway. The token is opaque
    // and does not carry any card data.
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    return {
      cardToken: `sim_${brand ?? 'card'}_${randomTokenSuffix()}`,
      paymentMethodId: brand ?? 'visa',
      brand,
      lastFour,
    };
  }

  const mp = await loadMercadoPago();
  const bin = digits.slice(0, 8);
  const methods = await mp.getPaymentMethods({ bin }).catch(() => null);
  const method = methods?.results?.find((m) => m.payment_type_id === 'credit_card')
    ?? methods?.results?.[0];
  if (!method) throw new Error('Não foi possível identificar a bandeira do cartão.');

  let token: { id: string };
  try {
    token = await mp.createCardToken({
      cardNumber: digits,
      cardholderName: values.holder.trim(),
      cardExpirationMonth: String(exp.month).padStart(2, '0'),
      cardExpirationYear: String(exp.year),
      securityCode: onlyDigits(values.cvv),
      identificationType: identification?.type,
      identificationNumber: identification?.number,
    });
  } catch {
    throw new Error('Os dados do cartão foram recusados pelo emissor. Revise e tente novamente.');
  }
  if (!token?.id) throw new Error('Não foi possível gerar o token do cartão.');

  return {
    cardToken: token.id,
    paymentMethodId: method.id,
    issuerId: method.issuer?.id !== undefined ? String(method.issuer.id) : undefined,
    brand,
    lastFour,
  };
}
