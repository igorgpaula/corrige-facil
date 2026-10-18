import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { join } from 'node:path';
import { needsReview } from './sheet-geometry';
import type { SheetAnchors } from './types';
import { analyzeSheet } from './omr-engine';
import { testOpenCv } from './opencv-test-runtime';

it.skipIf(!process.env.OMR_FIXTURES_DIR).each([
  [
    'WhatsApp Image 2026-10-18 at 2.25.20 PM.jpeg',
    ['A', 'B', 'C', 'A', 'A', 'C', 'C', 'C', 'D', 'A'],
  ],
  [
    'WhatsApp Image 2026-10-18 at 3.04.02 PM.jpeg',
    ['A', 'D', 'C', 'A', 'A', 'A', 'C', 'C', 'D', 'A'],
  ],
  [
    'WhatsApp Image 2026-09-07 at 2.55.22 PM (1).jpeg',
    ['D', 'B', 'B', 'E', 'C', 'B', 'A', 'A', 'E', 'B'],
  ],
  [
    'WhatsApp Image 2026-09-07 at 3.02.53 PM.jpeg',
    ['D', 'B', 'B', 'E', 'C', 'B', 'A', 'A', 'E', 'B'],
  ],
  ['Designer.png', ['B', 'D', 'A', 'E', 'C', 'A', 'D', 'B', 'E', 'C']],
])(
  'reads %s',
  async (filename, expected) => {
    const require = createRequire(import.meta.url);
    const cr = createRequire(require.resolve('pdfjs-dist/package.json'));
    const { createCanvas, loadImage } = cr('@napi-rs/canvas');
    const image = await loadImage(
      join(process.env.OMR_FIXTURES_DIR!, filename as string),
    );
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const { cv } = await testOpenCv();
    let result = analyzeSheet(
      cv,
      ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
      10,
      { mode: 'legacy' },
    );
    const auto = {
      accepted: result.readings.filter((r) => !needsReview(r)).length,
      review: result.readings.filter(needsReview).length,
    };
    result.readings.forEach((r, i) => {
      if (!needsReview(r)) expect(r.answer).toBe(expected[i]);
    });
    if (result.alignment !== 'verified') {
      const anchors = [
        { x: 240 / 1200, y: 230 / 1600 },
        { x: 620 / 1200, y: 225 / 1600 },
        { x: 600 / 1200, y: 1495 / 1600 },
        { x: 250 / 1200, y: 1490 / 1600 },
      ] as SheetAnchors;
      result = analyzeSheet(
        cv,
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
        10,
        { mode: 'legacy', anchors },
      );
    }
    expect(result.alignment).toBe('verified');
    result.readings.forEach((r, i) => {
      if (!needsReview(r)) expect(r.answer).toBe(expected[i]);
      else expect(r.suggestedAnswer).toBe(expected[i]);
    });
    process.stdout.write(
      'METRICS ' +
        JSON.stringify({
          filename,
          ...auto,
          afterAlignment: result.readings.filter((r) => !needsReview(r)).length,
          wrongSafe: 0,
        }) +
        '\n',
    );
  },
  60000,
);
