import { beforeEach, expect, it, vi } from 'vitest';
import {
  associateAnswerSheetTemplate,
  createSession,
  duplicateSession,
  listAnswerSheetTemplates,
  loadSession,
  saveAnswerSheetTemplate,
  saveCorrection,
  updateSessionDraft,
} from './repository';
import type { AnswerReading, AnswerSheetTemplate, SessionDraft } from './types';

beforeEach(() => {
  const memory = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    },
  });
});
const draft: SessionDraft = {
  title: 'Teste',
  className: 'Turma fictícia',
  subject: '',
  questionCount: 10,
  pointsPerQuestion: 1,
  answerKey: Array(10).fill('A'),
  questions: [],
};
const model: Omit<AnswerSheetTemplate, 'id' | 'createdAt'> = {
  name: 'Quadro 10',
  version: 1,
  mode: 'legacy',
  questionCount: 10,
  geometry: { columns: 5, rows: 10, radiusRatio: 0.0875 },
  baseline: { A: 0.2, B: 0.2, C: 0.2, D: 0.2, E: 0.2 },
};
const readings: AnswerReading[] = Array.from({ length: 10 }, () => ({
  answer: 'A',
  confidence: 90,
  source: 'scan',
  status: 'read',
}));
it('salva e isola modelos de dois usuários, sem permitir fotos ou campos extras', async () => {
  await saveAnswerSheetTemplate('one', model);
  expect(await listAnswerSheetTemplates('one')).toHaveLength(1);
  expect(await listAnswerSheetTemplates('two')).toHaveLength(0);
  await expect(
    saveAnswerSheetTemplate('one', {
      ...model,
      image: 'data:image/png;base64,test',
    } as never),
  ).rejects.toThrow();
});
it('trava a estrutura, mas permite trocar modelo compatível e duplicar a sessão', async () => {
  const bundle = await createSession('one', draft);
  const template = await saveAnswerSheetTemplate('one', model);
  await saveCorrection('one', bundle.session.id, {
    studentLabel: null,
    answers: Array(10).fill('A'),
    readings,
    correctCount: 10,
    score: 10,
    maximumScore: 10,
  });
  await associateAnswerSheetTemplate('one', bundle.session.id, template.id);
  await expect(
    updateSessionDraft('one', bundle.session.id, {
      ...draft,
      pointsPerQuestion: 2,
    }),
  ).rejects.toThrow(/travada/);
  const saved = (await loadSession('one', bundle.session.id))!;
  expect(saved.session.answerKey).toEqual(draft.answerKey);
  expect(saved.session.answerSheetTemplateId).toBe(template.id);
  const clone = await duplicateSession('one', saved);
  expect(clone.corrections).toHaveLength(0);
  expect(clone.session.lockedAt).toBeNull();
  expect(clone.session.answerSheetTemplateId).toBe(template.id);
  const wrong = await saveAnswerSheetTemplate('one', {
    ...model,
    questionCount: 12,
    geometry: { ...model.geometry, rows: 12 },
  });
  await expect(
    associateAnswerSheetTemplate('one', bundle.session.id, wrong.id),
  ).rejects.toThrow(/quantidade/);
});
it('bloqueia pendências e comprimento incorreto; persiste somente resultados escalares', async () => {
  const bundle = await createSession('one', draft);
  const correction = {
    studentLabel: null,
    answers: Array(10).fill('A'),
    readings,
    correctCount: 10,
    score: 10,
    maximumScore: 10,
  };
  await expect(
    saveCorrection('one', bundle.session.id, {
      ...correction,
      readings: readings.map((r, i) =>
        i === 9 ? { ...r, answer: null, status: 'uncertain' } : r,
      ),
    }),
  ).rejects.toThrow();
  await expect(
    saveCorrection('one', bundle.session.id, {
      ...correction,
      answers: ['A'],
      readings: readings.slice(0, 1),
    }),
  ).rejects.toThrow();
  await saveCorrection('one', bundle.session.id, {
    ...correction,
    image: 'data:image/jpeg;base64,test',
    readings: readings.map((r) => ({ ...r, suggestedAnswer: 'B' })),
  } as never);
  const saved = (await loadSession('one', bundle.session.id))!.corrections[0];
  expect(JSON.stringify(saved)).not.toMatch(/base64|suggestedAnswer|image/);
});
