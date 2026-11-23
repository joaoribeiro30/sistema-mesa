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
      <section aria-label="Eventos em destaque" className="pt-5 sm:pt-7">
        <div className="skeleton relative h-[380px] w-full overflow-hidden rounded-3xl border border-[var(--border-subtle)] sm:h-[440px] lg:h-[500px]" />
      </section>
    );
  }

  if (count === 0) {
    return (
      <section aria-label="Boas-vindas" className="pt-5 sm:pt-7">
        <div className="relative overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[#0c0c12] px-6 py-14 text-white sm:px-12 sm:py-20">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 18% 25%, rgba(255,51,102,0.28), transparent 45%), radial-gradient(circle at 82% 80%, rgba(99,102,241,0.24), transparent 50%)',
            }}
          />
          <div className="relative z-10 max-w-2xl space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1 text-[11px] font-semibold tracking-wider text-white/90 uppercase backdrop-blur-md">
              <Sparkles className="h-3.5 w-3.5 text-[#ff5c85]" />
              Em breve novos eventos
            </span>
            <h1 className="font-display text-3xl leading-[1.08] font-bold tracking-tight sm:text-5xl">
              As melhores noites e experiências, com sua mesa garantida.
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
              Assim que novos eventos forem publicados, os destaques da semana aparecerão aqui com seleção interativa de mesas em tempo real.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <a
                href="#eventos"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#08080a] transition-colors hover:bg-white/90"
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

  const current = events[activeIndex] ?? events[0];
  const heroImageUrl = resolveApiAssetUrl(
    current.bannerImageUrl || current.coverImageUrl,
  );
  const fallbackGradient = getEventFallbackGradient(current.id || current.slug);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Próximos eventos em destaque"
      className="pt-5 sm:pt-7"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="group relative h-[410px] w-full overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[#0b0b10] shadow-[var(--shadow-elevated)] sm:h-[460px] lg:h-[520px]">
        {/* Slides background */}
        {events.map((item, idx) => {
          const imgUrl = resolveApiAssetUrl(item.bannerImageUrl || item.coverImageUrl);
          const isCurrent = idx === activeIndex;
          return (
            <div
              key={item.id}
              aria-hidden={!isCurrent}
              className={`absolute inset-0 transition-opacity duration-700 ease-out ${
                isCurrent ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              {imgUrl ? (
                <img
                  src={imgUrl}
                  alt={item.title}
                  className="h-full w-full object-cover object-center transition-transform duration-[6500ms] ease-out group-hover:scale-[1.03]"
                />
              ) : (
                <div
                  className="h-full w-full"
                  style={{ background: getEventFallbackGradient(item.id || item.slug) }}
                />
              )}
              {/* Cinematic vignette scrim */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(8,8,10,0.22) 0%, rgba(8,8,10,0.45) 45%, rgba(8,8,10,0.92) 100%), linear-gradient(90deg, rgba(8,8,10,0.84) 0%, rgba(8,8,10,0.35) 55%, rgba(8,8,10,0.12) 100%)',
                }}
              />
            </div>
          );
        })}

        {/* Fallback surface if image failed */}
        {!heroImageUrl && (
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{ background: fallbackGradient }}
          />
        )}

        {/* Top bar inside hero */}
        <div className="relative z-10 flex items-center justify-between px-5 pt-5 sm:px-9 sm:pt-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-3 py-1 text-[11px] font-semibold tracking-wider text-white uppercase backdrop-blur-md">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff3366]" />
              Em destaque
            </span>
            {current.category && (
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md">
                {current.category}
              </span>
            )}
          </div>

          {count > 1 && (
            <div className="hidden items-center gap-2 sm:flex">
              <button
                type="button"
                onClick={goPrev}
                aria-label="Evento anterior"
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition-all hover:border-white/45 hover:bg-black/70"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="Próximo evento"
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition-all hover:border-white/45 hover:bg-black/70"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>

        {/* Bottom content */}
        <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-6 sm:px-9 sm:pb-9">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-medium text-white/85 sm:text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-[#ff5c85]" />
                  {formatEventDateLine(current.startsAt, current.endsAt)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-white/70" />
                  {current.venue}
                  {current.city ? ` · ${current.city}` : ''}
                </span>
              </div>

              <h1 className="font-display line-clamp-2 text-3xl leading-[1.06] font-bold tracking-tight text-white sm:text-5xl">
                {current.title}
              </h1>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  to={`/eventos/${current.slug}`}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#08080a] shadow-lg transition-all hover:bg-white/90 active:scale-[0.98]"
                >
                  Ver mesas disponíveis
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
                <a
                  href="#eventos"
                  className="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-5 py-3 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-white/20"
                >
                  Todos os eventos
                </a>
              </div>
            </div>

            {/* Slide indicators */}
            {count > 1 && (
              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <div className="flex items-center gap-2" role="tablist" aria-label="Selecionar destaque">
                  {events.map((item, idx) => {
                    const isActive = idx === activeIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-label={`Ir para ${item.title}`}
                        onClick={() => setActiveIndex(idx)}
                        className={`h-2 cursor-pointer rounded-full transition-all duration-300 ${
                          isActive
                            ? 'w-9 bg-white'
                            : 'w-2.5 bg-white/35 hover:bg-white/60'
                        }`}
                      />
                    );
                  })}
                </div>
                <span className="font-mono-num text-xs text-white/65">
                  {String(activeIndex + 1).padStart(2, '0')} /{' '}
                  {String(count).padStart(2, '0')}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
