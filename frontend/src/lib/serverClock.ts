/**
 * Lightweight server clock synchronisation.
 *
 * Reservation deadlines (`expiresAt`) are computed by the API clock. When the
 * `Date` response header is readable (same-origin deployments or when it is
 * exposed via CORS), we estimate the offset between the browser and the server
 * so countdowns match the deadline enforced by the backend.
 */

let offsetMs = 0;
const listeners = new Set<() => void>();

/** HTTP `Date` has 1s resolution; ignore offsets that are within that noise. */
const NOISE_THRESHOLD_MS = 1500;

export function recordServerDate(dateHeader: string | null): void {
  if (!dateHeader) return;
  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs)) return;
  // The header is truncated to the second; assume the midpoint of that second.
  const measured = serverMs + 500 - Date.now();
  const next = Math.abs(measured) < NOISE_THRESHOLD_MS ? 0 : measured;
  if (Math.abs(next - offsetMs) < 250) return;
  offsetMs = next;
  listeners.forEach((listener) => listener());
}

export function getServerOffsetMs(): number {
  return offsetMs;
}

/** Current time according to the (estimated) server clock. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function subscribeServerClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
