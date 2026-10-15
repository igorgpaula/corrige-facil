import { describe, expect, it } from 'vitest';

import { chooseFiveColumnGrid } from './omr';

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
