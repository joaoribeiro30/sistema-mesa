import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  QrCode,
  Radio,
  RefreshCw,
  Search,
  Ticket,
  Users,
} from 'lucide-react';
import {
  formatAdminDateTime,
  formatMinorStringCurrency,
  formatShortTime,
  getAdminErrorMessage,
  RESERVATION_STATUS_META,
} from '@/components/admin/adminUtils';
import { useEventTableStream } from '@/hooks/useEventTableStream';
import { adminApi } from '@/lib/api';
import { formatMinorCurrency } from '@/lib/format';
import type { AdminEventDetail, AdminEventDashboard } from '@/types/api';

interface EventRealtimeDashboardProps {
  event: AdminEventDetail;
  refreshSignal: number;
  onOpenCheckIn: () => void;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export function EventRealtimeDashboard({
  event,
  refreshSignal,
  onOpenCheckIn,
}: EventRealtimeDashboardProps) {
  const [dashboard, setDashboard] = useState<AdminEventDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [limit, setLimit] = useState<number>(20);
  const [offset, setOffset] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Reset pagination when changing event
  useEffect(() => {
    setOffset(0);
    setSearchQuery('');
  }, [event.id]);

  const loadDashboard = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await adminApi.getDashboard(event.id, { limit, offset });
        setDashboard(res.dashboard);
      } catch (err) {
        setError(getAdminErrorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [event.id, limit, offset],
  );

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  // Reload when parent signals (e.g. right after a check-in)
  useEffect(() => {
    if (refreshSignal > 0) {
      void loadDashboard(true);
    }
  }, [refreshSignal, loadDashboard]);

  // Connect SSE stream only for PUBLISHED future events (matching API contract)
  const canStream = useMemo(() => {
    if (event.status !== 'PUBLISHED') return false;
    return new Date(event.startsAt).getTime() > Date.now();
  }, [event.status, event.startsAt]);

  const debounceRef = useRef<number | null>(null);
  const scheduleSilentRefresh = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void loadDashboard(true);
    }, 300);
  }, [loadDashboard]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleSnapshot = useCallback(() => {
    // Initial snapshot confirms SSE connection; dashboard is already fetched on mount.
  }, []);

  const handleTableEvent = useCallback(() => {
    scheduleSilentRefresh();
  }, [scheduleSilentRefresh]);

  const { status: streamStatus } = useEventTableStream({
    eventId: canStream ? event.id : null,
    onSnapshot: handleSnapshot,
    onTableEvent: handleTableEvent,
  });

  const filteredReservations = useMemo(() => {
    if (!dashboard) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return dashboard.reservations;
    return dashboard.reservations.filter(
      (r) =>
        r.buyer.name.toLowerCase().includes(q) ||
        r.buyer.email.toLowerCase().includes(q) ||
        r.table.label.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
    );
  }, [dashboard, searchQuery]);

  const totalReservations = dashboard?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalReservations / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const rangeStart = totalReservations === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + limit, totalReservations);

  const totals = dashboard?.totals;
  const totalCapacityTables = totals
    ? totals.available + totals.reserved + totals.sold + totals.disabled
    : 0;
  const occupancyPercent =
    totalCapacityTables > 0 && totals
      ? Math.round(((totals.sold + totals.reserved) / totalCapacityTables) * 100)
      : 0;

  return (
    <div className="space-y-5">
      {/* Live Status & Action Bar */}
      <div className="flex flex-col gap-3 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {canStream ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${
                streamStatus === 'live'
                  ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                  : 'border-amber-500/35 bg-amber-500/12 text-amber-600 dark:text-amber-400'
              }`}
            >
              <Radio
                className={`h-3 w-3 ${streamStatus === 'live' ? 'animate-pulse' : ''}`}
              />
              {streamStatus === 'live'
                ? 'Tempo real ativo (SSE)'
                : streamStatus === 'reconnecting'
                  ? 'Reconectando stream...'
                  : 'Conectando tempo real...'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
              Atualização manual ({event.status === 'PUBLISHED' ? 'evento iniciado' : event.status})
            </span>
          )}

          {dashboard && (
            <span className="text-xs text-[var(--text-muted)]">
              Atualizado às {formatShortTime(dashboard.asOf)} · Ocupação{' '}
              <strong className="font-mono-num text-[var(--text-primary)]">
                {occupancyPercent}%
              </strong>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={refreshing || loading}
            onClick={() => void loadDashboard(true)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            />
            Atualizar
          </button>

          <button
            type="button"
            onClick={onOpenCheckIn}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            <QrCode className="h-3.5 w-3.5" />
            Abrir Portaria / Check-in
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-3xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-4 text-xs text-[var(--danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 4 Primary KPI Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
            <span>Mesas Disponíveis</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          {loading ? (
            <div className="skeleton mt-3 h-9 w-20 rounded-xl" />
          ) : (
            <>
              <p className="font-display font-mono-num mt-2 text-3xl font-bold text-[var(--text-primary)]">
                {totals?.available ?? 0}
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                {totals?.disabled
                  ? `+ ${totals.disabled} desabilitada${totals.disabled === 1 ? '' : 's'}`
                  : 'Livres para reserva imediata'}
              </p>
            </>
          )}
        </div>

        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
            <span>Reservadas (Pagto Pendente)</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-500">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          {loading ? (
            <div className="skeleton mt-3 h-9 w-20 rounded-xl" />
          ) : (
            <>
              <p className="font-display font-mono-num mt-2 text-3xl font-bold text-[var(--text-primary)]">
                {totals?.reserved ?? 0}
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Bloqueios ativos em PENDING_PAYMENT
              </p>
            </>
          )}
        </div>

        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
            <span>Mesas Vendidas</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <Ticket className="h-4 w-4" />
            </span>
          </div>
          {loading ? (
            <div className="skeleton mt-3 h-9 w-20 rounded-xl" />
          ) : (
            <>
              <p className="font-display font-mono-num mt-2 text-3xl font-bold text-[var(--text-primary)]">
                {totals?.sold ?? 0}
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Check-ins na portaria:{' '}
                <strong className="font-mono-num text-[var(--text-primary)]">
                  {totals?.checkedIn ?? 0}/{totals?.sold ?? 0}
                </strong>
              </p>
            </>
          )}
        </div>

        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
            <span>Faturamento Confirmado</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-500">
              <DollarSign className="h-4 w-4" />
            </span>
          </div>
          {loading ? (
            <div className="skeleton mt-3 h-9 w-32 rounded-xl" />
          ) : (
            <>
              <p className="font-display font-mono-num mt-2 truncate text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">
                {formatMinorStringCurrency(
                  totals?.confirmedRevenueMinor ?? '0',
                  dashboard?.currency ?? event.currency,
                )}
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Pagamentos confirmados ({dashboard?.currency ?? event.currency})
              </p>
            </>
          )}
        </div>
      </div>

      {/* Paginated Buyers / Reservations Table */}
      <section className="overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
              Compradores e Reservas
            </h3>
            <p className="text-xs text-[var(--text-muted)]">
              {totalReservations}{' '}
              {totalReservations === 1
                ? 'registro no histórico deste evento'
                : 'registros no histórico deste evento'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar comprador ou mesa..."
                className="w-56 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1.5 pr-3 pl-8.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </div>

            <select
              aria-label="Itens por página"
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setOffset(0);
              }}
              className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] focus:outline-none"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} por página
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">
            <div className="skeleton h-12 w-full rounded-2xl" />
            <div className="skeleton h-12 w-full rounded-2xl" />
            <div className="skeleton h-12 w-full rounded-2xl" />
          </div>
        ) : filteredReservations.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">
            {totalReservations === 0
              ? 'Nenhuma reserva registrada para este evento ainda.'
              : 'Nenhuma reserva nesta página corresponde ao filtro digitado.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/55 text-[11px] font-semibold text-[var(--text-secondary)]">
                  <th className="px-5 py-3">Comprador</th>
                  <th className="px-4 py-3">Mesa</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Valor</th>
                  <th className="px-4 py-3">Check-in</th>
                  <th className="px-5 py-3 text-right">Criada em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filteredReservations.map((res) => {
                  const statusMeta = RESERVATION_STATUS_META[res.status];
                  return (
                    <tr
                      key={res.id}
                      className="transition-colors hover:bg-[var(--bg-elevated)]/40"
                    >
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-[var(--text-primary)]">
                          {res.buyer.name}
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {res.buyer.email}
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-display font-bold text-[var(--text-primary)]">
                          Mesa {res.table.label}
                        </span>
                        <p className="mt-0.5 inline-flex items-center gap-1 pl-2 text-[11px] text-[var(--text-muted)]">
                          <Users className="h-3 w-3" />
                          {res.guestCount}
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${statusMeta.pillClass}`}
                        >
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="font-mono-num px-4 py-3.5 font-semibold text-[var(--text-primary)]">
                        {formatMinorCurrency(
                          res.amountMinor,
                          dashboard?.currency ?? event.currency,
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {res.checkedInAt ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            {formatShortTime(res.checkedInAt)}
                          </span>
                        ) : res.status === 'CONFIRMED' ? (
                          <span className="text-[11px] text-[var(--text-muted)]">
                            Aguardando entrada
                          </span>
                        ) : (
                          <span className="text-[11px] text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right text-[11px] text-[var(--text-secondary)]">
                        {formatAdminDateTime(res.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalReservations > 0 && (
          <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/35 px-5 py-3 text-xs text-[var(--text-secondary)] sm:flex-row sm:items-center sm:justify-between">
            <span>
              Mostrando{' '}
              <strong className="font-mono-num text-[var(--text-primary)]">
                {rangeStart}–{rangeEnd}
              </strong>{' '}
              de{' '}
              <strong className="font-mono-num text-[var(--text-primary)]">
                {totalReservations}
              </strong>{' '}
              reservas
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset <= 0 || loading}
                onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </button>
              <span className="font-mono-num text-[11px] font-semibold">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={offset + limit >= totalReservations || loading}
                onClick={() => setOffset((prev) => prev + limit)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Próxima
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
