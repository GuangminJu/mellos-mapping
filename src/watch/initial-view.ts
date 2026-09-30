/** One-shot startup view selection, independent of terminal I/O and page memory. */
import type { MellosMap } from '../domain/types.js';
import { measureMapBody, type MapBodyExtent, type RenderOptions, type Viewport } from '../render/render.js';
import { ZOOM_DEFAULT, ZOOM_MIN, type ZoomStep } from '../semantics/semantics.js';

export interface InitialViewDecisionState {
  readonly phase: 'pending' | 'settled' | 'cancelled';
  /** Provenance only: the shell keeps the resulting named view on its page. */
  readonly autoSelectedNamed: boolean;
}

export function initialViewDecision(): InitialViewDecisionState {
  return { phase: 'pending', autoSelectedNamed: false };
}

/** Manual input wins even before the first usable map arrives. */
export function cancelInitialView(state: InitialViewDecisionState): InitialViewDecisionState {
  return state.phase === 'pending' ? { phase: 'cancelled', autoSelectedNamed: false } : state;
}

/**
 * Offer one named overview at the first nonempty valid map and usable viewport.
 * The caller supplies already validated snapshots, or undefined while loading
 * or after a read failure. A non-selection is final too: later updates, resizes
 * and page changes must never claim ownership of the user's view.
 */
export function decideInitialView(
  state: InitialViewDecisionState,
  map: MellosMap | undefined,
  opts: Pick<RenderOptions, 'unicode'>,
  viewport: Pick<Viewport, 'width' | 'height'>,
): { readonly state: InitialViewDecisionState; readonly zoom: ZoomStep | undefined } {
  if (state.phase !== 'pending' || map === undefined || map.nodes.length === 0 ||
    !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
    viewport.width < 1 || viewport.height < 1) return { state, zoom: undefined };

  const renderOpts: RenderOptions = { color: false, unicode: opts.unicode, spinnerFrame: 0 };
  const fits = (extent: MapBodyExtent): boolean => extent.width <= viewport.width && extent.height <= viewport.height;
  const named = map.groups.length > 0 &&
    !fits(measureMapBody(map, { ...renderOpts, zoom: ZOOM_DEFAULT })) &&
    fits(measureMapBody(map, { ...renderOpts, zoom: ZOOM_MIN, namedOverview: true }));
  return { state: { phase: 'settled', autoSelectedNamed: named }, zoom: named ? ZOOM_MIN : undefined };
}
