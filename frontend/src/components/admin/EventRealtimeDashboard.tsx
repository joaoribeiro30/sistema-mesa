import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarCheck2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Info,
  Landmark,
  Percent,
  QrCode,
  Radio,
  ReceiptText,
  RefreshCw,
  Search,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react';
import {
  formatAdminDateTime,
  formatCivilDatePtBr,
  formatMinorStringCurrency,
  formatShortTime,
  getAdminErrorMessage,
  getCivilDateKeyInTimeZone,
  RESERVATION_STATUS_META,
  SETTLEMENT_OPERATION_META,
  SETTLEMENT_OPERATION_ORDER,
  sumMinorStrings,
} from '@/components/admin/adminUtils';
import { useEventTableStream } from '@/hooks/useEventTableStream';
import { adminApi } from '@/lib/api';
import { formatMinorCurrency } from '@/lib/format';
import type {
  AdminEventDetail,
  AdminEventDashboard,
  SettlementOperation,
  SettlementTotals,
} from '@/types/api';

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
  const [showAllWeeklyDates, setShowAllWeeklyDates] = useState(false);

  // Reset pagination when changing event
  useEffect(() => {
    setOffset(0);
    setSearchQuery('');
    setShowAllWeeklyDates(false);
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
  const settlement = dashboard?.settlement;
  const currency = dashboard?.currency ?? event.currency;

  const totalCapacityTables = totals
    ? totals.available + totals.reserved + totals.sold + totals.disabled
    : 0;
  const occupancyPercent =
    totalCapacityTables > 0 && totals
      ? Math.round(((totals.sold + totals.reserved) / totalCapacityTables) * 100)
      : 0;

  const settlementByOpMap = useMemo(() => {
    const map = new Map<
      SettlementOperation,
      SettlementTotals & { operation: SettlementOperation }
    >();
    if (!settlement) return map;
    for (const item of settlement.byOperation) {
      map.set(item.operation, item);
    }
    return map;
  }, [settlement]);

  const serviceFeeMinor = useMemo(() => {
    if (!settlement) return '0';
    return sumMinorStrings(
      settlement.totals.financialFeeMinor,
      settlement.totals.convenienceFeeMinor,
    );
  }, [settlement]);

  const scheduleInfo = useMemo(() => {
    if (!settlement || !dashboard) {
      return {
        timeZone: 'America/Sao_Paulo',
        upcomingWeekly: [] as string[],
        pastWeeklyCount: 0,
        finalDate: null as string | null,
      };
    }
    const tz = settlement.schedule.timeZone || 'America/Sao_Paulo';
    const todayKey = getCivilDateKeyInTimeZone(dashboard.asOf, tz);
    const upcomingWeekly = todayKey
      ? settlement.schedule.weeklyDates.filter((d) => d >= todayKey)
      : settlement.schedule.weeklyDates;
    const pastWeeklyCount =
      settlement.schedule.weeklyDates.length - upcomingWeekly.length;

    return {
      timeZone: tz,
      upcomingWeekly,
      pastWeeklyCount,
      finalDate: settlement.schedule.finalDate || null,
    };
  }, [settlement, dashboard]);

  const visibleWeeklyDates = showAllWeeklyDates
    ? scheduleInfo.upcomingWeekly
    : scheduleInfo.upcomingWeekly.slice(0, 6);

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

      {/* Settlement & Producer Payout Section */}
      <section className="overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <ReceiptText className="h-4.5 w-4.5" />
            </span>
            <div>
              <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
                Prestação de Contas &amp; Repasse ao Produtor
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Resumo transparente das deduções, taxas por modalidade e calendário de repasses.
              </p>
            </div>
          </div>

          {settlement && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
              <Wallet className="h-3.5 w-3.5 text-[var(--accent)]" />
              <strong className="font-mono-num text-[var(--text-primary)]">
                {settlement.totals.paymentCount}
              </strong>{' '}
              {settlement.totals.paymentCount === 1
                ? 'venda confirmada'
                : 'vendas confirmadas'}
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="skeleton h-28 rounded-2xl" />
              <div className="skeleton h-28 rounded-2xl" />
              <div className="skeleton h-28 rounded-2xl" />
              <div className="skeleton h-28 rounded-2xl" />
            </div>
            <div className="skeleton h-32 w-full rounded-2xl" />
          </div>
        ) : settlement ? (
          <div className="space-y-5 p-5">
            {/* 4-column transparent financial deductions summary */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {/* Gross Sold */}
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/55 p-4">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-secondary)]">
                  <span>Valor Bruto Vendido</span>
                  <DollarSign className="h-3.5 w-3.5 text-sky-500" />
                </div>
                <p className="font-display font-mono-num mt-2 text-2xl font-bold text-[var(--text-primary)]">
                  {formatMinorStringCurrency(settlement.totals.grossMinor, currency)}
                </p>
                <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                  Total de vendas confirmadas ({currency})
                </p>
              </div>

              {/* Service Fee 15% = 5% Mercado Pago + 10% Convenience */}
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/55 p-4">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-secondary)]">
                  <span>Taxa de Serviço (15%)</span>
                  <Landmark className="h-3.5 w-3.5 text-[var(--accent)]" />
                </div>
                <p className="font-display font-mono-num mt-2 text-2xl font-bold text-[var(--text-primary)]">
                  - {formatMinorStringCurrency(serviceFeeMinor, currency)}
                </p>
                <div className="mt-2 space-y-0.5 border-t border-[var(--border-subtle)] pt-1.5 text-[11px] text-[var(--text-muted)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">5% Inst. Financeira (Mercado Pago)</span>
                    <span className="font-mono-num shrink-0 font-medium text-[var(--text-secondary)]">
                      {formatMinorStringCurrency(
                        settlement.totals.financialFeeMinor,
                        currency,
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">10% Taxa de Comodidade</span>
                    <span className="font-mono-num shrink-0 font-medium text-[var(--text-secondary)]">
                      {formatMinorStringCurrency(
                        settlement.totals.convenienceFeeMinor,
                        currency,
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Processing Fees across payment modalities */}
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/55 p-4">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-secondary)]">
                  <span>Taxas de Prestação de Contas</span>
                  <Percent className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <p className="font-display font-mono-num mt-2 text-2xl font-bold text-[var(--text-primary)]">
                  - {formatMinorStringCurrency(settlement.totals.processingFeeMinor, currency)}
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
                  PIX 1,20% · DÉB 1,20% · CRÉD 2,99% · ANTEC 4,99%
                </p>
              </div>

              {/* Producer Net Amount */}
              <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4">
                <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <span>Valor Líquido do Produtor</span>
                  <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="font-display font-mono-num mt-2 text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                  {formatMinorStringCurrency(settlement.totals.netMinor, currency)}
                </p>
                <p className="mt-1.5 text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                  Bruto deduzidas a taxa de serviço (15%) e o processamento
                </p>
              </div>
            </div>

            {/* Unclassified legacy payments notice if applicable */}
            {settlement.unclassifiedPaymentCount > 0 && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Há{' '}
                  <strong className="font-mono-num">
                    {settlement.unclassifiedPaymentCount}
                  </strong>{' '}
                  {settlement.unclassifiedPaymentCount === 1
                    ? 'pagamento legado sem modalidade registrada'
                    : 'pagamentos legados sem modalidade registrada'}{' '}
                  (total bruto de{' '}
                  <strong className="font-mono-num">
                    {formatMinorStringCurrency(
                      settlement.unclassifiedGrossMinor,
                      currency,
                    )}
                  </strong>
                  ). As taxas e o valor líquido exibidos acima consideram apenas as vendas classificadas.
                </span>
              </div>
            )}

            {/* Breakdown by Payment Modality */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
                  Taxas de Prestação de Contas por Modalidade
                </h4>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Tarifas aplicadas sobre o valor bruto de cada operação
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {SETTLEMENT_OPERATION_ORDER.map((op) => {
                  const meta = SETTLEMENT_OPERATION_META[op];
                  const stats = settlementByOpMap.get(op);
                  const count = stats?.paymentCount ?? 0;
                  const gross = stats?.grossMinor ?? '0';
                  const procFee = stats?.processingFeeMinor ?? '0';
                  const net = stats?.netMinor ?? '0';
                  const hasSales = count > 0;

                  return (
                    <div
                      key={op}
                      className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-3.5 transition-opacity ${
                        hasSales ? 'opacity-100' : 'opacity-70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${meta.pillClass}`}
                        >
                          {meta.shortLabel}
                          <span className="font-mono-num">{meta.rateLabel}</span>
                        </span>
                        <span className="font-mono-num text-[11px] text-[var(--text-muted)]">
                          {count} {count === 1 ? 'venda' : 'vendas'}
                        </span>
                      </div>

                      <p className="mt-2 truncate text-xs font-semibold text-[var(--text-primary)]">
                        {meta.label}
                      </p>

                      <dl className="mt-2.5 space-y-1 border-t border-[var(--border-subtle)] pt-2 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-[var(--text-muted)]">Bruto</dt>
                          <dd className="font-mono-num font-medium text-[var(--text-primary)]">
                            {formatMinorStringCurrency(gross, currency)}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-[var(--text-muted)]">
                            Taxa ({meta.rateLabel})
                          </dt>
                          <dd className="font-mono-num font-medium text-[var(--text-secondary)]">
                            - {formatMinorStringCurrency(procFee, currency)}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-[var(--text-muted)]">Líquido</dt>
                          <dd className="font-mono-num font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatMinorStringCurrency(net, currency)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Settlement Schedule: Weekly (Tuesdays & Saturdays) + Final Closing (2nd business day) */}
            <div className="grid gap-3 lg:grid-cols-3">
              {/* Weekly Dates */}
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/45 p-4 lg:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-[var(--accent)]" />
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">
                        Próximas Datas de Prestação de Contas Semanal
                      </h4>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Repasses programados às <strong>Terças e Sábados</strong> ({scheduleInfo.timeZone})
                      </p>
                    </div>
                  </div>

                  {scheduleInfo.upcomingWeekly.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setShowAllWeeklyDates((prev) => !prev)}
                      className="cursor-pointer rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                    >
                      {showAllWeeklyDates
                        ? 'Mostrar menos'
                        : `Ver todas (${scheduleInfo.upcomingWeekly.length})`}
                    </button>
                  )}
                </div>

                {visibleWeeklyDates.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {visibleWeeklyDates.map((dateStr, idx) => {
                      const formatted = formatCivilDatePtBr(dateStr);
                      const isNext = idx === 0;
                      return (
                        <span
                          key={dateStr}
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs ${
                            isNext
                              ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] font-medium text-[var(--text-primary)]'
                          }`}
                        >
                          <span className="text-[10px] font-bold uppercase opacity-80">
                            {formatted.weekday}
                          </span>
                          <span className="font-mono-num">{formatted.fullDate}</span>
                          {isNext && (
                            <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-bold text-white uppercase">
                              Próxima
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-[var(--text-muted)]">
                    {scheduleInfo.pastWeeklyCount > 0
                      ? 'Todas as datas semanais anteriores ao fechamento já foram concluídas. O saldo restante segue para o fechamento final.'
                      : 'Nenhuma data semanal intermediária antes do fechamento final.'}
                  </p>
                )}
              </div>

              {/* Final Closing Date */}
              <div className="flex flex-col justify-between rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-soft)]/50 p-4">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
                    <CalendarCheck2 className="h-4 w-4" />
                  </span>
                  <div>
                    <h4 className="text-xs font-bold text-[var(--text-primary)]">
                      Fechamento Final
                    </h4>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      2º dia útil após o término do evento
                    </p>
                  </div>
                </div>

                {scheduleInfo.finalDate ? (
                  <div className="mt-3 border-t border-[var(--accent-border)]/50 pt-3">
                    {(() => {
                      const finalFmt = formatCivilDatePtBr(scheduleInfo.finalDate);
                      return (
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-display font-mono-num text-xl font-bold text-[var(--text-primary)]">
                            {finalFmt.fullDate}
                          </span>
                          <span className="rounded-full border border-[var(--accent-border)] bg-[var(--bg-surface)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                            {finalFmt.weekday}
                          </span>
                        </div>
                      );
                    })()}
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      Data civil exata em {scheduleInfo.timeZone} (desconsiderando sábados e domingos).
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-[var(--text-muted)]">
                    Data de fechamento indisponível.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-6 py-8 text-center text-xs text-[var(--text-muted)]">
            Dados de prestação de contas indisponíveis no momento.
          </div>
        )}
      </section>

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
                      <td className="px-4 py-3.5">
                        <p className="font-mono-num font-semibold text-[var(--text-primary)]">
                          {formatMinorCurrency(res.amountMinor, currency)}
                        </p>
                        {res.settlement && (
                          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                            <span
                              className={`inline-flex rounded-full border px-1.5 py-0.5 text-[9px] leading-none font-bold uppercase ${
                                SETTLEMENT_OPERATION_META[res.settlement.operation].pillClass
                              }`}
                            >
                              {SETTLEMENT_OPERATION_META[res.settlement.operation].shortLabel}
                            </span>
                            <span className="font-mono-num">
                              Líq. {formatMinorCurrency(res.settlement.netMinor, currency)}
                            </span>
                          </p>
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
