/**
 * Layer 4 (presentation) — pure rendering of a MellosMap to terminal lines.
 *
 * Shared by the MCP `mmap_view` tool (monochrome) and the split-pane watcher
 * (colored, animated). Pure function of (map, options): no I/O, no clock —
 * animation is driven by the caller passing a spinner frame index.
 *
 * This file is the COMPOSITION ROOT of the picture and holds the public
 * surface; each stage lives beside it and knows nothing of the next:
 *
 *   width.ts          how many columns a string takes (the grid's foundation)
 *   options.ts        what a caller asks for
 *   canvas.ts         the drawing surface: cells, mask algebra, ANSI emission
 *   skins.ts          status vocabulary -> this medium's borders and colors
 *   zoom-geometry.ts  what one rung of the zoom ladder buys, in cells
 *   layout.ts         where every box goes (columns, then rows)
 *   routing.ts        how each edge gets there (columns and track rows)
 *   draw.ts           transcription of all of the above onto the canvas
 *
 * The pipeline reads in that order and only forward: sizes and columns fix
 * the width, routing needs the columns, the row layout needs routing's track
 * counts, and drawing needs everything. Nothing drawn is ever decided.
 *
 * Visual language — a dark circuit board:
 *   rank 0 renders at the BOTTOM of the picture ("primitives are the
 *   ground"). Wiring and band bars are FAINT; the glowing things are the
 *   nodes. Junctions where a wire enters a box inherit the box's color,
 *   like lit pins. Dependency lines only ever travel downward.
 *
 *   planned      dashed dim rounded box, '·'  — a ghost: designed, not built
 *   in-progress  amber rounded box, spinner   — where attention currently is
 *   done         heavy green box, '■'         — built and verified
 *   done, no evidence   the same box, hollow '□' in a dimmer green — the
 *                ledger's fourth rule, made visible
 *   regressed    heavy red box, '✗'           — was done, foundation cracked
 *
 * Zoom — terminals cannot scale glyphs, so zooming out first COMPRESSES the
 * geometry (gaps, breathing rows, padding shrink; labels truncate toward a
 * scale-proportional budget) while boxes stay boxes. Only when a further
 * step would leave labels too short to mean anything does the picture switch
 * mode — to a borderless glyph constellation whose band bars carry
 * done/total counts. Zooming in past 100% unfolds evidence and design notes
 * inside the boxes; a second step widens the boxes and unfolds the notes
 * further. The ladder, one wheel tick per step:
 *   +2   detail+       wider boxes, design notes unfold almost fully
 *   +1   detail        evidence + design notes unfold inside boxes
 *    0   100%          the standard working view (default, unchanged)
 *   -1   85%           labels truncated to 85%, geometry still roomy
 *   -2   70%           padding and breathing rows collapse
 *   -3   55%           tightest meaningful boxes; band bars gain done/total
 *   -4   overview      MODE SWITCH: borderless status glyphs, pure topology
 * The same layout/routing machinery runs at every step; only the per-node
 * box spec (size, border, content) and the whitespace geometry change.
 */

import type { MellosMap } from '../domain/types.js';
import { ZOOM_DEFAULT, aggregateMap, flipForSequence, isNeutralKind } from '../semantics/semantics.js';
import { Canvas } from './canvas.js';
import { drawBands, drawBox, drawEdges, drawLaneHeaders, drawLegend, drawTitle } from './draw.js';
import { layoutColumns, layoutRows } from './layout.js';
import type { RenderOptions, Viewport } from './options.js';
import { routeEdges } from './routing.js';
import { type StatusFace, unverifiedDoneIds } from './skins.js';
import { displayWidth } from './width.js';
import { AGGREGATE_GEO, type ZoomGeometry, zoomGeometry } from './zoom-geometry.js';

export type { RenderOptions, Viewport } from './options.js';
export { displayWidth, fitWidth, wrapWidth } from './width.js';
export { statusSgr } from './skins.js';

// The medium-neutral vocabulary (zoom ladder, neutral-kind rule, status and
// node-kind glyphs) is defined in ../semantics and re-exported here so
// terminal consumers keep one import site.
export {
  type ZoomStep,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  isNeutralKind,
  kindGlyph,
  spinnerGlyph,
  statusGlyph,
  unverifiedDoneGlyph,
  zoomLabel,
} from '../semantics/semantics.js';

/** Render the whole map as terminal lines. */
export function renderMap(map: MellosMap, opts: RenderOptions): string[] {
  const built = buildCanvas(map, opts);
  return built.canvas.emit(opts);
}

/** Where a box sits on the full (unwindowed) picture, for hit testing. */
export interface BoxHit {
  /**
   * The box's id — a node id, or a GROUP id on the aggregated far zoom.
   *
   * VIOLATION: no-primitive-obsession - raw string where NodeId exists, for
   * the reason spelled out at focusInfo (../semantics/semantics.ts): which of
   * the two an id names is what the consumer of a hit calls that function to
   * find out, so this type cannot promise either.
   */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface WindowedRender {
  readonly lines: string[];
  /** Full extent of the picture, for viewport clamping. */
  readonly contentWidth: number;
  readonly contentHeight: number;
  /** Node hit regions in full-picture coordinates, for mouse interaction. */
  readonly hits: readonly BoxHit[];
}

/** Render only the given viewport of the map, plus the full content extent. */
export function renderMapWindow(map: MellosMap, opts: RenderOptions, viewport: Viewport): WindowedRender {
  const built = buildCanvas(map, opts);
  return {
    lines: built.canvas.emit(opts, viewport),
    contentWidth: built.canvas.width,
    contentHeight: built.canvas.height,
    hits: built.hits,
  };
}

function buildCanvas(map: MellosMap, opts: RenderOptions): { canvas: Canvas; hits: BoxHit[] } {
  const oriented = flipForSequence(map);
  const plainGeo = zoomGeometry(opts.zoom ?? ZOOM_DEFAULT);
  // The far zoom does not shrink the map, it AGGREGATES it: groups become one
  // box each. Which map is drawn is decided here, once.
  const aggregated = plainGeo.mode === 'constellation' ? aggregateMap(oriented) : undefined;
  const drawn = aggregated ?? oriented;
  return paint(drawn, opts, aggregated !== undefined ? AGGREGATE_GEO : plainGeo, unverifiedDoneIds(oriented, drawn));
}

function paint(
  map: MellosMap,
  opts: RenderOptions,
  geo: ZoomGeometry,
  unverified: ReadonlySet<string>,
): { canvas: Canvas; hits: BoxHit[] } {
  const canvas = new Canvas();
  if (map.layers.length === 0) {
    canvas.text(0, 0, map.title ?? 'mellos mapping', 'none', true);
    canvas.text(0, 2, '(empty map — declare layers and nodes to begin)', 'dim');
    return { canvas, hits: [] };
  }

  const neutral = isNeutralKind(map);
  const columns = layoutColumns(map, geo, opts.unicode, neutral);
  const routing = routeEdges(map, columns);
  const rows = layoutRows(columns, geo, routing.gapRowCount, map.title !== undefined, map.lanes.length > 0);

  /** Everything a wire may occupy: the boxes, plus any margin corridor. */
  const wiredWidth =
    routing.fallbackCount > 0 ? columns.contentWidth + 2 + routing.fallbackCount * 2 : columns.contentWidth;
  /** Plus the band labels' own right margin, which nothing else may enter. */
  const totalWidth = wiredWidth + Math.max(...columns.bandLabel.map(displayWidth));

  if (map.title !== undefined) drawTitle(canvas, map.title);
  drawLaneHeaders(canvas, map, columns, rows);
  drawBands(canvas, columns, rows, wiredWidth, totalWidth);
  /** The face a node presents: its status, or the hollow face of an unbacked done. */
  const faceOf = (id: string, status: StatusFace): StatusFace => (unverified.has(id) ? 'done-unverified' : status);
  for (const box of rows.boxOf.values()) {
    const id = box.node.id as string;
    drawBox(canvas, box, opts, neutral, faceOf(id, box.node.status), opts.focus !== undefined && id === opts.focus);
  }
  drawEdges(canvas, routing.edges, rows, opts);
  drawLegend(canvas, map, opts, rows.legendY, neutral, unverified.size > 0);

  const hits: BoxHit[] = [...rows.boxOf.values()].map((b) => ({
    id: b.node.id as string,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
  }));
  return { canvas, hits };
}
