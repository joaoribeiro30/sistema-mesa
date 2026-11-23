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
import { TableMapMarker } from '@/components/event/TableMapMarker';
import {
  formatExpiryTime,
  getVisualTableState,
  isTableSelectable,
  TABLE_STATUS_META,
  type RecentTableUpdate,
  type VisualTableState,
} from '@/components/event/tableStatus';
import { useCountdown } from '@/hooks/useCountdown';
import { formatMinorCurrency, resolveApiAssetUrl } from '@/lib/format';
import { compareTablesByLabel } from '@/lib/tableOrder';
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
  recentTableUpdates?: Record<string, RecentTableUpdate>;
  onToggleTable: (table: EventTable, sector: EventSector) => void;
}

const MIN_SCALE = 0.85;
const MAX_SCALE = 3.5;
const SCALE_STEP = 0.3;
const DRAG_THRESHOLD_PX = 6;

const LEGEND_STATES: VisualTableState[] = [
  'AVAILABLE',
  'SELECTED',
  'RESERVED',
  'SOLD',
];

function StatusBadgeIcon({
  state,
  className = 'h-3 w-3 shrink-0',
}: {
  state: VisualTableState;
  className?: string;
}) {
  if (state === 'SELECTED') return <Check className={className} aria-hidden="true" />;
  if (state === 'RESERVED') return <Clock className={className} aria-hidden="true" />;
  if (state === 'SOLD') return <Lock className={className} aria-hidden="true" />;
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full bg-[var(--status-available-border)]"
    />
  );
}

interface InspectorDetailsProps {
  table: EventTable;
  sector: EventSector;
  currency: string;
  isSelected: boolean;
  onToggle: () => void;
  onClose: () => void;
  variant: 'desktop' | 'mobile-sheet';
}

function TableInspectorContent({
  table,
  sector,
  currency,
  isSelected,
  onToggle,
  onClose,
  variant,
}: InspectorDetailsProps) {
  const visualState = getVisualTableState(table, isSelected);
  const meta = TABLE_STATUS_META[visualState];
  const selectable = isTableSelectable(table);
  const expiryTime = formatExpiryTime(table.expiresAt);
  const countdown = useCountdown(table.expiresAt, visualState === 'RESERVED');

  const isSheet = variant === 'mobile-sheet';

  return (
    <div
      className={
        isSheet
          ? 'space-y-4'
          : 'rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-elevated)]'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-display text-lg font-bold text-[var(--text-primary)] md:text-base">
              Mesa {table.label}
            </h4>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}
            >
              <StatusBadgeIcon state={visualState} className="h-3 w-3 shrink-0" />
              {meta.shortLabel}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">
            Setor {sector.name}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar detalhes da mesa"
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
        {meta.description}
      </p>

      <div className="flex items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-3 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
          <Users className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          Até {table.capacity} {table.capacity === 1 ? 'pessoa' : 'pessoas'}
        </span>
        <span className="font-mono-num text-base font-bold text-[var(--text-primary)] md:text-sm">
          {formatMinorCurrency(table.priceMinor, currency)}
        </span>
      </div>

      {visualState === 'RESERVED' && (expiryTime || countdown.label) && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--status-pending-border)]/45 bg-[var(--status-pending-bg)] px-3 py-2 text-xs font-medium text-[var(--status-pending-fg)]">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {countdown.label && !countdown.expired ? (
              <>
                Libera em{' '}
                <strong className="font-mono-num font-bold">
                  {countdown.label}
                </strong>
                {expiryTime ? ` (até ${expiryTime})` : ''} se não paga.
              </>
            ) : expiryTime ? (
              <>Bloqueio pendente · libera às {expiryTime} se não paga.</>
            ) : (
              <>Verificando liberação da mesa em tempo real…</>
            )}
          </span>
        </div>
      )}

      {selectable ? (
        <button
          type="button"
          onClick={() => {
            onToggle();
            if (isSheet) onClose();
          }}
          className={`flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)] md:min-h-11 md:text-xs ${
            isSelected
              ? 'border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              : 'bg-[var(--cta-bg)] text-[var(--cta-text)] hover:bg-[var(--cta-hover)]'
          }`}
        >
          {isSelected ? (
            <>
              <X className="h-4 w-4" aria-hidden="true" />
              Remover seleção
            </>
          ) : (
            <>
              <Check className="h-4 w-4" aria-hidden="true" />
              Selecionar mesa
            </>
          )}
        </button>
      ) : (
        isSheet && (
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 w-full cursor-pointer items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]"
          >
            Entendi
          </button>
        )
      )}
    </div>
  );
}

export function InteractiveFloorMap({
  floorPlanImageUrl,
  sectors,
  currency,
  selectedTableIds,
  activeSectorId,
  onlyAvailable,
  recentTableUpdates,
  onToggleTable,
}: InteractiveFloorMapProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);
  const [inspectedTableId, setInspectedTableId] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 767px)').matches
      : false,
  );

  // Sync latest transform for gesture math without stale closures
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  transformRef.current = { scale, x: translate.x, y: translate.y };

  // Multi-pointer tracking for smooth 1-finger pan + 2-finger pinch zoom
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );
  const panOriginRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    startedOnMarker: boolean;
    activated: boolean;
  } | null>(null);
  const pinchOriginRef = useRef<{
    distance: number;
    midX: number;
    midY: number;
    baseScale: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const suppressClickUntilRef = useRef(0);

  const resolvedFloorUrl = resolveApiAssetUrl(floorPlanImageUrl);
  const showFloorImage = Boolean(resolvedFloorUrl && !imageFailed);

  useEffect(() => {
    setImageFailed(false);
  }, [floorPlanImageUrl]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
    };
    setIsMobileViewport(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Escape closes inspected table sheet/card or tooltip
  useEffect(() => {
    if (!inspectedTableId && !hoveredTableId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setInspectedTableId(null);
        setHoveredTableId(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inspectedTableId, hoveredTableId]);

  const { positionedTables, unpositionedTables, tableLookup, statusCounts } =
    useMemo(() => {
      const positioned: PositionedTable[] = [];
      const unpositioned: PositionedTable[] = [];
      const lookup = new Map<string, PositionedTable>();
      const counts: Record<VisualTableState, number> = {
        AVAILABLE: 0,
        SELECTED: 0,
        RESERVED: 0,
        SOLD: 0,
      };

      for (const sector of sectors) {
        const matchesSector = !activeSectorId || sector.id === activeSectorId;
        for (const table of sector.tables) {
          const entry = { table, sector };
          lookup.set(table.id, entry);

          if (matchesSector) {
            const state = getVisualTableState(
              table,
              selectedTableIds.has(table.id),
            );
            counts[state] += 1;
          }

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

      const compareEntries = (left: PositionedTable, right: PositionedTable) =>
        compareTablesByLabel(left.table, right.table);

      return {
        positionedTables: positioned.sort(compareEntries),
        unpositionedTables: unpositioned.sort(compareEntries),
        tableLookup: lookup,
        statusCounts: counts,
      };
    }, [sectors, activeSectorId, selectedTableIds]);

  const clampScale = useCallback(
    (next: number) =>
      Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(next.toFixed(2)))),
    [],
  );

  const clampTranslate = useCallback(
    (nextX: number, nextY: number, nextScale: number) => {
      const viewport = viewportRef.current;
      const stage = stageRef.current;
      if (!viewport || !stage) {
        return { x: nextX, y: nextY };
      }

      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      const baseW = stage.offsetWidth || vw;
      const baseH = stage.offsetHeight || vh;

      const maxX = Math.max(64, (baseW * nextScale - vw * 0.35) / 2);
      const maxY = Math.max(64, (baseH * nextScale - vh * 0.35) / 2);

      return {
        x: Math.min(maxX, Math.max(-maxX, nextX)),
        y: Math.min(maxY, Math.max(-maxY, nextY)),
      };
    },
    [],
  );

  const applyZoom = useCallback(
    (nextScaleRaw: number, focalClientX?: number, focalClientY?: number) => {
      const current = transformRef.current;
      const nextScale = clampScale(nextScaleRaw);
      if (nextScale === current.scale) return;

      const viewport = viewportRef.current;
      if (
        viewport &&
        typeof focalClientX === 'number' &&
        typeof focalClientY === 'number'
      ) {
        const rect = viewport.getBoundingClientRect();
        const relX = focalClientX - (rect.left + rect.width / 2);
        const relY = focalClientY - (rect.top + rect.height / 2);
        const ratio = nextScale / current.scale;
        const rawX = relX - (relX - current.x) * ratio;
        const rawY = relY - (relY - current.y) * ratio;
        const clamped = clampTranslate(rawX, rawY, nextScale);
        setScale(nextScale);
        setTranslate(clamped);
        return;
      }

      const ratio = nextScale / current.scale;
      const clamped = clampTranslate(
        current.x * ratio,
        current.y * ratio,
        nextScale,
      );
      setScale(nextScale);
      setTranslate(clamped);
    },
    [clampScale, clampTranslate],
  );

  const handleZoomIn = useCallback(() => {
    applyZoom(transformRef.current.scale + SCALE_STEP);
  }, [applyZoom]);

  const handleZoomOut = useCallback(() => {
    applyZoom(transformRef.current.scale - SCALE_STEP);
  }, [applyZoom]);

  const handleResetView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  // Support Ctrl/Cmd + Wheel focal zoom without trapping normal page scrolling
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      applyZoom(transformRef.current.scale * factor, e.clientX, e.clientY);
    }

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    // Do not hijack gestures on HUD buttons or inspector controls
    if (target.closest('[data-map-hud="true"]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const pointers = activePointersRef.current;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      const startedOnMarker = Boolean(target.closest('[data-table-marker="true"]'));
      panOriginRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: transformRef.current.x,
        baseY: transformRef.current.y,
        startedOnMarker,
        activated: false,
      };
      pinchOriginRef.current = null;
    } else if (pointers.size === 2) {
      // Transition cleanly into 2-finger pinch-to-zoom even if started on markers
      const [p1, p2] = Array.from(pointers.values());
      const distance = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      pinchOriginRef.current = {
        distance,
        midX: (p1.x + p2.x) / 2,
        midY: (p1.y + p2.y) / 2,
        baseScale: transformRef.current.scale,
        baseX: transformRef.current.x,
        baseY: transformRef.current.y,
      };
      panOriginRef.current = null;
      setIsInteracting(true);
      suppressClickUntilRef.current = Date.now() + 350;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture failures on synthetic/unsupported pointers
      }
    }
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const pointers = activePointersRef.current;
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two-finger pinch-to-zoom with focal midpoint tracking
    if (pointers.size >= 2 && pinchOriginRef.current) {
      const [p1, p2] = Array.from(pointers.values());
      const currentDistance = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const origin = pinchOriginRef.current;

      const nextScale = clampScale(
        origin.baseScale * (currentDistance / origin.distance),
      );
      const viewport = viewportRef.current;
      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        const originRelX = origin.midX - (rect.left + rect.width / 2);
        const originRelY = origin.midY - (rect.top + rect.height / 2);
        const currentRelX = midX - (rect.left + rect.width / 2);
        const currentRelY = midY - (rect.top + rect.height / 2);

        const ratio = nextScale / origin.baseScale;
        const rawX = currentRelX - (originRelX - origin.baseX) * ratio;
        const rawY = currentRelY - (originRelY - origin.baseY) * ratio;

        setScale(nextScale);
        setTranslate(clampTranslate(rawX, rawY, nextScale));
      } else {
        setScale(nextScale);
      }
      suppressClickUntilRef.current = Date.now() + 300;
      return;
    }

    // Single-pointer pan (works even when starting over a dense table marker)
    const origin = panOriginRef.current;
    if (!origin || origin.pointerId !== e.pointerId) return;

    const dx = e.clientX - origin.startX;
    const dy = e.clientY - origin.startY;
    if (!origin.activated) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      origin.activated = true;
      setIsInteracting(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture failures
      }
    }

    suppressClickUntilRef.current = Date.now() + 250;
    setTranslate(
      clampTranslate(
        origin.baseX + dx,
        origin.baseY + dy,
        transformRef.current.scale,
      ),
    );
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const pointers = activePointersRef.current;
    pointers.delete(e.pointerId);

    const origin = panOriginRef.current;
    if (
      e.type === 'pointerup' &&
      origin &&
      origin.pointerId === e.pointerId &&
      !origin.activated &&
      !origin.startedOnMarker &&
      !pinchOriginRef.current
    ) {
      setInspectedTableId(null);
    }

    if (pointers.size === 1) {
      // Smoothly resume single-finger pan after lifting one pinch finger
      const [remainingId, pos] = Array.from(pointers.entries())[0];
      pinchOriginRef.current = null;
      panOriginRef.current = {
        pointerId: remainingId,
        startX: pos.x,
        startY: pos.y,
        baseX: transformRef.current.x,
        baseY: transformRef.current.y,
        startedOnMarker: false,
        activated: true,
      };
      return;
    }

    if (pointers.size === 0) {
      panOriginRef.current = null;
      pinchOriginRef.current = null;
      setIsInteracting(false);
    }
  }

  const inspectedEntry = inspectedTableId
    ? tableLookup.get(inspectedTableId) ?? null
    : null;
  const desktopInspectorEntry =
    inspectedEntry ?? (hoveredTableId ? tableLookup.get(hoveredTableId) ?? null : null);

  const showUnpositionedOnlyOnMobile =
    !showFloorImage &&
    positionedTables.length === 0 &&
    unpositionedTables.length > 0;

  return (
    <div className="space-y-3 md:space-y-4">
      <div
        className={`relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] md:rounded-3xl ${
          showUnpositionedOnlyOnMobile ? 'hidden md:block' : ''
        }`}
      >
        {/* Top bar (Mobile) / Floating HUD (Desktop) */}
        <div
          data-map-hud="true"
          className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 md:pointer-events-none md:absolute md:inset-x-4 md:top-4 md:z-20 md:border-b-0 md:bg-transparent md:p-0"
        >
          <div className="inline-flex min-w-0 items-center gap-1.5 text-[11px] leading-tight font-medium text-[var(--text-secondary)] md:rounded-full md:border md:border-[var(--border-strong)] md:bg-[var(--bg-surface)] md:px-3.5 md:py-2 md:shadow-xs">
            <Move className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
            <span className="md:hidden">Arraste ou faça pinça</span>
            <span className="hidden md:inline">
              Arraste para mover · Ctrl + Scroll para zoom
            </span>
          </div>

          {/* Zoom & Reset Controls (min 44x44px touch targets) */}
          <div className="pointer-events-auto flex shrink-0 items-center gap-1 md:rounded-full md:border md:border-[var(--border-strong)] md:bg-[var(--bg-surface)] md:p-1 md:shadow-sm">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={scale <= MIN_SCALE}
              aria-label="Diminuir zoom"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <span
              aria-live="off"
              className="font-mono-num min-w-[44px] text-center text-xs font-semibold text-[var(--text-primary)]"
            >
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={scale >= MAX_SCALE}
              aria-label="Aumentar zoom"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
            <span
              className="mx-0.5 h-5 w-px bg-[var(--border-strong)]"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={handleResetView}
              aria-label="Centralizar mapa"
              title="Centralizar mapa"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--text-primary)]"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Pan/Zoom Viewport */}
        <div
          ref={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`relative flex h-[56dvh] min-h-[340px] max-h-[500px] w-full touch-none items-center justify-center overflow-hidden p-3 select-none sm:p-5 md:h-[580px] md:max-h-none md:p-8 ${
            isInteracting ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, var(--map-grid) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        >
          {/* Transformed Stage */}
          <div
            ref={stageRef}
            className={`relative w-full max-w-4xl origin-center ${
              isInteracting
                ? 'transition-none'
                : 'transition-transform duration-200 ease-out motion-reduce:transition-none'
            }`}
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
              /* Architectural Blueprint Fallback when floorPlanImageUrl is null */
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
                      Você pode selecionar mesas disponíveis abaixo ou alternar
                      para a visualização em lista por setores.
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
              const recentUpdate = recentTableUpdates?.[table.id] ?? null;

              const matchesSector =
                !activeSectorId || sector.id === activeSectorId;
              const matchesAvailability =
                !onlyAvailable || selectable || isSelected;
              const isDimmed = !matchesSector || !matchesAvailability;

              const isHovered = hoveredTableId === table.id;
              const isInspected = inspectedTableId === table.id;
              const leftPct = Math.min(100, Math.max(0, table.x ?? 0));
              const topPct = Math.min(100, Math.max(0, table.y ?? 0));
              const showTooltipBelow = topPct < 26;
              const tooltipAlignClass =
                leftPct < 20
                  ? 'left-0 translate-x-0'
                  : leftPct > 80
                    ? 'right-0 left-auto translate-x-0'
                    : 'left-1/2 -translate-x-1/2';

              return (
                <div
                  key={table.id}
                  style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    // Spread clusters cleanly on zoom while preserving 44x44px hit targets
                    transform: `translate(-50%, -50%) scale(${1 / scale})`,
                  }}
                  className={`absolute ${
                    isInteracting
                      ? 'transition-none'
                      : 'transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none'
                  } ${
                    isDimmed
                      ? 'pointer-events-none z-0 opacity-20'
                      : isHovered || isInspected || isSelected
                        ? 'z-30'
                        : recentUpdate
                          ? 'z-20'
                          : 'z-10'
                  }`}
                >
                  <TableMapMarker
                    data-table-marker="true"
                    sizeVariant="interactive"
                    visualState={visualState}
                    recentUpdate={recentUpdate}
                    label={table.label}
                    markerClassName={meta.markerClass}
                    onMouseEnter={() => {
                      if (!isMobileViewport) setHoveredTableId(table.id);
                    }}
                    onMouseLeave={() =>
                      setHoveredTableId((prev) =>
                        prev === table.id ? null : prev,
                      )
                    }
                    onFocus={() => {
                      if (!isMobileViewport) setHoveredTableId(table.id);
                    }}
                    onBlur={() =>
                      setHoveredTableId((prev) =>
                        prev === table.id ? null : prev,
                      )
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (Date.now() < suppressClickUntilRef.current) return;

                      // Option A: mobile taps open Bottom Sheet first; desktop toggles AVAILABLE directly
                      if (isMobileViewport) {
                        setInspectedTableId(table.id);
                        return;
                      }

                      setInspectedTableId(table.id);
                      if (selectable) {
                        onToggleTable(table, sector);
                      }
                    }}
                    aria-label={`Mesa ${table.label}, setor ${sector.name}, ${table.capacity} lugares, ${formatMinorCurrency(table.priceMinor, currency)}, ${meta.label}`}
                    aria-pressed={selectable || isSelected ? isSelected : undefined}
                    className="cursor-pointer"
                  />

                  {/* Desktop hover & keyboard-focus popover (edge-clamped) */}
                  {!isMobileViewport && isHovered && (
                    <div
                      role="tooltip"
                      className={`pointer-events-none absolute z-40 hidden w-60 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-3 text-left shadow-[var(--shadow-elevated)] md:block ${tooltipAlignClass} ${
                        showTooltipBelow ? 'top-full mt-2' : 'bottom-full mb-2'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-sm font-bold text-[var(--text-primary)]">
                          Mesa {table.label}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                        >
                          <StatusBadgeIcon
                            state={visualState}
                            className="h-2.5 w-2.5 shrink-0"
                          />
                          {meta.shortLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] font-medium text-[var(--text-secondary)]">
                        {sector.name}
                      </p>
                      <div className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 text-xs">
                        <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                          <Users className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                          {table.capacity} lugares
                        </span>
                        <span className="font-mono-num font-semibold text-[var(--text-primary)]">
                          {formatMinorCurrency(table.priceMinor, currency)}
                        </span>
                      </div>
                      {visualState === 'RESERVED' && table.expiresAt && (
                        <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-[var(--status-pending-fg)]">
                          <Clock className="h-3 w-3 shrink-0" />
                          Bloqueio até {formatExpiryTime(table.expiresAt)}
                        </p>
                      )}
                      {selectable && (
                        <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">
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

          {/* Desktop Anchored Inspector Card (overlaid inside viewport — zero CLS) */}
          {!isMobileViewport && desktopInspectorEntry && (
            <div
              data-map-hud="true"
              className="pointer-events-auto absolute bottom-4 left-4 z-20 hidden w-80 md:block"
            >
              <TableInspectorContent
                table={desktopInspectorEntry.table}
                sector={desktopInspectorEntry.sector}
                currency={currency}
                isSelected={selectedTableIds.has(desktopInspectorEntry.table.id)}
                onToggle={() =>
                  onToggleTable(
                    desktopInspectorEntry.table,
                    desktopInspectorEntry.sector,
                  )
                }
                onClose={() => {
                  setInspectedTableId(null);
                  setHoveredTableId(null);
                }}
                variant="desktop"
              />
            </div>
          )}
        </div>

        {/* Always-visible Semantic Legend Bar (color + pattern + icon + tabular counts) */}
        <div
          aria-label="Legenda de status das mesas"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 md:px-5"
        >
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-[var(--text-primary)]">
            {LEGEND_STATES.map((state) => {
              const meta = TABLE_STATUS_META[state];
              const count = statusCounts[state];
              return (
                <li key={state} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`grid size-5 place-items-center rounded-full ${meta.swatchClass}`}
                  >
                    <StatusBadgeIcon state={state} className="h-2.5 w-2.5" />
                  </span>
                  <span>{meta.shortLabel}</span>
                  <span className="font-mono-num min-w-[1.5ch] text-[11px] font-semibold text-[var(--text-secondary)]">
                    ({count})
                  </span>
                </li>
              );
            })}
          </ul>
          <span className="text-[11px] font-medium text-[var(--text-secondary)] md:hidden">
            Toque em uma mesa para ver detalhes
          </span>
        </div>
      </div>

      {/* Mobile Bottom Sheet Drawer (Option A — zero layout shift, non-hover inspection) */}
      {isMobileViewport && inspectedEntry && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Detalhes da Mesa ${inspectedEntry.table.label}`}
          className="fixed inset-0 z-50 flex items-end md:hidden"
        >
          <div
            aria-hidden="true"
            onClick={() => setInspectedTableId(null)}
            className="animate-fade-in absolute inset-0 bg-[var(--modal-backdrop)]"
          />
          <div className="table-sheet-in relative w-full rounded-t-3xl border-t border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-elevated)]">
            <div
              aria-hidden="true"
              className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--border-strong)]"
            />
            <TableInspectorContent
              table={inspectedEntry.table}
              sector={inspectedEntry.sector}
              currency={currency}
              isSelected={selectedTableIds.has(inspectedEntry.table.id)}
              onToggle={() =>
                onToggleTable(inspectedEntry.table, inspectedEntry.sector)
              }
              onClose={() => setInspectedTableId(null)}
              variant="mobile-sheet"
            />
          </div>
        </div>
      )}

      {/* Fallback tray for tables without (x, y) coordinates */}
      {unpositionedTables.length > 0 && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 md:rounded-3xl md:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">
                Mesas sem posição definida na planta
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Escolha uma mesa abaixo.
              </p>
            </div>
            <span className="font-mono-num rounded-full bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">
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
              const recentUpdate = recentTableUpdates?.[table.id] ?? null;

              if (activeSectorId && sector.id !== activeSectorId) return null;
              if (onlyAvailable && !selectable && !isSelected) return null;

              return (
                <button
                  key={table.id}
                  type="button"
                  disabled={!selectable}
                  aria-pressed={isSelected}
                  onClick={() => onToggleTable(table, sector)}
                  className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)] disabled:cursor-not-allowed ${meta.badgeClass} ${
                    recentUpdate ? 'animate-sse-card' : ''
                  }`}
                >
                  <StatusBadgeIcon state={visualState} className="h-3.5 w-3.5 shrink-0" />
                  <span className={visualState === 'SOLD' ? 'line-through' : ''}>
                    {table.label}
                  </span>
                  <span className="font-medium">· {sector.name}</span>
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
