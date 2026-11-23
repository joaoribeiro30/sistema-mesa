import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  ExternalLink,
  Layers,
  Loader2,
  Map as MapIcon,
  MapPin,
  Pencil,
  Plus,
  QrCode,
  Search,
  Trash2,
} from 'lucide-react';
import {
  DISPLAY_MODE_META,
  EVENT_STATUS_META,
  getAdminErrorMessage,
} from '@/components/admin/adminUtils';
import { useAuthenticatedImageUrl } from '@/hooks/useAuthenticatedImageUrl';
import { adminApi } from '@/lib/api';
import { formatEventDateLine, getEventFallbackGradient } from '@/lib/format';
import type { AdminEvent, EventStatus } from '@/types/api';

interface EventsManagerPanelProps {
  events: AdminEvent[];
  loading: boolean;
  statusFilter: EventStatus | 'ALL';
  selectedEventId: string | null;
  imageRevision: number;
  onStatusFilterChange: (status: EventStatus | 'ALL') => void;
  onCreateClick: () => void;
  onEditClick: (event: AdminEvent) => void;
  onSelectEvent: (
    eventId: string,
    targetTab?: 'dashboard' | 'inventory' | 'map' | 'checkin',
  ) => void;
  onEventsMutated: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

function EventThumb({
  event,
  imageRevision,
}: {
  event: AdminEvent;
  imageRevision: number;
}) {
  const { src } = useAuthenticatedImageUrl(
    event.coverImageUrl || event.bannerImageUrl,
    imageRevision,
  );
  if (src) {
    return (
      <img
        src={src}
        alt={event.title}
        className="h-14 w-20 shrink-0 rounded-2xl border border-[var(--border-subtle)] object-cover"
      />
    );
  }
  return (
    <div
      className="flex h-14 w-20 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-subtle)] text-xs font-bold text-white/85"
      style={{ background: getEventFallbackGradient(event.slug || event.id) }}
    >
      {event.title.slice(0, 2).toUpperCase()}
    </div>
  );
}

const FILTER_TABS: Array<{ value: EventStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'PUBLISHED', label: 'Publicados' },
  { value: 'DRAFT', label: 'Rascunhos' },
  { value: 'CLOSED', label: 'Encerrados' },
];

export function EventsManagerPanel({
  events,
  loading,
  statusFilter,
  selectedEventId,
  imageRevision,
  onStatusFilterChange,
  onCreateClick,
  onEditClick,
  onSelectEvent,
  onEventsMutated,
  onNotify,
}: EventsManagerPanelProps) {
  const [search, setSearch] = useState('');
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (ev) =>
        ev.title.toLowerCase().includes(q) ||
        ev.slug.toLowerCase().includes(q) ||
        ev.venue.toLowerCase().includes(q) ||
        (ev.city?.toLowerCase().includes(q) ?? false) ||
        (ev.category?.toLowerCase().includes(q) ?? false),
    );
  }, [events, search]);

  async function handleStatusChange(event: AdminEvent, nextStatus: EventStatus) {
    if (event.status === nextStatus) return;
    setBusyEventId(event.id);
    try {
      await adminApi.updateEvent(event.id, { status: nextStatus });
      onNotify(
        'success',
        `Status de "${event.title}" alterado para ${EVENT_STATUS_META[nextStatus].label}.`,
      );
      await onEventsMutated();
    } catch (err) {
      onNotify('error', getAdminErrorMessage(err));
    } finally {
      setBusyEventId(null);
    }
  }

  async function handleDelete(event: AdminEvent) {
    setBusyEventId(event.id);
    try {
      await adminApi.deleteEvent(event.id);
      setConfirmDeleteId(null);
      onNotify('success', `Evento "${event.title}" excluído com sucesso.`);
      await onEventsMutated();
    } catch (err) {
      onNotify('error', getAdminErrorMessage(err));
    } finally {
      setBusyEventId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_TABS.map((tab) => {
            const active = statusFilter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onStatusFilterChange(tab.value)}
                className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[var(--cta-bg)] text-[var(--cta-text)]'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-1 items-center gap-2 sm:max-w-sm sm:justify-end">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar por nome, cidade ou local..."
              className="w-full rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1.5 pr-3.5 pl-8.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={onCreateClick}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo Evento
          </button>
        </div>
      </div>

      {/* Events List */}
      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-24 w-full rounded-3xl" />
          <div className="skeleton h-24 w-full rounded-3xl" />
          <div className="skeleton h-24 w-full rounded-3xl" />
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-6 py-12 text-center">
          <p className="font-display text-base font-bold text-[var(--text-primary)]">
            {events.length === 0
              ? 'Nenhum evento encontrado neste filtro'
              : 'Nenhum evento corresponde à busca'}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Crie um novo evento para configurar setores, mesas, planta interativa e portaria.
          </p>
          <button
            type="button"
            onClick={onCreateClick}
            className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-4 py-2 text-xs font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Criar primeiro evento
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((ev) => {
            const statusMeta = EVENT_STATUS_META[ev.status];
            const displayMeta = DISPLAY_MODE_META[ev.displayMode];
            const isSelected = ev.id === selectedEventId;
            const isBusy = busyEventId === ev.id;
            const isConfirmingDelete = confirmDeleteId === ev.id;

            return (
              <article
                key={ev.id}
                className={`rounded-3xl border bg-[var(--bg-surface)] p-4 transition-colors sm:p-5 ${
                  isSelected
                    ? 'border-[var(--accent-border)] ring-1 ring-[var(--accent-border)]'
                    : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  {/* Left: Thumb + Metadata */}
                  <div className="flex min-w-0 items-start gap-3.5">
                    <EventThumb event={ev} imageRevision={imageRevision} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display truncate text-base font-bold text-[var(--text-primary)]">
                          {ev.title}
                        </h3>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${statusMeta.pillClass}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
                          {statusMeta.label}
                        </span>
                        <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                          {displayMeta.label}
                        </span>
                        {ev.category && (
                          <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                            {ev.category}
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                          {formatEventDateLine(ev.startsAt, ev.endsAt)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                          {ev.venue}
                          {ev.city ? ` · ${ev.city}` : ''}
                        </span>
                        <span className="font-mono-num text-[11px] text-[var(--text-muted)]">
                          /{ev.slug}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Quick status + Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Status dropdown */}
                    <div className="relative">
                      <select
                        aria-label={`Alterar status de ${ev.title}`}
                        disabled={isBusy}
                        value={ev.status}
                        onChange={(e) =>
                          void handleStatusChange(ev, e.target.value as EventStatus)
                        }
                        className="cursor-pointer rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none disabled:opacity-50"
                      >
                        <option value="DRAFT">Rascunho</option>
                        <option value="PUBLISHED">Publicado</option>
                        <option value="CLOSED">Encerrado</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectEvent(ev.id, 'dashboard')}
                      className="cursor-pointer rounded-full bg-[var(--cta-bg)] px-3.5 py-1.5 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
                    >
                      Dashboard
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectEvent(ev.id, 'inventory')}
                      title="Gerenciar setores e mesas"
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Setores
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectEvent(ev.id, 'map')}
                      title="Abrir editor visual de mapa"
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      <MapIcon className="h-3.5 w-3.5" />
                      Mapa
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectEvent(ev.id, 'checkin')}
                      title="Portaria / Check-in"
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      Portaria
                    </button>

                    <button
                      type="button"
                      onClick={() => onEditClick(ev)}
                      disabled={isBusy}
                      title="Editar dados do evento"
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>

                    {ev.status === 'PUBLISHED' && (
                      <Link
                        to={`/eventos/${ev.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Abrir página pública"
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}

                    {isConfirmingDelete ? (
                      <div className="inline-flex items-center gap-1 rounded-full border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-2.5 py-1">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDelete(ev)}
                          className="cursor-pointer text-[11px] font-bold text-[var(--danger)] hover:underline"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            'Confirmar'
                          )}
                        </button>
                        <span className="text-[var(--text-muted)]">·</span>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setConfirmDeleteId(null)}
                          className="cursor-pointer text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          Não
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(ev.id)}
                        disabled={isBusy}
                        title="Excluir evento"
                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors hover:border-[var(--danger)]/40 hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
