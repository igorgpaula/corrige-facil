// The upstream runtime is pinned and self-hosted. Its WASM is embedded in the JS.
export type CvMat = {
  rows: number;
  cols: number;
  data: Uint8Array;
  data32F: Float32Array;
  data64F: Float64Array;
  delete(): void;
};
export type OpenCv = {
  Mat: new (...args: number[]) => CvMat;
  MatVector: new () => {
    size(): number;
    get(index: number): CvMat;
    delete(): void;
  };
  Size: new (width: number, height: number) => unknown;
  CV_8UC4: number;
  CV_8U: number;
  CV_32FC2: number;
  COLOR_RGBA2GRAY: number;
  ADAPTIVE_THRESH_GAUSSIAN_C: number;
  THRESH_BINARY_INV: number;
  RETR_LIST: number;
  CHAIN_APPROX_SIMPLE: number;
  MORPH_CLOSE: number;
  MORPH_ELLIPSE: number;
  RANSAC: number;
  cvtColor(src: CvMat, dst: CvMat, code: number): void;
  GaussianBlur(src: CvMat, dst: CvMat, size: unknown, sigma: number): void;
  adaptiveThreshold(
    src: CvMat,
    dst: CvMat,
    max: number,
    method: number,
    type: number,
    block: number,
    c: number,
  ): void;
  getStructuringElement(shape: number, size: unknown): CvMat;
  morphologyEx(src: CvMat, dst: CvMat, op: number, kernel: CvMat): void;
  findContours(
    src: CvMat,
    contours: unknown,
    hierarchy: CvMat,
    mode: number,
    method: number,
  ): void;
  boundingRect(contour: CvMat): {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  contourArea(contour: CvMat): number;
  arcLength(contour: CvMat, closed: boolean): number;
  fitEllipse(contour: CvMat): {
    center: { x: number; y: number };
    size: { width: number; height: number };
  };
  matFromArray(rows: number, cols: number, type: number, data: number[]): CvMat;
  findHomography(
    src: CvMat,
    dst: CvMat,
    method: number,
    threshold: number,
  ): CvMat;
  getPerspectiveTransform(src: CvMat, dst: CvMat): CvMat;
  warpPerspective(src: CvMat, dst: CvMat, matrix: CvMat, size: unknown): void;
};

let runtime: Promise<{ cv: OpenCv }> | undefined;
export function loadOpenCv(url: string) {
  runtime ??= (async () => {
    await import(/* @vite-ignore */ url);
    const cv = (
      globalThis as unknown as {
        cv: OpenCv & { onRuntimeInitialized?: () => void };
      }
    ).cv;
    if (!cv) throw new Error('Não foi possível carregar o leitor de imagens.');
    if (!cv.Mat)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error('O leitor demorou para carregar. Tente novamente.'),
            ),
          45000,
        );
        cv.onRuntimeInitialized = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    return { cv };
  })();
  return runtime;
}
