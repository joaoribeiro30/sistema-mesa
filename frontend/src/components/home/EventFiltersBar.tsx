import { useState } from 'react';
import {
  Calendar,
  MapPin,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { getDatePresetBounds, type DatePreset } from '@/lib/format';
import type { TableAvailabilityStatus } from '@/types/api';

export interface CatalogFilterState {
  q: string;
  fromDate: string;
  toDate: string;
  city: string;
  venue: string;
  category: string;
  minPrice: string;
  maxPrice: string;
  availability: '' | TableAvailabilityStatus;
}

interface EventFiltersBarProps {
  filters: CatalogFilterState;
  availableCategories: string[];
  availableCities: string[];
  availableVenues: string[];
  totalResults: number;
  loading: boolean;
  onChange: (patch: Partial<CatalogFilterState>) => void;
  onReset: () => void;
}

const DEFAULT_CATEGORIES = [
  'Música',
  'Eletrônica',
  'Festival',
  'Gastronomia',
  'Show',
  'Stand-up',
];

const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'all', label: 'Qualquer data' },
  { id: 'today', label: 'Hoje' },
  { id: 'tomorrow', label: 'Amanhã' },
  { id: 'weekend', label: 'Fim de semana' },
  { id: 'month', label: 'Próx. 30 dias' },
];

const AVAILABILITY_OPTIONS: Array<{
  value: '' | TableAvailabilityStatus;
  label: string;
}> = [
  { value: '', label: 'Todas' },
  { value: 'AVAILABLE', label: 'Disponíveis' },
  { value: 'RESERVED', label: 'Reservadas' },
  { value: 'SOLD', label: 'Esgotadas' },
];

export function EventFiltersBar({
  filters,
  availableCategories,
  availableCities,
  availableVenues,
  totalResults,
  loading,
  onChange,
  onReset,
}: EventFiltersBarProps) {
  const [expanded, setExpanded] = useState(false);

  const mergedCategories = Array.from(
    new Set([...availableCategories, ...DEFAULT_CATEGORIES]),
  );

  const activeFilterCount = [
    filters.q,
    filters.fromDate || filters.toDate,
    filters.city,
    filters.venue,
    filters.category,
    filters.minPrice || filters.maxPrice,
    filters.availability,
  ].filter(Boolean).length;

  function detectActiveDatePreset(): DatePreset | null {
    if (!filters.fromDate && !filters.toDate) return 'all';
    for (const preset of ['today', 'tomorrow', 'weekend', 'month'] as DatePreset[]) {
      const bounds = getDatePresetBounds(preset);
      if (bounds.fromDate === filters.fromDate && bounds.toDate === filters.toDate) {
        return preset;
      }
    }
    return null;
  }

  const activePreset = detectActiveDatePreset();

  return (
    <div className="space-y-4">
      {/* Row 1: Category chips + Toggle advanced filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => onChange({ category: '' })}
            className={`shrink-0 cursor-pointer rounded-full px-4 py-2 text-xs font-semibold transition-all ${
              !filters.category
                ? 'bg-[var(--cta-bg)] text-[var(--cta-text)]'
                : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
            }`}
          >
            Todos
          </button>

          {mergedCategories.map((cat) => {
            const isSelected =
              filters.category.toLowerCase() === cat.toLowerCase();
            return (
              <button
                key={cat}
                type="button"
                onClick={() => onChange({ category: isSelected ? '' : cat })}
                className={`shrink-0 cursor-pointer rounded-full px-4 py-2 text-xs font-medium transition-all ${
                  isSelected
                    ? 'border border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
              expanded || activeFilterCount > 0
                ? 'border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filtros
            {activeFilterCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Quick Date Presets + Availability quick toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
          <Calendar className="mr-1 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
          {DATE_PRESETS.map((preset) => {
            const selected = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  const bounds = getDatePresetBounds(preset.id);
                  onChange({ fromDate: bounds.fromDate, toDate: bounds.toDate });
                }}
                className={`shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  selected
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] ring-1 ring-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1">
          {AVAILABILITY_OPTIONS.map((opt) => {
            const isSelected = filters.availability === opt.value;
            return (
              <button
                key={opt.value || 'ALL'}
                type="button"
                onClick={() => onChange({ availability: opt.value })}
                className={`cursor-pointer rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                  isSelected
                    ? 'bg-[var(--cta-bg)] text-[var(--cta-text)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Collapsible Detailed API Filters Panel */}
      {expanded && (
        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Date From */}
            <div className="space-y-1.5">
              <label
                htmlFor="filter-from-date"
                className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase"
              >
                <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                Data inicial
              </label>
              <input
                id="filter-from-date"
                type="date"
                value={filters.fromDate}
                onChange={(e) => onChange({ fromDate: e.target.value })}
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </div>

            {/* Date To */}
            <div className="space-y-1.5">
              <label
                htmlFor="filter-to-date"
                className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase"
              >
                <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                Data final
              </label>
              <input
                id="filter-to-date"
                type="date"
                value={filters.toDate}
                onChange={(e) => onChange({ toDate: e.target.value })}
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </div>

            {/* City */}
            <div className="space-y-1.5">
              <label
                htmlFor="filter-city"
                className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase"
              >
                <MapPin className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                Cidade
              </label>
              <input
                id="filter-city"
                type="text"
                list="catalog-cities-list"
                value={filters.city}
                onChange={(e) => onChange({ city: e.target.value })}
                placeholder="Ex.: Nova Serra"
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
              />
              <datalist id="catalog-cities-list">
                {availableCities.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            {/* Venue */}
            <div className="space-y-1.5">
              <label
                htmlFor="filter-venue"
                className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase"
              >
                <Sparkles className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                Local / Casa
              </label>
              <input
                id="filter-venue"
                type="text"
                list="catalog-venues-list"
                value={filters.venue}
                onChange={(e) => onChange({ venue: e.target.value })}
                placeholder="Ex.: Armazém Serra"
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
              />
              <datalist id="catalog-venues-list">
                {availableVenues.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>

            {/* Category custom input */}
            <div className="space-y-1.5">
              <label
                htmlFor="filter-category"
                className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase"
              >
                <Tag className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                Categoria
              </label>
              <input
                id="filter-category"
                type="text"
                value={filters.category}
                onChange={(e) => onChange({ category: e.target.value })}
                placeholder="Ex.: Música, Festival..."
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </div>

            {/* Min price */}
            <div className="space-y-1.5">
              <label
                htmlFor="filter-min-price"
                className="block text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase"
              >
                Preço mínimo (R$)
              </label>
              <input
                id="filter-min-price"
                type="text"
                inputMode="decimal"
                value={filters.minPrice}
                onChange={(e) => onChange({ minPrice: e.target.value })}
                placeholder="Ex.: 50,00"
                className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] placeholder:font-sans placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </div>

            {/* Max price */}
            <div className="space-y-1.5">
              <label
                htmlFor="filter-max-price"
                className="block text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase"
              >
                Preço máximo (R$)
              </label>
              <input
                id="filter-max-price"
                type="text"
                inputMode="decimal"
                value={filters.maxPrice}
                onChange={(e) => onChange({ maxPrice: e.target.value })}
                placeholder="Ex.: 300,00"
                className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] placeholder:font-sans placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </div>

            {/* Availability select */}
            <div className="space-y-1.5">
              <label
                htmlFor="filter-availability"
                className="block text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase"
              >
                Disponibilidade de mesas
              </label>
              <select
                id="filter-availability"
                value={filters.availability}
                onChange={(e) =>
                  onChange({
                    availability: e.target.value as '' | TableAvailabilityStatus,
                  })
                }
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              >
                {AVAILABILITY_OPTIONS.map((opt) => (
                  <option key={opt.value || 'ALL'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Active filter chips & counter */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {loading
              ? 'Buscando eventos...'
              : `${totalResults} ${totalResults === 1 ? 'evento encontrado' : 'eventos encontrados'}`}
          </span>

          {filters.q && (
            <FilterPill
              label={`Busca: "${filters.q}"`}
              onRemove={() => onChange({ q: '' })}
            />
          )}
          {filters.city && (
            <FilterPill
              label={`Cidade: ${filters.city}`}
              onRemove={() => onChange({ city: '' })}
            />
          )}
          {filters.venue && (
            <FilterPill
              label={`Local: ${filters.venue}`}
              onRemove={() => onChange({ venue: '' })}
            />
          )}
          {filters.category && (
            <FilterPill
              label={`Categoria: ${filters.category}`}
              onRemove={() => onChange({ category: '' })}
            />
          )}
          {(filters.fromDate || filters.toDate) && (
            <FilterPill
              label={`Data: ${filters.fromDate || '...'} → ${filters.toDate || '...'}`}
              onRemove={() => onChange({ fromDate: '', toDate: '' })}
            />
          )}
          {(filters.minPrice || filters.maxPrice) && (
            <FilterPill
              label={`Preço: R$ ${filters.minPrice || '0'} – ${filters.maxPrice || '∞'}`}
              onRemove={() => onChange({ minPrice: '', maxPrice: '' })}
            />
          )}
          {filters.availability && (
            <FilterPill
              label={`Status: ${
                AVAILABILITY_OPTIONS.find((o) => o.value === filters.availability)?.label ??
                filters.availability
              }`}
              onRemove={() => onChange({ availability: '' })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FilterPill({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-1 pr-2 pl-3 text-[11px] font-medium text-[var(--text-primary)]">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remover filtro ${label}`}
        className="cursor-pointer rounded-full p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
