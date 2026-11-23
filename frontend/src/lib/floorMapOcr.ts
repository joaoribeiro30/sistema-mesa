import type { Bbox, Worker } from 'tesseract.js';
import workerPath from 'tesseract.js/dist/worker.min.js?url';

interface TableLabel {
  id: string;
  label: string;
}

interface NumericToken {
  text: string;
  bbox: Bbox;
  confidence: number;
}

interface Position {
  x: number;
  y: number;
}

const MAX_CANVAS_SIDE = 4096;
const OCR_TIMEOUT_MS = 120_000;
const IMAGE_ACCESS_MESSAGE =
  'Não foi possível ler a imagem para detectar mesas. Se a URL externa bloquear o acesso (CORS), use Enviar Planta para carregar o arquivo.';
const OCR_ERROR_MESSAGE =
  'Não foi possível detectar as mesas. Verifique sua conexão e tente novamente.';

class FloorMapImageError extends Error {}

function removeLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}

export function matchFloorMapTables(
  tables: readonly TableLabel[],
  tokens: readonly NumericToken[],
  canvasWidth: number,
  canvasHeight: number,
): Record<string, Position> {
  const tablesByNumber = new Map<string, TableLabel | null>();
  for (const table of tables) {
    const digits = /^(?:[\p{L}\s_-]+)?(\d+)$/u.exec(table.label.trim())?.[1];
    if (!digits) continue;
    const number = removeLeadingZeros(digits);
    // Labels are unique within a sector, so the same number can identify multiple tables.
    tablesByNumber.set(number, tablesByNumber.has(number) ? null : table);
  }

  const detectionsByNumber = new Map<string, Position[]>();
  const sortedTokens = [...tokens].sort((a, b) => b.confidence - a.confidence);
  for (const { text, bbox, confidence } of sortedTokens) {
    const digits = text.trim();
    if (confidence <= 0 || !/^\d+$/.test(digits)) continue;
    const number = removeLeadingZeros(digits);
    if (!tablesByNumber.get(number)) continue;

    const { x0, y0, x1, y1 } = bbox;
    const x = ((x0 + x1) / 2 / canvasWidth) * 100;
    const y = ((y0 + y1) / 2 / canvasHeight) * 100;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) continue;

    const detections = detectionsByNumber.get(number) ?? [];
    if (detections.some((position) => Math.hypot(x - position.x, y - position.y) < 1.5)) continue;
    detections.push({ x, y });
    detectionsByNumber.set(number, detections);
  }

  const matches: Array<[string, Position]> = [];
  for (const [number, detections] of detectionsByNumber) {
    const table = tablesByNumber.get(number);
    if (!table || detections.length !== 1) continue;
    const [{ x, y }] = detections;
    matches.push([table.id, { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) }]);
  }
  return Object.fromEntries(matches);
}

async function prepareFloorPlan(src: string, signal: AbortSignal): Promise<HTMLCanvasElement> {
  const image = new Image();
  const cancelLoad = () => image.removeAttribute('src');
  signal.addEventListener('abort', cancelLoad, { once: true });
  try {
    image.crossOrigin = 'anonymous';
    image.src = src;
    await image.decode();
    signal.throwIfAborted();

    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(longestSide < 1500 ? 2 : 1, MAX_CANVAS_SIDE / longestSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new FloorMapImageError(IMAGE_ACCESS_MESSAGE);

    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = pixels;
    for (let index = 0; index < data.length; index += 4) {
      const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      // Clip the darkest and lightest shades and keep midtones for adaptive thresholding.
      const contrasted = ((gray - 50) * 255) / (225 - 50);
      data[index] = contrasted;
      data[index + 1] = contrasted;
      data[index + 2] = contrasted;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  } catch {
    signal.throwIfAborted();
    throw new FloorMapImageError(IMAGE_ACCESS_MESSAGE);
  } finally {
    signal.removeEventListener('abort', cancelLoad);
    cancelLoad();
  }
}

export async function detectFloorMapTables(
  src: string,
  tables: readonly TableLabel[],
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<Record<string, Position>> {
  const runSignal = AbortSignal.any([signal, AbortSignal.timeout(OCR_TIMEOUT_MS)]);
  runSignal.throwIfAborted();
  let rejectRun: (reason: unknown) => void = () => undefined;
  const interrupted = new Promise<never>((_, reject) => { rejectRun = reject; });
  const abort = () => rejectRun(runSignal.reason);
  runSignal.addEventListener('abort', abort, { once: true });

  let worker: Worker | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let finished = false;

  async function recognize() {
    canvas = await prepareFloorPlan(src, runSignal);
    const { createWorker, OEM, PSM } = await import('tesseract.js');
    runSignal.throwIfAborted();

    const readyWorker = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath,
      workerBlobURL: false,
      errorHandler: rejectRun,
      logger: ({ status, progress }) => {
        if (!finished && !runSignal.aborted && status === 'recognizing text') {
          onProgress(Math.round(progress * 100));
        }
      },
    });
    // Initialization may finish after the run was canceled and its caller has returned.
    if (finished || runSignal.aborted) {
      await readyWorker.terminate();
      runSignal.throwIfAborted();
      return {};
    }
    worker = readyWorker;

    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      thresholding_method: '2',
      user_defined_dpi: '150',
    });
    runSignal.throwIfAborted();
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
    const words = (data.blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)),
    );
    return matchFloorMapTables(tables, words, canvas.width, canvas.height);
  }

  try {
    return await Promise.race([recognize(), interrupted]);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof FloorMapImageError) throw error;
    throw new Error(OCR_ERROR_MESSAGE, { cause: error });
  } finally {
    finished = true;
    runSignal.removeEventListener('abort', abort);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    await worker?.terminate();
  }
}
