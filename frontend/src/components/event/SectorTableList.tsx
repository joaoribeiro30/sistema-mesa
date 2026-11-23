import { useMemo, type CSSProperties } from 'react';
import { Check, Clock, Lock, Plus, Users } from 'lucide-react';
import {
  formatExpiryTime,
  formatRemainingCountdown,
  getVisualTableState,
  isTableSelectable,
  SSE_CARD_FLASH_COLOR,
  TABLE_STATUS_META,
  type RecentTableUpdate,
  type VisualTableState,
} from '@/components/event/tableStatus';
import { useServerNow } from '@/hooks/useCountdown';
import { formatMinorCurrency } from '@/lib/format';
import { compareTablesByLabel } from '@/lib/tableOrder';
import type { EventSector, EventTable } from '@/types/api';

interface SectorTableListProps {
  sectors: EventSector[];
  currency: string;
  selectedTableIds: Set<string>;
  activeSectorId: string | null;
  onlyAvailable: boolean;
  recentTableUpdates?: Record<string, RecentTableUpdate>;
  onToggleTable: (table: EventTable, sector: EventSector) => void;
}

const LEGEND_STATES: VisualTableState[] = [
  'AVAILABLE',
  'SELECTED',
  'RESERVED',
  'SOLD',
];

function StatusIcon({
  state,
  className = 'h-3 w-3 shrink-0',
}: {
  state: VisualTableState;
  className?: string;
}) {
  if (state === 'SELECTED') return <Check className={className} aria-hidden="true" />;
  if (state === 'RESERVED') return <Clock className={className} aria-hidden="true" />;
  if (state === 'SOLD') return <Lock className={className} aria-hidden="true" />;
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full bg-[var(--status-available-border)]"
    />
  );
}

export function SectorTableList({
  sectors,
  currency,
  selectedTableIds,
  activeSectorId,
  onlyAvailable,
  recentTableUpdates,
  onToggleTable,
}: SectorTableListProps) {
  const orderedSectors = useMemo(
    () =>
      sectors.map((sector) => ({
        ...sector,
        tables: [...sector.tables].sort(compareTablesByLabel),
      })),
    [sectors],
  );

  const visibleSectors = orderedSectors.filter(
    (s) => !activeSectorId || s.id === activeSectorId,
  );

  const { hasPendingExpiry, statusCounts } = useMemo(() => {
    let pending = false;
    const counts: Record<VisualTableState, number> = {
      AVAILABLE: 0,
      SELECTED: 0,
      RESERVED: 0,
      SOLD: 0,
    };

    for (const sector of visibleSectors) {
      for (const table of sector.tables) {
        const state = getVisualTableState(
          table,
          selectedTableIds.has(table.id),
        );
        counts[state] += 1;
        if (state === 'RESERVED' && table.expiresAt) {
          pending = true;
        }
      }
    }

    return { hasPendingExpiry: pending, statusCounts: counts };
  }, [visibleSectors, selectedTableIds]);

  const nowMs = useServerNow(hasPendingExpiry);

  if (visibleSectors.length === 0) {
    return (
      <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center text-sm text-[var(--text-secondary)]">
        Nenhum setor encontrado para o filtro selecionado.
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-5">
      {/* Always-visible semantic legend bar */}
      <div
        aria-label="Legenda de status das mesas"
        className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5 md:rounded-3xl md:px-5"
      >
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-[var(--text-primary)]">
          {LEGEND_STATES.map((state) => {
            const meta = TABLE_STATUS_META[state];
            return (
              <li key={state} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`grid size-5 place-items-center rounded-full ${meta.swatchClass}`}
                >
                  <StatusIcon state={state} className="h-2.5 w-2.5" />
                </span>
                <span>{meta.shortLabel}</span>
                <span className="font-mono-num min-w-[1.5ch] text-[11px] font-semibold text-[var(--text-secondary)]">
                  ({statusCounts[state]})
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {visibleSectors.map((sector) => {
        const filteredTables = onlyAvailable
          ? sector.tables.filter(
              (t) => isTableSelectable(t) || selectedTableIds.has(t.id),
            )
          : sector.tables;

        return (
          <section
            key={sector.id}
            aria-label={`Setor ${sector.name}`}
            className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] md:rounded-3xl"
          >
            <h3 className="font-display border-b border-[var(--border-subtle)] px-3 py-2.5 text-base font-bold text-[var(--text-primary)] [overflow-wrap:anywhere] md:px-5 md:py-3 md:text-lg">
              {sector.name}
            </h3>

            {/* Tables grid inside sector */}
            {filteredTables.length === 0 ? (
              <div className="px-6 py-8 text-center text-xs text-[var(--text-secondary)]">
                Nenhuma mesa disponível neste setor no momento.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2 md:gap-3 md:p-5 lg:grid-cols-3">
                {filteredTables.map((table) => {
                  const isSelected = selectedTableIds.has(table.id);
                  const visualState = getVisualTableState(table, isSelected);
                  const meta = TABLE_STATUS_META[visualState];
                  const selectable = isTableSelectable(table);
                  const expiry = formatExpiryTime(table.expiresAt);
                  const remaining =
                    visualState === 'RESERVED'
                      ? formatRemainingCountdown(table.expiresAt, nowMs)
                      : null;
                  const recentUpdate = recentTableUpdates?.[table.id] ?? null;

                  const cardStyle = recentUpdate
                    ? ({
                        '--sse-flash-color':
                          SSE_CARD_FLASH_COLOR[recentUpdate.kind],
                      } as CSSProperties)
                    : undefined;

                  return (
                    <div
                      key={table.id}
                      style={cardStyle}
                      className={`group flex flex-col justify-between gap-2.5 rounded-2xl border p-3.5 transition-[background-color,border-color,box-shadow] duration-300 ease-out md:gap-3 md:p-4 ${
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                          : visualState === 'RESERVED'
                            ? 'border-dashed border-[var(--status-pending-border)]/60 bg-[var(--status-pending-bg)]/45'
                            : visualState === 'SOLD'
                              ? 'border-[var(--status-sold-border)]/35 bg-[var(--status-sold-surface)]'
                              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/60'
                      } ${recentUpdate ? 'animate-sse-card' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`grid size-5 shrink-0 place-items-center rounded-full ${meta.swatchClass}`}
                              aria-hidden="true"
                            >
                              <StatusIcon state={visualState} className="h-2.5 w-2.5" />
                            </span>
                            <h4
                              className={`font-display text-base font-bold text-[var(--text-primary)] [overflow-wrap:anywhere] ${
                                visualState === 'SOLD' ? 'line-through decoration-[1.5px]' : ''
                              }`}
                            >
                              Mesa {table.label}
                            </h4>
                          </div>
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                            <Users
                              className="h-3.5 w-3.5 text-[var(--text-muted)]"
                              aria-hidden="true"
                            />
                            Até {table.capacity}{' '}
                            {table.capacity === 1 ? 'pessoa' : 'pessoas'}
                          </p>
                        </div>

                        <span
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}
                        >
                          <StatusIcon state={visualState} className="h-3 w-3 shrink-0" />
                          {meta.shortLabel}
                        </span>
                      </div>

                      {visualState === 'RESERVED' && (remaining || expiry) && (
                        <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--status-pending-fg)]">
                          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            {remaining ? (
                              <>
                                Libera em{' '}
                                <span className="font-mono-num font-bold">
                                  {remaining}
                                </span>
                                {expiry ? ` (${expiry})` : ''}
                              </>
                            ) : (
                              <>Bloqueio ativo até {expiry}</>
                            )}
                          </span>
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-2.5 md:pt-3">
                        <span className="font-mono-num text-sm font-bold text-[var(--text-primary)]">
                          {formatMinorCurrency(table.priceMinor, currency)}
                        </span>

                        {selectable ? (
                          <button
                            type="button"
                            onClick={() => onToggleTable(table, sector)}
                            aria-pressed={isSelected}
                            className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)] active:scale-[0.98] ${
                              isSelected
                                ? 'bg-[var(--accent)] text-white hover:bg-rose-800'
                                : 'bg-[var(--cta-bg)] text-[var(--cta-text)] hover:bg-[var(--cta-hover)]'
                            }`}
                          >
                            {isSelected ? (
                              <>
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                Selecionada
                              </>
                            ) : (
                              <>
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                Selecionar
                              </>
                            )}
                          </button>
                        ) : (
                          <span
                            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${meta.badgeClass}`}
                          >
                            {visualState === 'SOLD' ? (
                              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            {visualState === 'SOLD' ? 'Vendida' : 'Bloqueada'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
