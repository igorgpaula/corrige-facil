import { describe, expect, it } from 'vitest';

import { parseExamText } from './ocr';

describe('parseExamText', () => {
  it('extracts numbered questions and alternatives', () => {
    const questions = parseExamText(`
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
    `, 0.88);
    expect(questions).toHaveLength(2);
    expect(questions[0].prompt).toContain('2 + 2');
    expect(questions[0].options.C).toBe('4');
    expect(questions[1].options.B).toBe('Brasília');
    expect(questions[0].ocrConfidence).toBe(0.88);
  });
});
