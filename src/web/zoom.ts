/** Semantic zoom policy shared by wheel, toolbar and keyboard navigation. */
import { zoomViewport, type Viewport } from './viewport.js';

export interface SceneZoom {
  readonly viewport: Viewport;
  readonly overview: boolean;
}

export function showsOverview(state: SceneZoom, hasGroups: boolean): boolean {
  return hasGroups && (state.overview || state.viewport.scale < .55);
}

export function zoomScene(state: SceneZoom, factor: number, x: number, y: number): SceneZoom {
  return {
    viewport: zoomViewport(state.viewport, state.viewport.scale * factor, x, y),
    // Overview and fit can aggregate a scene explicitly. Moving closer resumes
    // scale-driven detail instead of leaving that earlier choice latched on.
    overview: state.overview && factor <= 1,
  };
}
