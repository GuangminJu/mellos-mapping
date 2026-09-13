/** Pure view state: page memory and pointer gestures, independent of terminal I/O. */
import { ZOOM_DEFAULT, type ZoomStep } from '../semantics/semantics.js';

export interface PageView {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly zoom: ZoomStep;
  readonly selectedId: string | undefined;
}
export interface ViewState extends PageView {
  readonly pageViews: ReadonlyMap<string, PageView>;
  readonly hoverId: string | undefined;
  readonly dragAnchor: { readonly x: number; readonly y: number; readonly ox: number; readonly oy: number } | undefined;
  readonly press: { readonly moved: boolean } | undefined;
  readonly dividerDrag: boolean;
  readonly lastClick: { readonly id: string; readonly at: number } | undefined;
}
const defaultPage = (): PageView => ({ offsetX: 0, offsetY: 0, zoom: ZOOM_DEFAULT, selectedId: undefined });
export function initialViewState(): ViewState {
  return { ...defaultPage(), pageViews: new Map(), hoverId: undefined, dragAnchor: undefined,
    press: undefined, dividerDrag: false, lastClick: undefined };
}
export type ViewEvent =
  | { readonly kind: 'reset' }
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'position'; readonly x: number; readonly y: number }
  | { readonly kind: 'zoom'; readonly value: ZoomStep }
  | { readonly kind: 'hover' | 'select'; readonly id: string | undefined }
  | { readonly kind: 'down'; readonly x: number; readonly y: number; readonly divider: boolean }
  | { readonly kind: 'drag'; readonly x: number; readonly y: number }
  | { readonly kind: 'up' }
  | { readonly kind: 'pages'; readonly files: readonly string[]; readonly previous: string | undefined; readonly active: string | undefined };

export function reduceView(state: ViewState, event: ViewEvent): ViewState {
  switch (event.kind) {
    case 'reset': return { ...state, offsetX: 0, offsetY: 0, zoom: ZOOM_DEFAULT };
    case 'pan': return { ...state, offsetX: state.offsetX + event.dx, offsetY: state.offsetY + event.dy };
    case 'position': return { ...state, offsetX: event.x, offsetY: event.y };
    case 'zoom': return { ...state, zoom: event.value };
    case 'hover': return event.id === state.hoverId ? state : { ...state, hoverId: event.id };
    case 'select': return { ...state, selectedId: event.id };
    case 'down': return { ...state, dividerDrag: event.divider,
      dragAnchor: event.divider ? undefined : { x: event.x, y: event.y, ox: state.offsetX, oy: state.offsetY },
      press: event.divider ? undefined : { moved: false } };
    case 'drag': {
      if (state.dividerDrag || !state.dragAnchor) return state;
      const { x, y, ox, oy } = state.dragAnchor;
      const offsetX = ox - (event.x - x);
      const offsetY = oy - (event.y - y);
      return offsetX === state.offsetX && offsetY === state.offsetY ? state
        : { ...state, offsetX, offsetY, press: { moved: true } };
    }
    case 'up': return { ...state, dragAnchor: undefined, press: undefined, dividerDrag: false };
    case 'pages': {
      const pageViews = new Map([...state.pageViews].filter(([file]) => event.files.includes(file)));
      if (event.previous === event.active || event.active === undefined) return { ...state, pageViews };
      // A removed page must not be parked again after pruning its saved view.
      if (event.previous !== undefined && event.files.includes(event.previous)) pageViews.set(event.previous, {
        offsetX: state.offsetX, offsetY: state.offsetY, zoom: state.zoom, selectedId: state.selectedId,
      });
      return { ...state, ...(pageViews.get(event.active) ?? defaultPage()), pageViews,
        hoverId: undefined, dragAnchor: undefined, press: undefined, dividerDrag: false, lastClick: undefined };
    }
  }
}

/** A drag or divider release cannot select a node or trigger a page action. */
export function isPointerClick(state: ViewState): boolean {
  return !state.dividerDrag && state.press !== undefined && !state.press.moved;
}

export function clickNode(state: ViewState, id: string | undefined, now: number, doubleClickMs: number): {
  readonly state: ViewState; readonly diveId: string | undefined;
} {
  const double = id !== undefined && state.lastClick?.id === id && now - state.lastClick.at <= doubleClickMs;
  return { state: { ...state, selectedId: id, lastClick: double || id === undefined ? undefined : { id, at: now } },
    diveId: double ? id : undefined };
}
