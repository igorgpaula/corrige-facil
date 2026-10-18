import { LETTERS, type AnswerReading } from './types';

export function getQuestionCoordinates(index: number, count: number) {
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
