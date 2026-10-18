import { calculateAnalytics } from './analytics';
import { LETTERS, type SessionBundle } from './types';

export function buildStatisticsSnapshot(
  bundle: SessionBundle,
  generatedAt = new Date(),
) {
  if (!bundle.corrections.length)
    throw new Error('Salve a primeira correção antes de exportar.');
  const { session, questions, corrections } = bundle;
  const analytics = calculateAnalytics(session, questions, corrections);
  return {
    generatedAt: generatedAt.toISOString(),
    session: {
      id: session.id,
      title: session.title,
      className: session.className,
      subject: session.subject,
      questionCount: session.questionCount,
      pointsPerQuestion: session.pointsPerQuestion,
      maximumScore: session.questionCount * session.pointsPerQuestion,
    },
    analytics,
    questions: analytics.questionStats.map((stat, i) => ({
      ...stat,
      answer: session.answerKey[i],
      options: Object.fromEntries(
        LETTERS.map((letter) => [letter, questions[i]?.options[letter] ?? '']),
      ),
    })),
    corrections: [...corrections]
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      )
      .map((correction) => ({
        studentLabel: correction.studentLabel || 'Não informado',
        createdAt: correction.createdAt,
        correctCount: correction.correctCount,
        score: correction.score,
        maximumScore: correction.maximumScore,
        percentage: correction.maximumScore
          ? correction.score / correction.maximumScore
          : 0,
        answers: Array.from(
          { length: session.questionCount },
          (_, i) => correction.answers[i] ?? null,
        ),
      })),
  };
}
export type StatisticsSnapshot = ReturnType<typeof buildStatisticsSnapshot>;
export function exportDate(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });
}
export function exportFilename(
  snapshot: StatisticsSnapshot,
  extension: 'pdf' | 'xlsx',
) {
  const slug = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 65);
  return `estatisticas-${slug(snapshot.session.title) || 'sessao'}-${slug(snapshot.session.className) || 'turma'}-${snapshot.generatedAt.slice(0, 10)}.${extension}`;
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export async function exportSessionStatistics(
  bundle: SessionBundle,
  format: 'pdf' | 'xlsx',
) {
  const snapshot = buildStatisticsSnapshot(bundle);
  if (format === 'pdf') {
    const { createStatisticsPdf, loadPdfFonts } =
      await import('./statistics-pdf');
    const pdf = createStatisticsPdf(snapshot, await loadPdfFonts());
    download(pdf.output('blob'), exportFilename(snapshot, format));
  } else {
    const { createStatisticsWorkbook } = await import('./statistics-xlsx');
    const bytes = await createStatisticsWorkbook(snapshot).xlsx.writeBuffer();
    download(
      new Blob([new Uint8Array(bytes)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      exportFilename(snapshot, format),
    );
  }
}
