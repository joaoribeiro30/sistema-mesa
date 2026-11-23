import { Check, Clock, Lock, Plus, Users } from 'lucide-react';
import {
  formatExpiryTime,
  getVisualTableState,
  isTableSelectable,
  TABLE_STATUS_META,
} from '@/components/event/tableStatus';
import { formatMinorCurrency } from '@/lib/format';
import type { EventSector, EventTable } from '@/types/api';

interface SectorTableListProps {
  sectors: EventSector[];
  currency: string;
  selectedTableIds: Set<string>;
  activeSectorId: string | null;
  onlyAvailable: boolean;
  onToggleTable: (table: EventTable, sector: EventSector) => void;
}

export function SectorTableList({
  sectors,
  currency,
  selectedTableIds,
  activeSectorId,
  onlyAvailable,
  onToggleTable,
}: SectorTableListProps) {
  const visibleSectors = sectors.filter(
    (s) => !activeSectorId || s.id === activeSectorId,
  );

  if (visibleSectors.length === 0) {
    return (
      <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center text-sm text-[var(--text-secondary)]">
        Nenhum setor encontrado para o filtro selecionado.
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-5">
      {visibleSectors.map((sector) => {
        const availableCount = sector.tables.filter((t) =>
          isTableSelectable(t),
        ).length;
        const filteredTables = onlyAvailable
          ? sector.tables.filter(
              (t) => isTableSelectable(t) || selectedTableIds.has(t.id),
            )
          : sector.tables;

        const minTablePrice =
          sector.tables.length > 0
            ? Math.min(...sector.tables.map((t) => t.priceMinor))
            : sector.basePriceMinor;
        const displayBasePrice =
          sector.basePriceMinor > 0 ? sector.basePriceMinor : minTablePrice;

        return (
          <section
            key={sector.id}
            aria-label={`Setor ${sector.name}`}
            className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] md:rounded-3xl"
          >
            {/* Sector header */}
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-3 py-2.5 md:items-center md:px-6 md:py-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5 md:gap-2.5">
                  <h3 className="font-display text-base font-bold text-[var(--text-primary)] [overflow-wrap:anywhere] md:text-lg">
                    {sector.name}
                  </h3>
                  <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                    {availableCount} de {sector.tables.length}{' '}
                    {sector.tables.length === 1 ? 'mesa livre' : 'mesas livres'}
                  </span>
                </div>
                {sector.description && (
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                    {sector.description}
                  </p>
                )}
              </div>

              <div className="shrink-0 text-right">
                <p className="text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
                  Preço base
                </p>
                <p className="font-mono-num text-xs font-bold text-[var(--text-primary)] md:text-base">
                  {formatMinorCurrency(displayBasePrice, currency)}
                </p>
              </div>
            </div>

            {/* Tables grid inside sector */}
            {filteredTables.length === 0 ? (
              <div className="px-6 py-8 text-center text-xs text-[var(--text-muted)]">
                Nenhuma mesa disponível neste setor no momento.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 md:gap-3 md:p-5 lg:grid-cols-3">
                {filteredTables.map((table) => {
                  const isSelected = selectedTableIds.has(table.id);
                  const visualState = getVisualTableState(table, isSelected);
                  const meta = TABLE_STATUS_META[visualState];
                  const selectable = isTableSelectable(table);
                  const expiry = formatExpiryTime(table.expiresAt);

                  return (
                    <div
                      key={table.id}
                      className={`group flex flex-col justify-between gap-2 rounded-2xl border p-3 transition-all md:gap-3 md:p-4 ${
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                          : selectable
                            ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/20 opacity-75'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dotClass}`}
                              aria-hidden="true"
                            />
                            <h4 className="font-display text-base font-bold text-[var(--text-primary)] [overflow-wrap:anywhere]">
                              Mesa {table.label}
                            </h4>
                          </div>
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                            <Users className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                            Até {table.capacity}{' '}
                            {table.capacity === 1 ? 'pessoa' : 'pessoas'}
                          </p>
                        </div>

                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                        >
                          {meta.shortLabel}
                        </span>
                      </div>

                      {visualState === 'RESERVED' && expiry && (
                        <p className="flex items-center gap-1.5 text-[11px] text-amber-700">
                          <Clock className="h-3 w-3 shrink-0" />
                          Bloqueio ativo até {expiry}
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-2 md:pt-3">
                        <span className="font-mono-num text-sm font-bold text-[var(--text-primary)]">
                          {formatMinorCurrency(table.priceMinor, currency)}
                        </span>

                        {selectable ? (
                          <button
                            type="button"
                            onClick={() => onToggleTable(table, sector)}
                            aria-pressed={isSelected}
                            className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-[0.98] md:min-h-0 ${
                              isSelected
                                ? 'bg-[var(--accent)] text-white hover:bg-rose-800'
                                : 'bg-[var(--cta-bg)] text-[var(--cta-text)] hover:bg-[var(--cta-hover)]'
                            }`}
                          >
                            {isSelected ? (
                              <>
                                <Check className="h-3.5 w-3.5" />
                                Selecionada
                              </>
                            ) : (
                              <>
                                <Plus className="h-3.5 w-3.5" />
                                Selecionar
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)]">
                            <Lock className="h-3 w-3" />
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
