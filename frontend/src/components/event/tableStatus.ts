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
      'border-emerald-500/35 bg-emerald-500/12 text-emerald-500 dark:text-emerald-400',
    markerClass:
      'border-emerald-400 bg-emerald-500/90 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.22)] hover:scale-110 hover:bg-emerald-400',
  },
  SELECTED: {
    label: 'Selecionada',
    shortLabel: 'Selecionada',
    dotClass: 'bg-[#ff3366]',
    badgeClass:
      'border-[#ff3366]/45 bg-[#ff3366]/15 text-[#ff3366] dark:text-[#ff5c85]',
    markerClass:
      'border-white bg-[#ff3366] text-white scale-115 shadow-[0_0_0_4px_rgba(255,51,102,0.38)] ring-2 ring-[#ff3366]/60',
  },
  RESERVED: {
    label: 'Pendente / Reservada',
    shortLabel: 'Reservada',
    dotClass: 'bg-amber-500',
    badgeClass:
      'border-amber-500/35 bg-amber-500/12 text-amber-600 dark:text-amber-400',
    markerClass:
      'border-amber-300/80 bg-amber-500/85 text-[#140e02] shadow-[0_0_0_3px_rgba(245,158,11,0.2)]',
  },
  SOLD: {
    label: 'Vendida',
    shortLabel: 'Vendida',
    dotClass: 'bg-zinc-500',
    badgeClass:
      'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]',
    markerClass:
      'border-zinc-500/60 bg-zinc-700/80 text-zinc-300 opacity-75',
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
