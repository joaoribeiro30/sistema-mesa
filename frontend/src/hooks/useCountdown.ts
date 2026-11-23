import { useEffect, useState } from 'react';
import { serverNow, subscribeServerClock } from '@/lib/serverClock';

export interface CountdownState {
  /** Remaining milliseconds (0 when expired or no deadline). */
  remainingMs: number;
  /** `MM:SS` label, or null when there is no deadline. */
  label: string | null;
  expired: boolean;
  /** Fraction (0..1) of the hold window still available. */
  fraction: number;
}

export const RESERVATION_HOLD_MS = 10 * 60 * 1000;

export function formatCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function computeCountdown(
  expiresAt: string | null | undefined,
  nowMs: number,
  windowMs = RESERVATION_HOLD_MS,
): CountdownState {
  if (!expiresAt) {
    return { remainingMs: 0, label: null, expired: false, fraction: 0 };
  }
  const target = Date.parse(expiresAt);
  if (!Number.isFinite(target)) {
    return { remainingMs: 0, label: null, expired: false, fraction: 0 };
  }
  const remainingMs = Math.max(0, target - nowMs);
  return {
    remainingMs,
    label: formatCountdown(remainingMs),
    expired: remainingMs <= 0,
    fraction: Math.min(1, remainingMs / windowMs),
  };
}

/**
 * Ticking "now" synchronised with the server clock. Re-renders every
 * `intervalMs` (aligned to the wall-clock second) while `enabled`.
 */
export function useServerNow(enabled = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    if (!enabled) return;
    let timeout: number | undefined;
    const tick = () => {
      const current = serverNow();
      setNow(current);
      // Align next tick to the next second boundary to avoid drift.
      const delay = intervalMs - (current % intervalMs) + 15;
      timeout = window.setTimeout(tick, delay);
    };
    tick();

    const resync = () => setNow(serverNow());
    const unsubscribe = subscribeServerClock(resync);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resync();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs]);

  return now;
}

/** Live countdown for a reservation deadline. */
export function useCountdown(
  expiresAt: string | null | undefined,
  enabled = true,
): CountdownState {
  const now = useServerNow(enabled && Boolean(expiresAt));
  return computeCountdown(expiresAt, now);
}
