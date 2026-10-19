import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeSheet, validateAnchors } from './omr-engine';
import { testOpenCv } from './opencv-test-runtime';
import type { OpenCv } from './opencv';
import {
  getQuestionCoordinates,
  getStandardSheetLayout,
  needsReview,
  assertFinalReadings,
} from './sheet-geometry';
import {
  LETTERS,
  type Letter,
  type SheetAnchors,
  type ScanOptions,
} from './types';

import { makeAnswerSheet } from './fixtures/answer-sheet';

let cv: OpenCv;
beforeAll(async () => {
  ({ cv } = await testOpenCv());
}, 60000);
const expected: Letter[] = ['A', 'D', 'C', 'A', 'A', 'A', 'C', 'C', 'D', 'A'];
function read(
  image: ReturnType<typeof makeAnswerSheet>,
  options: ScanOptions = { mode: 'legacy' },
  count = 10,
) {
  return analyzeSheet(
    cv,
    image.pixels,
    image.width,
    image.height,
    count,
    options,
  );
}
function noSafeErrors(
  result: ReturnType<typeof read>,
  key: Array<Letter | null>,
) {
  result.readings.forEach((reading, index) => {
    if (!needsReview(reading))
      expect(reading.answer, 'safe question ' + (index + 1)).toBe(key[index]);
  });
}
describe('geometria e confiança', () => {
  it.each([false, true])(
    'não usa título ou hífen como alternativa, sombra=%s',
    (shadow) => {
      const result = read(makeAnswerSheet(expected, { shadow }));
      expect(result.alignment).toBe('verified');
      noSafeErrors(result, expected);
      expect(
        result.readings.filter((r) => !needsReview(r)).length,
      ).toBeGreaterThanOrEqual(7);
      expect(result.overlay).toHaveLength(10);
      expect(result.overlay[0].centers[0].x).toBeCloseTo(120 / 600, 1);
    },
  );
  it('aceita inclinação e preserva x/y por círculo', () => {
    const result = read(
      makeAnswerSheet(expected, { shadow: true, tilt: 0.025 }),
    );
    noSafeErrors(result, expected);
    expect(result.alignment).toBe('verified');
    expect(result.overlay[0].centers[0].y).not.toBe(
      result.overlay[0].centers[4].y,
    );
  });
  it('não inventa letras quando a grade está ausente', () => {
    const image = makeAnswerSheet(expected);
    image.pixels.fill(255);
    const result = read(image);
    expect(result.alignment).toBe('failed');
    expect(
      result.readings.every(
        (r) => r.answer === null && r.confidence === 0 && needsReview(r),
      ),
    ).toBe(true);
  });
  it('distingue branco e marcação dupla', () => {
    const markings: Array<Letter | Letter[] | null> = [...expected];
    markings[3] = null;
    markings[7] = ['A', 'D'];
    const result = read(makeAnswerSheet(markings));
    expect(result.readings[3].answer).toBeNull();
    expect(result.readings[7].answer).toBeNull();
    expect(needsReview(result.readings[7])).toBe(true);
    expect(result.readings[7].status).toBe('multiple');
  });
  it.each(
    [1, 2, 8, 10, 15, 25, 26, 30, 50].flatMap((count) => [
      { count, sheetVersion: 2 as const },
      { count, sheetVersion: 3 as const },
      { count, sheetVersion: 4 as const },
    ]),
  )(
    'lê quadro de $count questões na versão $sheetVersion, incluindo folhas antigas',
    ({ count, sheetVersion }) => {
      const key = Array.from({ length: count }, (_, i) => LETTERS[i % 5]);
      const result = read(
        makeAnswerSheet(key, { markers: true, shadow: true, sheetVersion }),
        { mode: 'standard' },
        count,
      );
      expect(result.alignment).toBe('verified');
      noSafeErrors(result, key);
      expect(result.readings.filter((r) => !needsReview(r)).length).toBe(count);
    },
  );
  it('não assume orientação de folhas antigas sem indicação V2', () => {
    const image = makeAnswerSheet(expected, { markers: true, sheetVersion: 2 });
    for (let y = 0; y < image.height * 0.08; y++)
      for (let x = 70; x < 100; x++) {
        const o = (Math.floor(y) * image.width + x) * 4;
        image.pixels[o] = image.pixels[o + 1] = image.pixels[o + 2] = 248;
      }
    const result = read(image, { mode: 'standard' });
    expect(result.alignment).not.toBe('verified');
    expect(result.readings.every(needsReview)).toBe(true);
  });
  it('não aceita com segurança uma folha nova cuja marca de versão foi apagada', () => {
    const image = makeAnswerSheet(expected, { markers: true });
    const layout = getStandardSheetLayout(10);
    const y = (image.height * layout.markerInsetY) / layout.heightMm;
    for (let py = Math.floor(y - 12); py <= y + 12; py++)
      for (let px = 180; px <= 205; px++) {
        const offset = (py * image.width + px) * 4;
        image.pixels[offset] =
          image.pixels[offset + 1] =
          image.pixels[offset + 2] =
            248;
      }
    const result = read(image, { mode: 'standard' });
    expect(result.alignment).not.toBe('verified');
    expect(result.readings.every(needsReview)).toBe(true);
  });
  it('calibra impressão vazia e rejeita cadastro preenchido', () => {
    const result = read(makeAnswerSheet(Array(10).fill(null)), {
      mode: 'legacy',
      calibrate: true,
    });
    expect(result.calibration).toBeDefined();
    expect(
      Object.values(result.calibration!.baseline).every(
        (n) => n >= 0 && n <= 1,
      ),
    ).toBe(true);
    expect(() =>
      read(makeAnswerSheet(expected, { blue: true }), {
        mode: 'legacy',
        calibrate: true,
      }),
    ).toThrow(/branco/);
  });
  it('não declara branco quando um modelo incompatível suprime uma marca sólida', () => {
    const result = read(makeAnswerSheet(expected), {
      mode: 'legacy',
      template: {
        id: 'too-dark',
        name: 'Impressão muito escura',
        version: 2,
        mode: 'legacy',
        questionCount: 10,
        geometry: { columns: 5, rows: 10, radiusRatio: 16 / 192 },
        baseline: { A: 1, B: 1, C: 1, D: 1, E: 1 },
        createdAt: new Date().toISOString(),
      },
    });
    expect(
      result.readings.every((r) => r.status === 'uncertain' && needsReview(r)),
    ).toBe(true);
    expect(result.readings.map((r) => r.suggestedAnswer)).toEqual(expected);
  });
  it('rejeita pontos cruzados e modelo com quantidade incompatível', () => {
    expect(() =>
      validateAnchors([
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.9, y: 0.1 },
        { x: 0.1, y: 0.9 },
      ]),
    ).toThrow(/ordem/);
    expect(() =>
      read(makeAnswerSheet(expected), {
        mode: 'legacy',
        template: { questionCount: 12 } as never,
      }),
    ).toThrow(/quantidade/);
  });
});
describe('validação reservada: não ajustar limiares a estes casos', () => {
  it.each([10, 26, 50])(
    'não aceita erro seguro no novo quadro de %s questões com tinta azul, sombra e inclinação',
    (count) => {
      const key = Array.from(
        { length: count },
        (_, i) => LETTERS[(i * 3 + 1) % 5],
      );
      const image = makeAnswerSheet(key, {
        markers: true,
        shadow: true,
        blue: true,
        tilt: 0.008,
      });
      const result = read(image, { mode: 'standard' }, count);
      noSafeErrors(result, key);
      expect(result.alignment).not.toBe('failed');
      if (result.alignment !== 'verified')
        expect(result.readings.every(needsReview)).toBe(true);
      else
        expect(
          result.readings.filter((r) => !needsReview(r)).length,
        ).toBeGreaterThanOrEqual(count * 0.8);
    },
  );
  it.each([
    { pencil: true },
    { blue: true },
    { shadow: true, pencil: true },
    { shadow: true, blue: true, tilt: 0.017 },
  ])('não aceita alternativa errada em %j', (variation) => {
    const key: Letter[] = ['E', 'A', 'D', 'B', 'C', 'E', 'B', 'D', 'A', 'C'];
    const image = makeAnswerSheet(key, variation);
    const result = read(image);
    noSafeErrors(result, key);
    // A cautious request for review is allowed; a confident wrong answer is not.
    expect(
      result.readings.filter((r) => !needsReview(r)).length,
    ).toBeGreaterThanOrEqual(5);
  });
  it('corrige perspectiva pelos quatro pontos do usuário', () => {
    const image = makeAnswerSheet(expected);
    const source = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      [0, 0, 600, 0, 600, 800, 0, 800],
    );
    const target = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      [44, 20, 540, 55, 570, 760, 20, 735],
    );
    const h = cv.getPerspectiveTransform(source, target);
    const a = new cv.Mat(800, 600, cv.CV_8UC4);
    a.data.set(image.pixels);
    const b = new cv.Mat();
    try {
      cv.warpPerspective(a, b, h, new cv.Size(600, 800));
      const point = (x: number, y: number) => {
        const m = h.data64F;
        const z = m[6] * x + m[7] * y + m[8];
        return {
          x: (m[0] * x + m[1] * y + m[2]) / z / 600,
          y: (m[3] * x + m[4] * y + m[5]) / z / 800,
        };
      };
      const anchors = [
        point(120, 115),
        point(312, 115),
        point(312, 745),
        point(120, 745),
      ] as SheetAnchors;
      const result = read(
        { ...image, pixels: new Uint8ClampedArray(b.data) },
        { mode: 'legacy', anchors },
      );
      noSafeErrors(result, expected);
      expect(result.alignment).toBe('verified');
    } finally {
      source.delete();
      target.delete();
      h.delete();
      a.delete();
      b.delete();
    }
  });
});
describe('salvamento assistido', () => {
  it.each([70, 79, 80, 100])(
    'aceita respostas finais a partir de 70%%: %s',
    (confidence) => {
      for (const answer of ['A', null] as const) {
        const reading = {
          answer,
          confidence,
          source: 'scan' as const,
          status: answer === null ? ('blank' as const) : ('read' as const),
        };
        expect(needsReview(reading)).toBe(false);
        expect(() => assertFinalReadings([reading], 1)).not.toThrow();
      }
    },
  );
  it('mantém revisão abaixo de 70% ou com pendências, mesmo em confiança alta', () => {
    expect(
      needsReview({
        answer: 'A',
        confidence: 69,
        source: 'scan',
        status: 'read',
      }),
    ).toBe(true);
    expect(() =>
      assertFinalReadings(
        [{ answer: 'A', confidence: 69, source: 'scan', status: 'read' }],
        1,
      ),
    ).toThrow();
    for (const status of ['uncertain', 'multiple'] as const)
      expect(
        needsReview({ answer: null, confidence: 90, source: 'scan', status }),
      ).toBe(true);
  });
  it('bloqueia sugestão, dupla e branco incerto; permite confirmações manuais', () => {
    for (const status of ['uncertain', 'multiple'] as const)
      expect(() =>
        assertFinalReadings(
          [{ answer: null, confidence: 99, source: 'scan', status }],
          1,
        ),
      ).toThrow();
    expect(() =>
      assertFinalReadings(
        [{ answer: null, confidence: 69, source: 'scan', status: 'blank' }],
        1,
      ),
    ).toThrow();
    expect(() =>
      assertFinalReadings(
        [
          {
            answer: null,
            confidence: 100,
            source: 'manual',
            status: 'multiple',
          },
        ],
        1,
      ),
    ).not.toThrow();
    expect(() =>
      assertFinalReadings(
        [{ answer: null, confidence: 90, source: 'scan', status: 'blank' }],
        1,
      ),
    ).not.toThrow();
  });
  it('preserva compatibilidade de leituras antigas', () => {
    expect(needsReview({ answer: 'A', confidence: 92, source: 'scan' })).toBe(
      false,
    );
    expect(needsReview({ answer: null, confidence: 0, source: 'scan' })).toBe(
      true,
    );
  });
});
