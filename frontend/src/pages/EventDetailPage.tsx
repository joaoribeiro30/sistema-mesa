import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  LayoutGrid,
  Map as MapIcon,
  MapPin,
  QrCode,
  Radio,
  RefreshCw,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { CheckoutDrawer } from '@/components/checkout/CheckoutDrawer';
import { TicketModal } from '@/components/checkout/TicketModal';
import { InteractiveFloorMap } from '@/components/event/InteractiveFloorMap';
import {
  ReservationLockModal,
  type LockedReservationSummary,
} from '@/components/event/ReservationLockModal';
import { SectorTableList } from '@/components/event/SectorTableList';
import {
  SelectionBar,
  type SelectedTableEntry,
} from '@/components/event/SelectionBar';
import {
  isTableSelectable,
  TABLE_STATUS_META,
  type VisualTableState,
} from '@/components/event/tableStatus';
import { useAuth } from '@/contexts/AuthContext';
import {
  useEventTableStream,
  type TableStreamEventType,
} from '@/hooks/useEventTableStream';
import {
  eventsApi,
  generateIdempotencyKey,
  getFriendlyErrorMessage,
  reservationsApi,
} from '@/lib/api';
import { formatEventDateLine } from '@/lib/format';
import type {
  EventDetail,
  EventSector,
  EventTable,
  SseTableState,
  SseTableUpdatePayload,
} from '@/types/api';

type ActiveViewMode = 'MAP' | 'LIST';

const LEGEND_STATES: VisualTableState[] = [
  'AVAILABLE',
  'SELECTED',
  'RESERVED',
  'SOLD',
];

function chooseInitialViewMode(detail: EventDetail): ActiveViewMode {
  if (detail.displayMode === 'MAP') return 'MAP';
  if (detail.displayMode === 'LIST') return 'LIST';
  // For BOTH: prefer MAP when floor plan or positioned tables exist
  const hasPositioned = detail.sectors.some((sector) =>
    sector.tables.some((t) => t.x !== null && t.y !== null),
  );
  return detail.floorPlanImageUrl || hasPositioned ? 'MAP' : 'LIST';
}

export function EventDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ActiveViewMode>('MAP');
  const [activeSectorId, setActiveSectorId] = useState<string | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // tableId -> guestCount
  const [selectedMap, setSelectedMap] = useState<Record<string, number>>({});
  // Stable idempotency key per selected tableId until deselected or reserved
  const idempotencyKeysRef = useRef<Record<string, string>>({});

  const [submittingReservation, setSubmittingReservation] = useState(false);
  const [reservationError, setReservationError] = useState<string | null>(null);
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const [lockedReservations, setLockedReservations] = useState<
    LockedReservationSummary[]
  >([]);
  const [cancellingReservationId, setCancellingReservationId] = useState<
    string | null
  >(null);
  const [checkoutReservationId, setCheckoutReservationId] = useState<string | null>(null);
  const [ticketReservationId, setTicketReservationId] = useState<string | null>(null);
  const [paidReservationIds, setPaidReservationIds] = useState<Set<string>>(
    () => new Set(),
  );

  const checkoutEntry = useMemo(
    () =>
      checkoutReservationId
        ? lockedReservations.find((item) => item.reservation.id === checkoutReservationId) ?? null
        : null,
    [checkoutReservationId, lockedReservations],
  );

  const loadEvent = useCallback(
    async (silent = false) => {
      if (!slug) return;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const { event: detail } = await eventsApi.getBySlug(slug);
        setEvent(detail);
        if (!silent) {
          setViewMode(chooseInitialViewMode(detail));
          setActiveSectorId(null);
          setOnlyAvailable(false);
          setFiltersOpen(false);
          setSelectedMap({});
          idempotencyKeysRef.current = {};
        }
      } catch (err) {
        if (!silent) {
          setError(getFriendlyErrorMessage(err));
          setEvent(null);
        } else {
          setLiveNotice(getFriendlyErrorMessage(err));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [slug],
  );

  useEffect(() => {
    void loadEvent(false);
  }, [loadEvent]);

  // Helper to find a table's label for user-friendly SSE notices
  const findTableLabel = useCallback(
    (currentEvent: EventDetail | null, tableId: string): string => {
      if (!currentEvent) return 'selecionada';
      for (const sector of currentEvent.sectors) {
        const found = sector.tables.find((t) => t.id === tableId);
        if (found) return found.label;
      }
      return 'selecionada';
    },
    [],
  );

  // Apply SSE snapshot cleanly
  const handleSseSnapshot = useCallback(
    (snapshotTables: SseTableState[]) => {
      const stateById = new Map(snapshotTables.map((t) => [t.tableId, t]));
      const newlyUnavailableIds: string[] = [];

      setEvent((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sectors: prev.sectors.map((sector) => ({
            ...sector,
            tables: sector.tables.map((table) => {
              const incoming = stateById.get(table.id);
              if (!incoming) return table;
              if (!incoming.available || incoming.status !== 'AVAILABLE') {
                newlyUnavailableIds.push(table.id);
              }
              return {
                ...table,
                status: incoming.status,
                available: incoming.available,
                expiresAt: incoming.expiresAt,
              };
            }),
          })),
        };
      });

      if (newlyUnavailableIds.length > 0) {
        setSelectedMap((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const id of newlyUnavailableIds) {
            if (id in next) {
              delete next[id];
              delete idempotencyKeysRef.current[id];
              changed = true;
            }
          }
          if (changed) {
            setLiveNotice(
              'Uma ou mais mesas da sua seleção ficaram indisponíveis e foram removidas.',
            );
          }
          return changed ? next : prev;
        });
      }
    },
    [],
  );

  // Apply single SSE event (table.locked, table.released, table.sold)
  const handleSseTableEvent = useCallback(
    (eventType: TableStreamEventType, payload: SseTableUpdatePayload) => {
      let affectedLabel: string | null = null;

      setEvent((prev) => {
        if (!prev) return prev;
        affectedLabel = findTableLabel(prev, payload.tableId);
        return {
          ...prev,
          sectors: prev.sectors.map((sector) => ({
            ...sector,
            tables: sector.tables.map((table) =>
              table.id === payload.tableId
                ? {
                    ...table,
                    status: payload.status,
                    available: payload.available,
                    expiresAt: payload.expiresAt,
                  }
                : table,
            ),
          })),
        };
      });

      if (
        eventType === 'table.locked' ||
        eventType === 'table.sold' ||
        !payload.available
      ) {
        setSelectedMap((prev) => {
          if (!(payload.tableId in prev)) return prev;
          const next = { ...prev };
          delete next[payload.tableId];
          delete idempotencyKeysRef.current[payload.tableId];

          const actionWord =
            eventType === 'table.sold' ? 'vendida' : 'reservada';
          setLiveNotice(
            `A mesa ${affectedLabel ?? ''} acabou de ser ${actionWord} em tempo real e foi removida da sua seleção.`,
          );
          return next;
        });
      }
    },
    [findTableLabel],
  );

  const { status: streamStatus, reconnect: reconnectStream } =
    useEventTableStream({
      eventId: event?.id,
      onSnapshot: handleSseSnapshot,
      onTableEvent: handleSseTableEvent,
    });

  // Auto-dismiss live notice after 6s
  useEffect(() => {
    if (!liveNotice) return;
    const timer = window.setTimeout(() => setLiveNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [liveNotice]);

  // Derived selection items with latest live table data
  const selectedItems = useMemo<SelectedTableEntry[]>(() => {
    if (!event) return [];
    const items: SelectedTableEntry[] = [];
    for (const sector of event.sectors) {
      for (const table of sector.tables) {
        const guestCount = selectedMap[table.id];
        if (guestCount !== undefined && isTableSelectable(table)) {
          items.push({
            table,
            sector,
            guestCount: Math.min(Math.max(1, guestCount), table.capacity),
          });
        }
      }
    }
    return items;
  }, [event, selectedMap]);

  const selectedTableIds = useMemo(
    () => new Set(selectedItems.map((item) => item.table.id)),
    [selectedItems],
  );

  const handleToggleTable = useCallback((table: EventTable, _sector: EventSector) => {
    if (!isTableSelectable(table)) return;
    setReservationError(null);
    setSelectedMap((prev) => {
      if (table.id in prev) {
        const next = { ...prev };
        delete next[table.id];
        delete idempotencyKeysRef.current[table.id];
        return next;
      }
      idempotencyKeysRef.current[table.id] = generateIdempotencyKey();
      return {
        ...prev,
        [table.id]: table.capacity,
      };
    });
  }, []);

  const handleUpdateGuests = useCallback((tableId: string, guestCount: number) => {
    setSelectedMap((prev) => {
      if (!(tableId in prev)) return prev;
      // Guest count change requires a fresh idempotency key for POST /reservations
      idempotencyKeysRef.current[tableId] = generateIdempotencyKey();
      return { ...prev, [tableId]: guestCount };
    });
  }, []);

  const handleRemoveTable = useCallback((tableId: string) => {
    setSelectedMap((prev) => {
      if (!(tableId in prev)) return prev;
      const next = { ...prev };
      delete next[tableId];
      delete idempotencyKeysRef.current[tableId];
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedMap({});
    idempotencyKeysRef.current = {};
  }, []);

  async function handleProceedCheckout() {
    if (!event || selectedItems.length === 0 || submittingReservation) return;
    setReservationError(null);
    setSubmittingReservation(true);

    const created: LockedReservationSummary[] = [];
    const failures: string[] = [];

    for (const entry of selectedItems) {
      const idemKey =
        idempotencyKeysRef.current[entry.table.id] || generateIdempotencyKey();
      idempotencyKeysRef.current[entry.table.id] = idemKey;

      try {
        const { reservation } = await reservationsApi.create(
          {
            eventId: event.id,
            tableId: entry.table.id,
            guestCount: entry.guestCount,
          },
          idemKey,
        );
        created.push({
          reservation,
          tableLabel: entry.table.label,
          sectorName: entry.sector.name,
        });
      } catch (err) {
        failures.push(
          `Mesa ${entry.table.label}: ${getFriendlyErrorMessage(err)}`,
        );
      }
    }

    if (created.length > 0) {
      const createdByTableId = new Map(
        created.map((c) => [c.reservation.tableId, c.reservation]),
      );

      // Optimistically reflect locked status (SSE will also broadcast table.locked)
      setEvent((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sectors: prev.sectors.map((sector) => ({
            ...sector,
            tables: sector.tables.map((t) => {
              const res = createdByTableId.get(t.id);
              if (!res) return t;
              return {
                ...t,
                status: 'RESERVED',
                available: false,
                expiresAt: res.expiresAt,
              };
            }),
          })),
        };
      });

      // Remove locked tables from selection
      setSelectedMap((prev) => {
        const next = { ...prev };
        for (const c of created) {
          delete next[c.reservation.tableId];
          delete idempotencyKeysRef.current[c.reservation.tableId];
        }
        return next;
      });

      setLockedReservations((prev) => [...prev, ...created]);
    }

    if (failures.length > 0) {
      setReservationError(failures.join(' · '));
    }

    setSubmittingReservation(false);
  }

  const handleReservationPaid = useCallback(
    (reservationId: string) => {
      setPaidReservationIds((prev) => new Set(prev).add(reservationId));
      setLiveNotice('Pagamento confirmado! Seu ingresso digital já está disponível.');
      // SSE broadcasts table.sold as well; refresh silently to be safe.
      void loadEvent(true);
    },
    [loadEvent],
  );

  async function handleCancelLockedReservation(reservationId: string) {
    setCancellingReservationId(reservationId);
    try {
      await reservationsApi.cancel(reservationId);
      setLockedReservations((prev) =>
        prev.filter((item) => item.reservation.id !== reservationId),
      );
      setLiveNotice('Bloqueio cancelado e mesa liberada novamente.');
    } catch (err) {
      setReservationError(getFriendlyErrorMessage(err));
    } finally {
      setCancellingReservationId(null);
    }
  }

  async function handleShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      // Ignore clipboard failures in insecure contexts
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 pt-4 pb-16 sm:px-6 md:space-y-7 md:pt-6 lg:px-8">
        <div className="skeleton h-28 rounded-2xl md:rounded-3xl" />
        <div className="skeleton h-12 w-full rounded-xl md:w-96" />
        <div className="skeleton h-64 rounded-2xl md:h-[460px] md:rounded-3xl" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h1 className="font-display text-2xl font-bold text-[var(--text-primary)]">
          Evento não disponível
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {error || 'Não encontramos este evento no catálogo publicado.'}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-2.5 text-xs font-semibold text-[var(--cta-text)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar ao catálogo
          </Link>
          <button
            type="button"
            onClick={() => void loadEvent(false)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-5 py-2.5 text-xs font-semibold text-[var(--text-primary)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const hasActiveFilters = activeSectorId !== null || onlyAvailable;
  const effectiveViewMode: ActiveViewMode =
    event.displayMode === 'MAP'
      ? 'MAP'
      : event.displayMode === 'LIST'
        ? 'LIST'
        : viewMode;

  return (
    <div
      className={`mx-auto max-w-7xl space-y-4 px-4 pt-4 sm:px-6 md:space-y-7 md:pt-6 lg:px-8 ${
        selectedItems.length > 0 ? 'pb-36 sm:pb-32' : 'pb-16'
      }`}
    >
      <header className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 md:rounded-3xl md:px-6 md:py-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display min-w-0 text-2xl leading-tight font-bold tracking-tight [overflow-wrap:anywhere] md:text-4xl">
            {event.title}
          </h1>
          <button
            type="button"
            onClick={handleShareLink}
            aria-label={copiedLink ? 'Link copiado' : 'Compartilhar'}
            title={copiedLink ? 'Link copiado' : 'Compartilhar'}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            {copiedLink
              ? <Check className="h-4 w-4 text-[var(--success)]" />
              : <Share2 className="h-4 w-4" />}
          </button>
        </div>

        <div className="mt-1 flex flex-col gap-1.5 text-xs text-[var(--text-secondary)] md:mt-2 md:flex-row md:flex-wrap md:gap-x-5 md:text-sm">
          <span className="inline-flex items-start gap-1.5">
            <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)] md:h-4 md:w-4" />
            <span>{formatEventDateLine(event.startsAt, event.endsAt)}</span>
          </span>
          <span className="inline-flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)] md:h-4 md:w-4" />
            <span className="[overflow-wrap:anywhere]">
              {event.venue}{event.city ? ` · ${event.city}` : ''}
            </span>
          </span>
        </div>
      </header>

      <section aria-label="Seleção de mesas" className="space-y-2.5 md:space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-display text-xl leading-tight font-bold tracking-tight md:text-3xl">
              Escolha onde ficar
            </h2>
            {streamStatus === 'closed' ? (
              <button
                type="button"
                onClick={reconnectStream}
                className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-2.5 text-[11px] font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/20"
              >
                <Radio className="h-3 w-3 shrink-0" />
                Reconectar
              </button>
            ) : (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  streamStatus === 'live' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${streamStatus === 'live' ? 'bg-emerald-600' : 'bg-amber-600'}`}
                />
                {streamStatus === 'live' ? 'Ao vivo' : streamStatus === 'reconnecting' ? 'Reconectando…' : 'Conectando…'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {event.displayMode === 'BOTH' && (
              <div
                role="tablist"
                aria-label="Modo de visualização das mesas"
                className="grid grow basis-56 grid-cols-2 gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1 md:flex md:flex-none"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveViewMode === 'MAP'}
                  onClick={() => setViewMode('MAP')}
                  className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full px-1.5 text-xs font-semibold transition-colors md:px-3 ${
                    effectiveViewMode === 'MAP'
                      ? 'bg-[var(--cta-bg)] text-[var(--cta-text)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <MapIcon className="h-3.5 w-3.5 shrink-0" />
                  Mapa Interativo
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveViewMode === 'LIST'}
                  onClick={() => setViewMode('LIST')}
                  className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full px-1.5 text-xs font-semibold transition-colors md:px-3 ${
                    effectiveViewMode === 'LIST'
                      ? 'bg-[var(--cta-bg)] text-[var(--cta-text)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                  Lista por Setores
                </button>
              </div>
            )}

            <button
              type="button"
              aria-label={hasActiveFilters ? 'Filtrar, filtros ativos' : 'Filtrar'}
              aria-expanded={filtersOpen}
              aria-controls="table-selection-filters"
              onClick={() => setFiltersOpen((open) => !open)}
              className={`ml-auto inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
                hasActiveFilters
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filtrar
              {hasActiveFilters && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
            </button>
          </div>
        </div>

        <div
          id="table-selection-filters"
          hidden={!filtersOpen}
          className="space-y-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 md:px-4 md:py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Filtrar por setor" className="flex min-w-0 flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-label="Todos os setores"
                aria-pressed={activeSectorId === null}
                onClick={() => setActiveSectorId(null)}
                className={`min-h-9 cursor-pointer rounded-full border px-3 text-xs font-medium transition-colors ${
                  activeSectorId === null
                    ? 'border-transparent bg-[var(--cta-bg)] text-[var(--cta-text)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Todos
              </button>
              {event.sectors.map((sector) => {
                const selected = activeSectorId === sector.id;
                return (
                  <button
                    key={sector.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setActiveSectorId(selected ? null : sector.id)}
                    className={`min-h-9 max-w-full cursor-pointer truncate rounded-full border px-3 text-xs font-medium transition-colors ${
                      selected
                        ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {sector.name}
                  </button>
                );
              })}
            </div>

            <label className="inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-xs font-medium text-[var(--text-primary)] select-none">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              Somente livres
            </label>
          </div>

          <ul
            aria-label="Legenda de status das mesas"
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--border-subtle)] pt-2.5 text-[11px] font-medium text-[var(--text-secondary)]"
          >
            {LEGEND_STATES.map((state) => {
              const meta = TABLE_STATUS_META[state];
              return (
                <li key={state} className="inline-flex items-center gap-1">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
                  {meta.shortLabel}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Live SSE / Reservation Notifications */}
        {liveNotice && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-700"
          >
            <span className="flex items-center gap-2">
              <Radio className="h-4 w-4 shrink-0" />
              {liveNotice}
            </span>
            <button
              type="button"
              onClick={() => setLiveNotice(null)}
              aria-label="Dispensar aviso"
              className="cursor-pointer rounded-full p-1 hover:bg-amber-500/15"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {reservationError && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-4 py-3 text-xs leading-relaxed text-[var(--danger)]"
          >
            <span className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{reservationError}</span>
            </span>
            <button
              type="button"
              onClick={() => setReservationError(null)}
              aria-label="Fechar erro"
              className="cursor-pointer rounded-full p-1 hover:bg-[var(--danger)]/15"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Render Active View */}
        {event.sectors.length === 0 ? (
          <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center text-sm text-[var(--text-secondary)]">
            Este evento ainda não possui setores ou mesas liberadas para seleção.
          </div>
        ) : effectiveViewMode === 'MAP' ? (
          <InteractiveFloorMap
            floorPlanImageUrl={event.floorPlanImageUrl}
            sectors={event.sectors}
            currency={event.currency}
            selectedTableIds={selectedTableIds}
            activeSectorId={activeSectorId}
            onlyAvailable={onlyAvailable}
            onToggleTable={handleToggleTable}
          />
        ) : (
          <SectorTableList
            sectors={event.sectors}
            currency={event.currency}
            selectedTableIds={selectedTableIds}
            activeSectorId={activeSectorId}
            onlyAvailable={onlyAvailable}
            onToggleTable={handleToggleTable}
          />
        )}
      </section>

      <details className="group rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] md:rounded-3xl">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 rounded-2xl px-4 text-sm font-semibold hover:bg-[var(--bg-elevated)] md:px-6 [&::-webkit-details-marker]:hidden">
          <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
          Regras da reserva
          <ChevronDown className="ml-auto h-4 w-4 text-[var(--text-muted)] transition-transform group-open:rotate-180" />
        </summary>
        <ul className="grid gap-3 border-t border-[var(--border-subtle)] p-4 text-xs leading-relaxed text-[var(--text-secondary)] md:grid-cols-2 md:gap-4 md:px-6">
          <li className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
            <span>
              <strong className="text-[var(--text-primary)]">Bloqueio de 10 minutos.</strong>{' '}
              Conclua o pagamento por Pix ou cartão dentro desse prazo para confirmar a mesa.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
            <span>
              <strong className="text-[var(--text-primary)]">Capacidade por mesa.</strong>{' '}
              Confira o limite de pessoas antes de avançar.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <X className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            <span>
              <strong className="text-[var(--text-primary)]">Cancelamento.</strong>{' '}
              Você pode cancelar o bloqueio enquanto a reserva estiver pendente de pagamento.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
            <span>
              <strong className="text-[var(--text-primary)]">Ingresso com QR Code.</strong>{' '}
              Após confirmar o pagamento, abra o ingresso em Minhas Reservas e apresente-o na portaria.
            </span>
          </li>
        </ul>
      </details>

      {/* Floating Selection & Checkout Bar */}
      <SelectionBar
        selectedItems={selectedItems}
        currency={event.currency}
        eventSlug={event.slug}
        user={user}
        submitting={submittingReservation}
        onUpdateGuests={handleUpdateGuests}
        onRemoveTable={handleRemoveTable}
        onClearAll={handleClearSelection}
        onProceedCheckout={handleProceedCheckout}
      />

      {/* Locked Reservation Confirmation Modal → Checkout */}
      {!checkoutEntry && !ticketReservationId && (
        <ReservationLockModal
          items={lockedReservations}
          eventTitle={event.title}
          cancellingId={cancellingReservationId}
          paidIds={paidReservationIds}
          onCancelReservation={handleCancelLockedReservation}
          onPay={setCheckoutReservationId}
          onViewTicket={setTicketReservationId}
          onExpired={() => void loadEvent(true)}
          onClose={() => {
            setLockedReservations([]);
            setPaidReservationIds(new Set());
          }}
        />
      )}

      {checkoutEntry && (
        <CheckoutDrawer
          key={checkoutEntry.reservation.id}
          reservation={checkoutEntry.reservation}
          context={{
            eventTitle: event.title,
            eventSlug: event.slug,
            startsAt: event.startsAt,
            venue: event.venue,
            city: event.city,
            tableLabel: checkoutEntry.tableLabel,
            sectorName: checkoutEntry.sectorName,
          }}
          onClose={() => setCheckoutReservationId(null)}
          onPaid={handleReservationPaid}
          onExpired={() => void loadEvent(true)}
          onBackToEvent={() => {
            const expiredId = checkoutEntry.reservation.id;
            setCheckoutReservationId(null);
            setLockedReservations((prev) => prev.filter((item) => item.reservation.id !== expiredId));
            void loadEvent(true);
          }}
          onViewTicket={(reservationId) => {
            setCheckoutReservationId(null);
            setTicketReservationId(reservationId);
          }}
        />
      )}

      {ticketReservationId && (
        <TicketModal
          reservationId={ticketReservationId}
          onClose={() => setTicketReservationId(null)}
        />
      )}
    </div>
  );
}
