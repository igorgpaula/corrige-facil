import type { Correction, ExamSession, Letter, QuestionDefinition } from './types';
import { LETTERS } from './types';

export type QuestionStat = {
  order: number;
  prompt: string;
  accuracy: number;
  correct: number;
  total: number;
  optionCounts: Record<Letter | 'blank', number>;
  mostCommonWrong: Letter | null;
};

export function calculateAnalytics(
  session: ExamSession,
  questions: QuestionDefinition[],
  corrections: Correction[],
) {
  const scores = corrections.map((item) => item.score).sort((a, b) => a - b);
  const average = scores.length
    ? scores.reduce((sum, value) => sum + value, 0) / scores.length
    : 0;
  const middle = Math.floor(scores.length / 2);
  const median = !scores.length
    ? 0
    : scores.length % 2
      ? scores[middle]
      : (scores[middle - 1] + scores[middle]) / 2;

  const distribution = Array.from({ length: 10 }, (_, index) => ({
    label: `${index * 10}–${index === 9 ? 100 : index * 10 + 9}%`,
    count: 0,
  }));
  for (const correction of corrections) {
    const ratio = correction.maximumScore
      ? correction.score / correction.maximumScore
      : 0;
    const bucket = Math.min(9, Math.max(0, Math.floor(ratio * 10)));
    distribution[bucket].count += 1;
  }

  const questionStats: QuestionStat[] = Array.from(
    { length: session.questionCount },
    (_, index) => {
      const optionCounts: QuestionStat['optionCounts'] = {
        A: 0,
        B: 0,
        C: 0,
        D: 0,
        E: 0,
        blank: 0,
      };
      let correct = 0;
      for (const correction of corrections) {
        const answer = correction.answers[index];
        if (answer) optionCounts[answer] += 1;
        else optionCounts.blank += 1;
        if (answer && answer === session.answerKey[index]) correct += 1;
      }
      const wrongOptions = LETTERS.filter(
        (letter) => letter !== session.answerKey[index],
      ).sort((a, b) => optionCounts[b] - optionCounts[a]);
      return {
        order: index + 1,
        prompt: questions[index]?.prompt ?? '',
        accuracy: corrections.length ? correct / corrections.length : 0,
        correct,
        total: corrections.length,
        optionCounts,
        mostCommonWrong:
          wrongOptions[0] && optionCounts[wrongOptions[0]] > 0
            ? wrongOptions[0]
            : null,
      };
    },
  );

  const ranked = [...questionStats].sort(
    (a, b) => a.accuracy - b.accuracy || a.order - b.order,
  );

  return {
    total: corrections.length,
    average,
    median,
    distribution,
    questionStats,
    bottlenecks: ranked.slice(0, 3),
    strengths: ranked.slice(-3).reverse(),
  };
}
