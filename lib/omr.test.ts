import { describe, expect, it } from 'vitest';

import {
  chooseFiveColumnGrid,
  getQuestionCoordinates,
  readAnswerPixels,
} from './omr';
import { LETTERS, type Letter } from './types';

const glyphs = [
  ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
];

function makeAnswerSheet(
  answers: Array<Letter | Letter[] | null>,
  { markers = false, shadow = false, tilt = 0 } = {},
) {
  const width = 600;
  const height = 800;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const centerLight =
        (1 - Math.abs(x / width - 0.5) * 2) *
        (1 - Math.abs(y / height - 0.5) * 2);
      const paper = shadow ? 118 + centerLight * 88 : 248;
      const offset = (y * width + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = paper;
      pixels[offset + 3] = 255;
    }
  }
  const ink = (x: number, y: number, value = 18) => {
    const mappedX = Math.round(x + tilt * (y - height / 2));
    const mappedY = Math.round(y - tilt * (x - width / 2));
    if (mappedX < 0 || mappedX >= width || mappedY < 0 || mappedY >= height)
      return;
    const offset = (mappedY * width + mappedX) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
  };
  const rectangle = (cx: number, cy: number, w: number, h: number) => {
    for (let y = Math.floor(cy - h / 2); y < cy + h / 2; y += 1)
      for (let x = Math.floor(cx - w / 2); x < cx + w / 2; x += 1) ink(x, y);
  };
  if (markers) {
    for (const x of [30, 570])
      for (const y of [32, 768]) rectangle(x, y, 30, 30);
  } else {
    // Dense heading and the dash before A must never become a row or column.
    rectangle(180, 62, 295, 14);
  }
  for (let row = 0; row < answers.length; row += 1) {
    const answer = answers[row];
    const selected = Array.isArray(answer) ? answer : [answer];
    const standard = getQuestionCoordinates(row, answers.length);
    const y = markers ? 32 + standard.y * 736 : 115 + row * 70;
    if (!markers) rectangle(72, y, 9, 3);
    for (let column = 0; column < 5; column += 1) {
      const x = markers
        ? 30 + standard.bubbleXs[column] * 540
        : 120 + column * 48;
      const radius = markers ? 7.5 : 16;
      const filled = selected.includes(LETTERS[column]);
      for (let dy = -Math.ceil(radius); dy <= radius; dy += 1) {
        for (let dx = -Math.ceil(radius); dx <= radius; dx += 1) {
          const distance = Math.hypot(dx, dy);
          if (distance <= radius && (filled || distance >= radius - 1.5))
            ink(x + dx, y + dy);
        }
      }
      if (!filled) {
        const scale = markers ? 1 : 2;
        for (let gy = 0; gy < 7; gy += 1)
          for (let gx = 0; gx < 5; gx += 1) {
            if (glyphs[column][gy][gx] === '0') continue;
            for (let sy = 0; sy < scale; sy += 1)
              for (let sx = 0; sx < scale; sx += 1)
                ink(x + (gx - 2) * scale + sx, y + (gy - 3) * scale + sy);
          }
      }
    }
  }
  return { pixels, width, height };
}

describe('chooseFiveColumnGrid', () => {
  it('rejects the shifted dash-A-B-C-D grid in favor of A-B-C-D-E', () => {
    const result = chooseFiveColumnGrid([
      { start: 100, step: 60, inkScore: 0.27, circleScore: 0.07 },
      { start: 160, step: 60, inkScore: 0.25, circleScore: 0.24 },
      { start: 220, step: 60, inkScore: 0.18, circleScore: 0.11 },
    ]);
    expect(result?.start).toBe(160);
    expect(result?.geometryConfidence).toBeGreaterThan(0.8);
  });

  it('does not lower confidence because of subpixel-equivalent grids', () => {
    const result = chooseFiveColumnGrid([
      { start: 160, step: 60, inkScore: 0.25, circleScore: 0.24 },
      { start: 163, step: 61, inkScore: 0.249, circleScore: 0.239 },
      { start: 100, step: 60, inkScore: 0.2, circleScore: 0.06 },
    ]);
    expect(result?.start).toBeGreaterThanOrEqual(160);
    expect(result?.geometryConfidence).toBeGreaterThan(0.8);
  });

  it('uses the rightmost grid when candidates are effectively tied', () => {
    const result = chooseFiveColumnGrid([
      { start: 90, step: 50, inkScore: 0.2, circleScore: 0.2 },
      { start: 140, step: 50, inkScore: 0.198, circleScore: 0.2 },
    ]);
    expect(result?.start).toBe(140);
  });

  it('does not treat the rejected dash grid as optical ambiguity', () => {
    const result = chooseFiveColumnGrid([
      { start: 100, step: 60, inkScore: 0.32, circleScore: 0.12 },
      { start: 160, step: 60, inkScore: 0.28, circleScore: 0.2 },
    ]);
    expect(result?.start).toBe(160);
    expect(result?.geometryConfidence).toBeGreaterThan(0.8);
  });
});

describe('answer-sheet image analysis', () => {
  const expected: Letter[] = ['A', 'B', 'C', 'A', 'A', 'C', 'C', 'C', 'D', 'A'];

  it.each([false, true])(
    'reads a free grid with shaded corners = %s',
    (shadow) => {
      const { pixels, width, height } = makeAnswerSheet(expected, { shadow });
      const result = readAnswerPixels(pixels, width, height, expected.length);
      expect(result.mode).toBe('free');
      expect(result.readings.map((reading) => reading.answer)).toEqual(
        expected,
      );
    },
  );

  it('keeps the alternatives aligned in a slightly tilted photo', () => {
    const { pixels, width, height } = makeAnswerSheet(expected, {
      shadow: true,
      tilt: 0.012,
    });
    const result = readAnswerPixels(pixels, width, height, expected.length);
    expect(result.mode).toBe('free');
    expect(result.readings.map((reading) => reading.answer)).toEqual(expected);
  });

  it('does not invent an answer for a blank or a double marking', () => {
    const answers = [...expected];
    const markings: Array<Letter | Letter[] | null> = answers;
    markings[3] = null;
    markings[7] = ['A', 'D'];
    const { pixels, width, height } = makeAnswerSheet(markings, {
      shadow: true,
    });
    const result = readAnswerPixels(pixels, width, height, markings.length);
    expect(result.readings[3].answer).toBeNull();
    expect(result.readings[7].answer).toBeNull();
  });

  it('does not mistake four round blobs for square registration markers', () => {
    const { pixels, width, height } = makeAnswerSheet(expected, {
      shadow: true,
    });
    for (const centerX of [30, 570])
      for (const centerY of [32, 768]) {
        for (let dy = -18; dy <= 18; dy += 1)
          for (let dx = -18; dx <= 18; dx += 1) {
            if (Math.hypot(dx, dy) > 18) continue;
            const offset = ((centerY + dy) * width + centerX + dx) * 4;
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 18;
          }
      }
    const result = readAnswerPixels(pixels, width, height, expected.length);
    expect(result.mode).toBe('free');
    expect(result.readings.map((reading) => reading.answer)).toEqual(expected);
  });

  it.each([10, 30])(
    'recognizes the four square markers for %s questions',
    (count) => {
      const answers = Array.from(
        { length: count },
        (_, index) => LETTERS[index % 5],
      );
      const { pixels, width, height } = makeAnswerSheet(answers, {
        markers: true,
        shadow: true,
      });
      const result = readAnswerPixels(pixels, width, height, count);
      expect(result.mode).toBe('markers');
      expect(result.readings.map((reading) => reading.answer)).toEqual(answers);
    },
  );
});
