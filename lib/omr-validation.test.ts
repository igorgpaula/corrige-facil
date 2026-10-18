import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { makeAnswerSheet } from './fixtures/answer-sheet';
import { analyzeSheet } from './omr-engine';
import { testOpenCv } from './opencv-test-runtime';
import { needsReview } from './sheet-geometry';
import type { Letter } from './types';

it.skipIf(!process.env.OMR_FIXTURES_DIR).each([30, 60])(
  'não aceita erro seguro após compressão JPEG de qualidade %s',
  async (quality) => {
    const require = createRequire(import.meta.url);
    const localRequire = createRequire(
      require.resolve('pdfjs-dist/package.json'),
    );
    const { createCanvas, loadImage, ImageData } =
      localRequire('@napi-rs/canvas');
    const image = makeAnswerSheet(key, { shadow: true, blue: true });
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.putImageData(
      new ImageData(image.pixels, image.width, image.height),
      0,
      0,
    );
    const compressed = await loadImage(canvas.toBuffer('image/jpeg', quality));
    context.drawImage(compressed, 0, 0);
    const { cv } = await testOpenCv();
    const result = analyzeSheet(
      cv,
      context.getImageData(0, 0, image.width, image.height).data,
      image.width,
      image.height,
      10,
      { mode: 'legacy' },
    );
    result.readings.forEach((r, i) => {
      if (!needsReview(r)) expect(r.answer).toBe(key[i]);
    });
  },
  60000,
);

// Reserved scenarios: do not tune the detector against these permutations.
const key: Letter[] = ['B', 'E', 'A', 'D', 'C', 'A', 'D', 'B', 'E', 'C'];
describe('validação reservada de degradações', () => {
  it.each([0.55, 0.8])(
    'não aceita erro seguro após redução de resolução a %s',
    async (scale) => {
      const image = makeAnswerSheet(key, { shadow: true, blue: true });
      const width = Math.round(image.width * scale),
        height = Math.round(image.height * scale);
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const source =
            (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4;
          pixels.set(
            image.pixels.subarray(source, source + 4),
            (y * width + x) * 4,
          );
        }
      const { cv } = await testOpenCv();
      const result = analyzeSheet(cv, pixels, width, height, 10, {
        mode: 'legacy',
      });
      result.readings.forEach((r, i) => {
        if (!needsReview(r)) expect(r.answer).toBe(key[i]);
      });
    },
    60000,
  );
  it('encaminha uma rasura dupla para revisão', async () => {
    const marks: Array<Letter | Letter[] | null> = [...key];
    marks[5] = ['A', 'C'];
    const image = makeAnswerSheet(marks, { blue: true, shadow: true });
    const { cv } = await testOpenCv();
    const result = analyzeSheet(
      cv,
      image.pixels,
      image.width,
      image.height,
      10,
      { mode: 'legacy' },
    );
    expect(result.readings[5].answer).toBeNull();
    expect(needsReview(result.readings[5])).toBe(true);
  }, 60000);
  it.skipIf(!process.env.OMR_WRITE_TEST_IMAGES)(
    'gera amostras sintéticas locais para QA visual',
    () => {
      const require = createRequire(import.meta.url);
      const localRequire = createRequire(
        require.resolve('pdfjs-dist/package.json'),
      );
      const { createCanvas, ImageData } = localRequire('@napi-rs/canvas');
      for (const [name, marks] of [
        ['blank', Array(10).fill(null)],
        ['filled', key],
      ] as const) {
        const image = makeAnswerSheet([...marks], { markers: true });
        const canvas = createCanvas(image.width, image.height);
        canvas
          .getContext('2d')
          .putImageData(
            new ImageData(image.pixels, image.width, image.height),
            0,
            0,
          );
        writeFileSync(
          new URL(`../work/${name}-standard-v2.png`, import.meta.url),
          canvas.toBuffer('image/png'),
        );
      }
    },
  );
});
