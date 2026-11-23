import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Loader2,
  QrCode,
  ScanLine,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { formatShortTime } from '@/components/admin/adminUtils';
import { adminApi, ApiError, getFriendlyErrorMessage } from '@/lib/api';
import type { AdminEventDetail, CheckInResult } from '@/types/api';

interface CheckInScannerPanelProps {
  event: AdminEventDetail | null;
  onCheckInSuccess: () => void;
}

type CheckInFeedback =
  | {
      kind: 'success';
      title: string;
      subtitle: string;
      checkIn: CheckInResult;
      tableLabel: string | null;
      sectorName: string | null;
      timestamp: string;
    }
  | {
      kind: 'already_used';
      title: string;
      subtitle: string;
      code: string;
      timestamp: string;
    }
  | {
      kind: 'warning';
      title: string;
      subtitle: string;
      code: string;
      timestamp: string;
    }
  | {
      kind: 'invalid';
      title: string;
      subtitle: string;
      code: string;
      timestamp: string;
    };

interface ScanHistoryEntry {
  id: string;
  kind: CheckInFeedback['kind'];
  title: string;
  detail: string;
  timestamp: string;
}

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

export function CheckInScannerPanel({
  event,
  onCheckInSuccess,
}: CheckInScannerPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const lastScannedRef = useRef<{ token: string; at: number } | null>(null);
  const submittingRef = useRef(false);

  const [tokenInput, setTokenInput] = useState('');
  const [restrictToEvent, setRestrictToEvent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<CheckInFeedback | null>(null);
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);

  // Camera scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraSupported] = useState(() => Boolean(getBarcodeDetectorCtor()));

  // Lookup table label + sector name from currently loaded event
  const tableLookup = useMemo(() => {
    const map = new Map<string, { label: string; sectorName: string }>();
    if (!event) return map;
    for (const sector of event.sectors) {
      for (const table of sector.tables) {
        map.set(table.id, { label: table.label, sectorName: sector.name });
      }
    }
    return map;
  }, [event]);

  // Keep scanner input ready for USB/Bluetooth barcode readers
  useEffect(() => {
    inputRef.current?.focus();
  }, [event?.id]);

  const stopCamera = useCallback(() => {
    if (scanLoopRef.current !== null) {
      window.cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const pushHistory = useCallback(
    (kind: CheckInFeedback['kind'], title: string, detail: string) => {
      const entry: ScanHistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        title,
        detail,
        timestamp: new Date().toISOString(),
      };
      setHistory((prev) => [entry, ...prev].slice(0, 20));
    },
    [],
  );

  const processToken = useCallback(
    async (rawToken: string) => {
      const cleaned = rawToken.trim();
      if (!cleaned || submittingRef.current) return;

      const nowIso = new Date().toISOString();

      // Basic client format check matching backend regex `^[A-Za-z0-9_.-]+$`
      if (cleaned.length > 512 || !/^[A-Za-z0-9_.-]+$/.test(cleaned)) {
        const invalidFeedback: CheckInFeedback = {
          kind: 'invalid',
          title: 'Ingresso inválido',
          subtitle:
            'O código lido não corresponde ao formato esperado de ingresso do Sistema Mesa.',
          code: 'INVALID_TICKET',
          timestamp: nowIso,
        };
        setFeedback(invalidFeedback);
        pushHistory('invalid', invalidFeedback.title, 'Formato de token inválido');
        setTokenInput('');
        inputRef.current?.focus();
        return;
      }

      submittingRef.current = true;
      setSubmitting(true);

      try {
        const res = await adminApi.checkIn({
          token: cleaned,
          ...(restrictToEvent && event ? { eventId: event.id } : {}),
        });
        const info = tableLookup.get(res.checkIn.tableId);
        const tableLabel = info?.label ?? null;
        const sectorName = info?.sectorName ?? null;

        const successFeedback: CheckInFeedback = {
          kind: 'success',
          title: 'Entrada liberada',
          subtitle: tableLabel
            ? `Mesa ${tableLabel}${sectorName ? ` · ${sectorName}` : ''} · ${res.checkIn.guestCount} ${
                res.checkIn.guestCount === 1 ? 'pessoa' : 'pessoas'
              }`
            : `Reserva confirmada · ${res.checkIn.guestCount} ${
                res.checkIn.guestCount === 1 ? 'pessoa' : 'pessoas'
              }`,
          checkIn: res.checkIn,
          tableLabel,
          sectorName,
          timestamp: res.checkIn.checkedInAt,
        };

        setFeedback(successFeedback);
        pushHistory('success', 'Entrada liberada', successFeedback.subtitle);
        onCheckInSuccess();
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === 'TICKET_ALREADY_USED') {
            const usedFeedback: CheckInFeedback = {
              kind: 'already_used',
              title: 'Ingresso já utilizado',
              subtitle:
                'A entrada para este ingresso já foi registrada anteriormente na portaria.',
              code: err.code,
              timestamp: nowIso,
            };
            setFeedback(usedFeedback);
            pushHistory('already_used', usedFeedback.title, '409 TICKET_ALREADY_USED');
          } else if (err.code === 'TICKET_EVENT_MISMATCH') {
            const mismatchFeedback: CheckInFeedback = {
              kind: 'warning',
              title: 'Ingresso de outro evento',
              subtitle:
                'Este QR Code é válido, mas pertence a um evento diferente do selecionado.',
              code: err.code,
              timestamp: nowIso,
            };
            setFeedback(mismatchFeedback);
            pushHistory('warning', mismatchFeedback.title, '409 TICKET_EVENT_MISMATCH');
          } else if (err.code === 'RESERVATION_NOT_CONFIRMED') {
            const unconfirmedFeedback: CheckInFeedback = {
              kind: 'warning',
              title: 'Reserva não confirmada',
              subtitle:
                'O pagamento desta reserva ainda não foi confirmado.',
              code: err.code,
              timestamp: nowIso,
            };
            setFeedback(unconfirmedFeedback);
            pushHistory(
              'warning',
              unconfirmedFeedback.title,
              '409 RESERVATION_NOT_CONFIRMED',
            );
          } else if (err.code === 'INVALID_TICKET' || err.status === 400) {
            const invalidFeedback: CheckInFeedback = {
              kind: 'invalid',
              title: 'Ingresso inválido',
              subtitle:
                err.message ||
                'Não foi possível validar a autenticidade deste ingresso.',
              code: err.code,
              timestamp: nowIso,
            };
            setFeedback(invalidFeedback);
            pushHistory('invalid', invalidFeedback.title, err.code);
          } else {
            const errMsg = getFriendlyErrorMessage(err);
            setFeedback({
              kind: 'invalid',
              title: 'Falha na validação',
              subtitle: errMsg,
              code: err.code,
              timestamp: nowIso,
            });
            pushHistory('invalid', 'Falha na validação', errMsg);
          }
        } else {
          const msg = getFriendlyErrorMessage(err);
          setFeedback({
            kind: 'invalid',
            title: 'Erro inesperado',
            subtitle: msg,
            code: 'UNKNOWN',
            timestamp: nowIso,
          });
          pushHistory('invalid', 'Erro inesperado', msg);
        }
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
        setTokenInput('');
        inputRef.current?.focus();
      }
    },
    [restrictToEvent, event, tableLookup, pushHistory, onCheckInSuccess],
  );

  async function handleStartCamera() {
    setCameraError(null);
    const DetectorCtor = getBarcodeDetectorCtor();
    if (!DetectorCtor) {
      setCameraError(
        'Seu navegador não suporta leitura nativa de QR Code pela câmera (BarcodeDetector). Use um leitor USB/Bluetooth ou cole o token manualmente.',
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Acesso à câmera indisponível neste navegador ou contexto (requer HTTPS ou localhost).',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);

      // Attach stream after state commits
      requestAnimationFrame(() => {
        const video = videoRef.current;
        if (!video || !streamRef.current) return;
        video.srcObject = streamRef.current;
        void video.play().catch(() => {
          // Ignore autoplay promise rejection
        });

        const detector = new DetectorCtor({ formats: ['qr_code'] });

        const scanFrame = async () => {
          if (!streamRef.current || !videoRef.current) return;
          if (videoRef.current.readyState >= 2 && !submittingRef.current) {
            try {
              const codes = await detector.detect(videoRef.current);
              const raw = codes[0]?.rawValue?.trim();
              if (raw) {
                const now = Date.now();
                const last = lastScannedRef.current;
                // 3-second cooldown for the exact same token to prevent duplicate scans
                if (!last || last.token !== raw || now - last.at > 3000) {
                  lastScannedRef.current = { token: raw, at: now };
                  void processToken(raw);
                }
              }
            } catch {
              // Ignore single-frame detection errors
            }
          }
          scanLoopRef.current = window.requestAnimationFrame(() => {
            void scanFrame();
          });
        };

        scanLoopRef.current = window.requestAnimationFrame(() => {
          void scanFrame();
        });
      });
    } catch {
      stopCamera();
      setCameraError(
        'Permissão da câmera negada ou nenhuma câmera encontrada neste dispositivo.',
      );
    }
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    void processToken(tokenInput);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Left: Main Scanner Workstation */}
      <div className="space-y-5">
        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-[var(--accent)] uppercase">
                <QrCode className="h-3.5 w-3.5" />
                Portaria em Tempo Real
              </p>
              <h2 className="font-display mt-1 text-xl font-bold text-[var(--text-primary)]">
                Check-in de Ingressos
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                Aponte um leitor USB/Bluetooth, cole o token decodificado ou use a câmera do navegador.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                cameraActive ? stopCamera() : void handleStartCamera()
              }
              className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                cameraActive
                  ? 'border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]'
                  : 'border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {cameraActive ? (
                <>
                  <CameraOff className="h-3.5 w-3.5" />
                  Desligar câmera
                </>
              ) : (
                <>
                  <Camera className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Scanner via câmera
                </>
              )}
            </button>
          </div>

          {/* Scope Toggle */}
          {event && (
            <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/65 px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  Validar apenas ingressos de &ldquo;{event.title}&rdquo;
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Envia o <code className="font-mono-num">eventId</code> para bloquear ingressos de outros eventos.
                </p>
              </div>
              <input
                type="checkbox"
                checked={restrictToEvent}
                onChange={(e) => setRestrictToEvent(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
            </label>
          )}

          {/* Barcode / QR Token Input Form */}
          <form onSubmit={handleFormSubmit} className="mt-4 space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Token do ingresso (leitor de QR/código de barras ou colar)
              </span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <ScanLine className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--accent)]" />
                  <input
                    ref={inputRef}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="mesa-ticket-v1.<nonce>.<payload>.<tag>"
                    className="font-mono-num w-full rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] py-3 pr-4 pl-10 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none sm:text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting || !tokenInput.trim()}
                  className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[var(--cta-bg)] px-6 py-3 text-xs font-bold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Validar Entrada
                </button>
              </div>
            </label>
          </form>

          {/* Optional Camera Scanner Viewport */}
          {cameraError && (
            <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3.5 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{cameraError}</span>
            </div>
          )}

          {cameraActive && (
            <div className="relative mt-4 overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)]">
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-video w-full object-cover"
              />
              {/* Scanning reticle */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-44 w-44 rounded-3xl border-2 border-[var(--accent)] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              </div>
              <div className="pointer-events-none absolute right-3 bottom-3 left-3 flex items-center justify-between rounded-full bg-[var(--bg-surface)] px-3.5 py-1.5 text-[11px] font-medium text-[var(--text-primary)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--success)]" />
                  Enquadre o QR Code do ingresso
                </span>
                <span>Leitura automática</span>
              </div>
            </div>
          )}

          {!cameraActive && !cameraSupported && !cameraError && (
            <p className="mt-3 text-[11px] text-[var(--text-muted)]">
              Dica: leitores ópticos USB/Bluetooth funcionam em qualquer navegador — basta manter o campo acima focado.
            </p>
          )}
        </div>

        {/* Immediate High-Contrast Feedback Banner */}
        {feedback && (
          <div
            role="status"
            aria-live="assertive"
            className={`animate-pop-in rounded-3xl border-2 p-6 shadow-lg ${
              feedback.kind === 'success'
                ? 'border-emerald-500/60 bg-emerald-500/12 text-emerald-700'
                : feedback.kind === 'already_used'
                  ? 'border-amber-500/70 bg-amber-500/14 text-amber-800'
                  : feedback.kind === 'warning'
                    ? 'border-amber-500/55 bg-amber-500/12 text-amber-800'
                    : 'border-red-500/65 bg-red-500/12 text-red-700'
            }`}
          >
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                  feedback.kind === 'success'
                    ? 'bg-emerald-200 text-emerald-900'
                    : feedback.kind === 'already_used' || feedback.kind === 'warning'
                      ? 'bg-amber-200 text-amber-900'
                      : 'bg-red-200 text-red-900'
                }`}
              >
                {feedback.kind === 'success' ? (
                  <CheckCircle2 className="h-7 w-7" />
                ) : feedback.kind === 'already_used' ? (
                  <ShieldAlert className="h-7 w-7" />
                ) : feedback.kind === 'warning' ? (
                  <AlertTriangle className="h-7 w-7" />
                ) : (
                  <XCircle className="h-7 w-7" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-xl font-bold uppercase tracking-tight">
                    {feedback.title}
                  </h3>
                  <span className="font-mono-num inline-flex items-center gap-1 rounded-full bg-[var(--bg-surface)] px-2.5 py-0.5 text-[11px] font-semibold">
                    <Clock className="h-3 w-3" />
                    {formatShortTime(feedback.timestamp)}
                  </span>
                </div>

                <p className="mt-1 text-sm font-medium opacity-90">
                  {feedback.subtitle}
                </p>

                {feedback.kind === 'success' ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                    {feedback.tableLabel && (
                      <span className="rounded-full bg-emerald-500/20 px-3 py-1 font-bold">
                        Mesa {feedback.tableLabel}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 font-semibold">
                      <Users className="h-3.5 w-3.5" />
                      {feedback.checkIn.guestCount}{' '}
                      {feedback.checkIn.guestCount === 1
                        ? 'convidado'
                        : 'convidados'}
                    </span>
                    <span className="font-mono-num opacity-75">
                      Reserva: {feedback.checkIn.reservationId.slice(0, 8)}...
                    </span>
                  </div>
                ) : (
                  <p className="font-mono-num mt-2 text-[11px] font-semibold opacity-75">
                    Código: {feedback.code}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right: Recent Session Check-in Log */}
      <aside className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <div>
            <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">
              Histórico desta sessão
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              Últimas {history.length} leituras realizadas
            </p>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setHistory([])}
              className="cursor-pointer text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Limpar
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
            <ScanLine className="h-7 w-7 text-[var(--text-muted)]" />
            <p className="mt-2.5 text-xs font-medium text-[var(--text-secondary)]">
              Nenhuma leitura realizada ainda
            </p>
            <p className="mt-1 max-w-[220px] text-[11px] text-[var(--text-muted)]">
              As validações de entrada aparecerão aqui em tempo real.
            </p>
          </div>
        ) : (
          <ul className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {history.map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/55 p-3"
              >
                {item.kind === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                ) : item.kind === 'already_used' || item.kind === 'warning' ? (
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                      {item.title}
                    </p>
                    <span className="font-mono-num shrink-0 text-[10px] text-[var(--text-muted)]">
                      {formatShortTime(item.timestamp)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
