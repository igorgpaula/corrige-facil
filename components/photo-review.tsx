'use client';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
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
  const [points, setPoints] = useState<SheetAnchors>(
    result.anchors ?? [
      { x: 0.28, y: 0.18 },
      { x: 0.68, y: 0.18 },
      { x: 0.68, y: 0.88 },
      { x: 0.28, y: 0.88 },
    ],
  );
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState<number[]>([]);
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
    setPoints(
      (previous) =>
        previous.map((p, index) =>
          index === active
            ? {
                x: Math.max(0, Math.min(1, point.x)),
                y: Math.max(0, Math.min(1, point.y)),
              }
            : p,
        ) as SheetAnchors,
    );
    setTouched((previous) => [...new Set([...previous, active])]);
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
            onChange={(event) => setZoom(Number(event.target.value))}
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
            Toque no centro indicado. Use a ampliação para posicionar com
            precisão.
          </p>
          <div className="anchor-steps">
            {labels.map((label, index) => (
              <button
                type="button"
                key={index}
                className={active === index ? 'active' : ''}
                onClick={() => setActive(index)}
              >
                {touched.includes(index) ? '✓ ' : ''}
                {index + 1}. {label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="photo-scroll">
        <div
          className={`photo-stage ${adjusting ? 'adjusting' : ''}`}
          style={{
            width: `${zoom * 100}%`,
            aspectRatio: `${result.imageSize.width}/${result.imageSize.height}`,
          }}
          role={adjusting ? 'application' : undefined}
          tabIndex={adjusting ? 0 : undefined}
          aria-label={
            adjusting
              ? `Posicionar ponto ${active + 1}: ${labels[active]}. Use toque ou setas do teclado.`
              : undefined
          }
          onKeyDown={(event) => {
            if (
              !adjusting ||
              !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            const p = points[active];
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
            if (!adjusting || busy) return;
            const rect = event.currentTarget.getBoundingClientRect();
            update({
              x: (event.clientX - rect.left) / rect.width,
              y: (event.clientY - rect.top) / rect.height,
            });
            setActive((value) => Math.min(3, value + 1));
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
                  points={points
                    .map((p) => `${p.x * 1000},${p.y * 1000 * ratio}`)
                    .join(' ')}
                  className="alignment-polygon"
                />
                {points.map((p, index) => (
                  <g key={index}>
                    <circle
                      cx={p.x * 1000}
                      cy={p.y * 1000 * ratio}
                      r={index === active ? 17 : 12}
                      className="anchor-point"
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
          <Button
            disabled={busy || touched.length < 4}
            onClick={() => onAlign(points)}
          >
            Aplicar os quatro pontos
          </Button>
          {result.alignment === 'verified' && (
            <Button variant="outline" onClick={() => setAdjusting(false)}>
              Cancelar ajuste
            </Button>
          )}
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            setAdjusting(true);
            setTouched([]);
          }}
        >
          Ajustar quatro pontos
        </Button>
      )}
    </div>
  );
}
