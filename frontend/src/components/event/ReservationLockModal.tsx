import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Ticket,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { computeCountdown, useServerNow } from '@/hooks/useCountdown';
import { formatMinorCurrency } from '@/lib/format';
import type { ReservationItem } from '@/types/api';

export interface LockedReservationSummary {
  reservation: ReservationItem;
  tableLabel: string;
  sectorName: string;
}

interface ReservationLockModalProps {
  items: LockedReservationSummary[];
  eventTitle: string;
  cancellingId: string | null;
  /** Reservation ids already paid in this session. */
  paidIds?: ReadonlySet<string>;
  onCancelReservation: (reservationId: string) => void;
  /** Opens the checkout drawer for the given reservation. */
  onPay: (reservationId: string) => void;
  onViewTicket?: (reservationId: string) => void;
  onExpired?: () => void;
  onClose: () => void;
}

export function ReservationLockModal({
  items,
  eventTitle,
  cancellingId,
  paidIds,
  onCancelReservation,
  onPay,
  onViewTicket,
  onExpired,
  onClose,
}: ReservationLockModalProps) {
  const nowMs = useServerNow(items.length > 0);
  const expiredNotifiedRef = useRef(false);

  const isPaid = (id: string) => paidIds?.has(id) ?? false;
  const hasAnyExpired = items.some(
    (entry) =>
      !isPaid(entry.reservation.id) &&
      computeCountdown(entry.reservation.expiresAt, nowMs).expired,
  );

  useEffect(() => {
    if (!hasAnyExpired) {
      expiredNotifiedRef.current = false;
      return;
    }
    if (!expiredNotifiedRef.current) {
      expiredNotifiedRef.current = true;
      onExpired?.();
    }
  }, [hasAnyExpired, onExpired]);

  if (items.length === 0) return null;

  const pending = items.filter(
    (entry) =>
      !isPaid(entry.reservation.id) &&
      !computeCountdown(entry.reservation.expiresAt, nowMs).expired,
  );

  const currency = items[0].reservation.currency;
  const totalMinor = items.reduce((sum, entry) => sum + entry.reservation.amountMinor, 0);
  const earliestExpiry =
    pending
      .map((entry) => entry.reservation.expiresAt)
      .filter((v): v is string => Boolean(v))
      .sort()[0] ?? null;

  const countdown = computeCountdown(earliestExpiry, nowMs);
  const nextToPay = [...pending].sort((a, b) =>
    (a.reservation.expiresAt ?? '').localeCompare(b.reservation.expiresAt ?? ''),
  )[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reservation-lock-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-elevated)]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/35 bg-emerald-500/12 text-emerald-500">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="reservation-lock-title"
                className="font-display text-xl font-bold text-[var(--text-primary)]"
              >
                {items.length === 1
                  ? 'Mesa bloqueada com sucesso!'
                  : `${items.length} mesas bloqueadas com sucesso!`}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{eventTitle}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar resumo da reserva"
            className="cursor-pointer rounded-full p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Countdown banner */}
        {pending.length > 0 && countdown.label && (
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-amber-500/10 px-6 py-3">
            <span className="inline-flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
              <Clock className="h-4 w-4 shrink-0" />
              Tempo restante para concluir o pagamento
            </span>
            <span className="font-mono-num rounded-full bg-amber-500/20 px-3 py-1 text-sm font-bold text-amber-600 tabular-nums dark:text-amber-300">
              {countdown.label}
            </span>
          </div>
        )}

        {items.length > 1 && pending.length > 0 && (
          <p className="border-b border-[var(--border-subtle)] px-6 py-2.5 text-[11px] text-[var(--text-muted)]">
            Cada mesa é paga separadamente. Conclua o pagamento de cada uma antes do fim do prazo.
          </p>
        )}

        {/* Locked reservations list */}
        <div className="max-h-64 space-y-2.5 overflow-y-auto px-6 py-4">
          {items.map(({ reservation, tableLabel, sectorName }) => {
            const isCancelling = cancellingId === reservation.id;
            const paid = isPaid(reservation.id);
            const itemCountdown = computeCountdown(reservation.expiresAt, nowMs);
            const expired = !paid && itemCountdown.expired;
            return (
              <div
                key={reservation.id}
                className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                  paid
                    ? 'border-emerald-500/35 bg-emerald-500/8'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60'
                } ${expired ? 'opacity-60' : ''}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)]">
                    Mesa {tableLabel}{' '}
                    <span className="font-normal text-[var(--text-secondary)]">· {sectorName}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-muted)]">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {reservation.guestCount} de {reservation.capacity} lugares
                    </span>
                    <span className="font-mono-num">
                      {formatMinorCurrency(reservation.amountMinor, reservation.currency)}
                    </span>
                    {paid && <span className="font-semibold text-emerald-500">Pago</span>}
                    {expired && <span className="font-semibold text-[var(--danger)]">Expirada</span>}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {paid ? (
                    onViewTicket && (
                      <button
                        type="button"
                        onClick={() => onViewTicket(reservation.id)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-600"
                      >
                        <Ticket className="h-3.5 w-3.5" />
                        Ingresso
                      </button>
                    )
                  ) : !expired ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onPay(reservation.id)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-3 py-1.5 text-[11px] font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)]"
                      >
                        <CreditCard className="h-3.5 w-3.5" />
                        Pagar
                      </button>
                      <button
                        type="button"
                        disabled={isCancelling}
                        onClick={() => onCancelReservation(reservation.id)}
                        title="Cancelar bloqueio desta mesa"
                        aria-label={`Cancelar bloqueio da mesa ${tableLabel}`}
                        className="cursor-pointer rounded-full p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] disabled:opacity-50"
                      >
                        {isCancelling ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="space-y-4 border-t border-[var(--border-subtle)] px-6 py-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Total reservado</span>
            <span className="font-mono-num text-xl font-bold text-[var(--text-primary)]">
              {formatMinorCurrency(totalMinor, currency)}
            </span>
          </div>

          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Link
              to="/minhas-reservas"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-5 py-2.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              Minhas Reservas
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            {nextToPay ? (
              <button
                type="button"
                onClick={() => onPay(nextToPay.reservation.id)}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-6 py-2.5 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
              >
                <CreditCard className="h-4 w-4" />
                {pending.length > 1 ? `Pagar mesa ${nextToPay.tableLabel}` : 'Pagar agora'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-6 py-2.5 text-xs font-semibold text-[var(--cta-text)]"
              >
                Continuar no evento
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
