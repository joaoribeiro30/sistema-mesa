import { useCallback, useEffect, useRef, useState } from 'react';
import { eventsApi } from '@/lib/api';
import type {
  SseSnapshotPayload,
  SseTableState,
  SseTableUpdatePayload,
} from '@/types/api';

export type StreamConnectionState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'closed';

export type TableStreamEventType =
  | 'table.locked'
  | 'table.released'
  | 'table.sold';

interface UseEventTableStreamOptions {
  eventId: string | null | undefined;
  onSnapshot: (tables: SseTableState[]) => void;
  onTableEvent: (
    eventType: TableStreamEventType,
    payload: SseTableUpdatePayload,
  ) => void;
}

export function useEventTableStream({
  eventId,
  onSnapshot,
  onTableEvent,
}: UseEventTableStreamOptions) {
  const [status, setStatus] = useState<StreamConnectionState>('idle');
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);

  const onSnapshotRef = useRef(onSnapshot);
  const onTableEventRef = useRef(onTableEvent);

  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    onTableEventRef.current = onTableEvent;
  }, [onTableEvent]);

  const reconnect = useCallback(() => {
    setReconnectTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!eventId) {
      setStatus('idle');
      return;
    }

    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let retryAttempt = 0;

    function clearRetryTimer() {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    }

    function connect() {
      if (disposed || !eventId) return;
      clearRetryTimer();

      setStatus(retryAttempt === 0 ? 'connecting' : 'reconnecting');

      const streamUrl = eventsApi.getStreamUrl(eventId);
      const es = new EventSource(streamUrl);
      source = es;

      es.onopen = () => {
        if (disposed) return;
        retryAttempt = 0;
        setStatus('live');
      };

      const handleSnapshot = (evt: Event) => {
        if (disposed) return;
        const message = evt as MessageEvent<string>;
        try {
          const parsed = JSON.parse(message.data) as SseSnapshotPayload;
          if (parsed && Array.isArray(parsed.tables)) {
            setStatus('live');
            setLastUpdateAt(Date.now());
            onSnapshotRef.current(parsed.tables);
          }
        } catch {
          // Ignore malformed event data
        }
      };

      const makeTableHandler =
        (eventType: TableStreamEventType) => (evt: Event) => {
          if (disposed) return;
          const message = evt as MessageEvent<string>;
          try {
            const parsed = JSON.parse(message.data) as SseTableUpdatePayload;
            if (parsed && typeof parsed.tableId === 'string') {
              setStatus('live');
              setLastUpdateAt(Date.now());
              onTableEventRef.current(eventType, parsed);
            }
          } catch {
            // Ignore malformed event data
          }
        };

      const handleLocked = makeTableHandler('table.locked');
      const handleReleased = makeTableHandler('table.released');
      const handleSold = makeTableHandler('table.sold');

      es.addEventListener('snapshot', handleSnapshot);
      es.addEventListener('table.locked', handleLocked);
      es.addEventListener('table.released', handleReleased);
      es.addEventListener('table.sold', handleSold);

      es.onerror = () => {
        if (disposed) return;

        // Browser EventSource auto-reconnects when readyState === CONNECTING
        // and sends Last-Event-ID automatically.
        if (es.readyState === EventSource.CONNECTING) {
          setStatus('reconnecting');
          return;
        }

        // If browser gave up (CLOSED), perform bounded exponential backoff reconnect
        es.close();
        retryAttempt += 1;
        if (retryAttempt > 8) {
          setStatus('closed');
          return;
        }

        setStatus('reconnecting');
        const delayMs = Math.min(2000 * Math.pow(1.6, retryAttempt - 1), 15000);
        retryTimer = window.setTimeout(connect, delayMs);
      };
    }

    connect();

    return () => {
      disposed = true;
      clearRetryTimer();
      if (source) {
        source.close();
        source = null;
      }
    };
  }, [eventId, reconnectTrigger]);

  return {
    status,
    lastUpdateAt,
    reconnect,
  };
}
