import {
  LETTERS,
  type AnswerReading,
  type Answers,
  type ScanResult,
} from './types';

type Point = { x: number; y: number };

export function getQuestionCoordinates(index: number, count: number) {
  const columns = count > 25 ? 2 : 1;
  const rows = Math.ceil(count / columns);
  const column = Math.floor(index / rows);
  const row = index % rows;
  const y = rows === 1 ? 0.5 : 0.24 + (row / (rows - 1)) * 0.66;
  const bubbleXs =
    columns === 1
      ? [0.38, 0.5, 0.62, 0.74, 0.86]
      : column === 0
        ? [0.11, 0.19, 0.27, 0.35, 0.43]
        : [0.58, 0.66, 0.74, 0.82, 0.9];
  return {
    y,
    bubbleXs,
    numberX: columns === 1 ? 0.19 : column === 0 ? 0.045 : 0.515,
  };
}

function imageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível abrir a imagem.'));
    };
    image.src = url;
  });
}

function pixelDarkness(pixels: Uint8ClampedArray, offset: number) {
  const gray =
    pixels[offset] * 0.299 +
    pixels[offset + 1] * 0.587 +
    pixels[offset + 2] * 0.114;
  return Math.max(0, (185 - gray) / 185);
}

function smoothSignal(signal: Float32Array, windowSize: number) {
  const smoothed = new Float32Array(signal.length);
  const prefix = new Float64Array(signal.length + 1);
  for (let index = 0; index < signal.length; index += 1)
    prefix[index + 1] = prefix[index] + signal[index];
  const radius = Math.max(1, Math.floor(windowSize / 2));
  for (let index = 0; index < signal.length; index += 1) {
    const from = Math.max(0, index - radius);
    const to = Math.min(signal.length, index + radius + 1);
    smoothed[index] = (prefix[to] - prefix[from]) / (to - from);
  }
  return smoothed;
}

function averagePatch(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  center: Point,
  radius: number,
  annulus = false,
) {
  const r = Math.max(2, Math.round(radius));
  let darkness = 0;
  let samples = 0;
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > r || (annulus && distance < r * 0.58)) continue;
      const x = Math.round(center.x + dx);
      const y = Math.round(center.y + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      darkness += pixelDarkness(pixels, (y * width + x) * 4);
      samples += 1;
    }
  }
  return samples ? darkness / samples : 0;
}

function circleSignature(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  point: Point,
  radius: number,
) {
  const r = Math.max(3, radius);
  const patch = Math.max(1.5, r * 0.22);
  const directions = [
    [0, -r * 0.72],
    [0, r * 0.72],
    [-r * 0.72, 0],
    [r * 0.72, 0],
    [-r * 0.5, -r * 0.5],
    [r * 0.5, -r * 0.5],
    [-r * 0.5, r * 0.5],
    [r * 0.5, r * 0.5],
  ];
  const values = directions.map(([dx, dy]) =>
    averagePatch(
      pixels,
      width,
      height,
      { x: point.x + dx, y: point.y + dy },
      patch,
    ),
  );
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const minimumAxis = Math.min(values[0], values[1], values[2], values[3]);
  return mean * 0.55 + minimumAxis * 0.45;
}

export type ColumnGridCandidate = {
  start: number;
  step: number;
  inkScore: number;
  circleScore: number;
};

export function chooseFiveColumnGrid(candidates: ColumnGridCandidate[]) {
  if (!candidates.length) return null;
  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      score: candidate.inkScore * 0.42 + candidate.circleScore * 0.58,
    }))
    .sort((a, b) => b.score - a.score || b.start - a.start);
  const bestScore = scored[0].score;
  const competitive = scored.filter(
    (candidate) => candidate.score >= bestScore * 0.94,
  );
  // Quando duas grades têm qualidade semelhante, a grade correta é a mais à
  // direita: a falsa começa no hífen e termina em D (hífen, A, B, C, D).
  const best = competitive.sort((a, b) => b.start - a.start)[0];
  const runnerUp = scored.find((candidate) => {
    const meaningfullyDifferent =
      Math.abs(candidate.start - best.start) > best.step * 0.22 ||
      Math.abs(candidate.step - best.step) > best.step * 0.06;
    const isRejectedDashGrid =
      Math.abs(best.start - candidate.start - best.step) < best.step * 0.28 &&
      Math.abs(candidate.step - best.step) < best.step * 0.08 &&
      best.circleScore > candidate.circleScore * 1.04;
    return meaningfullyDifferent && !isRejectedDashGrid;
  });
  const margin = runnerUp
    ? Math.max(0, (best.score - runnerUp.score) / Math.max(best.score, 0.001))
    : 1;
  const geometryConfidence = Math.max(
    0,
    Math.min(1, margin * 4 + Math.min(0.45, best.circleScore * 1.8)),
  );
  return { ...best, geometryConfidence };
}

function sampleAnswers(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  pointsByQuestion: Point[][],
  radius: number,
  geometryConfidence: number,
  thresholds = { gap: 0.045, top: 0.15 },
): AnswerReading[] {
  return pointsByQuestion.map((points) => {
    const scores = points.map((point) =>
      averagePatch(pixels, width, height, point, radius),
    );
    const ranked = scores
      .map((score, index) => ({ score, index }))
      .sort((a, b) => b.score - a.score);
    const gap = ranked[0].score - ranked[1].score;
    const fillConfidence = Math.max(
      0,
      Math.min(1, (ranked[0].score - thresholds.top) / 0.28),
    );
    const separationConfidence = Math.max(
      0,
      Math.min(1, gap / Math.max(thresholds.gap * 3.2, 0.001)),
    );
    const confidence = Math.round(
      Math.min(geometryConfidence, fillConfidence, separationConfidence) * 100,
    );
    const answer =
      gap > thresholds.gap && ranked[0].score > thresholds.top
        ? LETTERS[ranked[0].index]
        : null;
    return { answer, confidence, source: 'scan' as const };
  });
}

function findRegistrationPoint(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  area: { x0: number; x1: number; y0: number; y1: number },
) {
  const step = Math.max(2, Math.round(Math.min(width, height) / 350));
  let totalX = 0;
  let totalY = 0;
  let weight = 0;
  for (let y = Math.floor(area.y0 * height); y < area.y1 * height; y += step) {
    for (let x = Math.floor(area.x0 * width); x < area.x1 * width; x += step) {
      const darkness = pixelDarkness(pixels, (y * width + x) * 4);
      if (darkness > 0.25) {
        const strong = darkness * darkness;
        totalX += x * strong;
        totalY += y * strong;
        weight += strong;
      }
    }
  }
  return weight ? { x: totalX / weight, y: totalY / weight } : null;
}

function detectRows(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  questionCount: number,
) {
  const signal = new Float32Array(height);
  const xFrom = Math.round(width * 0.16);
  const xTo = Math.round(width * 0.94);
  for (let y = 0; y < height; y += 1) {
    let total = 0;
    for (let x = xFrom; x < xTo; x += 1)
      total += pixelDarkness(pixels, (y * width + x) * 4);
    signal[y] = total / Math.max(1, xTo - xFrom);
  }
  const approximateStep = height / Math.max(1, questionCount);
  const smooth = smoothSignal(
    signal,
    Math.max(3, Math.round(approximateStep / 7)),
  );
  let best: { score: number; step: number; rows: number[] } | null = null;
  const minStep = Math.max(8, Math.round(approximateStep * 0.62));
  const maxStep = Math.max(minStep, Math.round(approximateStep * 1.1));
  for (let step = minStep; step <= maxStep; step += 1) {
    const lastStart = Math.min(
      Math.round(height * 0.4),
      height - 1 - step * (questionCount - 1),
    );
    for (let start = Math.round(height * 0.025); start <= lastStart; start += 1) {
      const rows: number[] = [];
      let score = 0;
      const radius = Math.max(2, Math.round(step * 0.14));
      for (let index = 0; index < questionCount; index += 1) {
        const expected = start + index * step;
        let localY = expected;
        let localScore = 0;
        for (
          let y = Math.max(0, expected - radius);
          y <= Math.min(height - 1, expected + radius);
          y += 1
        ) {
          if (smooth[y] > localScore) {
            localScore = smooth[y];
            localY = y;
          }
        }
        rows.push(localY);
        score += localScore;
      }
      score /= questionCount;
      if (!best || score > best.score) best = { score, step, rows };
    }
  }
  if (!best || best.score < 0.016)
    throw new Error('Não encontrei uma sequência regular de questões nesta foto.');
  return best;
}

function readFreeGrid(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  questionCount: number,
) {
  if (questionCount > 25)
    throw new Error(
      'O modo de foto livre aceita até 25 questões. Para provas maiores, use o quadro com marcadores.',
    );
  const rowLayout = detectRows(pixels, width, height, questionCount);
  const band = Math.max(3, Math.round(rowLayout.step * 0.22));
  const columnSignal = new Float32Array(width);
  for (let x = 0; x < width; x += 1) {
    let total = 0;
    let samples = 0;
    for (const row of rowLayout.rows) {
      for (
        let y = Math.max(0, row - band);
        y <= Math.min(height - 1, row + band);
        y += 1
      ) {
        total += pixelDarkness(pixels, (y * width + x) * 4);
        samples += 1;
      }
    }
    columnSignal[x] = samples ? total / samples : 0;
  }
  const smoothColumns = smoothSignal(
    columnSignal,
    Math.max(3, Math.round(width * 0.012)),
  );
  const projectedCandidates: Array<Omit<ColumnGridCandidate, 'circleScore'>> = [];
  for (let step = Math.round(width * 0.05); step <= width * 0.18; step += 1) {
    const latestStart = Math.min(
      Math.round(width * 0.56),
      width - 1 - step * 4,
    );
    for (let start = Math.round(width * 0.16); start <= latestStart; start += 1) {
      const columns = Array.from({ length: 5 }, (_, index) => start + index * step);
      const inkScore =
        columns.reduce((sum, column) => sum + smoothColumns[column], 0) / 5;
      if (inkScore < 0.018) continue;
      projectedCandidates.push({ start, step, inkScore });
    }
  }

  // A projeção 1D é barata e reduz dezenas de milhares de grades a um
  // conjunto curto e diverso. A assinatura circular (mais cara) só é medida
  // para esses finalistas, mantendo a leitura responsiva em celulares.
  const candidateBins = new Map<
    string,
    Omit<ColumnGridCandidate, 'circleScore'>
  >();
  for (const candidate of projectedCandidates) {
    const key = `${Math.round(candidate.start / Math.max(3, width * 0.005))}:${Math.round(candidate.step / Math.max(2, width * 0.003))}`;
    const previous = candidateBins.get(key);
    if (!previous || candidate.inkScore > previous.inkScore)
      candidateBins.set(key, candidate);
  }
  const finalists = [...candidateBins.values()]
    .sort((a, b) => b.inkScore - a.inkScore)
    .slice(0, 600);
  const candidates: ColumnGridCandidate[] = finalists.map((candidate) => {
      const radius = candidate.step * 0.25;
      let circleScore = 0;
      for (const row of rowLayout.rows) {
        for (let index = 0; index < 5; index += 1) {
          const column = candidate.start + index * candidate.step;
          circleScore += circleSignature(
            pixels,
            width,
            height,
            { x: column, y: row },
            radius,
          );
        }
      }
      circleScore /= rowLayout.rows.length * 5;
      return { ...candidate, circleScore };
    });
  const grid = chooseFiveColumnGrid(candidates);
  if (!grid || grid.circleScore < 0.018)
    throw new Error('Não encontrei as cinco colunas circulares A–E nesta foto.');
  const points = rowLayout.rows.map((y) =>
    Array.from({ length: 5 }, (_, index) => ({
      x: grid.start + index * grid.step,
      y,
    })),
  );
  return sampleAnswers(
    pixels,
    width,
    height,
    points,
    grid.step * 0.24,
    // Uma grade aprovada aqui já passou por dez linhas regulares e cinco
    // assinaturas circulares. Pequenas variações subpixel entre candidatos
    // não devem derrubar artificialmente a confiança de todas as respostas.
    Math.max(0.82, grid.geometryConfidence),
  );
}

export async function readAnswerSheet(
  file: File,
  questionCount: number,
): Promise<ScanResult> {
  const image = await imageFromFile(file);
  const scale = Math.min(1, 1200 / image.naturalWidth);
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Seu navegador não conseguiu analisar a foto.');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const preview = canvas.toDataURL('image/jpeg', 0.82);

  const regions = [
    { x0: 0, x1: 0.14, y0: 0, y1: 0.075 },
    { x0: 0.86, x1: 1, y0: 0, y1: 0.075 },
    { x0: 0, x1: 0.14, y0: 0.925, y1: 1 },
    { x0: 0.86, x1: 1, y0: 0.925, y1: 1 },
  ];
  const found = regions.map((area) =>
    findRegistrationPoint(pixels, width, height, area),
  );
  if (!found.every(Boolean)) {
    return {
      readings: readFreeGrid(pixels, width, height, questionCount),
      preview,
      mode: 'free',
    };
  }

  const [tl, tr, bl, br] = found as Point[];
  const mapPoint = (u: number, v: number): Point => ({
    x:
      (1 - u) * (1 - v) * tl.x +
      u * (1 - v) * tr.x +
      (1 - u) * v * bl.x +
      u * v * br.x,
    y:
      (1 - u) * (1 - v) * tl.y +
      u * (1 - v) * tr.y +
      (1 - u) * v * bl.y +
      u * v * br.y,
  });
  const sheetWidth = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const points = Array.from({ length: questionCount }, (_, question) => {
    const { y, bubbleXs } = getQuestionCoordinates(question, questionCount);
    return bubbleXs.map((x) => mapPoint(x, y));
  });
  return {
    readings: sampleAnswers(
      pixels,
      width,
      height,
      points,
      Math.max(5, sheetWidth * 0.011),
      0.98,
      { gap: 0.035, top: 0.12 },
    ),
    preview,
    mode: 'markers',
  };
}

export function answersFromReadings(readings: AnswerReading[]): Answers {
  return readings.map((reading) => reading.answer);
}
