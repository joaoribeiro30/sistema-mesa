import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Calendar,
  Check,
  Copy,
  Download,
  Loader2,
  MapPin,
  Printer,
  RefreshCw,
  ScanLine,
  Ticket,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError, getFriendlyErrorMessage, reservationsApi } from '@/lib/api';
import { formatEventDateLine, formatMinorCurrency } from '@/lib/format';
import type { PaymentMethod, ReservationReceipt } from '@/types/api';

interface TicketModalProps {
  reservationId: string;
  onClose: () => void;
}

const RETRY_DELAYS_MS = [1200, 2500, 4000];
const paymentMethodLabels: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
};

function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Human-friendly ticket code derived from the reservation id. */
export function ticketCode(reservationId: string): string {
  const hex = reservationId.replace(/-/g, '').toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function TicketModal({ reservationId, onClose }: TicketModalProps) {
  const { user } = useAuth();
  const [receipt, setReceipt] = useState<ReservationReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Right after the webhook confirms, the receipt may take a moment to be
    // available. Retry a few times on 404 before surfacing the error.
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const { receipt: data } = await reservationsApi.getReceipt(reservationId);
        setReceipt(data);
        setLoading(false);
        return;
      } catch (err) {
        const retriable =
          err instanceof ApiError && err.status === 404 && attempt < RETRY_DELAYS_MS.length;
        if (!retriable) {
          setError(
            err instanceof ApiError && err.status === 404
              ? 'O comprovante ainda não está disponível. Ele é liberado assim que o pagamento é confirmado.'
              : getFriendlyErrorMessage(err),
          );
          setLoading(false);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
  }, [reservationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function handleCopyToken() {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(receipt.ticket.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard unavailable
    }
  }

  const checkedIn = Boolean(receipt?.checkedInAt);
  const checkInKnown = receipt ? receipt.checkedInAt !== undefined : false;
  const code = ticketCode(reservationId);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[var(--modal-backdrop)] p-4 backdrop-blur-sm print:bg-transparent"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-title"
        className="ticket-printable animate-pop-in relative my-auto w-full max-w-sm"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar ingresso"
          className="ticket-no-print absolute -top-3 -right-3 z-10 cursor-pointer rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2 text-[var(--text-secondary)] shadow-lg hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>

        {loading ? (
          <div className="rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-10 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--accent)]" />
            <p className="mt-3 text-sm text-[var(--text-secondary)]">Carregando seu ingresso…</p>
          </div>
        ) : error || !receipt ? (
          <div className="rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--danger)]/10 text-[var(--danger)]">
              <AlertCircle className="h-6 w-6" />
            </div>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">{error ?? 'Comprovante indisponível.'}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-2.5 text-xs font-semibold text-[var(--cta-text)]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tentar novamente
            </button>
          </div>
        ) : (
          <article className="overflow-hidden rounded-3xl bg-[var(--bg-surface)] shadow-[var(--shadow-elevated)] ring-1 ring-[var(--border-strong)]">
            {/* Ticket header */}
            <header className="relative border-b border-[var(--border-subtle)] bg-[var(--accent-soft)] px-6 pt-6 pb-5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.2em] text-[var(--accent)] uppercase">
                  <Ticket className="h-3.5 w-3.5" />
                  Ingresso digital
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    checkedIn ? 'bg-[var(--bg-surface)] text-[var(--text-secondary)]' : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {checkedIn ? <ScanLine className="h-3 w-3" /> : <BadgeCheck className="h-3 w-3" />}
                  {checkedIn ? 'Utilizado' : 'Válido'}
                </span>
              </div>
              <h2 id="ticket-title" className="font-display mt-3 text-2xl leading-tight font-bold">
                {receipt.event.title}
              </h2>
              <div className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
                <p className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatEventDateLine(receipt.event.startsAt)}
                </p>
                <p className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {receipt.event.venue}
                  {receipt.event.city ? ` · ${receipt.event.city}` : ''}
                </p>
              </div>
            </header>

            {/* QR */}
            <div className="flex flex-col items-center px-6 pt-6">
              <div className={`relative rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5 ${checkedIn ? 'opacity-60' : ''}`}>
                <img
                  src={receipt.ticket.qrCode}
                  alt={`QR Code do ingresso ${code}`}
                  className="h-56 w-56 [image-rendering:pixelated]"
                />
                {checkedIn && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="-rotate-12 rounded-lg border-2 border-zinc-700 bg-white/90 px-3 py-1 text-sm font-black tracking-widest text-zinc-700 uppercase">
                      Check-in feito
                    </span>
                  </span>
                )}
              </div>
              <p className="mt-3 text-[10px] font-semibold tracking-[0.2em] text-[var(--text-muted)] uppercase">
                Código do ingresso
              </p>
              <p className="font-mono-num text-lg font-bold tracking-wider text-[var(--text-primary)]">{code}</p>
              <p className="mt-1 text-center text-[11px] text-[var(--text-muted)]">
                Apresente este QR Code na portaria. Aumente o brilho da tela para facilitar a leitura.
              </p>
            </div>

            {/* Perforation */}
            <div className="mx-5 my-5 border-t-2 border-dashed border-[var(--border-strong)]" aria-hidden="true" />

            {/* Details */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 px-6 text-xs">
              <div className="col-span-2">
                <dt className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
                  <UserIcon className="h-3 w-3" /> Titular
                </dt>
                <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">{user?.name ?? '—'}</dd>
                {user?.email && <dd className="text-[11px] text-[var(--text-secondary)]">{user.email}</dd>}
              </div>
              <div>
                <dt className="text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">Setor</dt>
                <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">{receipt.table.sector.name}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">Mesa</dt>
                <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">{receipt.table.label}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
                  <Users className="h-3 w-3" /> Pessoas
                </dt>
                <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">{receipt.guestCount}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">Valor pago</dt>
                <dd className="font-mono-num mt-0.5 font-semibold text-[var(--text-primary)]">
                  {formatMinorCurrency(receipt.payment.amountMinor, receipt.payment.currency)}
                </dd>
                <dd className="text-[11px] text-[var(--text-secondary)]">
                  {receipt.payment.method ? paymentMethodLabels[receipt.payment.method] : '—'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
                  Status de check-in
                </dt>
                <dd
                  className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    checkedIn
                      ? 'border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                      : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700'
                  }`}
                >
                  {checkedIn ? <ScanLine className="h-3.5 w-3.5" /> : <BadgeCheck className="h-3.5 w-3.5" />}
                  {checkedIn
                    ? `Entrada registrada em ${formatDateTime(receipt.checkedInAt)}`
                    : checkInKnown
                      ? 'Aguardando check-in na portaria'
                      : 'Check-in ainda não registrado'}
                </dd>
              </div>
              {receipt.confirmedAt && (
                <div className="col-span-2 text-[11px] text-[var(--text-muted)]">
                  Confirmado em {formatDateTime(receipt.confirmedAt)} · Reserva #{reservationId.slice(0, 8)}
                </div>
              )}
            </dl>

            {/* Actions */}
            <div className="ticket-no-print mt-5 grid grid-cols-3 gap-2 border-t border-[var(--border-subtle)] px-6 py-4">
              <a
                href={receipt.ticket.qrCode}
                download={`ingresso-${code}.png`}
                className="inline-flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <Download className="h-4 w-4" />
                Baixar QR
              </a>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex cursor-pointer flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <Printer className="h-4 w-4" />
                Imprimir
              </button>
              <button
                type="button"
                onClick={() => void handleCopyToken()}
                className="inline-flex cursor-pointer flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                title="Copia o conteúdo do QR Code para validação manual na portaria"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copiado' : 'Copiar token'}
              </button>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
