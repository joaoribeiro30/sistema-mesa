import type { EventTable, TableAvailabilityStatus } from '@/types/api';

export type VisualTableState = 'AVAILABLE' | 'SELECTED' | 'RESERVED' | 'SOLD';

export type DomainVisualStatus =
  | 'AVAILABLE'
  | 'SELECTED'
  | 'PENDING_PAYMENT'
  | 'SOLD';

export type RecentTableUpdateKind = 'locked' | 'released' | 'sold';

export interface RecentTableUpdate {
  kind: RecentTableUpdateKind;
  seq: number;
}

export function getVisualTableState(
  table: EventTable,
  isSelected: boolean,
): VisualTableState {
  if (table.status === 'SOLD') return 'SOLD';
  if (table.status === 'RESERVED' || !table.available) return 'RESERVED';
  if (isSelected) return 'SELECTED';
  return 'AVAILABLE';
}

export const TABLE_STATUS_META: Record<
  VisualTableState,
  {
    domainStatus: DomainVisualStatus;
    label: string;
    shortLabel: string;
    description: string;
    dotClass: string;
    swatchClass: string;
    badgeClass: string;
    markerClass: string;
  }
> = {
  AVAILABLE: {
    domainStatus: 'AVAILABLE',
    label: 'Disponível',
    shortLabel: 'Disponível',
    description: 'Livre para seleção imediata.',
    dotClass: 'bg-[var(--status-available-border)]',
    swatchClass:
      'border-2 border-[var(--status-available-border)] bg-[var(--status-available-bg)] text-[var(--status-available-fg)]',
    badgeClass:
      'border-[var(--status-available-border)]/45 bg-[var(--status-available-bg)] text-[var(--status-available-fg)]',
    markerClass:
      'border-2 border-[var(--status-available-border)] bg-[var(--status-available-bg)] text-[var(--status-available-fg)] shadow-xs group-hover:bg-[var(--status-available-bg-hover)]',
  },
  SELECTED: {
    domainStatus: 'SELECTED',
    label: 'Selecionada por você',
    shortLabel: 'Selecionada',
    description: 'Na sua seleção atual. Avance para bloquear e pagar.',
    dotClass: 'bg-[var(--status-selected-bg)]',
    swatchClass:
      'border-2 border-white bg-[var(--status-selected-bg)] text-[var(--status-selected-fg)] ring-1 ring-[var(--status-selected-bg)]',
    badgeClass:
      'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]',
    markerClass:
      'border-2 border-[var(--status-selected-border)] bg-[var(--status-selected-bg)] text-[var(--status-selected-fg)] ring-2 ring-[var(--status-selected-bg)] shadow-sm',
  },
  RESERVED: {
    domainStatus: 'PENDING_PAYMENT',
    label: 'Pagamento pendente',
    shortLabel: 'Pag. pendente',
    description: 'Em processo de pagamento por outro comprador.',
    dotClass: 'bg-[var(--status-pending-border)]',
    swatchClass:
      'border-2 border-dashed border-[var(--status-pending-border)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)] table-pattern-pending',
    badgeClass:
      'border-[var(--status-pending-border)]/55 bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)] table-pattern-pending',
    markerClass:
      'border-2 border-dashed border-[var(--status-pending-border)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)] table-pattern-pending',
  },
  SOLD: {
    domainStatus: 'SOLD',
    label: 'Vendida',
    shortLabel: 'Vendida',
    description: 'Mesa confirmada e indisponível para novas reservas.',
    dotClass: 'bg-[var(--status-sold-border)]',
    swatchClass:
      'border-[1.5px] border-[var(--status-sold-border)] bg-[var(--status-sold-bg)] text-[var(--status-sold-fg)] table-pattern-sold',
    badgeClass:
      'border-[var(--status-sold-border)]/45 bg-[var(--status-sold-surface)] text-[var(--status-sold-fg)] table-pattern-sold',
    markerClass:
      'border-[1.5px] border-[var(--status-sold-border)] bg-[var(--status-sold-bg)] text-[var(--status-sold-fg)] table-pattern-sold',
  },
};

export const SSE_RING_CLASS: Record<RecentTableUpdateKind, string> = {
  released: 'border-[var(--status-available-border)] bg-[var(--status-available-pulse)]',
  locked: 'border-[var(--status-pending-border)] bg-[var(--status-pending-pulse)]',
  sold: 'border-[var(--status-sold-border)] bg-[var(--status-sold-pulse)]',
};

export const SSE_CARD_FLASH_COLOR: Record<RecentTableUpdateKind, string> = {
  released: 'var(--status-available-pulse)',
  locked: 'var(--status-pending-pulse)',
  sold: 'var(--status-sold-pulse)',
};

export function formatExpiryTime(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatRemainingCountdown(
  expiresAt: string | null,
  nowMs: number,
): string | null {
  if (!expiresAt) return null;
  const target = new Date(expiresAt).getTime();
  if (Number.isNaN(target)) return null;
  const diffSec = Math.max(0, Math.floor((target - nowMs) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function isTableSelectable(table: {
  status: TableAvailabilityStatus;
  available: boolean;
}): boolean {
  return table.status === 'AVAILABLE' && table.available;
}
