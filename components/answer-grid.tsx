'use client';
import { useId } from 'react';
import { LETTERS, type Answers, type AnswerReading } from '@/lib/types';
import { needsReview } from '@/lib/sheet-geometry';

export function AnswerGrid({
  answers,
  onChange,
  compact = false,
  answerKey,
  readings,
  onResolveNull,
}: {
  answers: Answers;
  onChange: (next: Answers, question: number) => void;
  compact?: boolean;
  answerKey?: Answers;
  readings?: AnswerReading[];
  onResolveNull?: (question: number, status: 'blank' | 'multiple') => void;
}) {
  const groupId = useId();
  return (
    <div className={compact ? 'answer-grid compact' : 'answer-grid'}>
      {answers.map((answer, question) => {
        const reading = readings?.[question];
        const pending = reading ? needsReview(reading) : false;
        const incorrect = Boolean(
          answer && answerKey?.[question] && answer !== answerKey[question],
        );
        const confidenceClass =
          reading?.source === 'manual'
            ? 'manual'
            : (reading?.confidence ?? 0) < 60
              ? 'low'
              : (reading?.confidence ?? 0) < 80
                ? 'medium'
                : 'high';
        return (
          <div
            className={`answer-row ${incorrect ? 'incorrect' : ''} ${pending ? 'reading-pending' : ''}`}
            key={question}
          >
            <span className="question-number">
              {String(question + 1).padStart(2, '0')}
            </span>
            <div
              className="options"
              role="radiogroup"
              aria-label={`Questão ${question + 1}`}
            >
              {LETTERS.map((letter) => (
                <label
                  className={answer === letter ? 'bubble selected' : 'bubble'}
                  htmlFor={`${groupId}-${question}-${letter}`}
                  key={letter}
                >
                  <input
                    checked={answer === letter}
                    className="answer-radio"
                    id={`${groupId}-${question}-${letter}`}
                    name={`${groupId}-${question}`}
                    type="radio"
                    value={letter}
                    onChange={() => {
                      const next = [...answers];
                      next[question] = letter;
                      onChange(next, question);
                    }}
                  />
                  {letter}
                </label>
              ))}
            </div>
            {reading && (
              <span className={`confidence-badge ${confidenceClass}`}>
                {reading.source === 'manual'
                  ? 'Confirmada manualmente'
                  : reading.status === 'multiple'
                    ? 'Marcação múltipla — revisar'
                    : reading.status === 'blank'
                      ? `Em branco · ${reading.confidence}% confiança estimada`
                      : pending
                        ? `Revisar${reading.suggestedAnswer ? ` · sugestão ${reading.suggestedAnswer}` : ''} · ${reading.confidence}% estimada`
                        : `${reading.confidence}% confiança estimada`}
              </span>
            )}
            {onResolveNull && reading && (
              <div className="reading-actions">
                <button
                  type="button"
                  onClick={() => onResolveNull(question, 'blank')}
                >
                  Confirmar em branco
                </button>
                {(reading.status === 'multiple' || pending) && (
                  <button
                    type="button"
                    onClick={() => onResolveNull(question, 'multiple')}
                  >
                    Anular marcação
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
