interface BrandLogoProps {
  compact?: boolean;
  className?: string;
}

export function BrandLogo({ compact = false, className = '' }: BrandLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <span
        className="relative flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--cta-bg)] text-[var(--cta-text)] shadow-sm transition-transform duration-200 group-hover:scale-105"
        aria-hidden="true"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="3" y="4" width="18" height="4.5" rx="2.25" fill="currentColor" />
          <path
            d="M6.5 11.5H17.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M7.5 11.5V19.5M16.5 11.5V19.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="19" cy="18" r="2.25" fill="#FF3366" />
        </svg>
      </span>
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[17px] font-bold tracking-[0.14em] text-[var(--text-primary)]">
            MESA
          </span>
          <span className="mt-0.5 text-[9px] font-medium tracking-[0.2em] text-[var(--text-muted)] uppercase">
            LIVE TABLES
          </span>
        </span>
      )}
    </span>
  );
}
