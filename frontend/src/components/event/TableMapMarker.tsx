import type { ComponentPropsWithoutRef } from 'react';
import { Check, Clock, Lock } from 'lucide-react';
import {
  SSE_RING_CLASS,
  type RecentTableUpdate,
  type VisualTableState,
} from '@/components/event/tableStatus';

type TableMapMarkerProps = ComponentPropsWithoutRef<'button'> & {
  label: string;
  markerClassName: string;
  /**
   * `compact` preserves admin VisualMapEditor sizing;
   * `interactive` enforces 44x44px touch targets with non-color state icons and SSE pulse.
   */
  sizeVariant?: 'compact' | 'interactive';
  visualState?: VisualTableState;
  recentUpdate?: RecentTableUpdate | null;
};

function renderStateMicroBadge(visualState: VisualTableState | undefined) {
  if (visualState === 'SELECTED') {
    return (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full border border-white bg-[var(--text-primary)] text-white shadow-xs"
      >
        <Check className="h-2.5 w-2.5 stroke-[3]" />
      </span>
    );
  }
  if (visualState === 'RESERVED') {
    return (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full border border-white bg-[var(--status-pending-border)] text-white shadow-xs"
      >
        <Clock className="h-2.5 w-2.5 stroke-[2.5]" />
      </span>
    );
  }
  if (visualState === 'SOLD') {
    return (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full border border-white bg-[var(--status-sold-border)] text-white shadow-xs"
      >
        <Lock className="h-2 w-2 stroke-[2.5]" />
      </span>
    );
  }
  return null;
}

export function TableMapMarker({
  label,
  markerClassName,
  sizeVariant = 'compact',
  visualState,
  recentUpdate,
  className = '',
  children,
  ...props
}: TableMapMarkerProps) {
  const isInteractive = sizeVariant === 'interactive';

  return (
    <button
      {...props}
      type="button"
      className={`group relative grid place-items-center rounded-full select-none focus-visible:outline-none ${
        isInteractive ? 'size-11' : 'size-11 md:size-7'
      } ${className}`}
    >
      {isInteractive && recentUpdate && (
        <span
          key={recentUpdate.seq}
          aria-hidden="true"
          className={`animate-sse-ring pointer-events-none absolute inset-1.5 rounded-full border-2 ${SSE_RING_CLASS[recentUpdate.kind]}`}
        />
      )}

      <span
        className={`relative grid place-items-center rounded-full px-px leading-none font-bold tracking-tight transition-[background-color,border-color,color,box-shadow,transform] duration-300 ease-out group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[var(--text-primary)] ${
          isInteractive
            ? 'size-7 text-[10px] group-active:scale-95 md:size-8 md:text-[11px]'
            : 'size-5 border text-[9px] md:size-6 md:text-[10px]'
        } ${markerClassName}`}
      >
        <span
          className={`max-w-full truncate ${
            isInteractive && visualState === 'SOLD' ? 'line-through decoration-[1.5px]' : ''
          }`}
        >
          {label}
        </span>
        {isInteractive && renderStateMicroBadge(visualState)}
        {children}
      </span>
    </button>
  );
}
