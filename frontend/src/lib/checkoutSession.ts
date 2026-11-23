import type { PaymentMethod } from '@/types/api';

/**
 * Per-reservation checkout state kept in sessionStorage so the user can close
 * the drawer (or reload) and resume a pending Pix / card attempt.
 *
 * No card data or payer document is persisted: only the idempotency key, a
 * hash-like signature of the last request, the payment id and the Pix code.
 */
export interface CheckoutSessionState {
  idempotencyKey?: string;
  /** Signature of the request bound to `idempotencyKey`. */
  signature?: string;
  paymentId?: string;
  method?: PaymentMethod;
  pix?: { copyPasteCode: string; qrCode: string };
}

const PREFIX = 'mesa-checkout:';

export function readCheckoutSession(reservationId: string): CheckoutSessionState {
  try {
    const raw = sessionStorage.getItem(PREFIX + reservationId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as CheckoutSessionState) : {};
  } catch {
    return {};
  }
}

export function writeCheckoutSession(
  reservationId: string,
  state: CheckoutSessionState,
): void {
  try {
    sessionStorage.setItem(PREFIX + reservationId, JSON.stringify(state));
  } catch {
    // Ignore storage errors (private mode / quota)
  }
}

export function patchCheckoutSession(
  reservationId: string,
  patch: Partial<CheckoutSessionState>,
): CheckoutSessionState {
  const next = { ...readCheckoutSession(reservationId), ...patch };
  writeCheckoutSession(reservationId, next);
  return next;
}

export function clearCheckoutSession(reservationId: string): void {
  try {
    sessionStorage.removeItem(PREFIX + reservationId);
  } catch {
    // Ignore
  }
}

/** Short, non-reversible signature used only to match idempotent retries. */
export function requestSignature(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}
