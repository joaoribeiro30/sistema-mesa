import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Loader2,
  Lock,
  MapPin,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import { useCountdown } from '@/hooks/useCountdown';
import {
  ApiError,
  generateIdempotencyKey,
  getFriendlyErrorMessage,
  reservationsApi,
} from '@/lib/api';
import {
  CARD_BRAND_LABEL,
  IS_SIMULATED_GATEWAY,
  REQUIRES_PAYER_IDENTIFICATION,
  cvvLength,
  detectCardBrand,
  fetchInstallments,
  formatCardNumber,
  formatDocument,
  formatExpiry,
  onlyDigits,
  parseIdentification,
  simulatedInstallments,
  tokenizeCard,
  validateCardForm,
  type CardFormErrors,
  type CardFormValues,
  type InstallmentOption,
} from '@/lib/cardPayment';
import {
  clearCheckoutSession,
  patchCheckoutSession,
  readCheckoutSession,
  requestSignature,
} from '@/lib/checkoutSession';
import { formatEventDateLine, formatMinorCurrency } from '@/lib/format';
import type {
  CheckoutInput,
  PaymentMethod,
  PaymentStatus,
  ReservationItem,
} from '@/types/api';

export interface CheckoutContextInfo {
  eventTitle: string;
  eventSlug?: string | null;
  startsAt?: string | null;
  venue?: string | null;
  city?: string | null;
  tableLabel: string;
  sectorName?: string | null;
}

interface CheckoutDrawerProps {
  reservation: ReservationItem;
  context: CheckoutContextInfo;
  onClose: () => void;
  /** Called once the payment is confirmed (reservation becomes CONFIRMED). */
  onPaid?: (reservationId: string) => void;
  /** Opens the digital ticket / receipt for the reservation. */
  onViewTicket: (reservationId: string) => void;
  /** Called when the hold window runs out without a confirmed payment. */
  onExpired?: (reservationId: string) => void;
  /** "Voltar ao evento" action (defaults to closing the drawer). */
  onBackToEvent?: () => void;
}

type Phase = 'form' | 'processing' | 'awaiting' | 'success' | 'expired' | 'refund';

const POLL_INTERVAL_MS: Record<PaymentMethod, number> = {
  PIX: 4000,
  CREDIT_CARD: 2500,
  DEBIT_CARD: 2500,
};

const EMPTY_CARD: CardFormValues = {
  number: '',
  holder: '',
  expiry: '',
  cvv: '',
  document: '',
  installments: 1,
};

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

function declinedMessage(method: PaymentMethod | null | undefined): string {
  return method === 'PIX'
    ? 'A cobrança Pix foi cancelada ou recusada. Gere um novo QR Code para tentar novamente.'
    : 'Pagamento recusado pela operadora. Revise os dados ou use outro cartão e tente novamente.';
}

export function CheckoutDrawer({
  reservation,
  context,
  onClose,
  onPaid,
  onViewTicket,
  onExpired,
  onBackToEvent,
}: CheckoutDrawerProps) {
  const reservationId = reservation.id;
  const alreadyConfirmed = reservation.status === 'CONFIRMED';

  const [phase, setPhase] = useState<Phase>(alreadyConfirmed ? 'success' : 'form');
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [canSimulate, setCanSimulate] = useState(false);
  const [pix, setPix] = useState<{ copyPasteCode: string; qrCode: string } | null>(null);
  const [cardSummary, setCardSummary] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  const [pixDocument, setPixDocument] = useState('');
  const [pixDocError, setPixDocError] = useState<string | null>(null);

  const [card, setCard] = useState<CardFormValues>(EMPTY_CARD);
  const [cardErrors, setCardErrors] = useState<CardFormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof CardFormValues, boolean>>>({});
  const [remoteInstallments, setRemoteInstallments] = useState<InstallmentOption[] | null>(null);

  const terminal = phase === 'success' || phase === 'refund';
  const countdown = useCountdown(reservation.expiresAt, !terminal && !alreadyConfirmed);
  const paidNotifiedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const format = useCallback(
    (minor: number) => formatMinorCurrency(minor, reservation.currency),
    [reservation.currency],
  );

  const markPaid = useCallback(() => {
    clearCheckoutSession(reservationId);
    setPhase('success');
    setError(null);
    if (!paidNotifiedRef.current) {
      paidNotifiedRef.current = true;
      onPaid?.(reservationId);
    }
  }, [onPaid, reservationId]);

  const handleFailedAttempt = useCallback(
    (failedMethod: PaymentMethod | null | undefined) => {
      patchCheckoutSession(reservationId, {
        idempotencyKey: undefined,
        signature: undefined,
        paymentId: undefined,
        pix: undefined,
      });
      setPaymentId(null);
      setCanSimulate(false);
      setPix(null);
      setPhase('form');
      setError(declinedMessage(failedMethod));
    },
    [reservationId],
  );

  const applyPaymentStatus = useCallback(
    (status: PaymentStatus, paymentMethod: PaymentMethod | null | undefined) => {
      if (paidNotifiedRef.current) return;
      switch (status) {
        case 'SUCCEEDED':
          markPaid();
          return;
        case 'FAILED':
        case 'CANCELLED':
          handleFailedAttempt(paymentMethod);
          return;
        case 'REFUND_REQUIRED':
        case 'REFUNDED':
          clearCheckoutSession(reservationId);
          setPhase('refund');
          return;
        default:
          setPhase('awaiting');
      }
    },
    [handleFailedAttempt, markPaid, reservationId],
  );

  // ---------------------------------------------------------------------------
  // Resume a previous attempt stored in sessionStorage
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (alreadyConfirmed) return;
    const stored = readCheckoutSession(reservationId);
    if (!stored.paymentId) return;
    let active = true;

    setPaymentId(stored.paymentId);
    if (stored.method) setMethod(stored.method);
    if (stored.pix) setPix(stored.pix);
    setPhase('processing');

    reservationsApi
      .getPayment(reservationId, stored.paymentId)
      .then(({ payment }) => {
        if (!active) return;
        setCanSimulate(Boolean(payment.canSimulate));
        if (payment.status === 'PENDING' && payment.method === 'PIX' && !stored.pix) {
          // Without the Pix code we can still poll; inform the user.
          setNotice('Existe um Pix pendente para esta reserva. Aguardando confirmação.');
        }
        applyPaymentStatus(payment.status, payment.method);
      })
      .catch(() => {
        if (!active) return;
        clearCheckoutSession(reservationId);
        setPaymentId(null);
        setPix(null);
        setPhase('form');
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId]);

  // ---------------------------------------------------------------------------
  // Expiration handling
  // ---------------------------------------------------------------------------
  const expiredHandledRef = useRef(false);
  useEffect(() => {
    if (!countdown.expired || terminal || alreadyConfirmed || expiredHandledRef.current) return;
    expiredHandledRef.current = true;

    const finish = () => {
      if (!mountedRef.current) return;
      setPhase('expired');
      setError(null);
      clearCheckoutSession(reservationId);
      onExpired?.(reservationId);
    };

    // One last status check: a payment approved right before the deadline
    // may still be confirmed by the webhook.
    if (paymentId) {
      reservationsApi
        .getPayment(reservationId, paymentId)
        .then(({ payment }) => {
          if (payment.status === 'SUCCEEDED') markPaid();
          else if (payment.status === 'REFUND_REQUIRED') setPhase('refund');
          else finish();
        })
        .catch(finish);
    } else {
      finish();
    }
  }, [alreadyConfirmed, countdown.expired, markPaid, onExpired, paymentId, reservationId, terminal]);

  // ---------------------------------------------------------------------------
  // Polling while awaiting confirmation (Pix webhook / card processing)
  // ---------------------------------------------------------------------------
  const checkStatus = useCallback(
    async (manual = false) => {
      if (!paymentId) return;
      if (manual) setChecking(true);
      try {
        const { payment } = await reservationsApi.getPayment(reservationId, paymentId);
        if (!mountedRef.current) return;
        setLastCheckedAt(Date.now());
        applyPaymentStatus(payment.status, payment.method);
        if (manual && payment.status === 'PENDING') {
          setNotice('Pagamento ainda não confirmado. Assim que o banco aprovar, atualizaremos automaticamente.');
        }
      } catch (err) {
        if (manual && mountedRef.current) setError(getFriendlyErrorMessage(err));
      } finally {
        if (manual && mountedRef.current) setChecking(false);
      }
    },
    [applyPaymentStatus, paymentId, reservationId],
  );

  async function simulatePayment() {
    if (!paymentId || checking) return;
    setChecking(true);
    setError(null);
    try {
      await reservationsApi.simulatePayment(reservationId, paymentId);
      if (mountedRef.current) markPaid();
    } catch (err) {
      if (mountedRef.current) setError(getFriendlyErrorMessage(err));
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }

  useEffect(() => {
    if (phase !== 'awaiting' || !paymentId || countdown.expired) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkStatus(false);
    }, POLL_INTERVAL_MS[method]);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkStatus(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [checkStatus, countdown.expired, method, paymentId, phase]);

  // Notice auto-dismiss
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Escape to close + body scroll lock
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'processing') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, phase]);

  // ---------------------------------------------------------------------------
  // Installments (Mercado Pago SDK when available, simulated otherwise)
  // ---------------------------------------------------------------------------
  const cardBin = onlyDigits(card.number).slice(0, 8);
  useEffect(() => {
    if (method !== 'CREDIT_CARD' || IS_SIMULATED_GATEWAY || cardBin.length < 6) {
      setRemoteInstallments(null);
      return;
    }
    let active = true;
    void fetchInstallments(reservation.amountMinor, cardBin).then((options) => {
      if (active) setRemoteInstallments(options);
    });
    return () => {
      active = false;
    };
  }, [cardBin, method, reservation.amountMinor]);

  const installmentOptions = useMemo(
    () => remoteInstallments ?? simulatedInstallments(reservation.amountMinor, format),
    [format, remoteInstallments, reservation.amountMinor],
  );

  useEffect(() => {
    if (!installmentOptions.some((o) => o.installments === card.installments)) {
      setCard((prev) => ({ ...prev, installments: installmentOptions[0]?.installments ?? 1 }));
    }
  }, [card.installments, installmentOptions]);

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  async function submitCheckout(input: CheckoutInput, signatureSource: unknown) {
    if (countdown.expired) {
      setPhase('expired');
      return;
    }
    setError(null);
    setNotice(null);
    setPhase('processing');

    // Reuse the idempotency key only when retrying the exact same request
    // (e.g. after a network failure) so the API replays the same attempt.
    const signature = requestSignature(signatureSource);
    const stored = readCheckoutSession(reservationId);
    const idempotencyKey =
      stored.idempotencyKey && stored.signature === signature
        ? stored.idempotencyKey
        : generateIdempotencyKey();
    patchCheckoutSession(reservationId, { idempotencyKey, signature, method: input.method });

    try {
      const { payment } = await reservationsApi.checkout(reservationId, input, idempotencyKey);
      if (!mountedRef.current) return;
      // The hold ran out while the request was in flight.
      if (expiredHandledRef.current && payment.status !== 'SUCCEEDED') return;

      setPaymentId(payment.id);
      setCanSimulate(Boolean(payment.canSimulate));
      setMethod(payment.method);
      if (payment.pix) setPix(payment.pix);
      patchCheckoutSession(reservationId, {
        paymentId: payment.id,
        method: payment.method,
        pix: payment.pix,
      });
      applyPaymentStatus(payment.status, payment.method);
    } catch (err) {
      if (!mountedRef.current) return;
      const apiErr = err instanceof ApiError ? err : null;
      const transient =
        !apiErr || apiErr.code === 'NETWORK_ERROR' || apiErr.status >= 500 || apiErr.status === 429;
      if (!transient) {
        // Definitive answer from the API: next attempt needs a new key.
        patchCheckoutSession(reservationId, { idempotencyKey: undefined, signature: undefined });
      }

      if (apiErr?.code === 'RESERVATION_INACTIVE' || expiredHandledRef.current) {
        setPhase('expired');
        clearCheckoutSession(reservationId);
        if (!expiredHandledRef.current) {
          expiredHandledRef.current = true;
          onExpired?.(reservationId);
        }
        return;
      }

      setPhase('form');
      if (apiErr?.code === 'CHARGE_REJECTED') {
        setError(apiErr.message || declinedMessage(input.method));
      } else if (apiErr?.code === 'PAYMENT_IN_PROGRESS') {
        setError(
          'Já existe uma cobrança pendente para esta reserva. Conclua o pagamento iniciado (ex.: Pix gerado anteriormente) ou aguarde sua expiração antes de tentar outro método.',
        );
      } else if (apiErr?.code === 'IDEMPOTENCY_KEY_CONFLICT') {
        setError('Esta tentativa conflitou com uma anterior. Envie novamente para gerar uma nova cobrança.');
      } else if (transient) {
        setError(
          `${getFriendlyErrorMessage(err)} Você pode tentar novamente com segurança: a mesma tentativa será reaproveitada.`,
        );
      } else {
        setError(getFriendlyErrorMessage(err));
      }
    }
  }

  function handlePixSubmit(e: FormEvent) {
    e.preventDefault();
    let identification;
    try {
      identification = parseIdentification(pixDocument);
    } catch (err) {
      setPixDocError((err as Error).message);
      return;
    }
    if (!identification && REQUIRES_PAYER_IDENTIFICATION) {
      setPixDocError('Informe o CPF ou CNPJ do pagador para gerar o Pix.');
      return;
    }
    setPixDocError(null);
    const input: CheckoutInput = identification
      ? { method: 'PIX', identification }
      : { method: 'PIX' };
    void submitCheckout(input, input);
  }

  async function handleCardSubmit(e: FormEvent) {
    e.preventDefault();
    if (method === 'PIX') return;
    const errors = validateCardForm(card);
    setCardErrors(errors);
    setTouched({ number: true, holder: true, expiry: true, cvv: true, document: true, installments: true });
    if (Object.keys(errors).length > 0) return;
    if (countdown.expired) {
      setPhase('expired');
      return;
    }

    setError(null);
    setPhase('processing');
    let tokenized;
    try {
      tokenized = await tokenizeCard(card, method);
    } catch (err) {
      if (!mountedRef.current) return;
      setPhase('form');
      setError(getFriendlyErrorMessage(err));
      return;
    }

    const identification = parseIdentification(card.document) ?? undefined;
    const input: CheckoutInput = {
      ...(method === 'DEBIT_CARD' ? { method, installments: 1 } : { method, installments: card.installments }),
      cardToken: tokenized.cardToken,
      paymentMethodId: tokenized.paymentMethodId,
      ...(tokenized.issuerId ? { issuerId: tokenized.issuerId } : {}),
      ...(identification ? { identification } : {}),
    };
    setCardSummary(
      `${tokenized.brand ? CARD_BRAND_LABEL[tokenized.brand] : 'Cartão'} •••• ${tokenized.lastFour} · ${input.installments}x`,
    );
    // Card tokens are single-use, so each attempt is a new request.
    await submitCheckout(input, { ...input, cardToken: tokenized.cardToken });
    if (mountedRef.current) {
      // Never keep sensitive fields around after an attempt.
      setCard((prev) => ({ ...prev, cvv: '' }));
    }
  }

  function updateCard<K extends keyof CardFormValues>(key: K, value: CardFormValues[K]) {
    const next = { ...card, [key]: value };
    setCard(next);
    if (touched[key]) setCardErrors(validateCardForm(next));
  }

  function blurCard(key: keyof CardFormValues) {
    setTouched((prev) => ({ ...prev, [key]: true }));
    setCardErrors(validateCardForm(card));
  }

  async function handleCopyPix() {
    if (!pix) return;
    const ok = await copyToClipboard(pix.copyPasteCode);
    setCopied(ok);
    if (!ok) setError('Não foi possível copiar automaticamente. Selecione o código e copie manualmente.');
    window.setTimeout(() => setCopied(false), 2500);
  }

  const brand = detectCardBrand(card.number);
  const urgent = !countdown.expired && countdown.remainingMs > 0 && countdown.remainingMs <= 2 * 60 * 1000;
  const submitBlocked = countdown.expired || phase === 'processing';
  const showCountdown = !terminal && !alreadyConfirmed && countdown.label !== null;

  const backToEvent = onBackToEvent ?? onClose;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  const fieldClass = (hasError: boolean) =>
    `w-full rounded-xl border bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:opacity-60 ${
      hasError ? 'border-[var(--danger)]' : 'border-[var(--border-subtle)]'
    }`;

  const fieldError = (key: keyof CardFormValues) =>
    touched[key] && cardErrors[key] ? (
      <p className="mt-1 text-[11px] text-[var(--danger)]">{cardErrors[key]}</p>
    ) : null;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-end justify-center bg-[var(--modal-backdrop)] backdrop-blur-sm sm:items-stretch sm:justify-end"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phase !== 'processing') onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        className="checkout-drawer flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-elevated)] sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-l-3xl"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--accent)] uppercase">
              Checkout seguro
            </p>
            <h2
              id="checkout-title"
              className="font-display mt-0.5 truncate text-lg font-bold text-[var(--text-primary)]"
            >
              {context.eventTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === 'processing'}
            aria-label="Fechar checkout"
            className="cursor-pointer rounded-full p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Countdown */}
        {showCountdown && (
          <div
            className={`border-b border-[var(--border-subtle)] px-5 py-3 ${
              countdown.expired
                ? 'bg-[var(--danger)]/10'
                : urgent
                  ? 'bg-[var(--danger)]/8'
                  : 'bg-amber-500/10'
            }`}
            role="timer"
            aria-live={urgent ? 'assertive' : 'off'}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={`inline-flex items-center gap-2 text-xs font-medium ${
                  countdown.expired || urgent
                    ? 'text-[var(--danger)]'
                    : 'text-amber-700'
                }`}
              >
                <Clock className="h-4 w-4 shrink-0" />
                {countdown.expired ? 'Tempo esgotado' : 'Sua mesa está reservada por'}
              </span>
              <span
                className={`font-mono-num rounded-full px-3 py-1 text-base font-bold tabular-nums ${
                  countdown.expired || urgent
                    ? 'bg-[var(--danger)]/15 text-[var(--danger)]'
                    : 'bg-amber-500/20 text-amber-700'
                }`}
              >
                {countdown.label}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--bg-hover)]">
              <div
                className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
                  urgent || countdown.expired ? 'bg-[var(--danger)]' : 'bg-amber-500'
                }`}
                style={{ width: `${countdown.fraction * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Order summary */}
          <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1 text-xs text-[var(--text-secondary)]">
                <p className="text-sm font-bold text-[var(--text-primary)]">
                  Mesa {context.tableLabel}
                  {context.sectorName && (
                    <span className="font-normal text-[var(--text-secondary)]"> · {context.sectorName}</span>
                  )}
                </p>
                {context.startsAt && (
                  <p className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    {formatEventDateLine(context.startsAt)}
                  </p>
                )}
                {context.venue && (
                  <p className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                    <span className="truncate">
                      {context.venue}
                      {context.city ? ` · ${context.city}` : ''}
                    </span>
                  </p>
                )}
                <p className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  {reservation.guestCount} {reservation.guestCount === 1 ? 'pessoa' : 'pessoas'} · capacidade{' '}
                  {reservation.capacity}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">Total</p>
                <p className="font-mono-num text-xl font-bold text-[var(--text-primary)]">
                  {format(reservation.amountMinor)}
                </p>
              </div>
            </div>
          </section>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-4 py-3 text-xs leading-relaxed text-[var(--danger)]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p>{error}</p>
                {!countdown.expired && phase === 'form' && (
                  <p className="mt-1 font-semibold">
                    Você ainda tem {countdown.label} para tentar novamente.
                  </p>
                )}
              </div>
            </div>
          )}

          {notice && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 text-xs text-[var(--text-secondary)]"
            >
              <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          {/* ---------------- EXPIRED ---------------- */}
          {phase === 'expired' && (
            <section className="animate-pop-in rounded-3xl border border-[var(--danger)]/35 bg-[var(--danger)]/8 p-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--danger)]/15 text-[var(--danger)]">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <h3 className="font-display mt-4 text-lg font-bold text-[var(--text-primary)]">
                Reserva expirada
              </h3>
              <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-[var(--text-secondary)]">
                O prazo de 10 minutos para pagamento terminou e a mesa {context.tableLabel} foi liberada.
                Nenhuma cobrança foi confirmada. Volte ao evento para escolher uma mesa novamente.
              </p>
              <button
                type="button"
                onClick={backToEvent}
                className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-2.5 text-xs font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar ao evento
              </button>
            </section>
          )}

          {/* ---------------- REFUND REQUIRED ---------------- */}
          {phase === 'refund' && (
            <section className="animate-pop-in rounded-3xl border border-amber-500/35 bg-amber-500/10 p-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-700">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <h3 className="font-display mt-4 text-lg font-bold text-[var(--text-primary)]">
                Pagamento recebido após o prazo
              </h3>
              <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-[var(--text-secondary)]">
                Identificamos seu pagamento, mas ele foi aprovado depois que a reserva expirou. O valor será
                estornado pela nossa equipe pelo mesmo meio de pagamento.
              </p>
              <button
                type="button"
                onClick={backToEvent}
                className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-2.5 text-xs font-semibold text-[var(--cta-text)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar ao evento
              </button>
            </section>
          )}

          {/* ---------------- SUCCESS ---------------- */}
          {phase === 'success' && (
            <section className="animate-pop-in rounded-3xl border border-emerald-500/35 bg-emerald-500/10 p-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-[var(--success)] ring-8 ring-emerald-50">
                <Check className="h-8 w-8" strokeWidth={3} />
              </div>
              <h3 className="font-display mt-5 text-xl font-bold text-[var(--text-primary)]">
                Pagamento confirmado!
              </h3>
              <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-[var(--text-secondary)]">
                Sua mesa {context.tableLabel} está garantida. O ingresso digital com QR Code já está disponível
                para apresentação na portaria.
              </p>
              <div className="mt-5 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => onViewTicket(reservationId)}
                  className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-3 text-sm font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)]"
                >
                  <Ticket className="h-4 w-4" />
                  Ver ingresso / QR Code
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="cursor-pointer rounded-full border border-[var(--border-strong)] px-5 py-2.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                >
                  Fechar
                </button>
              </div>
            </section>
          )}

          {/* ---------------- AWAITING CONFIRMATION ---------------- */}
          {phase === 'awaiting' && method === 'PIX' && (
            <section className="space-y-4">
              <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-5 text-center">
                <p className="text-xs font-semibold tracking-wider text-[var(--text-muted)] uppercase">
                  Pague com Pix
                </p>
                {pix ? (
                  <>
                    <div className="mx-auto mt-3 w-fit rounded-2xl bg-white p-3 shadow-sm">
                      <img
                        src={pix.qrCode}
                        alt="QR Code Pix para pagamento"
                        className="h-52 w-52 [image-rendering:pixelated]"
                      />
                    </div>
                    <p className="mt-3 text-xs text-[var(--text-secondary)]">
                      Abra o app do seu banco, escolha <strong>Pagar com Pix</strong> e escaneie o código.
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-[var(--text-secondary)]">
                    O QR Code desta cobrança foi gerado em outra sessão. Use o código no app do banco onde ele foi
                    copiado.
                  </p>
                )}
              </div>

              {pix && (
                <div>
                  <label
                    htmlFor="pix-copy-paste"
                    className="mb-1.5 block text-xs font-semibold text-[var(--text-primary)]"
                  >
                    Pix copia e cola
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="pix-copy-paste"
                      readOnly
                      value={pix.copyPasteCode}
                      onFocus={(e) => e.currentTarget.select()}
                      className="font-mono-num min-w-0 flex-1 truncate rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs text-[var(--text-primary)]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleCopyPix()}
                      className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition-colors ${
                        copied
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-[var(--cta-bg)] text-[var(--cta-text)] hover:bg-[var(--cta-hover)]'
                      }`}
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                </div>
              )}

              {canSimulate ? (
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                  Este Pix é de demonstração. Simule a confirmação abaixo para emitir o ingresso.
                </p>
              ) : (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-500" />
                  <span>
                    <strong className="text-[var(--text-primary)]">Confirmação automática:</strong> assim que o banco
                    aprovar o Pix, esta tela será atualizada sozinha — não é preciso enviar comprovante. Pague antes do
                    cronômetro zerar.
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={() => void (canSimulate ? simulatePayment() : checkStatus(true))}
                disabled={checking || countdown.expired}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-5 py-2.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
                {canSimulate ? 'Simular pagamento' : 'Já paguei, verificar status'}
              </button>
              {lastCheckedAt && (
                <p className="text-center text-[11px] text-[var(--text-muted)]">
                  Última verificação às{' '}
                  {new Date(lastCheckedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </p>
              )}
              {IS_SIMULATED_GATEWAY && !canSimulate && (
                <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                  Ambiente de testes: este Pix é simulado e não tem valor. A confirmação ocorre quando o webhook
                  de teste for enviado ao endpoint <code>/webhooks/payment</code>.
                </p>
              )}
            </section>
          )}

          {phase === 'awaiting' && method !== 'PIX' && (
            <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-6 text-center">
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-[var(--accent)]" />
              <h3 className="font-display mt-4 text-base font-bold text-[var(--text-primary)]">
                Processando pagamento
              </h3>
              <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-[var(--text-secondary)]">
                {cardSummary ? `${cardSummary}. ` : ''}
                {canSimulate ? 'Simule a confirmação para emitir o ingresso.' : 'Aguardando a confirmação da operadora. Isso costuma levar poucos segundos.'}
              </p>
              <button
                type="button"
                onClick={() => void (canSimulate ? simulatePayment() : checkStatus(true))}
                disabled={checking || countdown.expired}
                className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border-strong)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
                {canSimulate ? 'Simular pagamento' : 'Verificar status'}
              </button>
            </section>
          )}

          {/* ---------------- PROCESSING ---------------- */}
          {phase === 'processing' && (
            <section
              className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-8 text-center"
              aria-busy="true"
            >
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-[var(--accent)]" />
              <p className="mt-4 text-sm font-semibold text-[var(--text-primary)]">
                {method === 'PIX' ? 'Gerando cobrança Pix…' : 'Enviando pagamento com segurança…'}
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Não feche esta janela.</p>
            </section>
          )}

          {/* ---------------- FORM ---------------- */}
          {phase === 'form' && (
            <section className="space-y-4">
              <div
                role="tablist"
                aria-label="Forma de pagamento"
                className="grid grid-cols-3 gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-1"
              >
                {(
                  [
                    { id: 'PIX', label: 'Pix', icon: QrCode, hint: 'Aprovação na hora' },
                    { id: 'CREDIT_CARD', label: 'Cartão de crédito', icon: CreditCard, hint: 'Em até 12x' },
                    { id: 'DEBIT_CARD', label: 'Cartão de débito', icon: CreditCard, hint: 'À vista' },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  const active = method === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        setMethod(opt.id);
                        setError(null);
                      }}
                      className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all ${
                        active
                          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--accent-border)]'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className={`h-4 w-4 ${active ? 'text-[var(--accent)]' : ''}`} />
                        {opt.label}
                      </span>
                      <span className="text-[10px] font-normal text-[var(--text-muted)]">{opt.hint}</span>
                    </button>
                  );
                })}
              </div>

              {method === 'PIX' ? (
                <form onSubmit={handlePixSubmit} className="space-y-4" noValidate>
                  <ul className="space-y-2 text-xs text-[var(--text-secondary)]">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      Geramos um QR Code e um código copia e cola para você pagar no app do banco.
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      A confirmação é automática e o ingresso é liberado em seguida.
                    </li>
                  </ul>
                  <div>
                    <label
                      htmlFor="pix-document"
                      className="mb-1.5 block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      CPF ou CNPJ do pagador
                      {!REQUIRES_PAYER_IDENTIFICATION && (
                        <span className="font-normal text-[var(--text-muted)]"> (opcional)</span>
                      )}
                    </label>
                    <input
                      id="pix-document"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="000.000.000-00"
                      value={pixDocument}
                      onChange={(e) => {
                        setPixDocument(formatDocument(e.target.value));
                        setPixDocError(null);
                      }}
                      className={fieldClass(Boolean(pixDocError))}
                    />
                    {pixDocError && <p className="mt-1 text-[11px] text-[var(--danger)]">{pixDocError}</p>}
                  </div>
                  <button
                    type="submit"
                    disabled={submitBlocked}
                    className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-3 text-sm font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <QrCode className="h-4 w-4" />
                    Gerar QR Code Pix · {format(reservation.amountMinor)}
                  </button>
                </form>
              ) : (
                <form onSubmit={(e) => void handleCardSubmit(e)} className="space-y-3.5" noValidate>
                  <div>
                    <label htmlFor="card-number" className="mb-1.5 block text-xs font-semibold text-[var(--text-primary)]">
                      Número do cartão
                    </label>
                    <div className="relative">
                      <input
                        id="card-number"
                        inputMode="numeric"
                        autoComplete="cc-number"
                        placeholder="0000 0000 0000 0000"
                        value={card.number}
                        onChange={(e) => updateCard('number', formatCardNumber(e.target.value))}
                        onBlur={() => blurCard('number')}
                        className={`${fieldClass(Boolean(touched.number && cardErrors.number))} font-mono-num pr-24`}
                      />
                      {brand && (
                        <span className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-secondary)] ring-1 ring-[var(--border-subtle)]">
                          {CARD_BRAND_LABEL[brand]}
                        </span>
                      )}
                    </div>
                    {fieldError('number')}
                  </div>

                  <div>
                    <label htmlFor="card-holder" className="mb-1.5 block text-xs font-semibold text-[var(--text-primary)]">
                      Nome do titular
                    </label>
                    <input
                      id="card-holder"
                      autoComplete="cc-name"
                      placeholder="Como impresso no cartão"
                      value={card.holder}
                      onChange={(e) => updateCard('holder', e.target.value.toUpperCase())}
                      onBlur={() => blurCard('holder')}
                      className={fieldClass(Boolean(touched.holder && cardErrors.holder))}
                    />
                    {fieldError('holder')}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="card-expiry" className="mb-1.5 block text-xs font-semibold text-[var(--text-primary)]">
                        Validade
                      </label>
                      <input
                        id="card-expiry"
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        placeholder="MM/AA"
                        value={card.expiry}
                        onChange={(e) => updateCard('expiry', formatExpiry(e.target.value))}
                        onBlur={() => blurCard('expiry')}
                        className={`${fieldClass(Boolean(touched.expiry && cardErrors.expiry))} font-mono-num`}
                      />
                      {fieldError('expiry')}
                    </div>
                    <div>
                      <label htmlFor="card-cvv" className="mb-1.5 block text-xs font-semibold text-[var(--text-primary)]">
                        CVV
                      </label>
                      <input
                        id="card-cvv"
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        type="password"
                        placeholder={brand === 'amex' ? '0000' : '000'}
                        value={card.cvv}
                        onChange={(e) => updateCard('cvv', onlyDigits(e.target.value).slice(0, cvvLength(brand)))}
                        onBlur={() => blurCard('cvv')}
                        className={`${fieldClass(Boolean(touched.cvv && cardErrors.cvv))} font-mono-num`}
                      />
                      {fieldError('cvv')}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="card-document" className="mb-1.5 block text-xs font-semibold text-[var(--text-primary)]">
                      CPF ou CNPJ do titular
                      {!REQUIRES_PAYER_IDENTIFICATION && (
                        <span className="font-normal text-[var(--text-muted)]"> (opcional)</span>
                      )}
                    </label>
                    <input
                      id="card-document"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="000.000.000-00"
                      value={card.document}
                      onChange={(e) => updateCard('document', formatDocument(e.target.value))}
                      onBlur={() => blurCard('document')}
                      className={fieldClass(Boolean(touched.document && cardErrors.document))}
                    />
                    {fieldError('document')}
                  </div>

                  {method === 'CREDIT_CARD' && (
                    <div>
                      <label htmlFor="card-installments" className="mb-1.5 block text-xs font-semibold text-[var(--text-primary)]">
                        Parcelas
                      </label>
                      <select
                        id="card-installments"
                        value={card.installments}
                        onChange={(e) => updateCard('installments', Number(e.target.value))}
                        className={`${fieldClass(Boolean(touched.installments && cardErrors.installments))} cursor-pointer`}
                      >
                        {installmentOptions.map((opt) => (
                          <option key={opt.installments} value={opt.installments}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      {fieldError('installments')}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitBlocked}
                    className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-3 text-sm font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Lock className="h-4 w-4" />
                    Pagar {format(reservation.amountMinor)}
                  </button>

                  <p className="flex items-start gap-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    {IS_SIMULATED_GATEWAY
                      ? 'Ambiente de testes: os dados do cartão são convertidos em um token simulado no navegador e nunca são enviados ao servidor.'
                      : 'Os dados do cartão são tokenizados diretamente pelo Mercado Pago e nunca passam pelos nossos servidores.'}
                  </p>
                </form>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        {(phase === 'form' || phase === 'awaiting') && (
          <footer className="flex items-center justify-center gap-1.5 border-t border-[var(--border-subtle)] px-5 py-3 text-[11px] text-[var(--text-muted)]">
            <Lock className="h-3 w-3" />
            Pagamento protegido · valor calculado pelo servidor
          </footer>
        )}
      </aside>
    </div>
  );
}
