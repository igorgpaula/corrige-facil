import type { CSSProperties } from 'react';
import {
  getQuestionCoordinates,
  getStandardSheetLayout,
} from '@/lib/sheet-geometry';
import { LETTERS, type ExamSession } from '@/lib/types';

export function PrintableSheet({ session }: { session: ExamSession }) {
  const layout = getStandardSheetLayout(session.questionCount);
  const position = (value: number, axis: 'x' | 'y') =>
    axis === 'x'
      ? `${(0.05 + value * 0.9) * 100}%`
      : `${layout.markerInsetY + value * (layout.heightMm - layout.markerInsetY * 2)}mm`;
  return (
    <section className="print-sheet" aria-hidden="true">
      <div
        className="print-card"
        data-layout="single-column"
        style={
          {
            height: `${layout.heightMm}mm`,
            '--bubble-diameter': `${layout.bubbleDiameterMm}mm`,
          } as CSSProperties
        }
      >
        <div className="print-marker marker-tl" />
        <div className="print-marker marker-tr" />
        <div className="print-marker marker-bl" />
        <div className="print-marker marker-br" />
        <div className="print-orientation-dot" />
        <div className="print-layout-dot" />
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
      </div>
    </section>
  );
}
