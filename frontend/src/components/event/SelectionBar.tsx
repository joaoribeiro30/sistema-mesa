import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minus,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { formatMinorCurrency } from '@/lib/format';
import { compareTablesByLabel } from '@/lib/tableOrder';
import type { EventSector, EventTable, User } from '@/types/api';

export interface SelectedTableEntry {
  table: EventTable;
  sector: EventSector;
  guestCount: number;
}

interface SelectionBarProps {
  selectedItems: SelectedTableEntry[];
  currency: string;
  eventSlug: string;
  user: User | null;
  submitting: boolean;
  onUpdateGuests: (tableId: string, guestCount: number) => void;
  onRemoveTable: (tableId: string) => void;
  onClearAll: () => void;
  onProceedCheckout: () => void;
}

export function SelectionBar({
  selectedItems,
  currency,
  eventSlug,
  user,
  submitting,
  onUpdateGuests,
  onRemoveTable,
  onClearAll,
  onProceedCheckout,
}: SelectionBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (selectedItems.length === 0) return null;

  const orderedItems = [...selectedItems].sort((left, right) =>
    compareTablesByLabel(left.table, right.table),
  );
  const totalMinor = selectedItems.reduce(
    (sum, item) => sum + item.table.priceMinor,
    0,
  );
  const totalGuests = selectedItems.reduce(
    (sum, item) => sum + item.guestCount,
    0,
  );

  const isGuest = !user;
  const isAdmin = user?.role === 'ADMIN';
  const needsVerification = Boolean(
    user && user.role === 'CUSTOMER' && !user.emailVerifiedAt,
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-5">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)]/95 shadow-[var(--shadow-elevated)] backdrop-blur-xl">
        {/* Expandable guest count & selected tables drawer */}
        {expanded && (
          <div className="max-h-72 overflow-y-auto border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/70 px-4 py-3 sm:px-6">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Mesas selecionadas ({selectedItems.length})
              </span>
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--danger)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Limpar seleção
              </button>
            </div>

            <div className="space-y-2">
              {orderedItems.map(({ table, sector, guestCount }) => (
                <div
                  key={table.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[var(--text-primary)]">
                      Mesa {table.label}{' '}
                      <span className="font-normal text-[var(--text-secondary)]">
                        · {sector.name}
                      </span>
                    </p>
                    <p className="font-mono-num text-xs text-[var(--text-secondary)]">
                      {formatMinorCurrency(table.priceMinor, currency)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Guest count stepper (>= 44x44px touch targets) */}
                    <div className="flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5">
                      <Users
                        className="ml-2 h-3.5 w-3.5 text-[var(--text-muted)]"
                        aria-hidden="true"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateGuests(table.id, Math.max(1, guestCount - 1))
                        }
                        disabled={guestCount <= 1}
                        aria-label={`Reduzir pessoas da mesa ${table.label}`}
                        className="flex size-11 cursor-pointer items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Minus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <span className="font-mono-num min-w-[24px] text-center text-xs font-bold text-[var(--text-primary)]">
                        {guestCount}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateGuests(
                            table.id,
                            Math.min(table.capacity, guestCount + 1),
                          )
                        }
                        disabled={guestCount >= table.capacity}
                        aria-label={`Aumentar pessoas da mesa ${table.label}`}
                        className="flex size-11 cursor-pointer items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <span className="pr-2.5 text-[11px] font-medium text-[var(--text-secondary)]">
                        /{table.capacity}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onRemoveTable(table.id)}
                      aria-label={`Remover mesa ${table.label}`}
                      className="grid size-11 cursor-pointer place-items-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--danger)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--text-primary)]"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Main Summary Row */}
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-3.5">
          <div className="flex items-center justify-between gap-4 sm:justify-start">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-2xl pr-2 text-left transition-colors hover:bg-[var(--bg-elevated)]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-xs font-bold text-white">
                {selectedItems.length}
              </span>
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                  <span>
                    {selectedItems.length === 1
                      ? `Mesa ${selectedItems[0].table.label}`
                      : `${selectedItems.length} mesas selecionadas`}
                  </span>
                  {expanded ? (
                    <ChevronDown
                      className="h-4 w-4 text-[var(--text-secondary)]"
                      aria-hidden="true"
                    />
                  ) : (
                    <ChevronUp
                      className="h-4 w-4 text-[var(--text-secondary)]"
                      aria-hidden="true"
                    />
                  )}
                </p>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  {totalGuests} {totalGuests === 1 ? 'pessoa' : 'pessoas'} · Ajustar lugares
                </p>
              </div>
            </button>

            <div className="text-right sm:border-l sm:border-[var(--border-subtle)] sm:pl-4 sm:text-left">
              <p className="text-[11px] font-semibold tracking-wider text-[var(--text-secondary)] uppercase">
                Total
              </p>
              <p className="font-mono-num text-lg font-bold text-[var(--text-primary)]">
                {formatMinorCurrency(totalMinor, currency)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isGuest ? (
              <Link
                to={`/login?redirect=${encodeURIComponent(`/eventos/${eventSlug}`)}`}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-6 py-3 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)] sm:w-auto sm:text-sm"
              >
                Entrar para reservar
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : isAdmin ? (
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5 text-xs font-medium text-[var(--text-secondary)]">
                Conta ADMIN não realiza reservas
              </span>
            ) : needsVerification ? (
              <Link
                to={`/verificar-email?email=${encodeURIComponent(user?.email ?? '')}`}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--warning-solid)] px-5 py-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)] sm:w-auto"
              >
                Verificar e-mail para reservar
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={onProceedCheckout}
                className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-6 py-3 text-xs font-semibold text-[var(--cta-text)] transition-all hover:bg-[var(--cta-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:text-sm"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Bloqueando {selectedItems.length === 1 ? 'mesa' : 'mesas'}...
                  </>
                ) : (
                  <>
                    Reservar e ir para checkout
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
