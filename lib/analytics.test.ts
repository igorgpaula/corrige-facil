import { describe, expect, it } from 'vitest';

import { calculateAnalytics } from './analytics';
import type { Correction, ExamSession, QuestionDefinition } from './types';

describe('calculateAnalytics', () => {
  it('calculates average, median, bottlenecks and answer distribution', () => {
    const session: ExamSession = {
      id: 's1', title: 'Teste', className: '7A', subject: '',
      questionCount: 2, pointsPerQuestion: 5, answerKey: ['A', 'D'],
      status: 'active', lockedAt: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };
    const questions: QuestionDefinition[] = [
      { id: 'q_1', order: 1, prompt: 'Primeira', options: {}, ocrConfidence: null },
      { id: 'q_2', order: 2, prompt: 'Segunda', options: {}, ocrConfidence: null },
    ];
    const corrections: Correction[] = [
      { id: 'c1', studentLabel: null, answers: ['A', 'E'], readings: [], correctCount: 1, score: 5, maximumScore: 10, createdAt: '2026-01-01' },
      { id: 'c2', studentLabel: null, answers: ['A', 'D'], readings: [], correctCount: 2, score: 10, maximumScore: 10, createdAt: '2026-01-01' },
    ];
    const result = calculateAnalytics(session, questions, corrections);
    expect(result.average).toBe(7.5);
    expect(result.median).toBe(7.5);
    expect(result.bottlenecks[0].order).toBe(2);
    expect(result.questionStats[1].optionCounts.E).toBe(1);
  });
});
