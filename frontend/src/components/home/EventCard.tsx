import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock, LayoutGrid, Map, MapPin } from 'lucide-react';
import {
  formatEventDayBadge,
  getEventFallbackGradient,
  resolveApiAssetUrl,
} from '@/lib/format';
import type { DisplayMode, EventSummary } from '@/types/api';

const DISPLAY_MODE_LABEL: Record<DisplayMode, string> = {
  MAP: 'Planta interativa',
  LIST: 'Lista de mesas',
  BOTH: 'Mapa & Lista',
};

interface EventCardProps {
  event: EventSummary;
}

export function EventCard({ event }: EventCardProps) {
  const imageUrl = resolveApiAssetUrl(event.coverImageUrl || event.bannerImageUrl);
  const badge = formatEventDayBadge(event.startsAt);
  const fallbackGradient = getEventFallbackGradient(event.id || event.slug);

  return (
    <Link
      to={`/eventos/${event.slug}`}
      className="group flex min-h-[88px] flex-row items-stretch overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-all duration-300 active:scale-[0.99] md:min-h-0 md:flex-col md:rounded-3xl md:hover:-translate-y-1 md:hover:border-[var(--border-strong)] md:hover:shadow-[var(--shadow-elevated)]"
    >
      {/* Visual cover: left thumbnail on mobile, top 16:10 cover on desktop */}
      <div className="relative w-[86px] shrink-0 overflow-hidden bg-[var(--bg-elevated)] md:aspect-[16/10] md:w-full">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={event.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          <div
            className="flex h-full w-full items-end p-2.5 md:p-4"
            style={{ background: fallbackGradient }}
          >
            <span aria-hidden="true" className="font-display line-clamp-2 text-xs font-bold tracking-tight text-[var(--text-secondary)] uppercase md:text-2xl">
              {event.title.slice(0, 14)}
            </span>
          </div>
        )}

        {/* Date pill (desktop) */}
        <div className="absolute top-3 left-3 hidden flex-col items-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-center leading-none shadow-sm md:flex">
          <span className="text-[9px] font-semibold tracking-wider text-[var(--accent)] uppercase">
            {badge.month}
          </span>
          <span className="font-display mt-0.5 text-lg font-bold">{badge.day}</span>
          <span className="mt-0.5 text-[9px] font-medium text-[var(--text-secondary)]">
            {badge.weekday}
          </span>
        </div>

        {/* Category pill (desktop) */}
        {event.category && (
          <span className="absolute top-3 right-3 hidden max-w-[calc(100%_-_5.5rem)] truncate rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] shadow-sm md:block">
            {event.category}
          </span>
        )}

        {/* Display mode tag (desktop) */}
        <span className="absolute bottom-3 left-3 hidden items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-secondary)] shadow-sm md:inline-flex">
          {event.displayMode === 'LIST' ? (
            <LayoutGrid className="h-3 w-3 text-[var(--accent)]" />
          ) : (
            <Map className="h-3 w-3 text-[var(--accent)]" />
          )}
          {DISPLAY_MODE_LABEL[event.displayMode]}
        </span>
      </div>

      {/* Card metadata: center on mobile, body on desktop */}
      <div className="flex min-w-0 flex-1 flex-col justify-center px-3.5 py-2.5 md:justify-between md:p-5">
        <div className="space-y-1 md:space-y-2">
          <h3 className="font-display line-clamp-2 text-[13px] leading-tight font-bold tracking-tight text-[var(--text-primary)] uppercase transition-colors group-hover:text-[var(--accent)] md:text-lg md:leading-snug md:normal-case">
            {event.title}
          </h3>

          <div className="space-y-1 text-[11px] text-[var(--text-secondary)] md:text-xs">
            <p className="flex items-center gap-1 truncate md:gap-1.5">
              <MapPin className="h-3 w-3 shrink-0 text-[var(--text-muted)] md:h-3.5 md:w-3.5" />
              <span className="truncate">
                {event.venue}
                {event.city ? ` · ${event.city}` : ''}
              </span>
            </p>
            <p className="hidden items-center gap-1.5 md:flex">
              <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              <span>
                {badge.weekday}, {badge.day} {badge.month} · {badge.time}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-4 hidden items-center justify-between border-t border-[var(--border-subtle)] pt-3.5 md:flex">
          <span className="text-xs font-medium text-[var(--text-muted)]">
            Reservar mesa
          </span>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] transition-all duration-200 group-hover:border-[var(--cta-bg)] group-hover:bg-[var(--cta-bg)] group-hover:text-[var(--cta-text)]">
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>
      </div>

      {/* Mobile date and time */}
      <div className="flex w-[78px] shrink-0 flex-col items-center justify-center gap-1.5 border-l border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-2.5 text-center text-[var(--text-primary)] md:hidden">
        <div className="flex flex-col items-center leading-none">
          <span className="font-display text-xl font-extrabold tracking-tight">
            {badge.day}
          </span>
          <span className="mt-0.5 text-[10px] font-extrabold tracking-[0.14em] text-[var(--text-secondary)] uppercase">
            {badge.month}
          </span>
        </div>
        <span className="font-mono-num rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wider text-[var(--accent)]">
          {badge.compactTime}
        </span>
      </div>
    </Link>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="flex min-h-[88px] flex-row overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] md:min-h-0 md:flex-col md:rounded-3xl">
      <div className="skeleton w-[86px] shrink-0 md:aspect-[16/10] md:w-full" />
      <div className="flex flex-1 flex-col justify-center space-y-2 p-3.5 md:space-y-3 md:p-5">
        <div className="skeleton h-4 w-4/5 rounded-lg md:h-5 md:w-3/4" />
        <div className="skeleton h-3 w-3/5 rounded-lg md:h-3.5 md:w-2/3" />
        <div className="skeleton hidden h-3.5 w-1/2 rounded-lg md:block" />
        <div className="hidden items-center justify-between border-t border-[var(--border-subtle)] pt-3.5 md:flex">
          <div className="skeleton h-3.5 w-24 rounded-lg" />
          <div className="skeleton h-8 w-8 rounded-full" />
        </div>
      </div>
      <div className="skeleton w-[78px] shrink-0 md:hidden" />
    </div>
  );
}
