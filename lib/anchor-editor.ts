import type { SheetAnchors, SheetPoint } from './types';

export type AnchorEditor = {
  points: SheetAnchors;
  confirmed: number[];
  active: number;
  candidate: SheetPoint | null;
  positioning: boolean;
};
export type AnchorAction =
  | { type: 'reset'; points: SheetAnchors }
  | { type: 'select'; index: number }
  | { type: 'navigate' }
  | { type: 'position' }
  | { type: 'propose'; point: SheetPoint }
  | { type: 'discard' }
  | { type: 'confirm' };

export function createAnchorEditor(points: SheetAnchors): AnchorEditor {
  return {
    points: points.map((p) => ({ ...p })) as SheetAnchors,
    confirmed: [],
    active: 0,
    candidate: null,
    positioning: false,
  };
}

export function canApplyAnchors(state: AnchorEditor) {
  return state.confirmed.length === 4 && state.candidate === null;
}

export function anchorEditorReducer(
  state: AnchorEditor,
  action: AnchorAction,
): AnchorEditor {
  switch (action.type) {
    case 'reset':
      return createAnchorEditor(action.points);
    case 'select':
      return Number.isInteger(action.index) &&
        action.index >= 0 &&
        action.index < 4
        ? { ...state, active: action.index, candidate: null, positioning: true }
        : state;
    case 'navigate':
      return { ...state, positioning: false };
    case 'position':
      return { ...state, positioning: true };
    case 'discard':
      return { ...state, candidate: null };
    case 'propose':
      if (
        !state.positioning ||
        !Number.isFinite(action.point.x) ||
        !Number.isFinite(action.point.y)
      )
        return state;
      return {
        ...state,
        candidate: {
          x: Math.max(0, Math.min(1, action.point.x)),
          y: Math.max(0, Math.min(1, action.point.y)),
        },
      };
    case 'confirm': {
      if (!state.candidate) return state;
      const points = state.points.map((point, index) =>
        index === state.active ? state.candidate! : point,
      ) as SheetAnchors;
      const confirmed = [...new Set([...state.confirmed, state.active])];
      const next = [1, 2, 3, 4]
        .map((offset) => (state.active + offset) % 4)
        .find((index) => !confirmed.includes(index));
      return {
        points,
        confirmed,
        active: next ?? state.active,
        candidate: null,
        positioning: false,
      };
    }
  }
}

// A tap is committed only on release. Scroll, dragging, multiple fingers and
// pointer cancellation invalidate the gesture without changing any point.
export class PhotoTapGesture {
  private pointers = new Set<number>();
  private start: {
    id: number;
    x: number;
    y: number;
    cancelled: boolean;
  } | null = null;

  down(id: number, x: number, y: number) {
    this.pointers.add(id);
    if (this.pointers.size === 1) this.start = { id, x, y, cancelled: false };
    else this.invalidate();
  }
  move(id: number, x: number, y: number) {
    if (
      this.start?.id === id &&
      Math.hypot(x - this.start.x, y - this.start.y) > 8
    )
      this.invalidate();
  }
  up(id: number, x: number, y: number) {
    this.move(id, x, y);
    const tapped =
      this.pointers.size === 1 &&
      this.start?.id === id &&
      !this.start.cancelled;
    this.pointers.delete(id);
    if (!this.pointers.size) this.start = null;
    return tapped;
  }
  cancel(id: number) {
    this.invalidate();
    this.pointers.delete(id);
    if (!this.pointers.size) this.start = null;
  }
  invalidate() {
    if (this.start) this.start.cancelled = true;
  }
}
