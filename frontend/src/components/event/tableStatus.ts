import type { EventTable, TableAvailabilityStatus } from '@/types/api';

export type VisualTableState = 'AVAILABLE' | 'SELECTED' | 'RESERVED' | 'SOLD';

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
    label: string;
    shortLabel: string;
    dotClass: string;
    badgeClass: string;
    markerClass: string;
  }
> = {
  AVAILABLE: {
    label: 'Livre / Disponível',
    shortLabel: 'Disponível',
    dotClass: 'bg-emerald-500',
    badgeClass:
      'border-emerald-500/35 bg-emerald-500/12 text-emerald-700',
    markerClass:
      'border-emerald-600 bg-emerald-100 text-emerald-950 hover:scale-110 hover:bg-emerald-200',
  },
  SELECTED: {
    label: 'Selecionada',
    shortLabel: 'Selecionada',
    dotClass: 'bg-[var(--accent)]',
    badgeClass:
      'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]',
    markerClass:
      'scale-115 border-white bg-[var(--accent)] text-white ring-2 ring-[var(--accent)]',
  },
  RESERVED: {
    label: 'Pendente / Reservada',
    shortLabel: 'Reservada',
    dotClass: 'bg-amber-500',
    badgeClass:
      'border-amber-500/35 bg-amber-500/12 text-amber-700',
    markerClass:
      'border-amber-600 bg-amber-100 text-amber-950',
  },
  SOLD: {
    label: 'Vendida',
    shortLabel: 'Vendida',
    dotClass: 'bg-zinc-500',
    badgeClass:
      'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]',
    markerClass:
      'border-zinc-500 bg-zinc-200 text-zinc-800',
  },
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
