import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PhotoReview } from '../components/photo-review';
import {
  anchorEditorReducer as reduce,
  canApplyAnchors,
  createAnchorEditor,
  PhotoTapGesture,
} from './anchor-editor';
import type { ScanResult, SheetAnchors } from './types';

const anchors: SheetAnchors = [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
];

describe('confirmação explícita dos quatro pontos', () => {
  it('começa em navegar e ignora toques sem modo de posicionamento', () => {
    const state = createAnchorEditor(anchors);
    expect(reduce(state, { type: 'propose', point: { x: 0.3, y: 0.3 } })).toBe(
      state,
    );
    expect(state.positioning).toBe(false);
    expect(canApplyAnchors(state)).toBe(false);
  });
  it('mantém a posição provisória, sem avançar nem confirmar ao tocar', () => {
    let state = reduce(createAnchorEditor(anchors), { type: 'position' });
    state = reduce(state, { type: 'propose', point: { x: 0.24, y: 0.25 } });
    state = reduce(state, { type: 'propose', point: { x: 0.26, y: 0.27 } });
    expect(state.points).toEqual(anchors);
    expect(state.candidate).toEqual({ x: 0.26, y: 0.27 });
    expect(state.active).toBe(0);
    expect(state.confirmed).toEqual([]);
    expect(canApplyAnchors(state)).toBe(false);
    state = reduce(state, { type: 'confirm' });
    expect(state.points[0]).toEqual({ x: 0.26, y: 0.27 });
    expect(state.confirmed).toEqual([0]);
    expect(state.active).toBe(1);
    expect(state.positioning).toBe(false);
    expect(reduce(state, { type: 'confirm' })).toBe(state);
  });
  it('exige quatro confirmações e bloqueia aplicar enquanto houver nova posição pendente', () => {
    let state = createAnchorEditor(anchors);
    for (const index of [2, 0, 3, 1]) {
      state = reduce(state, { type: 'select', index });
      state = reduce(state, { type: 'propose', point: anchors[index] });
      expect(canApplyAnchors(state)).toBe(false);
      state = reduce(state, { type: 'confirm' });
    }
    expect(canApplyAnchors(state)).toBe(true);
    state = reduce(state, { type: 'select', index: 0 });
    state = reduce(state, { type: 'propose', point: { x: 0.3, y: 0.3 } });
    expect(canApplyAnchors(state)).toBe(false);
    state = reduce(state, { type: 'discard' });
    expect(canApplyAnchors(state)).toBe(true);
    expect(state.points[0]).toEqual(anchors[0]);
    state = reduce(state, { type: 'reset', points: anchors });
    expect(state).toEqual(createAnchorEditor(anchors));
  });
  it('navegar preserva o candidato, mas não o confirma ou altera', () => {
    let state = reduce(createAnchorEditor(anchors), {
      type: 'select',
      index: 3,
    });
    state = reduce(state, { type: 'propose', point: { x: 0.22, y: 0.79 } });
    state = reduce(state, { type: 'navigate' });
    expect(reduce(state, { type: 'propose', point: { x: 0.5, y: 0.5 } })).toBe(
      state,
    );
    expect(state.candidate).toEqual({ x: 0.22, y: 0.79 });
    expect(state.confirmed).toEqual([]);
  });
  it('descarta um candidato ao selecionar outro ponto e rejeita índices inválidos', () => {
    let state = reduce(createAnchorEditor(anchors), { type: 'position' });
    state = reduce(state, { type: 'propose', point: { x: 0.3, y: 0.3 } });
    state = reduce(state, { type: 'select', index: 1 });
    expect(state.candidate).toBeNull();
    expect(state.points).toEqual(anchors);
    expect(reduce(state, { type: 'select', index: 5 })).toBe(state);
    expect(reduce(state, { type: 'propose', point: { x: NaN, y: 0.3 } })).toBe(
      state,
    );
  });
});

describe('distingue toque de navegação', () => {
  it('só considera toque ao soltar, tolerando pequeno tremor', () => {
    const gesture = new PhotoTapGesture();
    gesture.down(1, 100, 200);
    expect(gesture.up(1, 103, 204)).toBe(true);
    expect(gesture.up(1, 103, 204)).toBe(false);
  });
  it('ignora arrasto mesmo quando o dedo retorna ao início', () => {
    const gesture = new PhotoTapGesture();
    gesture.down(1, 100, 200);
    gesture.move(1, 100, 240);
    expect(gesture.up(1, 100, 200)).toBe(false);
  });
  it('ignora scroll, roda do mouse ou mudança de zoom durante o gesto', () => {
    const gesture = new PhotoTapGesture();
    gesture.down(1, 100, 200);
    gesture.invalidate();
    expect(gesture.up(1, 100, 200)).toBe(false);
  });
  it('ignora pinça com dois dedos até ambos soltarem', () => {
    const gesture = new PhotoTapGesture();
    gesture.down(1, 100, 200);
    gesture.down(2, 150, 200);
    expect(gesture.up(2, 150, 200)).toBe(false);
    expect(gesture.up(1, 100, 200)).toBe(false);
    gesture.down(3, 100, 200);
    expect(gesture.up(3, 100, 200)).toBe(true);
  });
  it('ignora pointercancel e soltura fora da foto', () => {
    const gesture = new PhotoTapGesture();
    gesture.down(1, 100, 200);
    gesture.cancel(1);
    expect(gesture.up(1, 100, 200)).toBe(false);
  });
});

it('renderiza OK desabilitado antes da seleção e orientações para os dois modelos', () => {
  const result: ScanResult = {
    readings: [],
    preview: 'data:image/png;base64,',
    mode: 'free',
    imageSize: { width: 600, height: 800 },
    alignment: 'needs-adjustment',
    anchors,
    overlay: [],
    diagnostics: {
      engine: 'test',
      geometry: 0,
      matched: 0,
      residual: 0,
      message: '',
    },
  };
  for (const mode of ['legacy', 'standard'] as const) {
    const html = renderToStaticMarkup(
      createElement(PhotoReview, {
        result,
        mode,
        count: 10,
        busy: false,
        onAlign: () => {},
      }),
    );
    expect(html).toContain('OK, confirmar ponto 1');
    expect(html).toMatch(
      /<button[^>]*disabled[^>]*>OK, confirmar ponto 1<\/button>/,
    );
    expect(html).toContain('Modo navegar');
    expect(html).toContain(
      mode === 'legacy' ? 'E da questão 10' : 'Marcador inferior direito',
    );
  }
});
