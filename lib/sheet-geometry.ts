import { LETTERS, type AnswerReading } from './types';

export type StandardSheetVersion = 2 | 3;

// V2 is retained for already printed sheets. New sheets use a single column
// and a second orientation dot, so the reader can identify the layout locally.
export function getStandardSheetLayout(
  count: number,
  version: StandardSheetVersion = 3,
) {
  if (!Number.isInteger(count) || count < 1 || count > 50)
    throw new Error('O quadro deve ter entre 1 e 50 questões.');
  const oldColumns = count > 25 ? 2 : 1;
  const pitchMm = count > 25 ? 4.4 : 7.4;
  const heightMm =
    version === 2
      ? Math.min(250, Math.max(90, 58 + Math.ceil(count / oldColumns) * 7.4))
      : Math.max(90, 44 + (count - 1) * pitchMm);
  return {
    version,
    columns: version === 2 ? oldColumns : 1,
    widthMm: version === 2 && oldColumns === 2 ? 186 : 100,
    heightMm,
    markerInsetY: version === 2 ? heightMm * 0.04 : 5,
    bubbleDiameterMm: version === 3 && count > 25 ? 4 : 5,
    pitchMm,
  };
}

export function getQuestionCoordinates(
  index: number,
  count: number,
  version: StandardSheetVersion = 3,
) {
  if (version === 3) {
    const layout = getStandardSheetLayout(count, version);
    return {
      y:
        (32 + index * layout.pitchMm - layout.markerInsetY) /
        (layout.heightMm - layout.markerInsetY * 2),
      bubbleXs: [0.38, 0.5, 0.62, 0.74, 0.86],
      numberX: 0.19,
    };
  }
  const columns = count > 25 ? 2 : 1;
  const rows = Math.ceil(count / columns);
  const column = Math.floor(index / rows);
  const row = index % rows;
  return {
    y: rows === 1 ? 0.5 : 0.24 + (row / (rows - 1)) * 0.66,
    bubbleXs:
      columns === 1
        ? [0.38, 0.5, 0.62, 0.74, 0.86]
        : column === 0
          ? [0.11, 0.19, 0.27, 0.35, 0.43]
          : [0.58, 0.66, 0.74, 0.82, 0.9],
    numberX: columns === 1 ? 0.19 : column === 0 ? 0.045 : 0.515,
  };
}

export function needsReview(reading: AnswerReading) {
  if (reading.source === 'manual') return false;
  return (
    reading.status === 'uncertain' ||
    reading.status === 'multiple' ||
    reading.confidence < 80 ||
    (!reading.answer && reading.status !== 'blank')
  );
}

export function assertFinalReadings(readings: AnswerReading[], count: number) {
  if (
    count < 1 ||
    count > 50 ||
    readings.length !== count ||
    readings.some(
      (reading) =>
        needsReview(reading) ||
        (reading.answer !== null && !LETTERS.includes(reading.answer)) ||
        !Number.isFinite(reading.confidence) ||
        reading.confidence < 0 ||
        reading.confidence > 100 ||
        !['manual', 'scan'].includes(reading.source) ||
        reading.status === 'uncertain' ||
        (reading.answer !== null &&
          reading.status &&
          reading.status !== 'read'),
    )
  )
    throw new Error('Confirme todas as respostas pendentes antes de salvar.');
}
