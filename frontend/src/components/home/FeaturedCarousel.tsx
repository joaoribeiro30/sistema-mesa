import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Calendar,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Sparkles,
} from 'lucide-react';
import {
  formatEventDateLine,
  getEventFallbackGradient,
  resolveApiAssetUrl,
} from '@/lib/format';
import type { EventSummary } from '@/types/api';

interface FeaturedCarouselProps {
  events: EventSummary[];
  loading: boolean;
}

const AUTOPLAY_MS = 6000;
const arrowClass = 'pointer-events-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] md:h-10 md:w-10';

export function FeaturedCarousel({ events, loading }: FeaturedCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const count = events.length;

  useEffect(() => {
    if (activeIndex >= count && count > 0) {
      setActiveIndex(0);
    }
  }, [activeIndex, count]);

  const goNext = useCallback(() => {
    if (count <= 1) return;
    setActiveIndex((prev) => (prev + 1) % count);
  }, [count]);

  const goPrev = useCallback(() => {
    if (count <= 1) return;
    setActiveIndex((prev) => (prev - 1 + count) % count);
  }, [count]);

  useEffect(() => {
    if (paused || count <= 1) return;
    const timer = window.setInterval(goNext, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [paused, count, goNext]);

  function handleTouchStart(e: TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(e: TouchEvent) {
    if (touchStartX.current === null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const delta = endX - touchStartX.current;
    if (Math.abs(delta) > 45) {
      if (delta < 0) goNext();
      else goPrev();
    }
    touchStartX.current = null;
  }

  if (loading) {
    return (
      <section aria-label="Eventos em destaque" className="pt-3 md:pt-7">
        <div className="skeleton h-[252px] w-full rounded-2xl border border-[var(--border-subtle)] sm:h-[310px] md:h-[420px] md:rounded-3xl xl:h-[460px]" />
      </section>
    );
  }

  if (count === 0) {
    return (
      <section aria-label="Boas-vindas" className="pt-3 md:pt-7">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-10 sm:px-8 sm:py-14 md:rounded-3xl md:px-12 md:py-20">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(ellipse at 90% 20%, var(--accent-soft), transparent 55%)',
            }}
          />
          <div className="relative z-10 max-w-2xl space-y-4 md:space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase md:px-3.5 md:text-[11px]">
              <Sparkles className="h-3.5 w-3.5" />
              Em breve novos eventos
            </span>
            <h1 className="font-display text-2xl leading-[1.08] font-bold tracking-tight sm:text-3xl md:text-5xl">
              As melhores noites e experiências, com sua mesa garantida.
            </h1>
            <p className="max-w-xl text-xs leading-relaxed text-[var(--text-secondary)] sm:text-sm md:text-base">
              Assim que novos eventos forem publicados, os destaques da semana aparecerão aqui com seleção interativa de mesas em tempo real.
            </p>
            <div className="hidden flex-wrap gap-3 pt-1 md:flex">
              <a
                href="#eventos"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--cta-bg)] px-6 py-3 text-sm font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
              >
                Explorar catálogo
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const visibleIndex = activeIndex < count ? activeIndex : 0;
  const current = events[visibleIndex];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Próximos eventos em destaque"
      className="pt-3 md:pt-7"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="group relative grid overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-elevated)] md:min-h-[420px] md:grid-cols-2 md:rounded-3xl xl:min-h-[460px]">
        <div className="relative h-36 overflow-hidden border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] sm:h-44 md:col-start-2 md:row-start-1 md:h-full md:border-b-0 md:border-l">
          {events.map((item, idx) => {
            const imgUrl = resolveApiAssetUrl(item.bannerImageUrl || item.coverImageUrl);
            return (
              <div
                key={item.id}
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ease-out ${idx === visibleIndex ? 'opacity-100' : 'opacity-0'}`}
                style={{ background: getEventFallbackGradient(item.id || item.slug) }}
              >
                {imgUrl && (
                  <img
                    src={imgUrl}
                    alt=""
                    className="h-full w-full object-cover object-center transition-transform duration-[6500ms] ease-out group-hover:scale-[1.03]"
                  />
                )}
              </div>
            );
          })}

          {count > 1 && (
            <div className="pointer-events-none absolute inset-x-2.5 top-1/2 z-20 flex -translate-y-1/2 justify-between gap-2 md:inset-x-auto md:top-auto md:right-5 md:bottom-5 md:translate-y-0">
              <button type="button" onClick={goPrev} aria-label="Evento anterior" className={arrowClass}>
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button type="button" onClick={goNext} aria-label="Próximo evento" className={arrowClass}>
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>

        <Link
          to={`/eventos/${current.slug}`}
          aria-label={`Ver detalhes de ${current.title}`}
          className="absolute inset-0 z-10 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--accent)] md:hidden"
        />

        <div className="flex min-w-0 flex-col justify-center gap-4 p-4 md:col-start-1 md:row-start-1 md:gap-6 md:p-9 xl:p-12">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase md:px-3 md:text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              Em destaque
            </span>
            {current.category && (
              <span className="hidden rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] md:inline-flex">
                {current.category}
              </span>
            )}
          </div>

          <div className="min-w-0 space-y-1.5 md:space-y-3">
            <h1 className="font-display line-clamp-2 text-xl leading-[1.08] font-bold tracking-tight sm:text-2xl md:text-4xl xl:text-5xl">
              {current.title}
            </h1>
            <div className="space-y-1 text-[11px] font-medium text-[var(--text-secondary)] md:space-y-2 md:text-sm">
              <p className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 shrink-0 text-[var(--accent)] md:h-4 md:w-4" />
                {formatEventDateLine(current.startsAt, current.endsAt)}
              </p>
              <p className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--accent)] md:h-4 md:w-4" />
                <span className="truncate">
                  {current.venue}
                  {current.city ? ` · ${current.city}` : ''}
                </span>
              </p>
            </div>
          </div>

          <div className="hidden flex-wrap items-center gap-3 md:flex">
            <Link
              to={`/eventos/${current.slug}`}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-3 text-sm font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
            >
              Ver mesas disponíveis
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <a
              href="#eventos"
              className="inline-flex items-center rounded-full border border-[var(--border-strong)] px-4 py-3 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)]"
            >
              Todos os eventos
            </a>
          </div>
        </div>
      </div>

      {count > 1 && (
        <div className="mt-1 flex items-center justify-center gap-1.5" role="tablist" aria-label="Selecionar destaque">
          {events.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={idx === visibleIndex}
              aria-label={`Ir para ${item.title}`}
              onClick={() => setActiveIndex(idx)}
              className="group grid h-8 min-w-6 cursor-pointer place-items-center rounded-full"
            >
              <span className={`h-1.5 rounded-full transition-all ${idx === visibleIndex ? 'w-7 bg-[var(--accent)]' : 'w-1.5 bg-[var(--text-muted)] group-hover:bg-[var(--text-primary)]'}`} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
