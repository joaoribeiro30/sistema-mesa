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
      className="group flex flex-col overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-all duration-300 hover:-translate-y-1 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-elevated)]"
    >
      {/* Visual cover */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--bg-elevated)]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={event.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          <div
            className="flex h-full w-full items-end p-4"
            style={{ background: fallbackGradient }}
          >
            <span className="font-display text-2xl font-bold tracking-tight text-white/25 uppercase">
              {event.title.slice(0, 14)}
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />

        {/* Date pill */}
        <div className="absolute top-3 left-3 flex flex-col items-center rounded-2xl border border-white/15 bg-black/65 px-3 py-1.5 text-center leading-none text-white backdrop-blur-md">
          <span className="text-[9px] font-semibold tracking-wider text-[#ff5c85] uppercase">
            {badge.month}
          </span>
          <span className="font-display mt-0.5 text-lg font-bold">{badge.day}</span>
          <span className="mt-0.5 text-[9px] font-medium text-white/70">
            {badge.weekday}
          </span>
        </div>

        {/* Category pill */}
        {event.category && (
          <span className="absolute top-3 right-3 rounded-full border border-white/15 bg-black/55 px-3 py-1 text-[11px] font-medium text-white/95 backdrop-blur-md">
            {event.category}
          </span>
        )}

        {/* Display mode tag */}
        <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white/85 backdrop-blur-md">
          {event.displayMode === 'LIST' ? (
            <LayoutGrid className="h-3 w-3 text-[#ff5c85]" />
          ) : (
            <Map className="h-3 w-3 text-[#ff5c85]" />
          )}
          {DISPLAY_MODE_LABEL[event.displayMode]}
        </span>
      </div>

      {/* Card metadata */}
      <div className="flex flex-1 flex-col justify-between p-4 sm:p-5">
        <div className="space-y-2">
          <h3 className="font-display line-clamp-2 text-lg leading-snug font-bold text-[var(--text-primary)] transition-colors group-hover:text-[var(--accent)]">
            {event.title}
          </h3>

          <div className="space-y-1 text-xs text-[var(--text-secondary)]">
            <p className="flex items-center gap-1.5 truncate">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              <span className="truncate">
                {event.venue}
                {event.city ? ` · ${event.city}` : ''}
              </span>
            </p>
            <p className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              <span>
                {badge.weekday}, {badge.day} {badge.month} · {badge.time}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3.5">
          <span className="text-xs font-medium text-[var(--text-muted)]">
            Reservar mesa
          </span>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] transition-all duration-200 group-hover:border-[var(--cta-bg)] group-hover:bg-[var(--cta-bg)] group-hover:text-[var(--cta-text)]">
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="skeleton aspect-[16/10] w-full" />
      <div className="space-y-3 p-5">
        <div className="skeleton h-5 w-3/4 rounded-lg" />
        <div className="skeleton h-3.5 w-2/3 rounded-lg" />
        <div className="skeleton h-3.5 w-1/2 rounded-lg" />
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3.5">
          <div className="skeleton h-3.5 w-24 rounded-lg" />
          <div className="skeleton h-8 w-8 rounded-full" />
        </div>
      </div>
    </div>
  );
}
