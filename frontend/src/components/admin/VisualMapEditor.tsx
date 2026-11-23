import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  AlertCircle,
  Check,
  Crosshair,
  Grid,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  Loader2,
  Maximize2,
  Minus,
  Move,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  getAdminErrorMessage,
  getSectorColor,
  isValidHttpsImageUrl,
  minorToEditablePrice,
} from '@/components/admin/adminUtils';
import { TableMapMarker } from '@/components/event/TableMapMarker';
import { useAuthenticatedImageUrl } from '@/hooks/useAuthenticatedImageUrl';
import { adminApi } from '@/lib/api';
import { EVENT_IMAGE_ACCEPT, IMAGE_SIZE_LABEL, validateImageFile } from '@/lib/eventImages';
import { formatMinorCurrency, parseMajorPriceToMinor } from '@/lib/format';
import type {
  AdminEventDetail,
  AdminSectorWithTables,
  AdminTable,
  LayoutTableCoordinate,
} from '@/types/api';

interface VisualMapEditorProps {
  event: AdminEventDetail;
  imageRevision: number;
  onRefreshEvent: (bumpImageRevision?: boolean) => Promise<void>;
  onGoToInventory: () => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

type CoordValue = { x: number; y: number } | { x: null; y: null };

interface FlatTableEntry {
  table: AdminTable;
  sector: AdminSectorWithTables;
  sectorIndex: number;
}

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.25;
const ZOOM_STEP = 0.25;

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

function snapPercent(value: number, step: number): number {
  return clampPercent(Math.round(value / step) * step);
}

function coordsEqual(
  a: { x: number | null; y: number | null },
  b: { x: number | null; y: number | null },
): boolean {
  if (a.x === null && a.y === null && b.x === null && b.y === null) return true;
  if (a.x === null || a.y === null || b.x === null || b.y === null) return false;
  return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;
}

export function VisualMapEditor({
  event,
  imageRevision,
  onRefreshEvent,
  onGoToInventory,
  onNotify,
}: VisualMapEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const floorUploadRef = useRef<HTMLInputElement>(null);

  // Draft coordinates overriding server table positions (keyed by tableId)
  const [draftCoords, setDraftCoords] = useState<Record<string, CoordValue>>({});
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [activeSectorFilter, setActiveSectorFilter] = useState<string>('ALL');

  // Canvas interaction state
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridStep, setGridStep] = useState<2.5 | 5>(2.5);
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);

  // Floor plan quick-URL bar
  const [showUrlPopover, setShowUrlPopover] = useState(false);
  const [floorUrlInput, setFloorUrlInput] = useState(
    event.floorPlanImageUrl?.startsWith('https://')
      ? event.floorPlanImageUrl
      : '',
  );
  const [uploadingFloor, setUploadingFloor] = useState(false);
  const [floorUploadError, setFloorUploadError] = useState<string | null>(null);
  const [unreadableFloorSrc, setUnreadableFloorSrc] = useState<string | null>(null);

  // Saving layout state
  const [savingLayout, setSavingLayout] = useState(false);

  // Inspector edit form state
  const [editLabel, setEditLabel] = useState('');
  const [editCapacity, setEditCapacity] = useState('4');
  const [editPrice, setEditPrice] = useState('');
  const [editSectorId, setEditSectorId] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [savingTable, setSavingTable] = useState(false);
  const [tableFormError, setTableFormError] = useState<string | null>(null);

  // Dragging metadata ref
  const dragMetaRef = useRef<{
    tableId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);

  // Reset drafts when switching events
  useEffect(() => {
    setDraftCoords({});
    setSelectedTableId(null);
    setActiveSectorFilter('ALL');
    setFloorUploadError(null);
    setFloorUrlInput(
      event.floorPlanImageUrl?.startsWith('https://')
        ? event.floorPlanImageUrl
        : '',
    );
  }, [event.id, event.floorPlanImageUrl]);

  const { src: resolvedFloorUrl, error: floorLoadError } =
    useAuthenticatedImageUrl(event.floorPlanImageUrl, imageRevision);
  const floorPreviewFailed = floorLoadError || Boolean(resolvedFloorUrl && resolvedFloorUrl === unreadableFloorSrc);
  const floorImageError = floorUploadError ?? (floorPreviewFailed ? 'Não foi possível exibir a planta baixa no editor.' : null);

  useEffect(() => setUnreadableFloorSrc(null), [imageRevision]);

  // Flatten tables with sector color index
  const { allTables, tableMap } = useMemo(() => {
    const list: FlatTableEntry[] = [];
    const map = new Map<string, FlatTableEntry>();
    event.sectors.forEach((sector, sectorIndex) => {
      for (const table of sector.tables) {
        const entry = { table, sector, sectorIndex };
        list.push(entry);
        map.set(table.id, entry);
      }
    });
    return { allTables: list, tableMap: map };
  }, [event.sectors]);

  const getEffectiveCoord = useCallback(
    (table: AdminTable): CoordValue => {
      const override = draftCoords[table.id];
      if (override) return override;
      if (
        typeof table.x === 'number' &&
        typeof table.y === 'number' &&
        Number.isFinite(table.x) &&
        Number.isFinite(table.y)
      ) {
        return { x: table.x, y: table.y };
      }
      return { x: null, y: null };
    },
    [draftCoords],
  );

  // Compute dirty list (only tables whose effective coord differs from server)
  const dirtyCoordinates = useMemo<LayoutTableCoordinate[]>(() => {
    const changed: LayoutTableCoordinate[] = [];
    for (const { table } of allTables) {
      const override = draftCoords[table.id];
      if (!override) continue;
      if (!coordsEqual(override, table)) {
        if (override.x === null || override.y === null) {
          changed.push({ tableId: table.id, x: null, y: null });
        } else {
          changed.push({ tableId: table.id, x: override.x, y: override.y });
        }
      }
    }
    return changed;
  }, [allTables, draftCoords]);

  const dirtyIdSet = useMemo(
    () => new Set(dirtyCoordinates.map((c) => c.tableId)),
    [dirtyCoordinates],
  );

  // Split positioned vs unpositioned
  const { positionedTables, unpositionedTables } = useMemo(() => {
    const positioned: Array<FlatTableEntry & { coord: { x: number; y: number } }> =
      [];
    const unpositioned: FlatTableEntry[] = [];

    for (const entry of allTables) {
      const coord = getEffectiveCoord(entry.table);
      if (coord.x !== null && coord.y !== null) {
        positioned.push({ ...entry, coord: { x: coord.x, y: coord.y } });
      } else {
        unpositioned.push(entry);
      }
    }
    return { positionedTables: positioned, unpositionedTables: unpositioned };
  }, [allTables, getEffectiveCoord]);

  const selectedEntry = selectedTableId
    ? tableMap.get(selectedTableId) ?? null
    : null;
  const selectedCoord = selectedEntry
    ? getEffectiveCoord(selectedEntry.table)
    : null;

  // Populate inspector form whenever selected table changes
  useEffect(() => {
    if (!selectedEntry) return;
    setEditLabel(selectedEntry.table.label);
    setEditCapacity(String(selectedEntry.table.capacity));
    setEditPrice(minorToEditablePrice(selectedEntry.table.priceMinor));
    setEditSectorId(selectedEntry.sector.id);
    setEditEnabled(selectedEntry.table.isEnabled);
    setTableFormError(null);
  }, [
    selectedEntry?.table.id,
    selectedEntry?.table.label,
    selectedEntry?.table.capacity,
    selectedEntry?.table.priceMinor,
    selectedEntry?.table.isEnabled,
    selectedEntry?.sector.id,
  ]);

  const setTableDraftPosition = useCallback(
    (tableId: string, nextCoord: CoordValue) => {
      setDraftCoords((prev) => ({
        ...prev,
        [tableId]: nextCoord,
      }));
    },
    [],
  );

  // Convert client pointer position to stage percentage (0..100)
  const clientToStagePercent = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const stage = stageRef.current;
      if (!stage) return null;
      const rect = stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const rawX = ((clientX - rect.left) / rect.width) * 100;
      const rawY = ((clientY - rect.top) / rect.height) * 100;
      return {
        x: snapToGrid ? snapPercent(rawX, gridStep) : clampPercent(rawX),
        y: snapToGrid ? snapPercent(rawY, gridStep) : clampPercent(rawY),
      };
    },
    [snapToGrid, gridStep],
  );

  // Pointer drag handlers on table marker
  function handleMarkerPointerDown(
    e: ReactPointerEvent<HTMLButtonElement>,
    tableId: string,
  ) {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedTableId(tableId);
    setDraggingTableId(tableId);
    dragMetaRef.current = {
      tableId,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    };
  }

  function handleMarkerPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const meta = dragMetaRef.current;
    if (!meta || meta.pointerId !== e.pointerId) return;

    const dx = e.clientX - meta.startClientX;
    const dy = e.clientY - meta.startClientY;
    if (!meta.moved && Math.hypot(dx, dy) < 3) return;
    meta.moved = true;

    const pct = clientToStagePercent(e.clientX, e.clientY);
    if (!pct) return;
    setTableDraftPosition(meta.tableId, pct);
  }

  function handleMarkerPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const meta = dragMetaRef.current;
    if (!meta || meta.pointerId !== e.pointerId) return;
    dragMetaRef.current = null;
    setDraggingTableId(null);
  }

  // Keyboard arrow nudging for selected positioned table
  useEffect(() => {
    if (!selectedEntry) return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (
        !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
      ) {
        return;
      }

      const current = getEffectiveCoord(selectedEntry!.table);
      if (current.x === null || current.y === null) return;

      e.preventDefault();
      const step = e.shiftKey ? 5 : snapToGrid ? gridStep : 0.5;
      let nextX = current.x;
      let nextY = current.y;
      if (e.key === 'ArrowLeft') nextX -= step;
      if (e.key === 'ArrowRight') nextX += step;
      if (e.key === 'ArrowUp') nextY -= step;
      if (e.key === 'ArrowDown') nextY += step;

      setTableDraftPosition(selectedEntry!.table.id, {
        x: clampPercent(nextX),
        y: clampPercent(nextY),
      });
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedEntry, getEffectiveCoord, snapToGrid, gridStep, setTableDraftPosition]);

  // Place a single unpositioned table on the map
  function handlePlaceTable(table: AdminTable) {
    // Spread slightly so multiple clicks don't stack identically on 50,50
    const offsetIndex = positionedTables.length % 12;
    const rawX = 20 + (offsetIndex % 4) * 20;
    const rawY = 25 + Math.floor(offsetIndex / 4) * 22;
    const coord = {
      x: snapToGrid ? snapPercent(rawX, gridStep) : clampPercent(rawX),
      y: snapToGrid ? snapPercent(rawY, gridStep) : clampPercent(rawY),
    };
    setTableDraftPosition(table.id, coord);
    setSelectedTableId(table.id);
  }

  // Auto-distribute all unpositioned tables neatly on the grid
  function handleAutoDistributeUnpositioned() {
    const targets = unpositionedTables.filter(
      (entry) =>
        activeSectorFilter === 'ALL' || entry.sector.id === activeSectorFilter,
    );
    if (targets.length === 0) return;

    const cols = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(targets.length * 1.4))));
    const rows = Math.ceil(targets.length / cols);

    setDraftCoords((prev) => {
      const next = { ...prev };
      targets.forEach((entry, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const rawX = cols === 1 ? 50 : 12 + (col / (cols - 1)) * 76;
        const rawY = rows === 1 ? 50 : 18 + (row / (rows - 1)) * 68;
        next[entry.table.id] = {
          x: snapToGrid ? snapPercent(rawX, gridStep) : clampPercent(rawX),
          y: snapToGrid ? snapPercent(rawY, gridStep) : clampPercent(rawY),
        };
      });
      return next;
    });
    setSelectedTableId(targets[0].table.id);
  }

  // Save layout batch to PUT /admin/events/:eventId/layout
  async function handleSaveLayout() {
    if (dirtyCoordinates.length === 0) return;
    setSavingLayout(true);
    try {
      // Chunk by 250 tables per API contract limit
      const chunkSize = 250;
      for (let i = 0; i < dirtyCoordinates.length; i += chunkSize) {
        const slice = dirtyCoordinates.slice(i, i + chunkSize);
        await adminApi.updateLayout(event.id, { tables: slice });
      }
      setDraftCoords({});
      onNotify(
        'success',
        `Layout salvo com sucesso (${dirtyCoordinates.length} ${
          dirtyCoordinates.length === 1 ? 'mesa atualizada' : 'mesas atualizadas'
        }).`,
      );
      await onRefreshEvent();
    } catch (err) {
      onNotify('error', getAdminErrorMessage(err));
    } finally {
      setSavingLayout(false);
    }
  }

  // Upload floor plan directly from editor
  async function handleFloorPlanUpload(file: File) {
    const validationErr = validateImageFile(file);
    setFloorUploadError(validationErr);
    if (validationErr) {
      return;
    }
    setUploadingFloor(true);
    try {
      await adminApi.uploadEventImage(event.id, 'floor-plan', file);
      setShowUrlPopover(false);
      onNotify('success', 'Planta baixa enviada com sucesso.');
      await onRefreshEvent(true);
    } catch (err) {
      setFloorUploadError(getAdminErrorMessage(err));
    } finally {
      setUploadingFloor(false);
    }
  }

  async function handleApplyFloorPlanUrl(e: FormEvent) {
    e.preventDefault();
    const trimmed = floorUrlInput.trim();
    if (trimmed && !isValidHttpsImageUrl(trimmed)) {
      onNotify('error', 'Informe uma URL HTTPS válida para a planta baixa.');
      return;
    }
    setUploadingFloor(true);
    setFloorUploadError(null);
    try {
      await adminApi.updateLayout(event.id, {
        floorPlanImageUrl: trimmed || null,
        tables: [],
      });
      setShowUrlPopover(false);
      onNotify(
        'success',
        trimmed ? 'URL da planta baixa atualizada.' : 'Planta baixa removida.',
      );
      await onRefreshEvent(true);
    } catch (err) {
      onNotify('error', getAdminErrorMessage(err));
    } finally {
      setUploadingFloor(false);
    }
  }

  // Save selected table details (label, capacity, price, sector, enabled)
  async function handleSaveSelectedTable(e: FormEvent) {
    e.preventDefault();
    if (!selectedEntry) return;
    setTableFormError(null);

    const trimmedLabel = editLabel.trim();
    const capNum = Number.parseInt(editCapacity, 10);
    const priceMinor = parseMajorPriceToMinor(editPrice);

    if (!trimmedLabel) {
      setTableFormError('Informe o número da mesa.');
      return;
    }
    if (!Number.isInteger(capNum) || capNum < 1) {
      setTableFormError('Capacidade deve ser um inteiro positivo.');
      return;
    }
    if (!priceMinor || priceMinor <= 0) {
      setTableFormError('Informe um preço válido.');
      return;
    }

    setSavingTable(true);
    try {
      await adminApi.updateTable(
        event.id,
        selectedEntry.sector.id,
        selectedEntry.table.id,
        {
          label: trimmedLabel,
          capacity: capNum,
          priceMinor,
          isEnabled: editEnabled,
          ...(editSectorId && editSectorId !== selectedEntry.sector.id
            ? { sectorId: editSectorId }
            : {}),
        },
      );
      onNotify('success', `Mesa ${trimmedLabel} atualizada.`);
      await onRefreshEvent();
    } catch (err) {
      setTableFormError(getAdminErrorMessage(err));
    } finally {
      setSavingTable(false);
    }
  }

  if (allTables.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-6 py-14 text-center">
        <LayoutGrid className="mx-auto h-9 w-9 text-[var(--text-muted)]" />
        <h3 className="font-display mt-3 text-base font-bold text-[var(--text-primary)]">
          Cadastre setores e mesas antes de montar o mapa
        </h3>
        <p className="mx-auto mt-1 max-w-md text-xs text-[var(--text-muted)]">
          Assim que você criar mesas no evento, elas aparecerão aqui para arrastar e posicionar sobre a planta baixa.
        </p>
        <button
          type="button"
          onClick={onGoToInventory}
          className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-4 py-2 text-xs font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)]"
        >
          Ir para Setores e Mesas
        </button>
      </div>
    );
  }

  const visibleUnpositioned = unpositionedTables.filter(
    (entry) =>
      activeSectorFilter === 'ALL' || entry.sector.id === activeSectorFilter,
  );

  return (
    <div className="space-y-4">
      {/* Top Editor Action Bar */}
      <div className="flex flex-col gap-3 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Floor Plan Upload */}
          <input
            ref={floorUploadRef}
            type="file"
            accept={EVENT_IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handleFloorPlanUpload(file);
            }}
          />
          <button
            type="button"
            disabled={uploadingFloor}
            title={`PNG, JPEG ou WebP, até ${IMAGE_SIZE_LABEL}`}
            aria-describedby={floorImageError ? 'floor-image-error' : undefined}
            onClick={() => floorUploadRef.current?.click()}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            {uploadingFloor ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5 text-[var(--accent)]" />
            )}
            {uploadingFloor ? 'Enviando planta…' : 'Enviar Planta'}
          </button>

          <button
            type="button"
            onClick={() => setShowUrlPopover((prev) => !prev)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Link2 className="h-3.5 w-3.5" />
            URL Planta
          </button>

          <span className="hidden h-5 w-px bg-[var(--border-subtle)] sm:inline-block" />

          {/* Snap to Grid */}
          <button
            type="button"
            onClick={() => setSnapToGrid((prev) => !prev)}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              snapToGrid
                ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
            Snap: {snapToGrid ? `${gridStep}%` : 'Off'}
          </button>

          {snapToGrid && (
            <button
              type="button"
              onClick={() => setGridStep((prev) => (prev === 2.5 ? 5 : 2.5))}
              title="Alternar passo da grade"
              className="cursor-pointer rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 font-mono-num text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Passo {gridStep}%
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowGrid((prev) => !prev)}
            className="cursor-pointer rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {showGrid ? 'Ocultar grade' : 'Mostrar grade'}
          </button>

          {/* Zoom Controls */}
          <div className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5">
            <button
              type="button"
              disabled={zoom <= MIN_ZOOM}
              onClick={() =>
                setZoom((z) => Math.max(MIN_ZOOM, Number((z - ZOOM_STEP).toFixed(2))))
              }
              aria-label="Diminuir zoom"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="font-mono-num min-w-[42px] text-center text-[11px] font-semibold text-[var(--text-primary)]">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              disabled={zoom >= MAX_ZOOM}
              onClick={() =>
                setZoom((z) => Math.min(MAX_ZOOM, Number((z + ZOOM_STEP).toFixed(2))))
              }
              aria-label="Aumentar zoom"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {zoom !== 1 && (
              <button
                type="button"
                onClick={() => setZoom(1)}
                title="Resetar zoom"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Save Layout Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {dirtyCoordinates.length > 0 && (
            <>
              <span className="rounded-full border border-amber-500/35 bg-amber-500/12 px-3 py-1 text-xs font-semibold text-amber-700">
                {dirtyCoordinates.length}{' '}
                {dirtyCoordinates.length === 1
                  ? 'alteração pendente'
                  : 'alterações pendentes'}
              </span>
              <button
                type="button"
                disabled={savingLayout}
                onClick={() => setDraftCoords({})}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Descartar
              </button>
            </>
          )}

          <button
            type="button"
            disabled={savingLayout || dirtyCoordinates.length === 0}
            onClick={() => void handleSaveLayout()}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {savingLayout ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Salvar Layout
          </button>
        </div>
      </div>

      {floorImageError && (
        <p id="floor-image-error" role="alert" className="flex items-start gap-2 rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {floorImageError}
        </p>
      )}

      {/* Floor plan external HTTPS URL inline bar */}
      {showUrlPopover && (
        <form
          onSubmit={handleApplyFloorPlanUrl}
          className="flex flex-col gap-2.5 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-3.5 sm:flex-row sm:items-center"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
            <ImageIcon className="h-4 w-4 text-[var(--accent)]" />
            URL HTTPS da planta baixa:
          </div>
          <input
            type="url"
            value={floorUrlInput}
            onChange={(e) => setFloorUrlInput(e.target.value)}
            placeholder="https://exemplo.com/planta.webp (deixe vazio para remover)"
            className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={uploadingFloor}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[var(--cta-bg)] px-4 py-1.5 text-xs font-semibold text-[var(--cta-text)]"
            >
              {uploadingFloor ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Aplicar
            </button>
            <button
              type="button"
              onClick={() => setShowUrlPopover(false)}
              className="cursor-pointer rounded-full p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </form>
      )}

      {/* Sector Filter Pills */}
      {event.sectors.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveSectorFilter('ALL')}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              activeSectorFilter === 'ALL'
                ? 'bg-[var(--cta-bg)] text-[var(--cta-text)]'
                : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
            }`}
          >
            Todos os setores ({allTables.length})
          </button>
          {event.sectors.map((sector, idx) => {
            const color = getSectorColor(idx);
            const active = activeSectorFilter === sector.id;
            return (
              <button
                key={sector.id}
                type="button"
                onClick={() => setActiveSectorFilter(sector.id)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? color.chip
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${color.dot}`} />
                {sector.name} ({sector.tables.length})
              </button>
            );
          })}
        </div>
      )}

      {/* Main Editor Grid: Canvas + Right Inspector */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Left: Interactive Floor Map Canvas + Unpositioned Tray */}
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5 text-[11px] text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1.5">
                <Move className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                Arraste os marcadores com mouse ou toque · Setas do teclado para ajuste fino
              </span>
              <span className="font-mono-num shrink-0 text-[var(--text-muted)]">
                {positionedTables.length}/{allTables.length} no mapa
              </span>
            </div>

            {/* Scrollable Zoom Container */}
            <div className="overflow-auto p-4 sm:p-6">
              <div
                className="mx-auto flex items-center justify-center"
                style={{
                  width: `${Math.round(zoom * 100)}%`,
                  minWidth: '100%',
                }}
              >
                {/* Exact Coordinate Stage (0..100% relative to this element) */}
                <div
                  ref={stageRef}
                  onClick={() => setSelectedTableId(null)}
                  className="relative w-full max-w-4xl select-none"
                  style={{ touchAction: 'none' }}
                >
                  {resolvedFloorUrl && !floorPreviewFailed ? (
                    <img
                      src={resolvedFloorUrl}
                      alt={`Planta baixa de ${event.title}`}
                      draggable={false}
                      onError={() => setUnreadableFloorSrc(resolvedFloorUrl)}
                      className="block h-auto w-full rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] object-contain shadow-[var(--shadow-elevated)]"
                    />
                  ) : (
                    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-elevated)]">
                      <div className="pointer-events-none absolute top-3.5 left-1/2 z-1 -translate-x-1/2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-6 py-1 text-[10px] font-semibold tracking-[0.26em] text-[var(--text-secondary)] uppercase">
                        Palco / Frente
                      </div>
                      {positionedTables.length === 0 && (
                        <div className="pointer-events-none relative z-1 flex h-full flex-col items-center justify-center p-6 text-center text-xs text-[var(--text-secondary)]">
                          <p className="font-semibold text-[var(--text-primary)]">
                            Nenhuma mesa posicionada na planta
                          </p>
                          <p className="mt-1 max-w-sm text-[11px]">
                            Clique nas mesas abaixo ou use &quot;Auto-distribuir&quot; para colocá-las na planta e depois arraste para ajustar.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Optional Grid Overlay */}
                  {showGrid && (
                    <div
                      className="pointer-events-none absolute inset-0 rounded-2xl"
                      style={{
                        backgroundImage:
                          'linear-gradient(to right, var(--map-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--map-grid) 1px, transparent 1px)',
                        backgroundSize: `${gridStep * 2}% ${gridStep * 2}%`,
                      }}
                    />
                  )}

                  {/* Draggable Table Markers */}
                  {positionedTables.map(({ table, sector, sectorIndex, coord }) => {
                    const color = getSectorColor(sectorIndex);
                    const isSelected = selectedTableId === table.id;
                    const isDragging = draggingTableId === table.id;
                    const isDirty = dirtyIdSet.has(table.id);
                    const dimmed =
                      activeSectorFilter !== 'ALL' &&
                      sector.id !== activeSectorFilter;

                    return (
                      <div
                        key={table.id}
                        style={{
                          left: `${coord.x}%`,
                          top: `${coord.y}%`,
                        }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                          isDragging
                            ? 'z-40'
                            : isSelected
                              ? 'z-30'
                              : dimmed
                                ? 'z-0 opacity-25'
                                : 'z-10'
                        }`}
                      >
                        <TableMapMarker
                          label={table.label}
                          onPointerDown={(e) =>
                            handleMarkerPointerDown(e, table.id)
                          }
                          onPointerMove={handleMarkerPointerMove}
                          onPointerUp={handleMarkerPointerUp}
                          onPointerCancel={handleMarkerPointerUp}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTableId(table.id);
                          }}
                          title={`Mesa ${table.label} (${sector.name}) · X ${coord.x.toFixed(1)}%, Y ${coord.y.toFixed(1)}%`}
                          aria-pressed={isSelected}
                          className={`touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                          markerClassName={`shadow-sm ${
                            table.isEnabled
                              ? `${color.bg} ${color.border}`
                              : 'border-slate-500 bg-slate-200 text-slate-700 line-through'
                          } ${
                            isSelected || isDragging
                              ? 'ring-1 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--bg-surface)]'
                              : ''
                          }`}
                        >
                          {isDirty && (
                            <span
                              title="Posição alterada (não salva)"
                              className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full border border-[var(--bg-surface)] bg-[var(--warning)]"
                            />
                          )}
                        </TableMapMarker>

                        {/* Live coordinates pill while dragging */}
                        {isDragging && (
                          <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-0.5 font-mono-num text-[10px] font-semibold whitespace-nowrap shadow-sm">
                            X {coord.x.toFixed(1)}% · Y {coord.y.toFixed(1)}%
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Unpositioned Tables Tray */}
          <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">
                  Mesas sem posição na planta ({visibleUnpositioned.length})
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Clique em uma mesa para inseri-la no mapa ou distribua todas automaticamente.
                </p>
              </div>
              {visibleUnpositioned.length > 0 && (
                <button
                  type="button"
                  onClick={handleAutoDistributeUnpositioned}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent)] transition-opacity hover:opacity-90"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Auto-distribuir ({visibleUnpositioned.length})
                </button>
              )}
            </div>

            {visibleUnpositioned.length === 0 ? (
              <p className="mt-3 text-xs text-[var(--success)]">
                Todas as mesas deste filtro já estão posicionadas na planta.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {visibleUnpositioned.map(({ table, sector, sectorIndex }) => {
                  const color = getSectorColor(sectorIndex);
                  return (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => handlePlaceTable(table)}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)]"
                    >
                      <span className={`h-2 w-2 rounded-full ${color.dot}`} />
                      <span className="font-bold">{table.label}</span>
                      <span className="text-[var(--text-muted)]">
                        {sector.name} · {table.capacity}p
                      </span>
                      <Plus className="h-3 w-3 text-[var(--accent)]" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Table Inspector & Quick Editor */}
        <aside className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          {!selectedEntry ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
              <Crosshair className="h-8 w-8 text-[var(--text-muted)]" />
              <h3 className="font-display mt-3 text-sm font-bold text-[var(--text-primary)]">
                Nenhuma mesa selecionada
              </h3>
              <p className="mt-1 max-w-xs text-xs text-[var(--text-muted)]">
                Clique em qualquer marcador na planta para ajustar coordenadas exatas, número, capacidade ou preço.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-2 border-b border-[var(--border-subtle)] pb-3.5">
                <div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
                      getSectorColor(selectedEntry.sectorIndex).chip
                    }`}
                  >
                    {selectedEntry.sector.name}
                  </span>
                  <h3 className="font-display mt-1.5 text-lg font-bold text-[var(--text-primary)]">
                    Mesa {selectedEntry.table.label}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTableId(null)}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Coordinates Section */}
              <div className="space-y-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/65 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    Posição na Planta (%)
                  </span>
                  {selectedCoord &&
                    selectedCoord.x !== null &&
                    selectedCoord.y !== null && (
                      <button
                        type="button"
                        onClick={() =>
                          setTableDraftPosition(selectedEntry.table.id, {
                            x: null,
                            y: null,
                          })
                        }
                        className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[var(--danger)] hover:underline"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remover do mapa
                      </button>
                    )}
                </div>

                {selectedCoord &&
                selectedCoord.x !== null &&
                selectedCoord.y !== null ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="block space-y-1">
                      <span className="text-[11px] text-[var(--text-muted)]">
                        Eixo X (0–100)
                      </span>
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        max={100}
                        value={selectedCoord.x}
                        onChange={(e) => {
                          const val = Number.parseFloat(e.target.value);
                          if (!Number.isFinite(val)) return;
                          setTableDraftPosition(selectedEntry.table.id, {
                            x: clampPercent(val),
                            y: selectedCoord.y!,
                          });
                        }}
                        className="font-mono-num w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-[var(--text-muted)]">
                        Eixo Y (0–100)
                      </span>
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        max={100}
                        value={selectedCoord.y}
                        onChange={(e) => {
                          const val = Number.parseFloat(e.target.value);
                          if (!Number.isFinite(val)) return;
                          setTableDraftPosition(selectedEntry.table.id, {
                            x: selectedCoord.x!,
                            y: clampPercent(val),
                          });
                        }}
                        className="font-mono-num w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
                      />
                    </label>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handlePlaceTable(selectedEntry.table)}
                    className="w-full cursor-pointer rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] py-2 text-xs font-semibold text-[var(--accent)]"
                  >
                    + Inserir na planta
                  </button>
                )}
              </div>

              {/* Edit Table Properties Form */}
              <form onSubmit={handleSaveSelectedTable} className="space-y-3">
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  Editar dados da mesa
                </p>

                {tableFormError && (
                  <div className="flex items-start gap-2 rounded-xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-2.5 text-[11px] text-[var(--danger)]">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{tableFormError}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      Número / Rótulo
                    </span>
                    <input
                      type="text"
                      required
                      maxLength={60}
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      Capacidade
                    </span>
                    <input
                      type="number"
                      required
                      min={1}
                      max={100}
                      value={editCapacity}
                      onChange={(e) => setEditCapacity(e.target.value)}
                      className="font-mono-num w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                    Preço ({event.currency}) · Atual:{' '}
                    {formatMinorCurrency(
                      selectedEntry.table.priceMinor,
                      event.currency,
                    )}
                  </span>
                  <input
                    type="text"
                    required
                    inputMode="decimal"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="font-mono-num w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
                  />
                </label>

                {event.sectors.length > 1 && (
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      Setor
                    </span>
                    <select
                      value={editSectorId}
                      onChange={(e) => setEditSectorId(e.target.value)}
                      className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
                    >
                      {event.sectors.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/65 px-3 py-2">
                  <span className="text-xs font-medium text-[var(--text-primary)]">
                    Habilitada para reserva
                  </span>
                  <input
                    type="checkbox"
                    checked={editEnabled}
                    onChange={(e) => setEditEnabled(e.target.checked)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </label>

                <button
                  type="submit"
                  disabled={savingTable}
                  className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-4 py-2 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)] disabled:opacity-55"
                >
                  {savingTable ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Salvar dados da mesa
                </button>
              </form>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
