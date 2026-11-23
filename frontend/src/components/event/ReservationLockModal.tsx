import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
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
  const allExpired = pending.length === 0 && hasAnyExpired;

  const currency = items[0].reservation.currency;
  const totalMinor = items.reduce((sum, entry) => sum + entry.reservation.amountMinor, 0);
  const earliestExpiry =
    pending
      .map((entry) => entry.reservation.expiresAt)
      .filter((v): v is string => Boolean(v))
      .sort()[0] ?? null;

  const countdown = computeCountdown(earliestExpiry, nowMs);
  const urgent =
    !countdown.expired &&
    countdown.remainingMs > 0 &&
    countdown.remainingMs <= 2 * 60 * 1000;
  const nextToPay = [...pending].sort((a, b) =>
    (a.reservation.expiresAt ?? '').localeCompare(b.reservation.expiresAt ?? ''),
  )[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reservation-lock-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--modal-backdrop)] p-3 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-elevated)]">
        {/* Sticky Header + Countdown */}
        <div className="sticky top-0 z-10 shrink-0 bg-[var(--bg-surface)]">
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
                  allExpired
                    ? 'border-[var(--danger)]/35 bg-red-50 text-[var(--danger)]'
                    : 'border-[var(--status-available-border)]/40 bg-[var(--status-available-bg)] text-[var(--status-available-fg)]'
                }`}
              >
                {allExpired ? (
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0">
                <h2
                  id="reservation-lock-title"
                  className="font-display text-lg font-bold text-[var(--text-primary)] sm:text-xl"
                >
                  {allExpired
                    ? 'Tempo de reserva esgotado'
                    : items.length === 1
                      ? 'Mesa bloqueada com sucesso!'
                      : `${items.length} mesas bloqueadas com sucesso!`}
                </h2>
                <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                  {eventTitle}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar resumo da reserva"
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {pending.length > 0 && countdown.label && (
            <div
              role="timer"
              aria-live={urgent ? 'assertive' : 'off'}
              className={`border-b px-5 py-3 transition-colors duration-300 sm:px-6 ${
                urgent
                  ? 'border-[var(--danger)]/35 bg-red-50'
                  : 'border-[var(--status-pending-border)]/35 bg-[var(--status-pending-bg)]'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`inline-flex items-center gap-2 text-xs font-semibold ${
                    urgent ? 'text-[var(--danger)]' : 'text-[var(--status-pending-fg)]'
                  }`}
                >
                  {urgent ? (
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  {urgent
                    ? 'Últimos 2 minutos — conclua o pagamento agora'
                    : 'Tempo restante para concluir o pagamento'}
                </span>
                <span
                  className={`font-mono-num shrink-0 rounded-full px-3 py-1 text-sm font-bold tabular-nums ${
                    urgent
                      ? 'bg-[var(--danger)] text-white'
                      : 'border border-[var(--status-pending-border)]/40 bg-[var(--bg-surface)] text-[var(--status-pending-fg)]'
                  }`}
                >
                  {countdown.label}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10">
                <div
                  className={`h-full rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none ${
                    urgent ? 'bg-[var(--danger)]' : 'bg-[var(--status-pending-border)]'
                  }`}
                  style={{ width: `${countdown.fraction * 100}%` }}
                />
              </div>
            </div>
          )}

          {allExpired && (
            <div className="border-b border-[var(--danger)]/35 bg-red-50 px-5 py-3 text-xs font-medium text-[var(--danger)] sm:px-6">
              O bloqueio de 10 minutos terminou e as mesas voltaram ao mapa. Nenhuma cobrança foi realizada.
            </div>
          )}

          {items.length > 1 && pending.length > 0 && (
            <p className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-5 py-2.5 text-xs text-[var(--text-secondary)] sm:px-6">
              Cada mesa é paga separadamente. Conclua o pagamento de cada uma antes do fim do prazo.
            </p>
          )}
        </div>

        {/* Locked reservations list */}
        <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4 sm:px-6">
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
                    ? 'border-[var(--status-available-border)]/40 bg-[var(--status-available-bg)]'
                    : expired
                      ? 'border-[var(--status-sold-border)]/35 bg-[var(--status-sold-surface)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)]">
                    Mesa {tableLabel}{' '}
                    <span className="font-normal text-[var(--text-secondary)]">
                      · {sectorName}
                    </span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      {reservation.guestCount} de {reservation.capacity} lugares
                    </span>
                    <span className="font-mono-num font-semibold text-[var(--text-primary)]">
                      {formatMinorCurrency(reservation.amountMinor, reservation.currency)}
                    </span>
                    {paid && (
                      <span className="font-semibold text-[var(--status-available-fg)]">
                        Pago
                      </span>
                    )}
                    {expired && (
                      <span className="font-semibold text-[var(--danger)]">
                        Expirada
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {paid ? (
                    onViewTicket && (
                      <button
                        type="button"
                        onClick={() => onViewTicket(reservation.id)}
                        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--success)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]"
                      >
                        <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
                        Ingresso
                      </button>
                    )
                  ) : !expired ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onPay(reservation.id)}
                        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-3.5 py-2 text-xs font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]"
                      >
                        <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                        Pagar
                      </button>
                      <button
                        type="button"
                        disabled={isCancelling}
                        onClick={() => onCancelReservation(reservation.id)}
                        title="Cancelar bloqueio desta mesa"
                        aria-label={`Cancelar bloqueio da mesa ${tableLabel}`}
                        className="grid size-11 cursor-pointer place-items-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-red-50 hover:text-[var(--danger)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--text-primary)] disabled:opacity-50"
                      >
                        {isCancelling ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer with transparent fee summary */}
        <div className="shrink-0 space-y-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-5">
          <dl className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-[var(--text-secondary)]">
              <dt>
                Subtotal ({items.length === 1 ? '1 mesa' : `${items.length} mesas`})
              </dt>
              <dd className="font-mono-num font-medium text-[var(--text-primary)]">
                {formatMinorCurrency(totalMinor, currency)}
              </dd>
            </div>
            <div className="flex items-center justify-between text-[var(--text-secondary)]">
              <dt>Taxa de conveniência</dt>
              <dd className="font-mono-num font-semibold text-[var(--status-available-fg)]">
                R$ 0,00 (inclusa)
              </dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-[var(--border-subtle)] pt-2">
              <dt className="text-xs font-bold tracking-wide text-[var(--text-primary)] uppercase">
                Total reservado
              </dt>
              <dd className="font-mono-num text-xl font-bold text-[var(--text-primary)]">
                {formatMinorCurrency(totalMinor, currency)}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Link
              to="/minhas-reservas"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-5 py-2.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]"
            >
              Minhas Reservas
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            {nextToPay ? (
              <button
                type="button"
                onClick={() => onPay(nextToPay.reservation.id)}
                className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-6 py-2.5 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]"
              >
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                {pending.length > 1
                  ? `Pagar mesa ${nextToPay.tableLabel}`
                  : 'Pagar agora'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-6 py-2.5 text-xs font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]"
              >
                {allExpired ? 'Escolher outra mesa no evento' : 'Continuar no evento'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
