import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Calendar,
  Image as ImageIcon,
  Link2,
  Loader2,
  MapPin,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  dateTimeLocalToIso,
  DISPLAY_MODE_META,
  EVENT_STATUS_META,
  getAdminErrorMessage,
  isoToDateTimeLocal,
  isValidHttpsImageUrl,
  slugifyTitle,
} from '@/components/admin/adminUtils';
import { useAuthenticatedImageUrl } from '@/hooks/useAuthenticatedImageUrl';
import { adminApi } from '@/lib/api';
import { EVENT_IMAGE_ACCEPT, IMAGE_SIZE_LABEL, validateImageFile } from '@/lib/eventImages';
import type {
  AdminEvent,
  AdminEventImageKind,
  CreateAdminEventInput,
  DisplayMode,
  EventStatus,
  UpdateAdminEventInput,
} from '@/types/api';

interface EventFormModalProps {
  mode: 'create' | 'edit';
  initialEvent?: AdminEvent | null;
  imageRevision: number;
  onClose: () => void;
  onSaved: (savedEvent: AdminEvent, uploadedImages: boolean) => void;
}

interface ImageSlotState {
  /** Current server URL (may be https:// or relative /events/.../images/...) */
  existingUrl: string | null;
  /** External HTTPS URL typed by user */
  urlInput: string;
  /** Pending file selected for binary upload */
  file: File | null;
  /** Local ObjectURL preview for the selected file */
  filePreviewUrl: string | null;
  /** Explicit removal requested */
  cleared: boolean;
}

const IMAGE_SLOTS: Array<{
  kind: AdminEventImageKind;
  field: 'coverImageUrl' | 'bannerImageUrl' | 'floorPlanImageUrl';
  label: string;
  hint: string;
}> = [
  {
    kind: 'cover',
    field: 'coverImageUrl',
    label: 'Imagem de Capa',
    hint: 'Card do catálogo',
  },
  {
    kind: 'banner',
    field: 'bannerImageUrl',
    label: 'Banner do Evento',
    hint: 'Destaque no topo da página do evento',
  },
  {
    kind: 'floor-plan',
    field: 'floorPlanImageUrl',
    label: 'Planta Baixa (Mapa)',
    hint: 'Imagem base para o editor visual e reserva no mapa',
  },
];

function createInitialSlot(existingUrl: string | null | undefined): ImageSlotState {
  const normalized = existingUrl ?? null;
  return {
    existingUrl: normalized,
    urlInput: normalized && normalized.startsWith('https://') ? normalized : '',
    file: null,
    filePreviewUrl: null,
    cleared: false,
  };
}

function defaultStartEnd(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 7,
    21,
    0,
    0,
  );
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
  return {
    start: isoToDateTimeLocal(start.toISOString()),
    end: isoToDateTimeLocal(end.toISOString()),
  };
}

function ImageSlotField({
  label,
  hint,
  slot,
  imageRevision,
  onSelectFile,
  onUrlChange,
  onClear,
  onError,
}: {
  label: string;
  hint: string;
  slot: ImageSlotState;
  imageRevision: number;
  onSelectFile: (file: File) => void;
  onUrlChange: (url: string) => void;
  onClear: () => void;
  onError: (message: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const rawDisplayUrl = slot.cleared
    ? null
    : slot.filePreviewUrl
      ? slot.filePreviewUrl
      : slot.urlInput.trim().startsWith('https://')
        ? slot.urlInput.trim()
        : slot.existingUrl;

  const { src: resolvedPreview } = useAuthenticatedImageUrl(
    rawDisplayUrl,
    imageRevision,
  );

  const hasImage = Boolean(
    !slot.cleared && (slot.file || slot.urlInput.trim() || slot.existingUrl),
  );

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/65 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-[var(--text-primary)]">{label}</p>
          <p className="text-[11px] text-[var(--text-muted)]">{hint}</p>
        </div>
        {hasImage && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/20"
          >
            <Trash2 className="h-3 w-3" />
            Remover
          </button>
        )}
      </div>

      {/* Preview Box */}
      <div className="mt-2.5 flex items-center gap-3">
        <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {resolvedPreview ? (
            <img
              src={resolvedPreview}
              alt={label}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="h-5 w-5 text-[var(--text-muted)]" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={EVENT_IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const validationErr = validateImageFile(file);
                if (validationErr) {
                  onError(validationErr);
                  return;
                }
                onSelectFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              <Upload className="h-3.5 w-3.5 text-[var(--accent)]" />
              {slot.file ? 'Trocar arquivo' : 'Fazer upload'}
            </button>
            {slot.file && (
              <span className="truncate text-[11px] font-medium text-[var(--success)]">
                {slot.file.name} ({Math.max(1, Math.round(slot.file.size / 1024))} KB)
              </span>
            )}
            {!slot.file &&
              !slot.cleared &&
              slot.existingUrl &&
              !slot.existingUrl.startsWith('https://') &&
              !slot.urlInput && (
                <span className="text-[11px] text-[var(--text-muted)]">
                  Arquivo hospedado na API
                </span>
              )}
          </div>

          <div className="relative">
            <Link2 className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="url"
              value={slot.urlInput}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="Ou cole uma URL HTTPS (https://...)"
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-1.5 pr-3 pl-8 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function EventFormModal({
  mode,
  initialEvent,
  imageRevision,
  onClose,
  onSaved,
}: EventFormModalProps) {
  const defaults = defaultStartEnd();

  const [title, setTitle] = useState(initialEvent?.title ?? '');
  const [slug, setSlug] = useState(initialEvent?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');
  const [description, setDescription] = useState(initialEvent?.description ?? '');
  const [startsAt, setStartsAt] = useState(
    initialEvent ? isoToDateTimeLocal(initialEvent.startsAt) : defaults.start,
  );
  const [endsAt, setEndsAt] = useState(
    initialEvent ? isoToDateTimeLocal(initialEvent.endsAt) : defaults.end,
  );
  const [venue, setVenue] = useState(initialEvent?.venue ?? '');
  const [city, setCity] = useState(initialEvent?.city ?? '');
  const [category, setCategory] = useState(initialEvent?.category ?? '');
  const [currency, setCurrency] = useState(initialEvent?.currency ?? 'BRL');
  const [status, setStatus] = useState<EventStatus>(initialEvent?.status ?? 'DRAFT');
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    initialEvent?.displayMode ?? 'BOTH',
  );

  const [slots, setSlots] = useState<Record<AdminEventImageKind, ImageSlotState>>(() => ({
    cover: createInitialSlot(initialEvent?.coverImageUrl),
    banner: createInitialSlot(initialEvent?.bannerImageUrl),
    'floor-plan': createInitialSlot(initialEvent?.floorPlanImageUrl),
  }));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clean up created local file previews on unmount
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  useEffect(() => {
    return () => {
      for (const slot of Object.values(slotsRef.current)) {
        if (slot.filePreviewUrl) {
          URL.revokeObjectURL(slot.filePreviewUrl);
        }
      }
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  function updateSlot(
    kind: AdminEventImageKind,
    updater: (prev: ImageSlotState) => ImageSlotState,
  ) {
    setSlots((prev) => {
      const current = prev[kind];
      const next = updater(current);
      if (
        current.filePreviewUrl &&
        current.filePreviewUrl !== next.filePreviewUrl
      ) {
        URL.revokeObjectURL(current.filePreviewUrl);
      }
      return { ...prev, [kind]: next };
    });
  }

  function handleTitleChange(nextTitle: string) {
    setTitle(nextTitle);
    if (!slugTouched) {
      setSlug(slugifyTitle(nextTitle));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    const trimmedSlug = slug.trim().toLowerCase();
    const trimmedVenue = venue.trim();
    const trimmedCity = city.trim();
    const trimmedCategory = category.trim();
    const trimmedCurrency = currency.trim().toUpperCase();
    const trimmedDescription = description.trim();

    if (!trimmedTitle) {
      setError('Informe o título do evento.');
      return;
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(trimmedSlug)) {
      setError(
        'O slug deve conter apenas letras minúsculas, números e hífens (ex.: noite-na-serra).',
      );
      return;
    }
    if (!trimmedVenue || !trimmedCity || !trimmedCategory) {
      setError('Preencha local, cidade e categoria.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
      setError('A moeda deve ter 3 letras maiúsculas (ex.: BRL, USD).');
      return;
    }

    const startsIso = dateTimeLocalToIso(startsAt);
    const endsIso = dateTimeLocalToIso(endsAt);
    if (!startsIso || !endsIso) {
      setError('Informe datas e horários válidos de início e término.');
      return;
    }
    if (new Date(startsIso).getTime() >= new Date(endsIso).getTime()) {
      setError('A data/hora de término deve ser posterior ao início.');
      return;
    }

    // Validate any external HTTPS URLs provided
    for (const def of IMAGE_SLOTS) {
      const slot = slots[def.kind];
      if (!slot.file && !slot.cleared && slot.urlInput.trim()) {
        if (!isValidHttpsImageUrl(slot.urlInput)) {
          setError(`${def.label}: informe uma URL HTTPS válida, sem credenciais.`);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      let savedEvent: AdminEvent;

      if (mode === 'create') {
        const payload: CreateAdminEventInput = {
          slug: trimmedSlug,
          title: trimmedTitle,
          description: trimmedDescription || null,
          startsAt: startsIso,
          endsAt: endsIso,
          venue: trimmedVenue,
          city: trimmedCity,
          category: trimmedCategory,
          currency: trimmedCurrency,
          status,
          displayMode,
        };

        for (const def of IMAGE_SLOTS) {
          const slot = slots[def.kind];
          if (!slot.file && !slot.cleared && slot.urlInput.trim()) {
            payload[def.field] = slot.urlInput.trim();
          }
        }

        const res = await adminApi.createEvent(payload);
        savedEvent = res.event;
      } else {
        if (!initialEvent) {
          throw new Error('Evento não encontrado para edição.');
        }

        const patch: UpdateAdminEventInput = {
          slug: trimmedSlug,
          title: trimmedTitle,
          description: trimmedDescription || null,
          startsAt: startsIso,
          endsAt: endsIso,
          venue: trimmedVenue,
          city: trimmedCity,
          category: trimmedCategory,
          status,
          displayMode,
        };

        // Only send currency when changed so events with reservation history can still be edited
        if (trimmedCurrency !== initialEvent.currency) {
          patch.currency = trimmedCurrency;
        }

        // Only send image URL fields if changed to HTTPS or explicitly cleared.
        // Never send relative `/events/:id/images/:kind` strings back into PATCH.
        for (const def of IMAGE_SLOTS) {
          const slot = slots[def.kind];
          if (slot.file) {
            // Will be updated by the upload endpoint immediately after PATCH
            continue;
          }
          if (slot.cleared && slot.existingUrl !== null) {
            patch[def.field] = null;
          } else if (slot.urlInput.trim()) {
            const nextUrl = slot.urlInput.trim();
            if (nextUrl !== slot.existingUrl) {
              patch[def.field] = nextUrl;
            }
          } else if (
            !slot.urlInput.trim() &&
            slot.existingUrl &&
            slot.existingUrl.startsWith('https://')
          ) {
            patch[def.field] = null;
          }
        }

        const res = await adminApi.updateEvent(initialEvent.id, patch);
        savedEvent = res.event;
      }

      // Upload any pending binary image files
      let uploadedAny = false;
      for (const def of IMAGE_SLOTS) {
        const slot = slots[def.kind];
        if (slot.file) {
          const uploadRes = await adminApi.uploadEventImage(
            savedEvent.id,
            def.kind,
            slot.file,
          );
          savedEvent = {
            ...savedEvent,
            [def.field]: uploadRes.image.url,
          };
          uploadedAny = true;
        }
      }

      onSaved(savedEvent, uploadedAny);
    } catch (err) {
      setError(getAdminErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-3 backdrop-blur-sm sm:p-6"
    >
      <div className="animate-pop-in flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-elevated)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4 sm:px-6">
          <div>
            <h2
              id="event-form-title"
              className="font-display text-lg font-bold text-[var(--text-primary)] sm:text-xl"
            >
              {mode === 'create' ? 'Criar novo evento' : `Editar evento`}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Configure dados gerais, modo de visualização e imagens do evento.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Fechar formulário"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            {error && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-3.5 text-xs text-[var(--danger)]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Title & Slug */}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Título do evento *
                </span>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="Ex.: Noite na Serra"
                  className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Slug da URL *
                </span>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  placeholder="noite-na-serra"
                  className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                />
              </label>
            </div>

            {/* Description */}
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Descrição
              </span>
              <textarea
                rows={3}
                maxLength={8000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalhes sobre atrações, dress code, abertura dos portões..."
                className="w-full resize-y rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </label>

            {/* Dates */}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                  <Calendar className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Início *
                </span>
                <input
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                  <Calendar className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Término *
                </span>
                <input
                  type="datetime-local"
                  required
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
                />
              </label>
            </div>

            {/* Location & Category */}
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block space-y-1.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                  <MapPin className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Local (Venue) *
                </span>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  placeholder="Armazém Serra"
                  className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Cidade *
                </span>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="São Paulo"
                  className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Categoria *
                </span>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Música, Gastronomia..."
                  className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                />
              </label>
            </div>

            {/* Status, Display Mode, Currency */}
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Status
                </span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as EventStatus)}
                  className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
                >
                  {(Object.keys(EVENT_STATUS_META) as EventStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {EVENT_STATUS_META[st].label} ({st})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Modo de exibição
                </span>
                <select
                  value={displayMode}
                  onChange={(e) => setDisplayMode(e.target.value as DisplayMode)}
                  className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
                >
                  {(Object.keys(DISPLAY_MODE_META) as DisplayMode[]).map((dm) => (
                    <option key={dm} value={dm}>
                      {DISPLAY_MODE_META[dm].label} ({dm})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Moeda (ISO 4217)
                </span>
                <input
                  type="text"
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  placeholder="BRL"
                  className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] uppercase focus:border-[var(--border-strong)] focus:outline-none"
                />
              </label>
            </div>

            {/* Images */}
            <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
              <div>
                <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">
                  Imagens e Planta Baixa
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Envie arquivos diretamente (PNG, JPEG ou WebP, até {IMAGE_SIZE_LABEL}) ou informe URLs HTTPS externas.
                </p>
              </div>

              <div className="space-y-3">
                {IMAGE_SLOTS.map((def) => (
                  <ImageSlotField
                    key={def.kind}
                    label={def.label}
                    hint={def.hint}
                    slot={slots[def.kind]}
                    imageRevision={imageRevision}
                    onError={(msg) => setError(msg)}
                    onSelectFile={(file) => {
                      const preview = URL.createObjectURL(file);
                      updateSlot(def.kind, (prev) => ({
                        ...prev,
                        file,
                        filePreviewUrl: preview,
                        urlInput: '',
                        cleared: false,
                      }));
                    }}
                    onUrlChange={(url) => {
                      updateSlot(def.kind, (prev) => ({
                        ...prev,
                        file: null,
                        filePreviewUrl: null,
                        urlInput: url,
                        cleared: false,
                      }));
                    }}
                    onClear={() => {
                      updateSlot(def.kind, (prev) => ({
                        ...prev,
                        file: null,
                        filePreviewUrl: null,
                        urlInput: '',
                        cleared: true,
                      }));
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="cursor-pointer rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-2 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)] disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {mode === 'create' ? 'Criar evento' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
