import workerAsset from './omr.worker.ts?worker&url';
import type { Answers, AnswerReading, ScanOptions, ScanResult } from './types';
export { getQuestionCoordinates } from './sheet-geometry';

function abortError() {
  return new DOMException('Análise cancelada.', 'AbortError');
}

async function imageFromFile(file: File, signal?: AbortSignal) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const image = new Image();
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      signal?.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      image.src = '';
      cleanup();
      reject(abortError());
    };
    signal?.addEventListener('abort', cancel, { once: true });
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Não foi possível abrir a imagem.'));
    };
    image.src = url;
  });
}

export async function readAnswerSheet(
  file: File,
  questionCount: number,
  options: ScanOptions = { mode: 'legacy' },
  signal?: AbortSignal,
): Promise<ScanResult> {
  if (file.size > 20 * 1024 * 1024)
    throw new Error('A foto pode ter no máximo 20 MB.');
  const image = await imageFromFile(file, signal);
  if (signal?.aborted) throw abortError();
  const scale = Math.min(
    1,
    1600 / image.naturalWidth,
    2200 / image.naturalHeight,
  );
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context)
      throw new Error('Seu navegador não conseguiu preparar a foto.');
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const preview = canvas.toDataURL('image/jpeg', 0.86);
    const asset = new URL(workerAsset, window.location.origin);
    if (asset.protocol === 'file:')
      asset.href = new URL(asset.pathname, window.location.origin).href;
    const prefix = asset.pathname.includes('/_next/')
      ? asset.pathname.split('/_next/')[0]
      : '';
    return await new Promise<ScanResult>((resolve, reject) => {
      const worker = new Worker(asset, { type: 'module' });
      const requestId = crypto.randomUUID();
      const finish = () => {
        clearTimeout(timer);
        worker.terminate();
        signal?.removeEventListener('abort', cancel);
      };
      const cancel = () => {
        finish();
        reject(abortError());
      };
      const timer = setTimeout(() => {
        finish();
        reject(
          new Error(
            'A análise demorou demais. Recorte a foto ou tente novamente.',
          ),
        );
      }, 60000);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) {
        cancel();
        return;
      }
      worker.onmessage = (
        event: MessageEvent<{
          requestId: string;
          result?: Omit<ScanResult, 'preview'>;
          error?: string;
        }>,
      ) => {
        if (event.data.requestId !== requestId) return;
        finish();
        if (event.data.error || !event.data.result)
          reject(
            new Error(event.data.error ?? 'Não foi possível analisar a foto.'),
          );
        else resolve({ ...event.data.result, preview });
      };
      worker.onerror = () => {
        finish();
        reject(
          new Error(
            'Não foi possível carregar o leitor local. Atualize a página e tente novamente.',
          ),
        );
      };
      worker.postMessage(
        {
          requestId,
          pixels: pixels.buffer,
          width,
          height,
          questionCount,
          options,
          runtimeUrl: new URL(
            `${prefix}/vendor/opencv-4.12.0.js`,
            window.location.origin,
          ).href,
        },
        [pixels.buffer],
      );
    });
  } finally {
    canvas.width = canvas.height = 1;
    image.src = '';
  }
}

export function answersFromReadings(readings: AnswerReading[]): Answers {
  return readings.map((reading) => reading.answer);
}
