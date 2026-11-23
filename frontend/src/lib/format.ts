import { API_BASE_URL } from './config';

export function resolveApiAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:') ||
    url.startsWith('blob:')
  ) {
    return url;
  }
  const normalizedBase = API_BASE_URL.replace(/\/+$/, '');
  const normalizedPath = url.startsWith('/') ? url : `/${url}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function formatMinorCurrency(
  amountMinor: number,
  currency = 'BRL',
): string {
  const value = amountMinor / 100;
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL',
    }).format(value);
  } catch {
    return `R$ ${value.toFixed(2).replace('.', ',')}`;
  }
}

export function parseMajorPriceToMinor(raw: string): number | undefined {
  const cleaned = raw.trim().replace(/[^\d.,]/g, '');
  if (!cleaned) return undefined;

  // Support both "99,50" and "99.50"
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed * 100);
}

export function formatEventDayBadge(isoUtc: string): {
  weekday: string;
  day: string;
  month: string;
  time: string;
} {
  const date = new Date(isoUtc);
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
    .format(date)
    .replace('.', '')
    .toUpperCase();
  const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit' }).format(date);
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'short' })
    .format(date)
    .replace('.', '')
    .toUpperCase();
  const time = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  return { weekday, day, month, time };
}

export function formatEventDateLine(startsAt: string, endsAt?: string): string {
  const start = new Date(startsAt);
  const datePart = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
    .format(start)
    .replace(/\./g, '');

  const startTime = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(start);

  const capitalized = datePart.charAt(0).toUpperCase() + datePart.slice(1);

  if (!endsAt) {
    return `${capitalized} · ${startTime}`;
  }

  const end = new Date(endsAt);
  const endTime = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(end);

  return `${capitalized} · ${startTime} – ${endTime}`;
}

export function formatLocalIsoOffset(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const offH = pad(Math.floor(absMin / 60));
  const offM = pad(absMin % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offH}:${offM}`;
}

export function dateInputToStartIso(dateStr: string): string | undefined {
  if (!dateStr) return undefined;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return formatLocalIsoOffset(new Date(y, m - 1, d, 0, 0, 0));
}

export function dateInputToEndIso(dateStr: string): string | undefined {
  if (!dateStr) return undefined;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return formatLocalIsoOffset(new Date(y, m - 1, d, 23, 59, 59));
}

export function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type DatePreset = 'all' | 'today' | 'tomorrow' | 'weekend' | 'month';

export function getDatePresetBounds(preset: DatePreset): {
  fromDate: string;
  toDate: string;
} {
  const now = new Date();
  if (preset === 'all') {
    return { fromDate: '', toDate: '' };
  }
  if (preset === 'today') {
    const today = toDateInputValue(now);
    return { fromDate: today, toDate: today };
  }
  if (preset === 'tomorrow') {
    const tmrw = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const val = toDateInputValue(tmrw);
    return { fromDate: val, toDate: val };
  }
  if (preset === 'weekend') {
    const day = now.getDay(); // 0 = Sun, 5 = Fri, 6 = Sat
    const daysUntilFri = day <= 5 ? 5 - day : 6;
    const friday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + (day === 0 ? 0 : daysUntilFri),
    );
    const sunday = new Date(
      friday.getFullYear(),
      friday.getMonth(),
      friday.getDate() + (day === 0 ? 0 : 2),
    );
    return {
      fromDate: toDateInputValue(day === 6 ? now : friday),
      toDate: toDateInputValue(sunday),
    };
  }
  // month: next 30 days
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
  return {
    fromDate: toDateInputValue(now),
    toDate: toDateInputValue(end),
  };
}

const FALLBACK_GRADIENTS = [
  'linear-gradient(135deg, #1b0f26 0%, #3b1334 45%, #ff3366 100%)',
  'linear-gradient(135deg, #0b1623 0%, #152b47 50%, #3b82f6 100%)',
  'linear-gradient(135deg, #14141c 0%, #2b1d3d 48%, #8b5cf6 100%)',
  'linear-gradient(135deg, #0e1c1a 0%, #134e4a 52%, #10b981 100%)',
  'linear-gradient(135deg, #1f130d 0%, #4c1d1b 50%, #f97316 100%)',
];

export function getEventFallbackGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_GRADIENTS[hash % FALLBACK_GRADIENTS.length];
}
