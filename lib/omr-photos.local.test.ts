import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { join } from 'node:path';
import { needsReview } from './sheet-geometry';
import type { AnswerSheetTemplate, SheetAnchors } from './types';
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
    if (process.env.OMR_DIAGNOSTICS)
      process.stdout.write(
        'DETAILS ' +
          JSON.stringify({
            filename,
            readings: result.readings,
            diagnostics: result.diagnostics,
          }) +
          '\n',
      );
  },
  60000,
);

async function loadPhoto(filename: string) {
  const require = createRequire(import.meta.url);
  const cr = createRequire(require.resolve('pdfjs-dist/package.json'));
  const { createCanvas, loadImage } = cr('@napi-rs/canvas');
  const image = await loadImage(join(process.env.OMR_FIXTURES_DIR!, filename));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return {
    pixels: context.getImageData(0, 0, image.width, image.height).data,
    width: image.width,
    height: image.height,
  };
}

it.skipIf(!process.env.OMR_FIXTURES_DIR)(
  'confirma a marca A da questão 10 com e sem o modelo em branco, também em escala de cinza',
  async () => {
    const { cv } = await testOpenCv();
    const blank = await loadPhoto(
      'WhatsApp Image 2026-09-07 at 1.39.07 PM.jpeg',
    );
    const calibration = analyzeSheet(
      cv,
      blank.pixels,
      blank.width,
      blank.height,
      10,
      {
        mode: 'legacy',
        calibrate: true,
      },
    ).calibration;
    expect(calibration).toBeDefined();
    const template: AnswerSheetTemplate = {
      id: 'local-blank',
      name: 'Quadro em branco',
      version: 2,
      mode: 'legacy',
      questionCount: 10,
      geometry: { columns: 5, rows: 10, radiusRatio: calibration!.radiusRatio },
      baseline: calibration!.baseline,
      createdAt: new Date().toISOString(),
    };
    const image = await loadPhoto(
      'WhatsApp Image 2026-10-18 at 3.04.02 PM.jpeg',
    );
    const gray = new Uint8ClampedArray(image.pixels);
    for (let i = 0; i < gray.length; i += 4) {
      const value = Math.round((gray[i] + gray[i + 1]) / 2);
      gray[i] = gray[i + 1] = gray[i + 2] = value;
    }
    const expected = ['A', 'D', 'C', 'A', 'A', 'A', 'C', 'C', 'D', 'A'];
    for (const selected of [null, template])
      for (const pixels of [image.pixels, gray]) {
        const result = analyzeSheet(cv, pixels, image.width, image.height, 10, {
          mode: 'legacy',
          template: selected,
        });
        result.readings.forEach((r, i) => {
          if (!needsReview(r)) expect(r.answer).toBe(expected[i]);
        });
        expect(result.readings[9].answer).toBe('A');
        expect(result.readings[9].confidence).toBeGreaterThanOrEqual(80);
        if (process.env.OMR_DIAGNOSTICS)
          process.stdout.write(
            'Q10 ' +
              JSON.stringify({
                calibrated: !!selected,
                gray: pixels === gray,
                reading: result.readings[9],
                evidence: result.diagnostics.questions?.[9],
              }) +
              '\n',
          );
      }
  },
  60000,
);

it.skipIf(!process.env.OMR_FIXTURES_DIR)(
  'não aceita resposta errada na foto com X',
  async () => {
    const { cv } = await testOpenCv();
    const image = await loadPhoto(
      'WhatsApp Image 2026-10-18 at 9.48.05 PM.jpeg',
    );
    const result = analyzeSheet(
      cv,
      image.pixels,
      image.width,
      image.height,
      10,
      {
        mode: 'legacy',
        anchors: [
          { x: 235 / 899, y: 274 / 1599 },
          { x: 513 / 899, y: 281 / 1599 },
          { x: 510 / 899, y: 1234 / 1599 },
          { x: 230 / 899, y: 1231 / 1599 },
        ],
      },
    );
    const expected = ['A', 'D', 'C', 'A', 'C', 'A', 'C', 'A', 'A', 'A'];
    result.readings.forEach((r, i) => {
      if (!needsReview(r)) expect(r.answer).toBe(expected[i]);
    });
  },
  60000,
);
