/**
 * Layer 4a — what a caller asks the renderer for.
 *
 * Every stage below (canvas, skins, layout, drawing) reads these, so they
 * live in a module of their own rather than in whichever stage happens to
 * touch them first: a picture's inputs are not the property of one stage.
 *
 * Pure types; no behavior.
 */

import type { ZoomStep } from '../semantics/semantics.js';

export interface RenderOptions {
  /** Emit ANSI color codes. */
  readonly color: boolean;
  /** Use box-drawing characters; false falls back to pure ASCII. */
  readonly unicode: boolean;
  /** Spinner frame index for in-progress nodes; caller advances it over time. */
  readonly spinnerFrame: number;
  /**
   * Node id to spotlight: its box border and every wire touching it render
   * bright instead of faint. Color mode only — monochrome output ignores it.
   */
  readonly focus?: string | undefined;
  /** Position on the zoom ladder; omitted means ZOOM_DEFAULT (100%). */
  readonly zoom?: ZoomStep | undefined;
}

/** A window over the rendered picture, in cell coordinates (0-based). */
export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
