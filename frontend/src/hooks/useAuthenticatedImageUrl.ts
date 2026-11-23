import { useEffect, useState } from 'react';
import { getStoredAccessToken } from '@/lib/api';
import { resolveApiAssetUrl } from '@/lib/format';

/**
 * Resolves an event image URL for display in admin screens.
 *
 * Uploaded images stored by the API use relative URLs like `/events/:id/images/:kind`.
 * For DRAFT/CLOSED/past events, the backend only serves those bytes to an authenticated
 * ADMIN. Because standard `<img>` tags cannot attach `Authorization: Bearer` headers,
 * this hook fetches relative API images with credentials + Bearer token and exposes an
 * Object URL (revoking it automatically on change/unmount).
 */
export function useAuthenticatedImageUrl(
  rawUrl: string | null | undefined,
  revision = 0,
): { src: string | null; loading: boolean; error: boolean } {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const trimmed = rawUrl?.trim() || null;
  const isRelativeApiUpload = Boolean(
    trimmed &&
      !trimmed.startsWith('http://') &&
      !trimmed.startsWith('https://') &&
      !trimmed.startsWith('data:') &&
      !trimmed.startsWith('blob:'),
  );

  useEffect(() => {
    if (!trimmed || !isRelativeApiUpload) {
      setObjectUrl(null);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    const controller = new AbortController();

    async function fetchImage() {
      const resolved = resolveApiAssetUrl(trimmed);
      if (!resolved) {
        setObjectUrl(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(false);

      const headers = new Headers();
      const token = getStoredAccessToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      try {
        const cacheBuster = revision > 0 ? `?v=${revision}` : '';
        const res = await fetch(`${resolved}${cacheBuster}`, {
          method: 'GET',
          headers,
          credentials: 'include',
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      } catch {
        if (!cancelled) {
          setObjectUrl(null);
          setError(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchImage();

    return () => {
      cancelled = true;
      controller.abort();
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [trimmed, isRelativeApiUpload, revision]);

  if (!trimmed) {
    return { src: null, loading: false, error: false };
  }

  if (!isRelativeApiUpload) {
    return { src: trimmed, loading: false, error: false };
  }

  return { src: objectUrl, loading, error };
}
