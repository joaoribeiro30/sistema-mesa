import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUpRight,
  Ban,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Hourglass,
  Loader2,
  MapPin,
  QrCode,
  RefreshCw,
  Shield,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import { CheckoutDrawer } from '@/components/checkout/CheckoutDrawer';
import { TicketModal } from '@/components/checkout/TicketModal';
import { useAuth } from '@/contexts/AuthContext';
import { computeCountdown, useServerNow } from '@/hooks/useCountdown';
import { getFriendlyErrorMessage, reservationsApi } from '@/lib/api';
import { clearCheckoutSession } from '@/lib/checkoutSession';
import { formatEventDateLine, formatMinorCurrency } from '@/lib/format';
import type { ReservationItem, ReservationStatus } from '@/types/api';

const PAGE_SIZE = 50;

const STATUS_META: Record<
  ReservationStatus,
  { label: string; badgeClass: string }
> = {
  PENDING_PAYMENT: {
    label: 'Aguardando pagamento',
    badgeClass: 'border-[var(--warning)]/35 bg-[var(--warning)]/12 text-[var(--warning)]',
  },
  CONFIRMED: {
    label: 'Confirmada',
    badgeClass: 'border-[var(--success)]/35 bg-[var(--success)]/12 text-[var(--success)]',
  },
  EXPIRED: {
    label: 'Expirada',
    badgeClass: 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]',
  },
  CANCELLED: {
    label: 'Cancelada',
    badgeClass: 'border-[var(--danger)]/35 bg-[var(--danger)]/10 text-[var(--danger)]',
  },
};

type GroupId = 'pending' | 'confirmed' | 'closed';
type FilterId = 'all' | GroupId;

const GROUPS: Array<{
  id: GroupId;
  title: string;
  description: string;
  icon: typeof Clock;
  iconClass: string;
}> = [
  {
    id: 'pending',
    title: 'Aguardando pagamento',
    description: 'Conclua o pagamento antes do fim do cronômetro para garantir a mesa.',
    icon: Hourglass,
    iconClass: 'text-[var(--warning)]',
  },
  {
    id: 'confirmed',
    title: 'Confirmadas',
    description: 'Ingressos digitais prontos para apresentar na portaria.',
    icon: CheckCircle2,
    iconClass: 'text-[var(--success)]',
  },
  {
    id: 'closed',
    title: 'Expiradas e canceladas',
    description: 'Reservas encerradas sem pagamento confirmado.',
    icon: Ban,
    iconClass: 'text-[var(--text-muted)]',
  },
];

/** PENDING reservations past their deadline are shown as EXPIRED. */
function effectiveStatus(item: ReservationItem, nowMs: number): ReservationStatus {
  if (item.status === 'PENDING_PAYMENT') {
    if (!item.expiresAt) return item.status;
    return computeCountdown(item.expiresAt, nowMs).expired ? 'EXPIRED' : item.status;
  }
  return item.status;
}

function groupOf(status: ReservationStatus): GroupId {
  if (status === 'PENDING_PAYMENT') return 'pending';
  if (status === 'CONFIRMED') return 'confirmed';
  return 'closed';
}

export function MyReservationsPage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [loading, setLoading] = useState(!isAdmin);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>('all');

  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const hasActivePending = reservations.some((r) => r.status === 'PENDING_PAYMENT');
  const nowMs = useServerNow(hasActivePending);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (isAdmin) return;
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const { reservations: items } = await reservationsApi.listMine({
          limit: PAGE_SIZE,
          offset: 0,
        });
        setReservations(items);
        setHasMore(items.length === PAGE_SIZE);
      } catch (err) {
        if (mode === 'initial') setError(getFriendlyErrorMessage(err));
        else setActionError(getFriendlyErrorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isAdmin],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  // Refresh when the tab regains focus (e.g. after paying Pix on the phone).
  useEffect(() => {
    if (isAdmin) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !checkoutId) void load('refresh');
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [checkoutId, isAdmin, load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const { reservations: items } = await reservationsApi.listMine({
        limit: PAGE_SIZE,
        offset: reservations.length,
      });
      setReservations((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...items.filter((r) => !seen.has(r.id))];
      });
      setHasMore(items.length === PAGE_SIZE);
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleCancel(reservationId: string) {
    setCancellingId(reservationId);
    setActionError(null);
    try {
      await reservationsApi.cancel(reservationId);
      clearCheckoutSession(reservationId);
      setReservations((prev) =>
        prev.map((r) => (r.id === reservationId ? { ...r, status: 'CANCELLED' } : r)),
      );
      setNotice('Reserva cancelada. A mesa foi liberada para outros clientes.');
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err));
      void load('refresh');
    } finally {
      setCancellingId(null);
      setConfirmCancelId(null);
    }
  }

  const handlePaid = useCallback(
    (reservationId: string) => {
      setReservations((prev) =>
        prev.map((r) => (r.id === reservationId ? { ...r, status: 'CONFIRMED' } : r)),
      );
      setNotice('Pagamento confirmado! Seu ingresso está disponível em "Confirmadas".');
      void load('refresh');
    },
    [load],
  );

  const grouped = useMemo(() => {
    const result: Record<GroupId, ReservationItem[]> = { pending: [], confirmed: [], closed: [] };
    for (const item of reservations) {
      result[groupOf(effectiveStatus(item, nowMs))].push(item);
    }
    // Pending: most urgent first. Confirmed: next events first.
    result.pending.sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''));
    result.confirmed.sort((a, b) =>
      (a.event?.startsAt ?? '').localeCompare(b.event?.startsAt ?? ''),
    );
    return result;
  }, [nowMs, reservations]);

  const checkoutReservation = checkoutId
    ? reservations.find((r) => r.id === checkoutId) ?? null
    : null;

  const visibleGroups = GROUPS.filter(
    (g) => (filter === 'all' || filter === g.id) && grouped[g.id].length > 0,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-[var(--accent)] uppercase">
            Área do cliente
          </p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            Minhas Reservas
          </h1>
          {user && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Conectado como <strong className="text-[var(--text-primary)]">{user.email}</strong>
            </p>
          )}
        </div>
        {!isAdmin && !loading && !error && (
          <button
            type="button"
            onClick={() => void load('refresh')}
            disabled={refreshing}
            className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-60 sm:self-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        )}
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-xs font-medium text-emerald-600 dark:text-emerald-400"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {notice}
          </span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dispensar aviso"
            className="cursor-pointer rounded-full p-1 hover:bg-emerald-500/15"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-4 py-3 text-xs text-[var(--danger)]"
        >
          <span className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {actionError}
          </span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Fechar erro"
            className="cursor-pointer rounded-full p-1 hover:bg-[var(--danger)]/15"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {isAdmin ? (
        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Shield className="h-6 w-6" />
          </div>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">
            Você está autenticado como ADMIN
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-[var(--text-secondary)]">
            As rotas de reservas pessoais são exclusivas para contas de clientes (`CUSTOMER`). Utilize o Painel Admin para gerenciar eventos, mesas e vendas.
          </p>
          <Link
            to="/admin"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-2.5 text-xs font-semibold text-[var(--cta-text)]"
          >
            Ir para o Painel Admin
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="skeleton h-48 rounded-3xl" />
          <div className="skeleton h-48 rounded-3xl" />
          <div className="skeleton h-48 rounded-3xl" />
          <div className="skeleton h-48 rounded-3xl" />
        </div>
      ) : error ? (
        <div className="flex items-start justify-between gap-3 rounded-3xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-5 text-xs text-[var(--danger)]">
          <span className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </span>
          <button
            type="button"
            onClick={() => void load('initial')}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--danger)]/35 px-3 py-1 font-semibold hover:bg-[var(--danger)]/15"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Tentar novamente
          </button>
        </div>
      ) : reservations.length === 0 ? (
        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
            <Ticket className="h-6 w-6" />
          </div>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">
            Você ainda não possui reservas
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--text-secondary)]">
            Explore os eventos publicados e escolha sua mesa para acompanhar pagamentos e QR Codes por aqui.
          </p>
          <Link
            to="/"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-2.5 text-xs font-semibold text-[var(--cta-text)]"
          >
            Explorar eventos
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div
            role="tablist"
            aria-label="Filtrar reservas por status"
            className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1"
          >
            {(
              [
                { id: 'all', label: 'Todas', count: reservations.length },
                { id: 'pending', label: 'Pendentes', count: grouped.pending.length },
                { id: 'confirmed', label: 'Confirmadas', count: grouped.confirmed.length },
                { id: 'closed', label: 'Encerradas', count: grouped.closed.length },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                onClick={() => setFilter(tab.id)}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
                  filter === tab.id
                    ? 'border-transparent bg-[var(--cta-bg)] text-[var(--cta-text)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
                <span
                  className={`font-mono-num rounded-full px-1.5 text-[10px] ${
                    filter === tab.id ? 'bg-black/15 dark:bg-black/10' : 'bg-[var(--bg-elevated)]'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {visibleGroups.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[var(--border-strong)] px-6 py-12 text-center text-xs text-[var(--text-secondary)]">
              Nenhuma reserva neste status.
            </div>
          ) : (
            <div className="space-y-8">
              {visibleGroups.map((group) => {
                const Icon = group.icon;
                return (
                  <section key={group.id} aria-labelledby={`group-${group.id}`}>
                    <div className="mb-3 flex items-end justify-between gap-3">
                      <div>
                        <h2
                          id={`group-${group.id}`}
                          className="font-display flex items-center gap-2 text-lg font-bold text-[var(--text-primary)]"
                        >
                          <Icon className={`h-5 w-5 ${group.iconClass}`} />
                          {group.title}
                          <span className="font-mono-num text-sm font-medium text-[var(--text-muted)]">
                            ({grouped[group.id].length})
                          </span>
                        </h2>
                        <p className="mt-0.5 text-xs text-[var(--text-muted)]">{group.description}</p>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {grouped[group.id].map((item) => (
                        <ReservationCard
                          key={item.id}
                          item={item}
                          nowMs={nowMs}
                          confirmingCancel={confirmCancelId === item.id}
                          cancelling={cancellingId === item.id}
                          onPay={() => {
                            setActionError(null);
                            setCheckoutId(item.id);
                          }}
                          onAskCancel={() => setConfirmCancelId(item.id)}
                          onAbortCancel={() => setConfirmCancelId(null)}
                          onConfirmCancel={() => void handleCancel(item.id)}
                          onViewTicket={() => setTicketId(item.id)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {hasMore && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-5 py-2.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-60"
              >
                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Carregar mais reservas
              </button>
            </div>
          )}
        </>
      )}

      {checkoutReservation && (
        <CheckoutDrawer
          key={checkoutReservation.id}
          reservation={checkoutReservation}
          context={{
            eventTitle: checkoutReservation.event?.title ?? 'Reserva de mesa',
            eventSlug: checkoutReservation.event?.slug,
            startsAt: checkoutReservation.event?.startsAt,
            venue: checkoutReservation.event?.venue,
            city: checkoutReservation.event?.city,
            tableLabel: checkoutReservation.table?.label ?? checkoutReservation.tableId.slice(0, 6),
            sectorName: checkoutReservation.table?.sector?.name,
          }}
          onClose={() => setCheckoutId(null)}
          onPaid={handlePaid}
          onExpired={() => void load('refresh')}
          onBackToEvent={() => {
            const slug = checkoutReservation.event?.slug;
            setCheckoutId(null);
            if (slug) navigate(`/eventos/${encodeURIComponent(slug)}`);
            else void load('refresh');
          }}
          onViewTicket={(id) => {
            setCheckoutId(null);
            setTicketId(id);
          }}
        />
      )}

      {ticketId && <TicketModal reservationId={ticketId} onClose={() => setTicketId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reservation card
// ---------------------------------------------------------------------------

interface ReservationCardProps {
  item: ReservationItem;
  nowMs: number;
  confirmingCancel: boolean;
  cancelling: boolean;
  onPay: () => void;
  onAskCancel: () => void;
  onAbortCancel: () => void;
  onConfirmCancel: () => void;
  onViewTicket: () => void;
}

function ReservationCard({
  item,
  nowMs,
  confirmingCancel,
  cancelling,
  onPay,
  onAskCancel,
  onAbortCancel,
  onConfirmCancel,
  onViewTicket,
}: ReservationCardProps) {
  const status = effectiveStatus(item, nowMs);
  const meta = STATUS_META[status];
  const pending = status === 'PENDING_PAYMENT';
  const countdown = computeCountdown(item.expiresAt, nowMs);
  const urgent = pending && countdown.remainingMs <= 2 * 60 * 1000;
  const closed = status === 'EXPIRED' || status === 'CANCELLED';
  const eventPast = item.event?.startsAt ? Date.parse(item.event.startsAt) < nowMs : false;

  return (
    <article
      className={`flex flex-col rounded-3xl border bg-[var(--bg-surface)] p-5 transition-colors ${
        pending
          ? urgent
            ? 'border-[var(--danger)]/40'
            : 'border-[var(--warning)]/35'
          : 'border-[var(--border-subtle)]'
      } ${closed ? 'opacity-75' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${meta.badgeClass}`}>
          {meta.label}
        </span>
        <span className="font-mono-num text-sm font-bold text-[var(--text-primary)]">
          {formatMinorCurrency(item.amountMinor, item.currency)}
        </span>
      </div>

      <div className="mt-3">
        {item.event ? (
          <Link
            to={`/eventos/${encodeURIComponent(item.event.slug)}`}
            className="font-display line-clamp-2 text-base font-bold text-[var(--text-primary)] hover:text-[var(--accent)]"
          >
            {item.event.title}
          </Link>
        ) : (
          <p className="font-display text-base font-bold text-[var(--text-primary)]">Reserva de mesa</p>
        )}
      </div>

      <dl className="mt-2.5 space-y-1.5 text-xs text-[var(--text-secondary)]">
        {item.event?.startsAt && (
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
            <dd>
              {formatEventDateLine(item.event.startsAt)}
              {eventPast && status === 'CONFIRMED' && (
                <span className="ml-1.5 text-[var(--text-muted)]">· realizado</span>
              )}
            </dd>
          </div>
        )}
        {item.event?.venue && (
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
            <dd className="truncate">
              {item.event.venue}
              {item.event.city ? ` · ${item.event.city}` : ''}
            </dd>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="inline-flex items-center gap-1.5">
            <QrCode className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <dd>
              {item.table?.sector?.name ? `${item.table.sector.name} · ` : ''}
              Mesa <strong className="text-[var(--text-primary)]">{item.table?.label ?? '—'}</strong>
            </dd>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <dd>
              {item.guestCount} {item.guestCount === 1 ? 'pessoa' : 'pessoas'}
            </dd>
          </div>
        </div>
        <p className="font-mono-num text-[11px] text-[var(--text-muted)]">Reserva #{item.id.slice(0, 8)}</p>
      </dl>

      {pending && countdown.label && (
        <div
          className={`mt-4 rounded-2xl px-3.5 py-2.5 ${
            urgent ? 'bg-[var(--danger)]/10' : 'bg-amber-500/10'
          }`}
          role="timer"
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                urgent ? 'text-[var(--danger)]' : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              Expira em
            </span>
            <span
              className={`font-mono-num text-sm font-bold tabular-nums ${
                urgent ? 'text-[var(--danger)]' : 'text-amber-600 dark:text-amber-300'
              }`}
            >
              {countdown.label}
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div
              className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
                urgent ? 'bg-[var(--danger)]' : 'bg-amber-500'
              }`}
              style={{ width: `${countdown.fraction * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto pt-4">
        {pending &&
          (confirmingCancel ? (
            <div className="rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger)]/8 p-3">
              <p className="text-xs font-medium text-[var(--text-primary)]">
                Cancelar esta reserva? A mesa será liberada imediatamente.
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={onConfirmCancel}
                  disabled={cancelling}
                  className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-[var(--danger)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {cancelling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Sim, cancelar
                </button>
                <button
                  type="button"
                  onClick={onAbortCancel}
                  disabled={cancelling}
                  className="flex-1 cursor-pointer rounded-full border border-[var(--border-strong)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                >
                  Manter
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onPay}
                className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-4 py-2.5 text-xs font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)]"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Concluir Pagamento
              </button>
              <button
                type="button"
                onClick={onAskCancel}
                className="cursor-pointer rounded-full border border-[var(--border-strong)] px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--danger)]/50 hover:text-[var(--danger)]"
              >
                Cancelar Reserva
              </button>
            </div>
          ))}

        {status === 'CONFIRMED' && (
          <button
            type="button"
            onClick={onViewTicket}
            className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-600"
          >
            <Ticket className="h-4 w-4" />
            Ver Ingresso / QR Code
          </button>
        )}

        {closed && item.event?.slug && !eventPast && (
          <Link
            to={`/eventos/${encodeURIComponent(item.event.slug)}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-[var(--border-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            Reservar novamente
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </article>
  );
}
