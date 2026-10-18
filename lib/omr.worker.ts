import { analyzeSheet } from './omr-engine';
import { loadOpenCv } from './opencv';
import type { ScanOptions } from './types';

type Request = {
  requestId: string;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  questionCount: number;
  options: ScanOptions;
  runtimeUrl: string;
};
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<Request>) => Promise<void>;
  postMessage(value: unknown): void;
};
scope.onmessage = async ({ data }) => {
  try {
    const { cv } = await loadOpenCv(data.runtimeUrl);
    const result = analyzeSheet(
      cv,
      new Uint8ClampedArray(data.pixels),
      data.width,
      data.height,
      data.questionCount,
      data.options,
    );
    scope.postMessage({ requestId: data.requestId, result });
  } catch (cause) {
    scope.postMessage({
      requestId: data.requestId,
      error:
        cause instanceof Error
          ? cause.message
          : 'Não foi possível alinhar a imagem. Tente o ajuste manual.',
    });
  }
};
