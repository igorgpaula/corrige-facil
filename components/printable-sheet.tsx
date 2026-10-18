import { getQuestionCoordinates } from '@/lib/sheet-geometry';
import { LETTERS, type ExamSession } from '@/lib/types';

function formatScore(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export function PrintableSheet({ session }: { session: ExamSession }) {
  const columns = session.questionCount > 25 ? 2 : 1;
  const rows = Math.ceil(session.questionCount / columns);
  const cardHeight = Math.min(250, Math.max(90, 58 + rows * 7.4));
  const position = (value: number, axis: 'x' | 'y') =>
    `${((axis === 'x' ? 0.05 : 0.04) + value * (axis === 'x' ? 0.9 : 0.92)) * 100}%`;
  return (
    <section className="print-sheet" aria-hidden="true">
      <div
        className={columns === 1 ? 'print-card' : 'print-card wide'}
        style={{ height: `${cardHeight}mm` }}
      >
        <div className="print-marker marker-tl" />
        <div className="print-marker marker-tr" />
        <div className="print-marker marker-bl" />
        <div className="print-marker marker-br" />
        <div className="print-orientation-dot" />
        <div className="print-heading">
          <span>↑ FOLHA DE RESPOSTAS · MODELO V2</span>
          <h1>{session.title}</h1>
          <div className="student-fields">
            <p>Aluno(a): __________________________________</p>
            <p>Turma: {session.className || '______________'}</p>
          </div>
          <p className="print-config">
            {session.questionCount} questões ·{' '}
            {formatScore(session.pointsPerQuestion)} ponto(s) cada
          </p>
        </div>
        <div className="print-questions">
          {Array.from({ length: session.questionCount }, (_, question) => {
            const { y, bubbleXs, numberX } = getQuestionCoordinates(
              question,
              session.questionCount,
            );
            return (
              <div
                className="print-question"
                data-question={question + 1}
                key={question}
              >
                <strong
                  className="print-question-number"
                  style={{
                    left: position(numberX, 'x'),
                    top: position(y, 'y'),
                  }}
                >
                  {String(question + 1).padStart(2, '0')}
                </strong>
                {LETTERS.map((letter, option) => (
                  <span
                    className="print-option"
                    data-option={letter}
                    style={{
                      left: position(bubbleXs[option], 'x'),
                      top: position(y, 'y'),
                    }}
                    key={letter}
                  >
                    <i>{letter}</i>
                  </span>
                ))}
              </div>
            );
          })}
        </div>
        <p className="print-tip">
          Preencha completamente um círculo e fotografe somente este quadro.
        </p>
      </div>
    </section>
  );
}
