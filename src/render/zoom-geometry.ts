/**
 * Layer 4a — what one rung of the zoom ladder buys, in terminal cells.
 *
 * Terminals cannot scale glyphs, so zooming out COMPRESSES geometry instead:
 * gaps, breathing rows and padding shrink, labels truncate toward a
 * scale-proportional budget, and only when a further step would leave labels
 * too short to mean anything does the picture switch mode. WHICH steps switch
 * mode is semantics (zoomMode over in ../semantics); this module owns only
 * the whitespace and label budgets each step spends.
 */

import { type ZoomStep, zoomMode } from '../semantics/semantics.js';

/** Height of a box with nothing unfolded inside it: border, content, border. */
export const BOX_H = 3;
/** Columns between two boxes of one band at the roomy default. */
export const BOX_GAP = 2;
/** Columns before the leftmost box; the picture never starts at the edge. */
export const LEFT_MARGIN = 2;
/** Bar cells kept left of the narrowest band label, so a band still reads as a band. */
export const BAR_MIN_RUN = 7;

/** Box content budget for a detail step; present exactly when mode is 'detail'. */
export interface DetailBudget {
  /** Clamp range for the box's inner width. */
  readonly innerMin: number;
  readonly innerMax: number;
  /** Design-note rows shown before the … cut. */
  readonly noteRows: number;
}

/** +1: a readable unfold. +2: the box grows into a reading card. */
const DETAIL_BUDGET: DetailBudget = { innerMin: 22, innerMax: 32, noteRows: 3 };
const DETAIL_PLUS_BUDGET: DetailBudget = { innerMin: 30, innerMax: 48, noteRows: 12 };

/** How one zoom step translates into whitespace geometry; see the module header. */
export interface ZoomGeometry {
  readonly mode: 'constellation' | 'boxes' | 'detail';
  /** Label width multiplier while scaling down (boxes mode). */
  readonly scale: number;
  /** Inner padding around "glyph label" (1 = the roomy standard look). */
  readonly pad: 0 | 1;
  readonly boxGap: number;
  /** Breathing rows around wire track rows in a band gap. */
  readonly breathe: 0 | 1;
  /** Blank row after the title. */
  readonly titleGap: 0 | 1;
  /** Blank row between a band bar and its boxes. */
  readonly barGap: 0 | 1;
  /** Band bars carry done/total counts once boxes are too small to speak. */
  readonly bandCounts: boolean;
  /** Content budget of the detail steps; set exactly when mode is 'detail'. */
  readonly detail?: DetailBudget;
}

export function zoomGeometry(zoom: ZoomStep): ZoomGeometry {
  const m = zoomMode(zoom);
  const mode = m === 'overview' ? 'constellation' : m;
  switch (zoom) {
    case 2:
      return { mode, scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false, detail: DETAIL_PLUS_BUDGET };
    case 1:
      return { mode, scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false, detail: DETAIL_BUDGET };
    case 0:
      return { mode, scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false };
    case -1:
      return { mode, scale: 0.85, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false };
    case -2:
      return { mode, scale: 0.7, pad: 0, boxGap: BOX_GAP, breathe: 0, titleGap: 0, barGap: 1, bandCounts: false };
    case -3:
      return { mode, scale: 0.55, pad: 0, boxGap: 1, breathe: 0, titleGap: 0, barGap: 1, bandCounts: true };
    case -4:
      return { mode, scale: 0, pad: 0, boxGap: BOX_GAP, breathe: 0, titleGap: 0, barGap: 1, bandCounts: true };
  }
}

/**
 * Geometry for the aggregated far zoom: tight chrome, but FULL labels — the
 * point of collapsing a map into its groups is reading their names.
 */
export const AGGREGATE_GEO: ZoomGeometry = {
  mode: 'boxes',
  scale: 1,
  pad: 0,
  boxGap: 1,
  breathe: 0,
  titleGap: 0,
  barGap: 1,
  bandCounts: false,
};
