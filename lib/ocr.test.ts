import { describe, expect, it, vi } from 'vitest';

import { examPages, expectedExamQuestions } from './fixtures/exam-pages';
import {
  parseExamSections,
  parseExamText,
  readBlankExam,
  resolvePdfWorkerUrl,
} from './ocr';
import { LETTERS } from './types';

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({
  getDocument,
  GlobalWorkerOptions: { workerSrc: '' },
}));

describe('resolvePdfWorkerUrl', () => {
  it('converts the generated file URL into an HTTPS asset URL', () => {
    expect(
      resolvePdfWorkerUrl(
        'file:///corrige-facil/v2/_next/static/media/pdf.worker.min.mjs',
        'https://igorgpaula.github.io',
      ),
    ).toBe(
      'https://igorgpaula.github.io/corrige-facil/v2/_next/static/media/pdf.worker.min.mjs',
    );
  });

  it('preserves an already valid HTTPS worker URL', () => {
    expect(
      resolvePdfWorkerUrl(
        'https://cdn.example.com/pdf.worker.min.mjs',
        'https://igorgpaula.github.io',
      ),
    ).toBe('https://cdn.example.com/pdf.worker.min.mjs');
  });
});

describe('parseExamText', () => {
  it('extracts numbered questions and alternatives', () => {
    const questions = parseExamText(
      `
      Questão 1 - Quanto é 2 + 2?
      A) 2
      B) 3
      C) 4
      D) 5
      E) 6
      02 - Qual é a capital do Brasil?
      (A) São Paulo
      (B) Brasília
      (C) Recife
      (D) Manaus
      (E) Curitiba
    `,
      0.88,
    );
    expect(questions).toHaveLength(2);
    expect(questions[0].prompt).toContain('2 + 2');
    expect(questions[0].options.C).toBe('4');
    expect(questions[1].options.B).toBe('Brasília');
    expect(questions[0].ocrConfidence).toBe(0.88);
  });

  it('does not interpret exam metadata or numeric answers as questions', () => {
    const questions = parseExamText(`
      10 questões - valor sugerido: 1,0 ponto por questão
      1. Escolha o número ou fração.
      A) 15
      B) 1/2
      C) 0.5
      D) 200
      E) 4/5
      2) Próxima questão.
      A. Primeira
      (B) Segunda
      C: Terceira
      D- Quarta
      E) Quinta
    `);
    expect(questions).toHaveLength(2);
    expect(questions[0].prompt).toBe('Escolha o número ou fração.');
    expect(questions[0].options).toEqual({
      A: '15',
      B: '1/2',
      C: '0.5',
      D: '200',
      E: '4/5',
    });
    expect(questions[1].options).toEqual({
      A: 'Primeira',
      B: 'Segunda',
      C: 'Terceira',
      D: 'Quarta',
      E: 'Quinta',
    });
  });
});

describe('multi-page exam import', () => {
  it('reads all ten questions and every alternative from the sample exam', () => {
    const questions = parseExamSections(
      examPages.map((text) => ({ text, confidence: 0.98 })),
    );
    expect(
      questions.map((question) => [
        question.prompt,
        LETTERS.map((letter) => question.options[letter]),
      ]),
    ).toEqual(expectedExamQuestions);
    expect(questions.map((question) => question.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('continues a question across a page break without including titles and footers', () => {
    const questions = parseExamSections([
      {
        text: 'PROVA DE MATEMÁTICA\nQuestão 1 - Escolha a fração\nque representa metade.\nA) Um\nB) Um meio\nPágina 1 de 2',
        confidence: 0.95,
      },
      {
        text: 'PROVA DE MATEMÁTICA\nC) Um terço\nD) Um quarto\nE) Dois\nQuestão 2 - Próxima questão.\nA) Sim\nB) Não\nPágina 2 de 2',
        confidence: 0.72,
      },
    ]);
    expect(questions).toHaveLength(2);
    expect(questions[0].prompt).toBe('Escolha a fração que representa metade.');
    expect(questions[0].options).toEqual({
      A: 'Um',
      B: 'Um meio',
      C: 'Um terço',
      D: 'Um quarto',
      E: 'Dois',
    });
    expect(questions[0].ocrConfidence).toBe(0.72);
  });

  it('handles flattened PDF text with inline question and option markers', () => {
    const questions = parseExamText(
      'Questão 01 Quanto é 2 + 2? A) 2 B) 3 C) 4 D) 5 E) 6 Questão 02 Capital? (A) Recife (B) Brasília (C) Natal (D) Manaus (E) Belém',
    );
    expect(questions).toHaveLength(2);
    expect(questions[0].options.C).toBe('4');
    expect(questions[1].options.B).toBe('Brasília');
  });

  it('keeps the second page when importing through readBlankExam', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: examPages.length,
        getPage: async (pageNumber: number) => ({
          getTextContent: async () => ({
            items: examPages[pageNumber - 1]
              .split('\n')
              .map((str) => ({ str, hasEOL: true })),
          }),
          cleanup: vi.fn(),
        }),
      }),
      destroy,
    });
    vi.stubGlobal('window', {
      location: { origin: 'https://igorgpaula.github.io' },
    });
    try {
      const onProgress = vi.fn();
      const questions = await readBlankExam(
        new File(['PDF'], 'prova.pdf', { type: 'application/pdf' }),
        new AbortController().signal,
        onProgress,
      );
      expect(
        questions.map((question) => [
          question.prompt,
          LETTERS.map((letter) => question.options[letter]),
        ]),
      ).toEqual(expectedExamQuestions);
      expect(onProgress).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 2,
          totalPages: 2,
          progress: 1,
          message: '10 questões encontradas. Revise o texto.',
        }),
      );
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
