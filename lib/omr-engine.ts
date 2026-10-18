import type { CvMat, OpenCv } from './opencv';
import { getQuestionCoordinates } from './sheet-geometry';
import {
  LETTERS,
  type AnswerReading,
  type ScanOptions,
  type ScanResult,
  type SheetAnchors,
  type SheetPoint,
} from './types';

type Circle = SheetPoint & { radius: number };
type Row = {
  y: number;
  start: number;
  step: number;
  matched: Circle[];
  score: number;
};
type Geometry = {
  anchors: SheetAnchors;
  radius: number;
  confidence: number;
  matched: number;
  residual: number;
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const median = (values: number[]) => quantile(values, 0.5);
function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))] ??
    0
  );
}
const distance = (a: SheetPoint, b: SheetPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const odd = (value: number) => Math.max(3, Math.round(value) | 1);
function project(h: ArrayLike<number>, x: number, y: number): SheetPoint {
  const z = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / z,
    y: (h[3] * x + h[4] * y + h[5]) / z,
  };
}
function transform(cv: OpenCv, from: SheetPoint[], to: SheetPoint[]) {
  const a = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    from.flatMap((p) => [p.x, p.y]),
  );
  const b = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    to.flatMap((p) => [p.x, p.y]),
  );
  try {
    return cv.getPerspectiveTransform(a, b);
  } finally {
    a.delete();
    b.delete();
  }
}

function contours(
  cv: OpenCv,
  binary: CvMat,
  width: number,
  height: number,
  count: number,
) {
  const vector = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const circles: Circle[] = [];
  const squares: Array<SheetPoint & { size: number }> = [];
  try {
    cv.findContours(
      binary,
      vector,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );
    for (let index = 0; index < vector.size(); index += 1) {
      const contour = vector.get(index);
      try {
        const box = cv.boundingRect(contour);
        const area = cv.contourArea(contour);
        const aspect = box.width / Math.max(1, box.height);
        const fill = area / Math.max(1, box.width * box.height);
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        if (
          aspect > 0.7 &&
          aspect < 1.4 &&
          fill > 0.82 &&
          box.width > width * 0.018 &&
          box.width < width * 0.11
        )
          squares.push({ ...center, size: box.width });
        if (
          box.width < Math.max(10, width * 0.012) ||
          box.width > width * 0.17 ||
          box.height > (height / Math.max(1, count)) * 0.94 ||
          aspect < 0.63 ||
          aspect > 1.5 ||
          fill < 0.46
        )
          continue;
        const perimeter = cv.arcLength(contour, true);
        if (
          (4 * Math.PI * area) / Math.max(1, perimeter * perimeter) < 0.42 ||
          contour.rows < 5
        )
          continue;
        const ellipse = cv.fitEllipse(contour);
        const radius = (ellipse.size.width + ellipse.size.height) / 4;
        if (radius > 4 && Number.isFinite(ellipse.center.x))
          circles.push({ ...ellipse.center, radius });
      } finally {
        contour.delete();
      }
    }
  } finally {
    vector.delete();
    hierarchy.delete();
  }
  circles.sort((a, b) => b.radius - a.radius);
  return {
    circles: circles.filter(
      (circle, index) =>
        !circles
          .slice(0, index)
          .some(
            (other) =>
              distance(circle, other) <
              Math.min(circle.radius, other.radius) * 0.6,
          ),
    ),
    squares,
  };
}

function rowFits(points: Circle[], radius: number): Row[] {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const fits: Row[] = [];
  for (const a of sorted)
    for (const b of sorted) {
      if (b.x <= a.x) continue;
      for (let gap = 1; gap <= 4; gap += 1) {
        const step = (b.x - a.x) / gap;
        if (step < radius * 2.15 || step > radius * 4.2) continue;
        for (let column = 0; column < 5; column += 1) {
          const start = a.x - column * step;
          const found: Circle[] = [];
          let error = 0;
          for (let option = 0; option < 5; option += 1) {
            const expected = start + option * step;
            const nearest = sorted.reduce((best, p) =>
              Math.abs(p.x - expected) < Math.abs(best.x - expected) ? p : best,
            );
            if (
              Math.abs(nearest.x - expected) < radius * 0.33 &&
              !found.includes(nearest)
            ) {
              found.push(nearest);
              error += Math.abs(nearest.x - expected);
            }
          }
          if (found.length >= 4)
            fits.push({
              y: median(found.map((p) => p.y)),
              start,
              step,
              matched: found,
              score: found.length / 5 - error / (5 * radius),
            });
        }
      }
    }
  return fits
    .sort((a, b) => b.score - a.score)
    .filter(
      (fit, index, all) =>
        !all
          .slice(0, index)
          .some(
            (other) =>
              Math.abs(fit.start - other.start) < radius * 0.3 &&
              Math.abs(fit.step - other.step) < radius * 0.15,
          ),
    )
    .slice(0, 8);
}

function findLegacyGeometry(
  cv: OpenCv,
  circles: Circle[],
  count: number,
): Geometry | null {
  const peaks = [...circles].sort(
    (a, b) =>
      circles.filter((p) => Math.abs(p.radius - b.radius) < b.radius * 0.2)
        .length -
      circles.filter((p) => Math.abs(p.radius - a.radius) < a.radius * 0.2)
        .length,
  );
  const radii: number[] = [];
  for (const peak of peaks)
    if (!radii.some((r) => Math.abs(r - peak.radius) < r * 0.24))
      radii.push(peak.radius);
  const solutions: Geometry[] = [];
  for (const radius of radii.slice(0, 4)) {
    const candidates = circles.filter(
      (p) => p.radius > radius * 0.74 && p.radius < radius * 1.25,
    );
    // Estimate the common direction of rows before clustering their centers.
    const slopes: number[] = [];
    for (const a of candidates)
      for (const b of candidates) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx > radius * 2 && dx < radius * 15 && Math.abs(dy / dx) < 0.3)
          slopes.push(dy / dx);
      }
    const bins = new Map<number, number[]>();
    for (const slope of slopes) {
      const key = Math.round(slope / 0.015);
      bins.set(key, [...(bins.get(key) ?? []), slope]);
    }
    const slope = median(
      [...bins.values()].sort((a, b) => b.length - a.length)[0] ?? [0],
    );
    const groups: Circle[][] = [];
    for (const p of candidates.sort(
      (a, b) => a.y - slope * a.x - (b.y - slope * b.x),
    )) {
      const last = groups[groups.length - 1];
      if (
        last &&
        Math.abs(
          p.y - slope * p.x - median(last.map((c) => c.y - slope * c.x)),
        ) <
          radius * 0.75
      )
        last.push(p);
      else groups.push([p]);
    }
    const choices = groups
      .filter((g) => g.length >= 4)
      .map((g) => rowFits(g, radius))
      .filter((g) => g.length);
    const complete = choices
      .map((g) => g[0])
      .filter((row) => row.matched.length === 5);
    if (!complete.length) continue;
    const start = median(complete.map((row) => row.start));
    const step = median(complete.map((row) => row.step));
    const rows = choices
      .map((options) =>
        options.find(
          (row) =>
            Math.abs(row.start - start) < step * 0.45 &&
            Math.abs(row.step - step) < step * 0.18,
        ),
      )
      .filter((row): row is Row => Boolean(row))
      .sort((a, b) => a.y - b.y);
    if (rows.length < count) continue;
    let bestRows: Row[] | null = null;
    let bestCost = Infinity;
    for (let offset = 0; offset <= rows.length - count; offset += 1) {
      const subset = rows.slice(offset, offset + count);
      const gaps = subset.slice(1).map((row, i) => row.y - subset[i].y);
      const pitch = median(gaps);
      if (count > 1 && pitch < radius * 2) continue;
      const cost =
        gaps.reduce(
          (sum, gap) => sum + Math.abs(gap - pitch) / Math.max(1, pitch),
          0,
        ) /
          Math.max(1, gaps.length) +
        1 -
        subset.reduce((sum, row) => sum + row.score, 0) / count;
      if (cost < bestCost) {
        bestCost = cost;
        bestRows = subset;
      }
    }
    if (!bestRows || bestCost > 0.22) continue;
    const canonical: number[] = [];
    const actual: number[] = [];
    bestRows.forEach((row, index) =>
      row.matched.forEach((p) => {
        canonical.push(Math.round((p.x - row.start) / row.step), index);
        actual.push(p.x, p.y);
      }),
    );
    if (count === 1) {
      const row = bestRows[0];
      const y = row.y;
      solutions.push({
        anchors: [
          { x: row.start, y },
          { x: row.start + 4 * row.step, y },
          { x: row.start + 4 * row.step, y: y + 1 },
          { x: row.start, y: y + 1 },
        ],
        radius,
        confidence: 0.88,
        matched: row.matched.length,
        residual: 0,
      });
      continue;
    }
    const a = cv.matFromArray(canonical.length / 2, 1, cv.CV_32FC2, canonical);
    const b = cv.matFromArray(actual.length / 2, 1, cv.CV_32FC2, actual);
    let h: CvMat | undefined;
    try {
      h = cv.findHomography(a, b, cv.RANSAC, Math.max(2, radius * 0.22));
      if (!h.rows) continue;
      const errors = Array.from({ length: actual.length / 2 }, (_, index) =>
        distance(
          project(h!.data64F, canonical[index * 2], canonical[index * 2 + 1]),
          { x: actual[index * 2], y: actual[index * 2 + 1] },
        ),
      );
      const inliers = errors.filter((error) => error < radius * 0.3);
      const residual = Math.sqrt(
        inliers.reduce((sum, error) => sum + error * error, 0) /
          Math.max(1, inliers.length),
      );
      const coverage = inliers.length / (count * 5);
      const confidence = clamp(
        Math.min(1, coverage / 0.9) * (1 - residual / (radius * 0.8)),
      );
      solutions.push({
        anchors: [
          project(h.data64F, 0, 0),
          project(h.data64F, 4, 0),
          project(h.data64F, 4, count - 1),
          project(h.data64F, 0, count - 1),
        ],
        radius,
        confidence,
        matched: inliers.length,
        residual,
      });
    } finally {
      a.delete();
      b.delete();
      h?.delete();
    }
  }
  solutions.sort((a, b) => b.confidence - a.confidence);
  const best = solutions[0];
  if (!best) return null;
  const rival = solutions.find(
    (other) =>
      distance(other.anchors[0], best.anchors[0]) > best.radius * 0.7 &&
      other.confidence > best.confidence - 0.08,
  );
  if (rival) return { ...best, confidence: Math.min(0.59, best.confidence) };
  return best;
}

function findMarkerGeometry(
  squares: Array<SheetPoint & { size: number }>,
  width: number,
  height: number,
  count: number,
): Geometry | null {
  const quadrants = [
    (p: SheetPoint) => p.x < width * 0.2 && p.y < height * 0.15,
    (p: SheetPoint) => p.x > width * 0.8 && p.y < height * 0.15,
    (p: SheetPoint) => p.x > width * 0.8 && p.y > height * 0.85,
    (p: SheetPoint) => p.x < width * 0.2 && p.y > height * 0.85,
  ];
  const markers = quadrants.map(
    (test) => squares.filter(test).sort((a, b) => b.size - a.size)[0],
  );
  if (markers.some((p) => !p)) return null;
  const sizes = markers.map((p) => p.size);
  if (Math.max(...sizes) > Math.min(...sizes) * 1.6) return null;
  return {
    anchors: markers as unknown as SheetAnchors,
    radius:
      distance(markers[0], markers[1]) *
      (2.5 / ((count > 25 ? 186 : 100) * 0.9)),
    confidence: 0.96,
    matched: 4,
    residual: 0,
  };
}

export function validateAnchors(points: SheetAnchors) {
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 1 ||
        p.y < 0 ||
        p.y > 1,
    )
  )
    throw new Error('Os pontos devem ficar dentro da foto.');
  const crosses = points.map((p, index) => {
    const q = points[(index + 1) % 4];
    const r = points[(index + 2) % 4];
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
  });
  if (crosses.some((value) => value <= 0.00001))
    throw new Error(
      'Marque os quatro pontos na ordem indicada, sem cruzar os lados.',
    );
}

function diskScores(
  pixels: Uint8ClampedArray,
  maskA: Uint8Array,
  maskB: Uint8Array,
  width: number,
  height: number,
  point: SheetPoint,
  radius: number,
) {
  const r = Math.max(2, radius * 0.6);
  let a = 0;
  let b = 0;
  let blue = 0;
  let total = 0;
  for (let dy = -Math.ceil(r); dy <= r; dy += 1)
    for (let dx = -Math.ceil(r); dx <= r; dx += 1) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = Math.round(point.x + dx);
      const y = Math.round(point.y + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = y * width + x;
      const offset = index * 4;
      a += maskA[index] / 255;
      b += maskB[index] / 255;
      blue += clamp(
        (pixels[offset + 2] -
          Math.min(pixels[offset], pixels[offset + 1]) -
          14) /
          70,
      );
      total += 1;
    }
  return {
    a: a / Math.max(1, total),
    b: b / Math.max(1, total),
    blue: blue / Math.max(1, total),
  };
}

export function analyzeSheet(
  cv: OpenCv,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  count: number,
  options: ScanOptions,
): Omit<ScanResult, 'preview'> {
  if (count < 1 || count > 50 || pixels.length !== width * height * 4)
    throw new Error('Dimensões ou quantidade de questões inválidas.');
  if (options.template && options.template.questionCount !== count)
    throw new Error(
      'O modelo deve ter a mesma quantidade de questões da sessão.',
    );
  const allocated: CvMat[] = [];
  const mat = (...args: number[]) => {
    const m = new cv.Mat(...args);
    allocated.push(m);
    return m;
  };
  const engine = 'opencv-4.12.0-calibrated-v1';
  try {
    const rgba = mat(height, width, cv.CV_8UC4);
    rgba.data.set(pixels);
    const gray = mat();
    const blurred = mat();
    const binary = mat();
    const closed = mat();
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);
    const block = odd(Math.min(width, height) * 0.12);
    cv.adaptiveThreshold(
      blurred,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      block,
      4,
    );
    const kernel = cv.getStructuringElement(
      cv.MORPH_ELLIPSE,
      new cv.Size(7, 7),
    );
    allocated.push(kernel);
    cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel);
    const found = contours(cv, closed, width, height, count);
    let geometry: Geometry | null;
    if (options.anchors) {
      validateAnchors(options.anchors);
      const anchors = options.anchors.map((p) => ({
        x: p.x * width,
        y: p.y * height,
      })) as SheetAnchors;
      const span = distance(anchors[0], anchors[1]);
      if (
        span < width * 0.08 ||
        (count > 1 && distance(anchors[0], anchors[3]) < height * 0.08)
      )
        throw new Error(
          'Os quatro pontos precisam envolver todas as questões.',
        );
      geometry = {
        anchors,
        radius:
          span *
          (options.template?.geometry.radiusRatio ??
            (options.mode === 'standard'
              ? 2.5 / ((count > 25 ? 186 : 100) * 0.9)
              : 0.0875)),
        confidence: 0.96,
        matched: 0,
        residual: 0,
      };
    } else
      geometry =
        options.mode === 'standard'
          ? findMarkerGeometry(found.squares, width, height, count)
          : findLegacyGeometry(cv, found.circles, count);
    const normalizedAnchors = geometry?.anchors.map((p) => ({
      x: p.x / width,
      y: p.y / height,
    })) as SheetAnchors | undefined;
    if (!geometry)
      return {
        imageSize: { width, height },
        mode: options.mode === 'standard' ? 'markers' : 'free',
        alignment: 'failed',
        anchors: null,
        overlay: [],
        readings: Array.from({ length: count }, () => ({
          answer: null,
          confidence: 0,
          source: 'scan',
          status: 'uncertain',
        })),
        diagnostics: {
          engine,
          geometry: 0,
          matched: 0,
          residual: 0,
          message:
            'Não localizei a grade com segurança. Ajuste os quatro pontos sobre a foto.',
        },
      };

    const standard = options.mode === 'standard';
    const canonicalWidth = standard ? 900 : 512;
    const rows = Math.ceil(count / (count > 25 ? 2 : 1));
    const cardHeight = Math.min(250, Math.max(90, 58 + rows * 7.4));
    const canonicalHeight = standard
      ? Math.round(
          (900 * (cardHeight * 0.92)) / ((count > 25 ? 186 : 100) * 0.9),
        )
      : Math.max(112, (count - 1) * 100 + 112);
    const target: SheetAnchors = standard
      ? [
          { x: 0, y: 0 },
          { x: canonicalWidth, y: 0 },
          { x: canonicalWidth, y: canonicalHeight },
          { x: 0, y: canonicalHeight },
        ]
      : [
          { x: 56, y: 56 },
          { x: 456, y: 56 },
          { x: 456, y: count === 1 ? 57 : canonicalHeight - 56 },
          { x: 56, y: count === 1 ? 57 : canonicalHeight - 56 },
        ];
    const h = transform(cv, geometry.anchors, target);
    allocated.push(h);
    const inverse = transform(cv, target, geometry.anchors);
    allocated.push(inverse);
    const rectified = mat();
    cv.warpPerspective(
      rgba,
      rectified,
      h,
      new cv.Size(canonicalWidth, canonicalHeight),
    );
    const rectGray = mat();
    cv.cvtColor(rectified, rectGray, cv.COLOR_RGBA2GRAY);
    const maskA = mat();
    const maskB = mat();
    const scale =
      distance(target[0], target[1]) /
      distance(geometry.anchors[0], geometry.anchors[1]);
    const radius = Math.max(4, geometry.radius * scale);
    cv.adaptiveThreshold(
      rectGray,
      maskA,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      odd(radius * 5),
      9,
    );
    cv.adaptiveThreshold(
      rectGray,
      maskB,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      odd(radius * 6),
      16,
    );
    // V2 has a small orientation dot next to the top-left marker. Older sheets
    // without it remain usable, but must be explicitly aligned by the teacher.
    if (standard && !options.anchors) {
      const orientation = diskScores(
        new Uint8ClampedArray(
          rectified.data.buffer,
          rectified.data.byteOffset,
          rectified.data.byteLength,
        ),
        maskA.data,
        maskB.data,
        canonicalWidth,
        canonicalHeight,
        { x: canonicalWidth * 0.1, y: 0 },
        canonicalWidth * 0.014,
      );
      if (Math.min(orientation.a, orientation.b) < 0.65)
        geometry.confidence = Math.min(geometry.confidence, 0.59);
    }
    const points = Array.from({ length: count }, (_, question) => {
      if (standard) {
        const c = getQuestionCoordinates(question, count);
        return c.bubbleXs.map((x) => ({
          x: x * canonicalWidth,
          y: c.y * canonicalHeight,
        }));
      }
      return LETTERS.map((_, column) => ({
        x: 56 + column * 100,
        y: 56 + question * 100,
      }));
    });
    const scores = points.map((row) =>
      row.map((p) =>
        diskScores(
          new Uint8ClampedArray(
            rectified.data.buffer,
            rectified.data.byteOffset,
            rectified.data.byteLength,
          ),
          maskA.data,
          maskB.data,
          canonicalWidth,
          canonicalHeight,
          p,
          radius,
        ),
      ),
    );
    const baseline = Object.fromEntries(
      LETTERS.map((letter, index) => [
        letter,
        options.calibrate
          ? median(scores.map((row) => Math.min(row[index].a, row[index].b)))
          : (options.template?.baseline[letter] ??
            Math.min(
              0.34,
              quantile(
                scores.map((row) => Math.min(row[index].a, row[index].b)),
                0.15,
              ),
            )),
      ]),
    ) as Record<(typeof LETTERS)[number], number>;
    const readings: AnswerReading[] = scores.map((row) => {
      const rank = (variant: 'a' | 'b') =>
        row
          .map((s, index) => ({
            index,
            value: clamp(
              Math.max(s[variant] - baseline[LETTERS[index]], s.blue * 1.25),
            ),
          }))
          .sort((a, b) => b.value - a.value);
      const a = rank('a');
      const b = rank('b');
      const top =
        (a[0].value + b.find((v) => v.index === a[0].index)!.value) / 2;
      const gap = Math.min(a[0].value - a[1].value, b[0].value - b[1].value);
      const stable = a[0].index === b[0].index;
      if (a[0].value < 0.13 && b[0].value < 0.13)
        return {
          answer: null,
          confidence: Math.round(geometry.confidence * 95),
          source: 'scan',
          status: geometry.confidence >= 0.8 ? 'blank' : 'uncertain',
        };
      if (a[1].value > 0.43 && b[1].value > 0.43)
        return {
          answer: null,
          confidence: Math.round(geometry.confidence * 90),
          source: 'scan',
          status: 'multiple',
        };
      const confidence = Math.round(
        100 *
          Math.min(
            geometry.confidence,
            clamp(0.6 + (top - 0.25) * 1.1),
            clamp(0.6 + (gap - 0.09) * 1.9),
            stable ? 1 : 0.55,
          ),
      );
      const accepted = confidence >= 80 && stable && gap > 0.09;
      return {
        answer: accepted ? LETTERS[a[0].index] : null,
        confidence,
        source: 'scan',
        status: accepted ? 'read' : 'uncertain',
        suggestedAnswer: LETTERS[a[0].index],
      };
    });
    const alignment =
      geometry.confidence >= 0.8 ? 'verified' : 'needs-adjustment';
    if (alignment !== 'verified')
      for (const reading of readings) {
        reading.suggestedAnswer = reading.answer ?? reading.suggestedAnswer;
        reading.answer = null;
        reading.status = 'uncertain';
      }
    if (
      options.calibrate &&
      scores.some((row) =>
        row.some((s) => s.blue > 0.25 || Math.min(s.a, s.b) > 0.8),
      )
    )
      throw new Error(
        'Use uma foto do quadro em branco, sem respostas preenchidas.',
      );
    return {
      imageSize: { width, height },
      readings,
      mode: standard ? 'markers' : 'free',
      alignment,
      anchors: normalizedAnchors ?? null,
      overlay: points.map((row, question) => ({
        question,
        radius: geometry.radius / width,
        centers: row.map((p) => {
          const q = project(inverse.data64F, p.x, p.y);
          return { x: q.x / width, y: q.y / height };
        }),
      })),
      diagnostics: {
        engine,
        geometry: Math.round(geometry.confidence * 100),
        matched: geometry.matched,
        residual: geometry.residual,
        message:
          alignment === 'verified'
            ? 'Grade alinhada. Confira os círculos sobre a foto e revise as pendências.'
            : 'O alinhamento está ambíguo. Ajuste os quatro pontos antes de aceitar as respostas.',
      },
      ...(options.calibrate
        ? {
            calibration: {
              radiusRatio:
                geometry.radius /
                distance(geometry.anchors[0], geometry.anchors[1]),
              baseline,
            },
          }
        : {}),
    };
  } finally {
    for (const resource of allocated.reverse()) resource.delete();
  }
}
