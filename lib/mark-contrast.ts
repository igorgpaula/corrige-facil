import type { SheetPoint } from './types';

export type MarkContrast = {
  paper: number;
  coverage: number;
  strictCoverage: number;
  weakestQuadrant: number;
  darkness: number;
  valid: boolean;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Local paper normalization, shared by blue and black ink. No photo is retained. */
export function measureMarkContrast(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  point: SheetPoint,
  radius: number,
): MarkContrast {
  const intensity = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    // Blue ink is dark in both channels; neutral black ink follows the same path.
    return (pixels[offset] + pixels[offset + 1]) / 2;
  };
  const background: number[] = [];
  const outer = radius * 1.65;
  const inner = radius * 1.15;
  for (let dy = -Math.ceil(outer); dy <= outer; dy += 2)
    for (let dx = -Math.ceil(outer); dx <= outer; dx += 2) {
      const d = dx * dx + dy * dy;
      if (d < inner * inner || d > outer * outer) continue;
      const x = Math.round(point.x + dx),
        y = Math.round(point.y + dy);
      if (x >= 0 && y >= 0 && x < width && y < height)
        background.push(intensity(x, y));
    }
  background.sort((a, b) => a - b);
  // The upper quartile ignores most nearby outlines/letters without using a
  // single bright pixel as the background reference.
  const paper = background[Math.floor((background.length - 1) * 0.75)] ?? 0;
  const r = Math.max(2, radius * 0.6);
  const quadrants = Array.from({ length: 4 }, () => ({ total: 0, dark: 0 }));
  let total = 0,
    coverage = 0,
    strict = 0,
    darkness = 0;
  for (let dy = -Math.ceil(r); dy <= r; dy++)
    for (let dx = -Math.ceil(r); dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = Math.round(point.x + dx),
        y = Math.round(point.y + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const contrast = clamp((paper - intensity(x, y)) / Math.max(1, paper));
      const quadrant = quadrants[(dy < 0 ? 0 : 2) + (dx < 0 ? 0 : 1)];
      quadrant.total++;
      total++;
      darkness += contrast;
      if (contrast >= 0.22) coverage++;
      if (contrast >= 0.36) {
        strict++;
        quadrant.dark++;
      }
    }
  return {
    paper,
    coverage: coverage / Math.max(1, total),
    strictCoverage: strict / Math.max(1, total),
    weakestQuadrant: Math.min(
      ...quadrants.map((q) => q.dark / Math.max(1, q.total)),
    ),
    darkness: darkness / Math.max(1, total),
    valid: background.length >= 24 && total >= 24 && paper >= 50,
  };
}

/** A solid mark must survive both contrast thresholds and cover all quadrants. */
export function rankMarkContrast(marks: MarkContrast[]) {
  const ranked = marks
    .map((mark, index) => ({ mark, index }))
    .sort((a, b) => b.mark.strictCoverage - a.mark.strictCoverage);
  const solid = (mark: MarkContrast) =>
    mark.valid &&
    mark.strictCoverage >= 0.7 &&
    mark.weakestQuadrant >= 0.45 &&
    mark.darkness >= 0.4;
  const winner = ranked[0];
  const runner = ranked[1];
  const multiple = ranked.filter(({ mark }) => solid(mark)).length > 1;
  const gap = winner.mark.strictCoverage - runner.mark.strictCoverage;
  const confidence =
    solid(winner.mark) && runner.mark.valid && !multiple && gap >= 0.25
      ? Math.min(
          clamp((winner.mark.strictCoverage - 0.3) / 0.5),
          clamp(winner.mark.weakestQuadrant / 0.55),
          clamp(winner.mark.darkness / 0.55),
          clamp(gap / 0.4),
          clamp(1 - (winner.mark.coverage - winner.mark.strictCoverage) / 0.2),
        )
      : 0;
  return { index: winner.index, confidence, multiple };
}
