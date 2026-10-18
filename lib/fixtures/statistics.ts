import { LETTERS, type SessionBundle } from '../types';
export function statisticsFixture(
  count = 10,
  total = 3,
  long = false,
): SessionBundle {
  const answerKey = Array.from({ length: count }, (_, i) => LETTERS[i % 5]);
  return {
    session: {
      id: 'export-test',
      title: 'Avaliação de Geografia - 3º trimestre',
      className: '8º A',
      subject: 'Geografia',
      questionCount: count,
      pointsPerQuestion: 0.8,
      answerKey,
      status: 'active',
      lockedAt: '2026-10-18T12:00:00Z',
      createdAt: '2026-10-18T12:00:00Z',
      updatedAt: '2026-10-18T12:00:00Z',
    },
    questions: Array.from({ length: count }, (_, i) => ({
      id: `q_${i + 1}`,
      order: i + 1,
      prompt: `Como a distribuição da população se relaciona com a urbanização na região ${i + 1}? ${long ? 'Considere a ocupação territorial, as condições de transporte e as atividades econômicas da população. '.repeat(7) : ''}`,
      options: {
        A: 'Primeira alternativa',
        B: 'Segunda alternativa',
        C: 'Terceira alternativa',
        D: 'Quarta alternativa',
        E: 'Quinta alternativa',
      },
      ocrConfidence: null,
    })),
    corrections: Array.from({ length: total }, (_, student) => {
      const answers = answerKey.map((answer, i) =>
        (i + student) % 7 === 0
          ? null
          : (i + student) % 3 === 0
            ? LETTERS[(i + 1) % 5]
            : answer,
      );
      const correctCount = answers.filter((a, i) => a === answerKey[i]).length;
      return {
        id: `c_${String(student).padStart(4, '0')}`,
        studentLabel:
          student === 0
            ? null
            : student === 1
              ? '=HYPERLINK("https://example.test")'
              : `Aluno de teste ${student + 1}`,
        answers,
        readings: [],
        correctCount,
        score: correctCount * 0.8,
        maximumScore: count * 0.8,
        createdAt: '2026-10-18T12:00:00Z',
      };
    }),
  };
}
