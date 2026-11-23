import type { ComponentPropsWithoutRef } from 'react';

type TableMapMarkerProps = ComponentPropsWithoutRef<'button'> & {
  label: string;
  markerClassName: string;
};

export function TableMapMarker({ label, markerClassName, className = '', children, ...props }: TableMapMarkerProps) {
  return (
    <button
      {...props}
      type="button"
      className={`group grid size-11 place-items-center rounded-full select-none focus-visible:outline-none md:size-7 ${className}`}
    >
      <span className={`relative grid size-5 place-items-center rounded-full border px-px text-[9px] leading-none font-bold tracking-tight group-focus-visible:outline-2 group-focus-visible:outline-offset-1 group-focus-visible:outline-[var(--text-primary)] md:size-6 md:text-[10px] ${markerClassName}`}>
        <span className="max-w-full truncate">{label}</span>
        {children}
      </span>
    </button>
  );
}
