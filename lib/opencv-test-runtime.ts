import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { OpenCv } from './opencv';

let ready: Promise<{ cv: OpenCv }> | undefined;
export function testOpenCv() {
  ready ??= new Promise<{ cv: OpenCv }>((resolve, reject) => {
    try {
      const module = {
        exports: {} as OpenCv & { onRuntimeInitialized?: () => void },
      };
      const require = createRequire(import.meta.url);
      const script = readFileSync(
        new URL('../public/vendor/opencv-4.12.0.js', import.meta.url),
        'utf8',
      );
      new Function('require', 'module', 'exports', '__dirname', script)(
        require,
        module,
        module.exports,
        '.',
      );
      const cv = module.exports;
      if (cv.Mat) resolve({ cv });
      else cv.onRuntimeInitialized = () => resolve({ cv });
    } catch (error) {
      reject(error);
    }
  });
  return ready;
}
