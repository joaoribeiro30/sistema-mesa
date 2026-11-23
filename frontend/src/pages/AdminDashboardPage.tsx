import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  BarChart3,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Layers,
  Loader2,
  Map as MapIcon,
  Pencil,
  Plus,
  QrCode,
  Shield,
  Ticket,
  X,
} from 'lucide-react';
import {
  EVENT_STATUS_META,
  getAdminErrorMessage,
} from '@/components/admin/adminUtils';
import { CheckInScannerPanel } from '@/components/admin/CheckInScannerPanel';
import { EventFormModal } from '@/components/admin/EventFormModal';
import { EventRealtimeDashboard } from '@/components/admin/EventRealtimeDashboard';
import { EventsManagerPanel } from '@/components/admin/EventsManagerPanel';
import { SectorsTablesManager } from '@/components/admin/SectorsTablesManager';
import { VisualMapEditor } from '@/components/admin/VisualMapEditor';
import { adminApi } from '@/lib/api';
import { formatEventDateLine } from '@/lib/format';
import type {
  AdminEvent,
  AdminEventDetail,
  AdminOverview,
  EventStatus,
} from '@/types/api';

type AdminTab = 'events' | 'dashboard' | 'inventory' | 'map' | 'checkin';

const VALID_TABS: AdminTab[] = [
  'events',
  'dashboard',
  'inventory',
  'map',
  'checkin',
];

function parseTab(raw: string | null): AdminTab {
  if (raw && VALID_TABS.includes(raw as AdminTab)) {
    return raw as AdminTab;
  }
  return 'events';
}

export function AdminDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<AdminTab>(() =>
    parseTab(searchParams.get('tab')),
  );
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    () => searchParams.get('event') || null,
  );

  // Global overview & events list
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [allEvents, setAllEvents] = useState<AdminEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<AdminEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'ALL'>('ALL');
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Selected event full detail (with sectors & tables)
  const [selectedEventDetail, setSelectedEventDetail] =
    useState<AdminEventDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Event create/edit modal state
  const [eventModal, setEventModal] = useState<
    | { open: true; mode: 'create'; event: null }
    | { open: true; mode: 'edit'; event: AdminEvent }
    | null
  >(null);

  // Signals & revision counters
  const [imageRevision, setImageRevision] = useState(0);
  const [dashboardRefreshSignal, setDashboardRefreshSignal] = useState(0);
  const [changingActiveStatus, setChangingActiveStatus] = useState(false);

  // Toast notification
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Sync URL query params with tab + selected event
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeTab !== 'events') {
      next.set('tab', activeTab);
    }
    if (selectedEventId) {
      next.set('event', selectedEventId);
    }
    setSearchParams(next, { replace: true });
  }, [activeTab, selectedEventId, setSearchParams]);

  // Load overview + events list (supports backend status filtering)
  const loadOverviewAndEvents = useCallback(
    async (filter: EventStatus | 'ALL' = statusFilter) => {
      setLoadingEvents(true);
      setGlobalError(null);
      try {
        const [ov, allRes, filteredRes] = await Promise.all([
          adminApi.overview(),
          adminApi.listEvents({ limit: 100, offset: 0 }),
          filter === 'ALL'
            ? Promise.resolve(null)
            : adminApi.listEvents({ status: filter, limit: 100, offset: 0 }),
        ]);

        setOverview(ov);
        setAllEvents(allRes.events);
        setFilteredEvents(filteredRes ? filteredRes.events : allRes.events);

        setSelectedEventId((prev) => {
          if (prev && allRes.events.some((ev) => ev.id === prev)) {
            return prev;
          }
          return allRes.events[0]?.id ?? null;
        });
      } catch (err) {
        setGlobalError(getAdminErrorMessage(err));
      } finally {
        setLoadingEvents(false);
      }
    },
    [statusFilter],
  );

  useEffect(() => {
    void loadOverviewAndEvents(statusFilter);
  }, [loadOverviewAndEvents, statusFilter]);

  // Load selected event details (sectors + tables)
  const loadSelectedEventDetail = useCallback(
    async (eventId: string | null = selectedEventId) => {
      if (!eventId) {
        setSelectedEventDetail(null);
        return;
      }
      setLoadingDetail(true);
      try {
        const res = await adminApi.getEvent(eventId);
        setSelectedEventDetail(res.event);
      } catch (err) {
        notify('error', getAdminErrorMessage(err));
      } finally {
        setLoadingDetail(false);
      }
    },
    [selectedEventId, notify],
  );

  useEffect(() => {
    void loadSelectedEventDetail(selectedEventId);
  }, [selectedEventId, loadSelectedEventDetail]);

  const handleRefreshSelectedEvent = useCallback(
    async (bumpImageRevision = false) => {
      if (bumpImageRevision) {
        setImageRevision((prev) => prev + 1);
      }
      await Promise.all([
        loadSelectedEventDetail(selectedEventId),
        loadOverviewAndEvents(statusFilter),
      ]);
    },
    [loadSelectedEventDetail, loadOverviewAndEvents, selectedEventId, statusFilter],
  );

  const handleSelectEvent = useCallback(
    (
      eventId: string,
      targetTab?: 'dashboard' | 'inventory' | 'map' | 'checkin',
    ) => {
      setSelectedEventId(eventId);
      if (targetTab) {
        setActiveTab(targetTab);
      }
    },
    [],
  );

  async function handleQuickStatusChange(nextStatus: EventStatus) {
    if (!selectedEventDetail || selectedEventDetail.status === nextStatus) return;
    setChangingActiveStatus(true);
    try {
      await adminApi.updateEvent(selectedEventDetail.id, { status: nextStatus });
      notify(
        'success',
        `Evento "${selectedEventDetail.title}" atualizado para ${EVENT_STATUS_META[nextStatus].label}.`,
      );
      await handleRefreshSelectedEvent(false);
    } catch (err) {
      notify('error', getAdminErrorMessage(err));
    } finally {
      setChangingActiveStatus(false);
    }
  }

  const tabs: Array<{
    id: AdminTab;
    label: string;
    icon: typeof Calendar;
  }> = [
    { id: 'events', label: 'Eventos', icon: Calendar },
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'inventory', label: 'Setores e Mesas', icon: Layers },
    { id: 'map', label: 'Editor de Mapa', icon: MapIcon },
    { id: 'checkin', label: 'Portaria / Check-in', icon: QrCode },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-6 lg:px-8">
      {/* Top Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.18em] text-[var(--accent)] uppercase">
            <Shield className="h-3.5 w-3.5" />
            Administração · Sistema Mesa
          </p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            Painel Administrativo
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Compact Overview KPIs */}
          <div className="inline-flex items-center gap-3 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Calendar className="h-3.5 w-3.5 text-[var(--accent)]" />
              <strong className="font-mono-num text-[var(--text-primary)]">
                {overview?.events ?? allEvents.length}
              </strong>{' '}
              eventos
            </span>
            <span className="h-3.5 w-px bg-[var(--border-subtle)]" />
            <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Ticket className="h-3.5 w-3.5 text-[var(--success)]" />
              <strong className="font-mono-num text-[var(--text-primary)]">
                {overview?.reservations ?? 0}
              </strong>{' '}
              reservas
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              setEventModal({ open: true, mode: 'create', event: null })
            }
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-4 py-2 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo Evento
          </button>

          <Link
            to="/"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Catálogo
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Toast Banner */}
      {toast && (
        <div
          role="status"
          className={`animate-fade-in flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs font-medium ${
            toast.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700'
              : 'border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]'
          }`}
        >
          <span className="inline-flex items-center gap-2">
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {toast.message}
          </span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Fechar aviso"
            className="cursor-pointer rounded-full p-1 opacity-75 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {globalError && (
        <div className="flex items-start gap-3 rounded-3xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-4 text-xs text-[var(--danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{globalError}</span>
        </div>
      )}

      {/* Primary Workspace Tabs */}
      <nav
        aria-label="Seções do painel administrativo"
        className="no-scrollbar flex items-center gap-1.5 overflow-x-auto rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1.5"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                active
                  ? 'bg-[var(--cta-bg)] text-[var(--cta-text)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Active Event Context Bar (for event-scoped tabs) */}
      {activeTab !== 'events' && (
        <div className="flex flex-col gap-3 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
              <span>Evento ativo:</span>
              <select
                value={selectedEventId ?? ''}
                onChange={(e) => setSelectedEventId(e.target.value || null)}
                disabled={allEvents.length === 0}
                className="max-w-[280px] cursor-pointer rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3.5 py-1.5 text-xs font-bold text-[var(--text-primary)] focus:outline-none sm:max-w-sm"
              >
                {allEvents.length === 0 ? (
                  <option value="">Nenhum evento cadastrado</option>
                ) : (
                  allEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title} ({EVENT_STATUS_META[ev.status].label})
                    </option>
                  ))
                )}
              </select>
            </label>

            {selectedEventDetail && (
              <span className="text-xs text-[var(--text-muted)]">
                {formatEventDateLine(selectedEventDetail.startsAt)} ·{' '}
                {selectedEventDetail.venue}
              </span>
            )}
          </div>

          {selectedEventDetail && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                  EVENT_STATUS_META[selectedEventDetail.status].pillClass
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    EVENT_STATUS_META[selectedEventDetail.status].dotClass
                  }`}
                />
                {EVENT_STATUS_META[selectedEventDetail.status].label}
              </span>

              <select
                aria-label="Mudar status do evento ativo"
                disabled={changingActiveStatus}
                value={selectedEventDetail.status}
                onChange={(e) =>
                  void handleQuickStatusChange(e.target.value as EventStatus)
                }
                className="cursor-pointer rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] focus:outline-none disabled:opacity-50"
              >
                <option value="DRAFT">Rascunho</option>
                <option value="PUBLISHED">Publicado</option>
                <option value="CLOSED">Encerrado</option>
              </select>

              <button
                type="button"
                onClick={() =>
                  setEventModal({
                    open: true,
                    mode: 'edit',
                    event: selectedEventDetail,
                  })
                }
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Pencil className="h-3 w-3" />
                Editar
              </button>

              {selectedEventDetail.status === 'PUBLISHED' && (
                <Link
                  to={`/eventos/${selectedEventDetail.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]"
                >
                  Ver página
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* Active Tab Content */}
      {activeTab === 'events' && (
        <EventsManagerPanel
          events={filteredEvents}
          loading={loadingEvents}
          statusFilter={statusFilter}
          selectedEventId={selectedEventId}
          imageRevision={imageRevision}
          onStatusFilterChange={setStatusFilter}
          onCreateClick={() =>
            setEventModal({ open: true, mode: 'create', event: null })
          }
          onEditClick={(ev) =>
            setEventModal({ open: true, mode: 'edit', event: ev })
          }
          onSelectEvent={handleSelectEvent}
          onEventsMutated={() => handleRefreshSelectedEvent(false)}
          onNotify={notify}
        />
      )}

      {activeTab !== 'events' && !selectedEventId && !loadingEvents && (
        <div className="rounded-3xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-6 py-14 text-center">
          <Calendar className="mx-auto h-9 w-9 text-[var(--text-muted)]" />
          <h2 className="font-display mt-3 text-base font-bold text-[var(--text-primary)]">
            Nenhum evento selecionado
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Crie seu primeiro evento para acessar o dashboard, setores, editor de mapa e portaria.
          </p>
          <button
            type="button"
            onClick={() =>
              setEventModal({ open: true, mode: 'create', event: null })
            }
            className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Criar Evento
          </button>
        </div>
      )}

      {activeTab !== 'events' && selectedEventId && loadingDetail && !selectedEventDetail && (
        <div className="flex min-h-[260px] items-center justify-center rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2.5 text-sm text-[var(--text-secondary)]">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
            Carregando detalhes do evento...
          </div>
        </div>
      )}

      {activeTab === 'dashboard' && selectedEventDetail && (
        <EventRealtimeDashboard
          event={selectedEventDetail}
          refreshSignal={dashboardRefreshSignal}
          onOpenCheckIn={() => setActiveTab('checkin')}
        />
      )}

      {activeTab === 'inventory' && selectedEventDetail && (
        <SectorsTablesManager
          event={selectedEventDetail}
          onRefreshEvent={() => handleRefreshSelectedEvent(false)}
          onOpenMapEditor={() => setActiveTab('map')}
          onNotify={notify}
        />
      )}

      {activeTab === 'map' && selectedEventDetail && (
        <VisualMapEditor
          event={selectedEventDetail}
          imageRevision={imageRevision}
          onRefreshEvent={(bump) => handleRefreshSelectedEvent(bump)}
          onGoToInventory={() => setActiveTab('inventory')}
          onNotify={notify}
        />
      )}

      {activeTab === 'checkin' && (
        <CheckInScannerPanel
          event={selectedEventDetail}
          onCheckInSuccess={() => {
            setDashboardRefreshSignal((prev) => prev + 1);
            void loadOverviewAndEvents(statusFilter);
          }}
        />
      )}

      {/* Event Create / Edit Modal */}
      {eventModal?.open && (
        <EventFormModal
          mode={eventModal.mode}
          initialEvent={eventModal.event}
          imageRevision={imageRevision}
          onClose={() => setEventModal(null)}
          onSaved={async (savedEvent, uploadedImages) => {
            const wasCreate = eventModal.mode === 'create';
            setEventModal(null);
            if (uploadedImages) {
              setImageRevision((prev) => prev + 1);
            }
            setSelectedEventId(savedEvent.id);
            notify(
              'success',
              wasCreate
                ? `Evento "${savedEvent.title}" criado com sucesso.`
                : `Evento "${savedEvent.title}" atualizado com sucesso.`,
            );
            await Promise.all([
              loadOverviewAndEvents(statusFilter),
              loadSelectedEventDetail(savedEvent.id),
            ]);
          }}
        />
      )}
    </div>
  );
}
