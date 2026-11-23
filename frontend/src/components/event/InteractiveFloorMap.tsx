import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Check,
  Clock,
  Lock,
  Maximize2,
  Minus,
  Move,
  Plus,
  Users,
  X,
} from 'lucide-react';
import {
  formatExpiryTime,
  getVisualTableState,
  isTableSelectable,
  TABLE_STATUS_META,
} from '@/components/event/tableStatus';
import { formatMinorCurrency, resolveApiAssetUrl } from '@/lib/format';
import type { EventSector, EventTable } from '@/types/api';

interface PositionedTable {
  table: EventTable;
  sector: EventSector;
}

interface InteractiveFloorMapProps {
  floorPlanImageUrl: string | null;
  sectors: EventSector[];
  currency: string;
  selectedTableIds: Set<string>;
  activeSectorId: string | null;
  onlyAvailable: boolean;
  onToggleTable: (table: EventTable, sector: EventSector) => void;
}

const MIN_SCALE = 0.85;
const MAX_SCALE = 2.6;
const SCALE_STEP = 0.25;

export function InteractiveFloorMap({
  floorPlanImageUrl,
  sectors,
  currency,
  selectedTableIds,
  activeSectorId,
  onlyAvailable,
  onToggleTable,
}: InteractiveFloorMapProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);
  const [inspectedTableId, setInspectedTableId] = useState<string | null>(null);

  const dragOrigin = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);

  const resolvedFloorUrl = resolveApiAssetUrl(floorPlanImageUrl);
  const showFloorImage = Boolean(resolvedFloorUrl && !imageFailed);

  useEffect(() => {
    setImageFailed(false);
  }, [floorPlanImageUrl]);

  const { positionedTables, unpositionedTables, tableLookup } = useMemo(() => {
    const positioned: PositionedTable[] = [];
    const unpositioned: PositionedTable[] = [];
    const lookup = new Map<string, PositionedTable>();

    for (const sector of sectors) {
      for (const table of sector.tables) {
        const entry = { table, sector };
        lookup.set(table.id, entry);
        if (
          typeof table.x === 'number' &&
          typeof table.y === 'number' &&
          Number.isFinite(table.x) &&
          Number.isFinite(table.y)
        ) {
          positioned.push(entry);
        } else {
          unpositioned.push(entry);
        }
      }
    }

    return {
      positionedTables: positioned,
      unpositionedTables: unpositioned,
      tableLookup: lookup,
    };
  }, [sectors]);

  const clampScale = (next: number) =>
    Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(next.toFixed(2))));

  const handleZoomIn = useCallback(() => {
    setScale((prev) => clampScale(prev + SCALE_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => clampScale(prev - SCALE_STEP));
  }, []);

  const handleResetView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  // Support Ctrl + Wheel zoom smoothly without trapping normal page scrolling
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.16 : -0.16;
      setScale((prev) => clampScale(prev + delta));
    }

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Only pan when clicking the map canvas itself (not toolbar buttons or markers)
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOrigin.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: translate.x,
      baseY: translate.y,
      moved: false,
    };
    setIsDragging(true);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== e.pointerId) return;

    const dx = e.clientX - origin.startX;
    const dy = e.clientY - origin.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      origin.moved = true;
    }

    setTranslate({
      x: origin.baseX + dx,
      y: origin.baseY + dy,
    });
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== e.pointerId) return;
    if (e.type === 'pointerup' && !origin.moved) {
      setInspectedTableId(null);
    }
    dragOrigin.current = null;
    setIsDragging(false);
  }

  const activeInspectorEntry =
    (hoveredTableId ? tableLookup.get(hoveredTableId) : null) ??
    (inspectedTableId ? tableLookup.get(inspectedTableId) : null);
  const showUnpositionedOnlyOnMobile =
    !showFloorImage && positionedTables.length === 0 && unpositionedTables.length > 0;

  return (
    <div className="space-y-3 md:space-y-4">
      <div
        className={`relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] md:rounded-3xl ${
          showUnpositionedOnlyOnMobile ? 'hidden md:block' : ''
        }`}
      >
        {/* Top-left hint badge */}
        <div className="pointer-events-none absolute top-4 left-4 z-20 hidden items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] md:inline-flex">
          <Move className="h-3.5 w-3.5 text-[var(--accent)]" />
          Arraste para mover · Ctrl + Scroll para zoom
        </div>

        {/* Top-right Zoom Controls */}
        <div className="flex items-center justify-end gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1 md:absolute md:top-4 md:right-4 md:z-20 md:rounded-full md:border md:border-[var(--border-strong)] md:shadow-sm">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={scale <= MIN_SCALE}
            aria-label="Diminuir zoom"
            className="flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40 md:size-8"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="font-mono-num min-w-[46px] text-center text-[11px] font-semibold">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={scale >= MAX_SCALE}
            aria-label="Aumentar zoom"
            className="flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40 md:size-8"
          >
            <Plus className="h-4 w-4" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-[var(--border-strong)]" aria-hidden="true" />
          <button
            type="button"
            onClick={handleResetView}
            aria-label="Centralizar mapa"
            title="Centralizar mapa"
            className="flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-hover)] md:size-8"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Pan/Zoom Viewport */}
        <div
          ref={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`relative flex min-h-[250px] w-full items-center justify-center overflow-hidden p-6 select-none md:min-h-[540px] md:p-8 ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          } ${scale > 1 ? 'touch-none' : 'touch-pan-y md:touch-none'}`}
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, var(--map-grid) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        >
          {/* Transformed Stage */}
          <div
            className="relative w-full max-w-4xl origin-center transition-transform duration-75 ease-out"
            style={{
              transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${scale})`,
            }}
          >
            {showFloorImage ? (
              <img
                src={resolvedFloorUrl!}
                alt="Planta interativa do evento"
                draggable={false}
                onError={() => setImageFailed(true)}
                className="block h-auto w-full rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] object-contain shadow-[var(--shadow-elevated)]"
              />
            ) : (
              /* Sleek Architectural Blueprint Fallback when floorPlanImageUrl is null */
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-elevated)]">
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, var(--map-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--map-grid) 1px, transparent 1px)',
                    backgroundSize: '10% 10%',
                  }}
                />
                <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1 text-[10px] font-semibold tracking-[0.12em] whitespace-nowrap text-[var(--text-secondary)] uppercase md:top-4 md:px-6 md:py-1.5 md:tracking-[0.26em]">
                  Palco / Frente
                </div>
                {positionedTables.length === 0 && (
                  <div className="relative flex h-full flex-col items-center justify-center p-6 text-center text-xs text-[var(--text-secondary)]">
                    <p className="font-medium text-[var(--text-primary)]">
                      Nenhuma mesa posicionada na planta ainda.
                    </p>
                    <p className="mt-1 max-w-sm text-[11px]">
                      Você pode selecionar mesas disponíveis abaixo ou alternar para a visualização em lista por setores.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Percentage-positioned table markers */}
            {positionedTables.map(({ table, sector }) => {
              const isSelected = selectedTableIds.has(table.id);
              const visualState = getVisualTableState(table, isSelected);
              const meta = TABLE_STATUS_META[visualState];
              const selectable = isTableSelectable(table);

              const matchesSector =
                !activeSectorId || sector.id === activeSectorId;
              const matchesAvailability =
                !onlyAvailable || selectable || isSelected;
              const isDimmed = !matchesSector || !matchesAvailability;

              const isHovered = hoveredTableId === table.id;
              const leftPct = Math.min(100, Math.max(0, table.x ?? 0));
              const topPct = Math.min(100, Math.max(0, table.y ?? 0));
              const showTooltipBelow = topPct < 24;

              return (
                <div
                  key={table.id}
                  style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                  }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 transition-opacity duration-200 ${
                    isDimmed
                      ? 'pointer-events-none z-0 opacity-20'
                      : isHovered || isSelected
                        ? 'z-30'
                        : 'z-10'
                  }`}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setHoveredTableId(table.id)}
                    onMouseLeave={() =>
                      setHoveredTableId((prev) =>
                        prev === table.id ? null : prev,
                      )
                    }
                    onFocus={() => setHoveredTableId(table.id)}
                    onBlur={() =>
                      setHoveredTableId((prev) =>
                        prev === table.id ? null : prev,
                      )
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setInspectedTableId(table.id);
                      if (selectable) {
                        onToggleTable(table, sector);
                      }
                    }}
                    aria-label={`Mesa ${table.label}, setor ${sector.name}, ${table.capacity} lugares, ${formatMinorCurrency(table.priceMinor, currency)}, ${meta.label}`}
                    aria-pressed={isSelected}
                    className={`group relative flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border-2 px-2 text-[11px] font-bold tracking-tight transition-all duration-150 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)] md:h-10 md:min-w-10 ${meta.markerClass}`}
                  >
                    {isSelected ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Check className="h-3 w-3 stroke-[3]" />
                        <span>{table.label}</span>
                      </span>
                    ) : visualState === 'RESERVED' ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Lock className="h-2.5 w-2.5" />
                        <span>{table.label}</span>
                      </span>
                    ) : (
                      <span>{table.label}</span>
                    )}
                  </button>

                  {/* Compact desktop hover popover */}
                  {isHovered && (
                    <div
                      role="tooltip"
                      className={`pointer-events-none absolute left-1/2 z-40 hidden w-56 -translate-x-1/2 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-3 text-left shadow-[var(--shadow-elevated)] md:block ${
                        showTooltipBelow ? 'top-full mt-2.5' : 'bottom-full mb-2.5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-sm font-bold">
                          Mesa {table.label}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                        >
                          {meta.shortLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                        {sector.name}
                      </p>
                      <div className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 text-xs">
                        <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                          <Users className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                          {table.capacity} lugares
                        </span>
                        <span className="font-mono-num font-semibold">
                          {formatMinorCurrency(table.priceMinor, currency)}
                        </span>
                      </div>
                      {visualState === 'RESERVED' && table.expiresAt && (
                        <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--warning)]">
                          <Clock className="h-3 w-3" />
                          Bloqueio até {formatExpiryTime(table.expiresAt)}
                        </p>
                      )}
                      {selectable && (
                        <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
                          {isSelected
                            ? 'Clique para remover da seleção'
                            : 'Clique para selecionar'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom-left Live Inspector Card (ideal for mobile taps & quick confirmation) */}
        {activeInspectorEntry && (
          <div className="px-3 pb-3 md:absolute md:bottom-4 md:left-4 md:z-20 md:w-80 md:p-0">
            {(() => {
              const { table, sector } = activeInspectorEntry;
              const isSelected = selectedTableIds.has(table.id);
              const visualState = getVisualTableState(table, isSelected);
              const meta = TABLE_STATUS_META[visualState];
              const selectable = isTableSelectable(table);
              const expiry = formatExpiryTime(table.expiresAt);

              return (
                <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-elevated)]">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-display text-base font-bold">
                          Mesa {table.label}
                        </h4>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                        >
                          {meta.shortLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        Setor {sector.name}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setInspectedTableId(null);
                        setHoveredTableId(null);
                      }}
                      aria-label="Fechar detalhes da mesa"
                      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] md:size-6"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-xs">
                    <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                      <Users className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                      Até {table.capacity} pessoas
                    </span>
                    <span className="font-mono-num text-sm font-bold">
                      {formatMinorCurrency(table.priceMinor, currency)}
                    </span>
                  </div>

                  {visualState === 'RESERVED' && expiry && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--warning)]">
                      <Clock className="h-3.5 w-3.5" />
                      Bloqueio pendente · libera às {expiry} se não paga
                    </p>
                  )}

                  {selectable && (
                    <button
                      type="button"
                      onClick={() => onToggleTable(table, sector)}
                      className={`mt-3 min-h-11 w-full cursor-pointer rounded-full px-4 py-2 text-xs font-semibold transition-colors md:min-h-0 ${
                        isSelected
                          ? 'border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                          : 'bg-[var(--cta-bg)] text-[var(--cta-text)] hover:bg-[var(--cta-hover)]'
                      }`}
                    >
                      {isSelected ? 'Remover seleção' : 'Selecionar mesa'}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Fallback tray for tables without (x, y) coordinates */}
      {unpositionedTables.length > 0 && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 md:rounded-3xl md:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">
                Mesas sem posição definida na planta
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Escolha uma mesa abaixo.
              </p>
            </div>
            <span className="rounded-full bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
              {unpositionedTables.length}{' '}
              {unpositionedTables.length === 1 ? 'mesa' : 'mesas'}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {unpositionedTables.map(({ table, sector }) => {
              const isSelected = selectedTableIds.has(table.id);
              const visualState = getVisualTableState(table, isSelected);
              const meta = TABLE_STATUS_META[visualState];
              const selectable = isTableSelectable(table);

              if (activeSectorId && sector.id !== activeSectorId) return null;
              if (onlyAvailable && !selectable && !isSelected) return null;

              return (
                <button
                  key={table.id}
                  type="button"
                  disabled={!selectable}
                  aria-pressed={isSelected}
                  onClick={() => onToggleTable(table, sector)}
                  className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-55 md:min-h-0 ${meta.badgeClass}`}
                >
                  <span className="font-bold">{table.label}</span>
                  <span className="opacity-75">· {sector.name}</span>
                  <span className="font-mono-num">
                    {formatMinorCurrency(table.priceMinor, currency)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
