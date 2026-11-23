import { ApiError, getFriendlyErrorMessage } from '@/lib/api';
import { formatLocalIsoOffset } from '@/lib/format';
import type {
  DisplayMode,
  EventStatus,
  ReservationStatus,
  SettlementOperation,
} from '@/types/api';

export const EVENT_STATUS_META: Record<
  EventStatus,
  { label: string; pillClass: string; dotClass: string }
> = {
  DRAFT: {
    label: 'Rascunho',
    pillClass:
      'border-amber-500/35 bg-amber-500/12 text-amber-700',
    dotClass: 'bg-amber-500',
  },
  PUBLISHED: {
    label: 'Publicado',
    pillClass:
      'border-emerald-500/35 bg-emerald-500/12 text-emerald-700',
    dotClass: 'bg-emerald-500',
  },
  CLOSED: {
    label: 'Encerrado',
    pillClass:
      'border-slate-500/35 bg-slate-500/12 text-slate-600',
    dotClass: 'bg-slate-400',
  },
};

export const DISPLAY_MODE_META: Record<DisplayMode, { label: string; description: string }> = {
  BOTH: {
    label: 'Mapa + Lista',
    description: 'Planta interativa e lista por setores',
  },
  MAP: {
    label: 'Somente Mapa',
    description: 'Apenas a planta visual interativa',
  },
  LIST: {
    label: 'Somente Lista',
    description: 'Apenas seleção por setores e mesas',
  },
};

export const RESERVATION_STATUS_META: Record<
  ReservationStatus,
  { label: string; pillClass: string }
> = {
  CONFIRMED: {
    label: 'Confirmada',
    pillClass:
      'border-emerald-500/35 bg-emerald-500/12 text-emerald-700',
  },
  PENDING_PAYMENT: {
    label: 'Aguardando Pagto',
    pillClass:
      'border-amber-500/35 bg-amber-500/12 text-amber-700',
  },
  EXPIRED: {
    label: 'Expirada',
    pillClass:
      'border-slate-500/30 bg-slate-500/10 text-slate-600',
  },
  CANCELLED: {
    label: 'Cancelada',
    pillClass:
      'border-red-500/30 bg-red-500/10 text-red-700',
  },
};

export const SECTOR_COLOR_PALETTE = [
  {
    bg: 'bg-rose-100',
    border: 'border-rose-600',
    ring: 'ring-rose-500/40',
    dot: 'bg-rose-500',
    chip: 'border-rose-500/35 bg-rose-500/12 text-rose-700',
  },
  {
    bg: 'bg-sky-100',
    border: 'border-sky-600',
    ring: 'ring-sky-500/40',
    dot: 'bg-sky-500',
    chip: 'border-sky-500/35 bg-sky-500/12 text-sky-700',
  },
  {
    bg: 'bg-emerald-100',
    border: 'border-emerald-600',
    ring: 'ring-emerald-500/40',
    dot: 'bg-emerald-500',
    chip: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700',
  },
  {
    bg: 'bg-violet-100',
    border: 'border-violet-600',
    ring: 'ring-violet-500/40',
    dot: 'bg-violet-500',
    chip: 'border-violet-500/35 bg-violet-500/12 text-violet-700',
  },
  {
    bg: 'bg-amber-100',
    border: 'border-amber-600',
    ring: 'ring-amber-500/40',
    dot: 'bg-amber-500',
    chip: 'border-amber-500/35 bg-amber-500/12 text-amber-700',
  },
  {
    bg: 'bg-cyan-100',
    border: 'border-cyan-600',
    ring: 'ring-cyan-500/40',
    dot: 'bg-cyan-500',
    chip: 'border-cyan-500/35 bg-cyan-500/12 text-cyan-700',
  },
] as const;

export function getSectorColor(index: number) {
  return SECTOR_COLOR_PALETTE[Math.abs(index) % SECTOR_COLOR_PALETTE.length];
}

export function slugifyTitle(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Converts an ISO UTC string into a `YYYY-MM-DDTHH:mm` value for `<input type="datetime-local">`. */
export function isoToDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converts `<input type="datetime-local">` value into an ISO 8601 string with local timezone offset. */
export function dateTimeLocalToIso(localValue: string): string | null {
  if (!localValue) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    localValue.trim(),
  );
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    s ? Number(s) : 0,
  );
  if (!Number.isFinite(date.getTime())) return null;
  return formatLocalIsoOffset(date);
}

/** Formats minor integer units into an editable major currency string like `99,00`. */
export function minorToEditablePrice(amountMinor: number): string {
  if (!Number.isFinite(amountMinor)) return '';
  return (amountMinor / 100).toFixed(2).replace('.', ',');
}

/** Formats a decimal integer string (possibly huge) in minor currency units. */
export function formatMinorStringCurrency(
  amountMinorRaw: string,
  currency = 'BRL',
): string {
  const cleaned = amountMinorRaw.trim();
  if (!/^-?\d+$/.test(cleaned)) {
    return formatFallbackCurrency(0, currency);
  }
  const asNum = Number(cleaned);
  if (Number.isSafeInteger(asNum)) {
    return formatFallbackCurrency(asNum / 100, currency);
  }
  // BigInt precision fallback
  const negative = cleaned.startsWith('-');
  const digits = negative ? cleaned.slice(1) : cleaned;
  const padded = digits.padStart(3, '0');
  const intPart = padded.slice(0, -2);
  const fracPart = padded.slice(-2);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = negative ? '-' : '';
  return `${sign}${currency === 'BRL' ? 'R$ ' : `${currency} `}${grouped},${fracPart}`;
}

function formatFallbackCurrency(majorValue: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL',
    }).format(majorValue);
  } catch {
    return `R$ ${majorValue.toFixed(2).replace('.', ',')}`;
  }
}

export function formatAdminDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatShortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function isValidHttpsImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length < 9 || trimmed.length > 2048 || trimmed.includes('\\')) {
    return false;
  }
  if (!/^https:\/\/[^\s<>]+$/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return (
      parsed.protocol === 'https:' &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export const SETTLEMENT_OPERATION_ORDER: readonly SettlementOperation[] = [
  'PIX',
  'DEBIT',
  'CREDIT',
  'ANTICIPATED_CREDIT',
] as const;

export const SETTLEMENT_OPERATION_META: Record<
  SettlementOperation,
  {
    shortLabel: string;
    label: string;
    rateLabel: string;
    pillClass: string;
  }
> = {
  PIX: {
    shortLabel: 'PIX',
    label: 'Pix',
    rateLabel: '1,20%',
    pillClass:
      'border-emerald-500/35 bg-emerald-500/12 text-emerald-700',
  },
  DEBIT: {
    shortLabel: 'DÉB',
    label: 'Débito',
    rateLabel: '1,20%',
    pillClass:
      'border-sky-500/35 bg-sky-500/12 text-sky-700',
  },
  CREDIT: {
    shortLabel: 'CRÉD',
    label: 'Crédito sem antecipação',
    rateLabel: '2,99%',
    pillClass:
      'border-violet-500/35 bg-violet-500/12 text-violet-700',
  },
  ANTICIPATED_CREDIT: {
    shortLabel: 'ANTEC',
    label: 'Crédito com antecipação',
    rateLabel: '4,99%',
    pillClass:
      'border-amber-500/35 bg-amber-500/12 text-amber-700',
  },
};

/** Sums decimal integer strings in minor currency units using BigInt precision. */
export function sumMinorStrings(...values: string[]): string {
  let total = 0n;
  for (const raw of values) {
    const cleaned = raw.trim();
    if (/^-?\d+$/.test(cleaned)) {
      total += BigInt(cleaned);
    }
  }
  return total.toString();
}

/** Formats a civil YYYY-MM-DD date in pt-BR without timezone shift. */
export function formatCivilDatePtBr(yyyyMmDd: string): {
  weekday: string;
  shortDate: string;
  fullDate: string;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim());
  if (!match) {
    return { weekday: '', shortDate: yyyyMmDd, fullDate: yyyyMmDd };
  }
  const [, y, m, d] = match;
  const noonUtc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12, 0, 0));
  const rawWeekday = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    timeZone: 'UTC',
  })
    .format(noonUtc)
    .replace('.', '');
  const weekday = rawWeekday.charAt(0).toUpperCase() + rawWeekday.slice(1);
  const shortDate = `${d}/${m}`;
  const fullDate = `${d}/${m}/${y}`;
  return { weekday, shortDate, fullDate };
}

/** Returns the civil date YYYY-MM-DD of an ISO timestamp in a given IANA timeZone. */
export function getCivilDateKeyInTimeZone(
  isoUtc: string,
  timeZone = 'America/Sao_Paulo',
): string {
  const date = new Date(isoUtc);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function getAdminErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'ADMIN_RESOURCE_CONFLICT':
        return 'Já existe um registro com este identificador (slug, nome de setor ou número de mesa).';
      case 'RESERVATION_HISTORY_EXISTS':
        return 'Esta ação não pode ser concluída porque já existe histórico de reservas vinculado.';
      case 'INVALID_EVENT_SCHEDULE':
        return 'A data/hora de término deve ser posterior à data/hora de início.';
      case 'INVALID_IMAGE_TYPE':
        return 'Envie uma imagem no formato PNG, JPEG ou WebP.';
      case 'INVALID_IMAGE_CONTENT':
        return 'O conteúdo do arquivo não corresponde a uma imagem PNG, JPEG ou WebP válida.';
      case 'INVALID_IMAGE_URL':
        return 'Informe uma URL HTTPS válida para a imagem, sem credenciais.';
      case 'INVALID_TABLE_PRICE':
        return 'Informe um preço válido para a mesa ou configure o preço base do setor.';
      default:
        return getFriendlyErrorMessage(error);
    }
  }
  return getFriendlyErrorMessage(error);
}
