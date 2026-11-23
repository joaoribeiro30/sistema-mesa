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
      <section aria-label="Eventos em destaque" className="pt-3 md:pt-7">
        <div className="skeleton relative h-[215px] w-full overflow-hidden rounded-2xl border border-[var(--border-subtle)] sm:h-[280px] md:h-[460px] md:rounded-3xl lg:h-[500px]" />
      </section>
    );
  }

  if (count === 0) {
    return (
      <section aria-label="Boas-vindas" className="pt-3 md:pt-7">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[#0c0c12] px-5 py-10 text-white sm:px-8 sm:py-14 md:rounded-3xl md:px-12 md:py-20">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 18% 25%, rgba(255,51,102,0.28), transparent 45%), radial-gradient(circle at 82% 80%, rgba(99,102,241,0.24), transparent 50%)',
            }}
          />
          <div className="relative z-10 max-w-2xl space-y-4 md:space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-semibold tracking-wider text-white/90 uppercase backdrop-blur-md md:px-3.5 md:text-[11px]">
              <Sparkles className="h-3.5 w-3.5 text-[#ff5c85]" />
              Em breve novos eventos
            </span>
            <h1 className="font-display text-2xl leading-[1.08] font-bold tracking-tight sm:text-3xl md:text-5xl">
              As melhores noites e experiências, com sua mesa garantida.
            </h1>
            <p className="max-w-xl text-xs leading-relaxed text-white/70 sm:text-sm md:text-base">
              Assim que novos eventos forem publicados, os destaques da semana aparecerão aqui com seleção interativa de mesas em tempo real.
            </p>
            <div className="hidden flex-wrap gap-3 pt-1 md:flex">
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
      className="pt-3 md:pt-7"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="group relative h-[215px] w-full overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[#0b0b10] shadow-[var(--shadow-elevated)] sm:h-[290px] md:h-[460px] md:rounded-3xl lg:h-[520px]">
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
                    'linear-gradient(180deg, rgba(8,8,10,0.16) 0%, rgba(8,8,10,0.34) 48%, rgba(8,8,10,0.88) 100%), linear-gradient(90deg, rgba(8,8,10,0.72) 0%, rgba(8,8,10,0.28) 55%, rgba(8,8,10,0.1) 100%)',
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

        {/* Mobile full-banner tap target */}
        <Link
          to={`/eventos/${current.slug}`}
          aria-label={`Ver detalhes de ${current.title}`}
          className="absolute inset-0 z-10 md:hidden"
        />

        {/* Mobile soft edge controls */}
        {count > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Evento anterior"
              className="absolute top-1/2 left-2.5 z-20 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/35 text-white/90 backdrop-blur-md transition-all active:scale-95 md:hidden"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Próximo evento"
              className="absolute top-1/2 right-2.5 z-20 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/35 text-white/90 backdrop-blur-md transition-all active:scale-95 md:hidden"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Top bar inside hero */}
        <div className="pointer-events-none relative z-10 flex items-center justify-between px-3.5 pt-3.5 md:pointer-events-auto md:px-9 md:pt-8">
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase backdrop-blur-md md:px-3 md:py-1 md:text-[11px]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff3366]" />
              Em destaque
            </span>
            {current.category && (
              <span className="hidden rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md md:inline-flex">
                {current.category}
              </span>
            )}
          </div>

          {count > 1 && (
            <div className="hidden items-center gap-2 md:flex">
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
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-4 md:pointer-events-auto md:px-9 md:pb-9">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-1.5 md:space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-white/85 md:gap-x-4 md:text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-[#ff5c85] md:h-4 md:w-4" />
                  {formatEventDateLine(current.startsAt, current.endsAt)}
                </span>
                <span className="hidden items-center gap-1.5 md:inline-flex">
                  <MapPin className="h-4 w-4 text-white/70" />
                  {current.venue}
                  {current.city ? ` · ${current.city}` : ''}
                </span>
              </div>

              <h1 className="font-display line-clamp-2 text-xl leading-[1.08] font-bold tracking-tight text-white sm:text-2xl md:text-5xl">
                {current.title}
              </h1>

              <p className="flex items-center gap-1 truncate text-[11px] text-white/75 md:hidden">
                <MapPin className="h-3 w-3 shrink-0 text-white/65" />
                <span className="truncate">
                  {current.venue}
                  {current.city ? ` · ${current.city}` : ''}
                </span>
              </p>

              <div className="hidden flex-wrap items-center gap-3 pt-1 md:flex">
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

            {/* Desktop slide indicators */}
            {count > 1 && (
              <div className="hidden items-center justify-end gap-4 md:flex">
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

      {/* Mobile clean slide pagination dots below banner */}
      {count > 1 && (
        <div
          className="mt-3 flex items-center justify-center gap-1.5 md:hidden"
          role="tablist"
          aria-label="Selecionar destaque"
        >
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
                className={`h-1.5 cursor-pointer rounded-full transition-all duration-300 ${
                  isActive
                    ? 'w-6 bg-[var(--accent)]'
                    : 'w-1.5 bg-[var(--border-strong)] hover:bg-[var(--text-muted)]'
                }`}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
