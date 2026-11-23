import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, CalendarX2, Loader2, RefreshCw } from 'lucide-react';
import { EventCard, EventCardSkeleton } from '@/components/home/EventCard';
import {
  EventFiltersBar,
  type CatalogFilterState,
} from '@/components/home/EventFiltersBar';
import { FeaturedCarousel } from '@/components/home/FeaturedCarousel';
import { eventsApi, getFriendlyErrorMessage } from '@/lib/api';
import {
  dateInputToEndIso,
  dateInputToStartIso,
  parseMajorPriceToMinor,
} from '@/lib/format';
import type {
  EventsQueryParams,
  EventSummary,
  TableAvailabilityStatus,
} from '@/types/api';

const PAGE_SIZE = 12;

function readFiltersFromParams(params: URLSearchParams): CatalogFilterState {
  const availabilityRaw = params.get('availability') ?? '';
  const availability: '' | TableAvailabilityStatus =
    availabilityRaw === 'AVAILABLE' ||
    availabilityRaw === 'RESERVED' ||
    availabilityRaw === 'SOLD'
      ? availabilityRaw
      : '';

  return {
    q: params.get('q') ?? '',
    fromDate: params.get('fromDate') ?? '',
    toDate: params.get('toDate') ?? '',
    city: params.get('city') ?? '',
    venue: params.get('venue') ?? '',
    category: params.get('category') ?? '',
    minPrice: params.get('minPrice') ?? '',
    maxPrice: params.get('maxPrice') ?? '',
    availability,
  };
}

export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<CatalogFilterState>(() =>
    readFiltersFromParams(searchParams),
  );

  // Keep filter state synchronized when Header updates URL search params
  useEffect(() => {
    const next = readFiltersFromParams(searchParams);
    setFilters((prev) =>
      JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
    );
  }, [searchParams]);

  // Featured carousel data (upcoming published events)
  const [featuredEvents, setFeaturedEvents] = useState<EventSummary[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);

  // Active grid data
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Debounce free-text filter inputs before querying API
  const [debouncedApiFilters, setDebouncedApiFilters] = useState({
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    city: filters.city,
    venue: filters.venue,
    category: filters.category,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    availability: filters.availability,
  });

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedApiFilters({
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        city: filters.city,
        venue: filters.venue,
        category: filters.category,
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        availability: filters.availability,
      });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [
    filters.fromDate,
    filters.toDate,
    filters.city,
    filters.venue,
    filters.category,
    filters.minPrice,
    filters.maxPrice,
    filters.availability,
  ]);

  const updateFilters = useCallback(
    (patch: Partial<CatalogFilterState>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        const params = new URLSearchParams();
        for (const [key, val] of Object.entries(next)) {
          if (val) params.set(key, val);
        }
        setSearchParams(params, { replace: true });
        return next;
      });
    },
    [setSearchParams],
  );

  const resetFilters = useCallback(() => {
    setFilters({
      q: '',
      fromDate: '',
      toDate: '',
      city: '',
      venue: '',
      category: '',
      minPrice: '',
      maxPrice: '',
      availability: '',
    });
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // Fetch featured upcoming events for Hero Carousel
  useEffect(() => {
    let active = true;
    async function loadFeatured() {
      setFeaturedLoading(true);
      try {
        const { events: list } = await eventsApi.list({ limit: 6, offset: 0 });
        if (active) {
          setFeaturedEvents(list);
        }
      } catch {
        if (active) {
          setFeaturedEvents([]);
        }
      } finally {
        if (active) {
          setFeaturedLoading(false);
        }
      }
    }
    void loadFeatured();
    return () => {
      active = false;
    };
  }, [reloadTick]);

  const apiQueryParams = useMemo<EventsQueryParams>(() => {
    return {
      limit: PAGE_SIZE,
      offset: 0,
      startsFrom: dateInputToStartIso(debouncedApiFilters.fromDate),
      startsTo: dateInputToEndIso(debouncedApiFilters.toDate),
      city: debouncedApiFilters.city.trim() || undefined,
      venue: debouncedApiFilters.venue.trim() || undefined,
      category: debouncedApiFilters.category.trim() || undefined,
      minPriceMinor: parseMajorPriceToMinor(debouncedApiFilters.minPrice),
      maxPriceMinor: parseMajorPriceToMinor(debouncedApiFilters.maxPrice),
      availability: debouncedApiFilters.availability || undefined,
    };
  }, [debouncedApiFilters]);

  // Fetch filtered catalog grid from API
  useEffect(() => {
    let active = true;

    async function loadEvents() {
      setLoading(true);
      setError(null);
      try {
        const { events: fetched } = await eventsApi.list(apiQueryParams);
        if (!active) return;
        setEvents(fetched);
        setHasMore(fetched.length === PAGE_SIZE);
      } catch (err) {
        if (!active) return;
        setError(getFriendlyErrorMessage(err));
        setEvents([]);
        setHasMore(false);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadEvents();
    return () => {
      active = false;
    };
  }, [apiQueryParams, reloadTick]);

  async function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const { events: more } = await eventsApi.list({
        ...apiQueryParams,
        offset: events.length,
      });
      setEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const uniqueMore = more.filter((e) => !existingIds.has(e.id));
        return [...prev, ...uniqueMore];
      });
      setHasMore(more.length === PAGE_SIZE);
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  // Client-side match for quick search query (matches title, venue, city, category)
  const visibleEvents = useMemo(() => {
    const term = filters.q.trim().toLowerCase();
    if (!term) return events;
    return events.filter((ev) => {
      const haystack = [ev.title, ev.venue, ev.city ?? '', ev.category ?? '']
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [events, filters.q]);

  const { availableCategories, availableCities, availableVenues } = useMemo(() => {
    const source = featuredEvents.length > 0 ? [...featuredEvents, ...events] : events;
    const cats = new Set<string>();
    const cities = new Set<string>();
    const venues = new Set<string>();
    for (const ev of source) {
      if (ev.category) cats.add(ev.category);
      if (ev.city) cities.add(ev.city);
      if (ev.venue) venues.add(ev.venue);
    }
    return {
      availableCategories: Array.from(cats),
      availableCities: Array.from(cities),
      availableVenues: Array.from(venues),
    };
  }, [featuredEvents, events]);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
      {/* Interactive Featured Carousel */}
      <FeaturedCarousel events={featuredEvents} loading={featuredLoading} />

      {/* Active Events Catalog Section */}
      <section id="eventos" className="mt-12 scroll-mt-24 space-y-6 sm:mt-16">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-[var(--accent)] uppercase">
              Programação ativa
            </p>
            <h2 className="font-display mt-1 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
              Próximos eventos
            </h2>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Disponibilidade atualizada diretamente pelo catálogo em tempo real.
          </p>
        </div>

        <EventFiltersBar
          filters={filters}
          availableCategories={availableCategories}
          availableCities={availableCities}
          availableVenues={availableVenues}
          totalResults={visibleEvents.length}
          loading={loading}
          onChange={updateFilters}
          onReset={resetFilters}
        />

        {/* Error state */}
        {error && (
          <div
            role="alert"
            className="flex flex-col items-start justify-between gap-4 rounded-3xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-5 sm:flex-row sm:items-center"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--danger)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  Não foi possível carregar os eventos
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReloadTick((t) => t + 1)}
              className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-[var(--cta-bg)] px-4 py-2 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tentar novamente
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        ) : visibleEvents.length === 0 && !error ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
              <CalendarX2 className="h-6 w-6" />
            </div>
            <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">
              Nenhum evento encontrado
            </h3>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-[var(--text-secondary)]">
              Não encontramos eventos publicados para os filtros selecionados. Experimente ampliar as datas, ajustar a faixa de preço ou limpar os filtros.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-5 cursor-pointer rounded-full bg-[var(--cta-bg)] px-5 py-2.5 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
            >
              Limpar todos os filtros
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleEvents.map((ev) => (
                <EventCard key={ev.id} event={ev} />
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center pt-4">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-6 py-3 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-60"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando mais...
                    </>
                  ) : (
                    'Carregar mais eventos'
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
