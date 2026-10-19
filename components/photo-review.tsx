'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Button } from './ui/button';
import {
  anchorEditorReducer,
  canApplyAnchors,
  createAnchorEditor,
  PhotoTapGesture,
} from '@/lib/anchor-editor';
import type {
  ScanResult,
  SheetAnchors,
  SheetMode,
  SheetPoint,
} from '@/lib/types';

export function PhotoReview({
  result,
  mode,
  count,
  busy,
  onAlign,
  onEditingChange,
}: {
  result: ScanResult;
  mode: SheetMode;
  count: number;
  busy: boolean;
  onAlign: (points: SheetAnchors) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [adjusting, setAdjusting] = useState(result.alignment !== 'verified');
  useEffect(() => {
    onEditingChange?.(adjusting);
  }, [adjusting, onEditingChange]);
  const initialPoints: SheetAnchors = result.anchors ?? [
    { x: 0.28, y: 0.18 },
    { x: 0.68, y: 0.18 },
    { x: 0.68, y: 0.88 },
    { x: 0.28, y: 0.88 },
  ];
  const [editor, dispatch] = useReducer(
    anchorEditorReducer,
    initialPoints,
    createAnchorEditor,
  );
  const { points, active, candidate, confirmed, positioning } = editor;
  const gesture = useRef(new PhotoTapGesture());
  const shownPoints = points.map((p, index) =>
    index === active && candidate ? candidate : p,
  );
  const [zoom, setZoom] = useState(1);
  const ratio = result.imageSize.height / result.imageSize.width;
  const last = String(count).padStart(2, '0');
  const labels =
    mode === 'legacy'
      ? [
          'A da questão 01',
          'E da questão 01',
          `E da questão ${last}`,
          `A da questão ${last}`,
        ]
      : [
          'Marcador superior esquerdo',
          'Marcador superior direito',
          'Marcador inferior direito',
          'Marcador inferior esquerdo',
        ];
  const update = (point: SheetPoint) => {
    dispatch({ type: 'propose', point });
  };
  return (
    <div className="photo-review">
      <div className="photo-tools">
        <strong>
          {adjusting ? 'Ajustar alinhamento' : 'Círculos analisados'}
        </strong>
        <label>
          Ampliar{' '}
          <select
            aria-label="Ampliação da foto"
            value={zoom}
            disabled={busy}
            onChange={(event) => {
              gesture.current.invalidate();
              setZoom(Number(event.target.value));
            }}
          >
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={3}>3×</option>
          </select>
        </label>
      </div>
      {adjusting && (
        <>
          <p className="alignment-instruction">
            Navegue e amplie a foto à vontade. Escolha “Posicionar ponto”, toque
            no centro indicado e pressione “OK, confirmar ponto”. Arrastar a
            foto não marca pontos. Nada é aplicado sem confirmação.
          </p>
          <div className="anchor-steps">
            {labels.map((label, index) => (
              <button
                type="button"
                key={index}
                className={active === index ? 'active' : ''}
                disabled={busy}
                aria-pressed={active === index}
                onClick={() => {
                  gesture.current.invalidate();
                  dispatch({ type: 'select', index });
                }}
              >
                {confirmed.includes(index) ? '✓ ' : ''}
                {index + 1}. {label}
              </button>
            ))}
          </div>
        </>
      )}
      <div
        className="photo-scroll"
        onScroll={() => gesture.current.invalidate()}
      >
        <div
          className={`photo-stage ${adjusting && positioning ? 'adjusting' : ''}`}
          style={{
            width: `${zoom * 100}%`,
            aspectRatio: `${result.imageSize.width}/${result.imageSize.height}`,
          }}
          role={adjusting ? 'group' : undefined}
          tabIndex={adjusting ? 0 : undefined}
          aria-label={
            adjusting
              ? `${positioning ? 'Posicionar' : 'Navegar até o'} ponto ${active + 1}: ${labels[active]}. Confirme a posição no botão OK.`
              : undefined
          }
          onKeyDown={(event) => {
            if (
              !adjusting ||
              !positioning ||
              busy ||
              !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            const p = candidate ?? points[active];
            update({
              x:
                p.x +
                (event.key === 'ArrowLeft'
                  ? -0.002
                  : event.key === 'ArrowRight'
                    ? 0.002
                    : 0),
              y:
                p.y +
                (event.key === 'ArrowUp'
                  ? -0.002
                  : event.key === 'ArrowDown'
                    ? 0.002
                    : 0),
            });
          }}
          onPointerDown={(event) => {
            if (!adjusting || !positioning || busy || event.button !== 0)
              return;
            gesture.current.down(event.pointerId, event.clientX, event.clientY);
          }}
          onPointerMove={(event) =>
            gesture.current.move(event.pointerId, event.clientX, event.clientY)
          }
          onPointerCancel={(event) => gesture.current.cancel(event.pointerId)}
          onPointerLeave={(event) => gesture.current.cancel(event.pointerId)}
          onWheel={() => gesture.current.invalidate()}
          onPointerUp={(event) => {
            const tapped = gesture.current.up(
              event.pointerId,
              event.clientX,
              event.clientY,
            );
            if (!tapped || !adjusting || !positioning || busy) return;
            const rect = event.currentTarget.getBoundingClientRect();
            update({
              x: (event.clientX - rect.left) / rect.width,
              y: (event.clientY - rect.top) / rect.height,
            });
          }}
        >
          {/* Photo is an in-memory local preview, never uploaded. */}
          <img
            src={result.preview}
            alt="Foto com a grade de leitura sobreposta"
            draggable={false}
          />
          <svg
            viewBox={`0 0 1000 ${1000 * ratio}`}
            className="photo-overlay"
            aria-hidden="true"
          >
            {!adjusting &&
              result.overlay.map((row) => (
                <g key={row.question}>
                  {row.centers.map((p, option) => (
                    <circle
                      key={option}
                      cx={p.x * 1000}
                      cy={p.y * 1000 * ratio}
                      r={row.radius * 1000 * 0.6}
                      className={
                        result.readings[row.question].answer ===
                        ['A', 'B', 'C', 'D', 'E'][option]
                          ? 'detected-mark'
                          : 'sample-area'
                      }
                    />
                  ))}
                  <text
                    x={row.centers[0].x * 1000 - row.radius * 1000 * 1.8}
                    y={row.centers[0].y * 1000 * ratio}
                  >
                    {String(row.question + 1).padStart(2, '0')}
                  </text>
                </g>
              ))}
            {adjusting && (
              <>
                <polygon
                  points={shownPoints
                    .map((p) => `${p.x * 1000},${p.y * 1000 * ratio}`)
                    .join(' ')}
                  className="alignment-polygon"
                />
                {shownPoints.map((p, index) => (
                  <g key={index}>
                    <circle
                      cx={p.x * 1000}
                      cy={p.y * 1000 * ratio}
                      r={index === active ? 17 : 12}
                      className={`anchor-point ${index === active ? 'active' : ''} ${confirmed.includes(index) && !(index === active && candidate) ? 'confirmed' : ''}`}
                    />
                    <text x={p.x * 1000 + 20} y={p.y * 1000 * ratio - 15}>
                      {index + 1}
                    </text>
                  </g>
                ))}
              </>
            )}
          </svg>
        </div>
      </div>
      {adjusting ? (
        <div className="alignment-actions">
          <div className="anchor-confirm-panel">
            <p aria-live="polite">
              <strong>
                Ponto {active + 1}: {labels[active]}
              </strong>
              <span>
                {confirmed.length}/4 confirmados.{' '}
                {candidate
                  ? 'Posição provisória — confirme no botão OK.'
                  : canApplyAnchors(editor)
                    ? 'Todos confirmados. Aplique o alinhamento ou selecione um ponto para editar.'
                    : positioning
                      ? 'Toque na foto ou use as setas do teclado para ajustar.'
                      : 'Modo navegar: tocar ou arrastar não altera os pontos.'}
              </span>
            </p>
            <div className="anchor-mode-actions">
              <Button
                variant="outline"
                disabled={busy}
                aria-pressed={!positioning}
                onClick={() => {
                  gesture.current.invalidate();
                  dispatch({ type: 'navigate' });
                }}
              >
                Navegar
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                aria-pressed={positioning}
                onClick={() => dispatch({ type: 'position' })}
              >
                Posicionar ponto {active + 1}
              </Button>
            </div>
            <Button
              className="anchor-confirm-button"
              disabled={busy || !candidate}
              onClick={() => {
                gesture.current.invalidate();
                dispatch({ type: 'confirm' });
              }}
            >
              OK, confirmar ponto {active + 1}
            </Button>
            {candidate && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => dispatch({ type: 'discard' })}
              >
                Desfazer posição provisória
              </Button>
            )}
          </div>
          <Button
            disabled={busy || !canApplyAnchors(editor)}
            onClick={() => {
              if (!busy && canApplyAnchors(editor)) onAlign(points);
            }}
          >
            Aplicar os quatro pontos
          </Button>
          {result.alignment === 'verified' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                gesture.current.invalidate();
                dispatch({ type: 'reset', points: initialPoints });
                setAdjusting(false);
              }}
            >
              Cancelar ajuste
            </Button>
          )}
        </div>
      ) : (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setAdjusting(true);
            gesture.current.invalidate();
            dispatch({ type: 'reset', points: initialPoints });
          }}
        >
          Ajustar quatro pontos
        </Button>
      )}
    </div>
  );
}
