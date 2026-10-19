import { describe, expect, it } from 'vitest';
import { makeAnswerSheet } from './fixtures/answer-sheet';
import { measureMarkContrast, rankMarkContrast } from './mark-contrast';
import type { Letter } from './types';

function sample(answers: Array<Letter | Letter[] | null>, variation = {}) {
  const image = makeAnswerSheet(answers, variation);
  return answers.map((_, row) =>
    Array.from({ length: 5 }, (_, col) =>
      measureMarkContrast(
        image.pixels,
        image.width,
        image.height,
        { x: 120 + col * 48, y: 115 + row * 70 },
        16,
      ),
    ),
  );
}

describe('contraste local da marca azul ou preta', () => {
  it.each([false, true])(
    'identifica preenchimento sólido, tinta azul=%s, sob sombra',
    (blue) => {
      const rows = sample(['A', 'D', 'C', 'A', 'A', 'A', 'C', 'C', 'D', 'A'], {
        blue,
        shadow: true,
      });
      rows.forEach((row, index) => {
        const result = rankMarkContrast(row);
        expect(result.index).toBe([0, 3, 2, 0, 0, 0, 2, 2, 3, 0][index]);
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
        expect(result.multiple).toBe(false);
      });
    },
  );
  it('não transforma letras impressas em marcações', () => {
    for (const shadow of [false, true])
      sample(Array(10).fill(null), { shadow }).forEach((row) =>
        expect(rankMarkContrast(row).confidence).toBe(0),
      );
  });
  it('identifica duas bolinhas sólidas mesmo sob sombra', () => {
    const result = rankMarkContrast(sample([['A', 'D']], { shadow: true })[0]);
    expect(result.multiple).toBe(true);
    expect(result.confidence).toBe(0);
  });
  it('não promove contraste fraco a preenchimento seguro', () => {
    const image = makeAnswerSheet(['A']);
    // Keep the full geometry, but compress the ink/paper contrast to 15%.
    for (let i = 0; i < image.pixels.length; i += 4)
      for (let channel = 0; channel < 3; channel++)
        image.pixels[i + channel] = 205 + image.pixels[i + channel] * 0.15;
    const row = Array.from({ length: 5 }, (_, col) =>
      measureMarkContrast(
        image.pixels,
        image.width,
        image.height,
        { x: 120 + col * 48, y: 115 },
        16,
      ),
    );
    expect(rankMarkContrast(row).confidence).toBe(0);
  });
  it('recusa amostra sem referência suficiente de papel', () => {
    const pixels = new Uint8ClampedArray(20 * 20 * 4).fill(20);
    const mark = measureMarkContrast(pixels, 20, 20, { x: 10, y: 10 }, 16);
    expect(mark.valid).toBe(false);
    expect(rankMarkContrast(Array(5).fill(mark)).confidence).toBe(0);
  });
});
