/**
 * Layer 4a — putting the decided picture onto the canvas.
 *
 * Everything here is the LAST stage: positions, columns and track rows are
 * already values by the time these functions run, so drawing is a
 * transcription and never a decision. Order matters in exactly one way — the
 * band bars go down before the boxes and the wires, so a wire crossing a band
 * merges into it as ┿ instead of being refused by a literal.
 */

import type { MellosMap } from '../domain/types.js';
import { kindGlyph } from '../semantics/semantics.js';
import { Canvas, LEFT, RIGHT, drawPath } from './canvas.js';
import type { ColumnLayout, PlacedBox, RowLayout } from './layout.js';
import type { RenderOptions } from './options.js';
import { type RoutedEdge, edgePolyline } from './routing.js';
import { type StatusFace, glyphFor, neutralGlyph, neutralSkin, skinFor, styleFor } from './skins.js';
import { displayWidth, fitWidth } from './width.js';
import { LEFT_MARGIN } from './zoom-geometry.js';

/** The map's title, at the top left of the picture. */
export function drawTitle(canvas: Canvas, title: string): void {
  canvas.text(LEFT_MARGIN, 0, title, 'none', true);
}

/** Lane headers, centered over their column region. */
export function drawLaneHeaders(canvas: Canvas, map: MellosMap, columns: ColumnLayout, rows: RowLayout): void {
  if (rows.laneHeaderY === undefined) return;
  for (let i = 0; i < map.lanes.length; i++) {
    const region = columns.lanes[i]!;
    const label = fitWidth(map.lanes[i]!.label, region.w);
    const cx = region.x + Math.max(0, Math.floor((region.w - displayWidth(label)) / 2));
    canvas.text(cx, rows.laneHeaderY, label, 'faint', true);
  }
}

/**
 * The band bars and their labels. A bar spans everything a wire may occupy;
 * the label lives in a margin of its own to the right of that, because a
 * label written over the bar REPLACES cells, and the canvas refuses to
 * overdraw a literal — a wire crossing under a label was simply cut.
 */
export function drawBands(
  canvas: Canvas,
  columns: ColumnLayout,
  rows: RowLayout,
  wiredWidth: number,
  totalWidth: number,
): void {
  for (let b = 0; b < columns.bands.length; b++) {
    const label = columns.bandLabel[b]!;
    for (let x = 0; x < wiredWidth; x++) canvas.line(x, rows.barY[b]!, LEFT | RIGHT, true);
    canvas.text(totalWidth - displayWidth(label), rows.barY[b]!, label, 'none', true);
  }
}

/** One node's box: border, glyph, label, and any unfolded detail rows. */
export function drawBox(
  canvas: Canvas,
  box: PlacedBox,
  opts: RenderOptions,
  neutral: boolean,
  face: StatusFace,
  focused = false,
): void {
  const { node, x, y, w } = box;
  const skin = neutral ? neutralSkin(opts.unicode) : skinFor(face, opts.unicode);
  // Hover must not switch font faces: some terminal fonts draw their bold
  // box/line glyphs at a different offset, making a stationary box jump.
  const borderStyle = focused ? 'focus' : skin.style;
  // Neutral pages give the glyph slot to the node kind (a bullet when kindless).
  const slotGlyph = neutral ? neutralGlyph(node, opts.unicode) : glyphFor(face, opts);

  if (box.borderless) {
    // Constellation mode: the node IS its glyph. Wires simply end
    // beside it — a glyph is not a border, so no junction chars appear.
    canvas.text(x + 1, y, slotGlyph, skin.style, true);
    return;
  }

  const inner = w - 2;
  const pad = box.pad === 1 ? ' ' : '';
  canvas.text(x, y, skin.corners[0] + skin.h.repeat(inner) + skin.corners[1], borderStyle);
  canvas.text(x, y + 1, skin.v, borderStyle);
  canvas.text(x + 1, y + 1, `${pad}${slotGlyph} ${box.label}${pad}`, skin.style, true);
  canvas.text(x + w - 1, y + 1, skin.v, borderStyle);
  for (let i = 0; i < box.extra.length; i++) {
    const row = box.extra[i]!;
    const yy = y + 2 + i;
    canvas.text(x, yy, skin.v, borderStyle);
    canvas.text(x + 1, yy, row.text, row.style);
    canvas.text(x + w - 1, yy, skin.v, borderStyle);
  }
  canvas.text(x, y + box.h - 1, skin.corners[2] + skin.h.repeat(inner) + skin.corners[3], borderStyle);
}

/** Every wire. Those touching the focused node render bright. */
export function drawEdges(canvas: Canvas, edges: readonly RoutedEdge[], rows: RowLayout, opts: RenderOptions): void {
  for (const edge of edges) {
    const bright =
      opts.focus !== undefined &&
      ((edge.from.node.id as string) === opts.focus || (edge.to.node.id as string) === opts.focus);
    drawPath(canvas, edgePolyline(edge, rows), bright);
  }
}

/**
 * The legend under the picture: the status vocabulary on a dev page, the kind
 * vocabulary on a documentation page. The hollow "done, no evidence" face is
 * named only where the picture shows one — the four statuses are the
 * vocabulary, that one is a rule being broken in THIS map.
 */
export function drawLegend(
  canvas: Canvas,
  map: MellosMap,
  opts: RenderOptions,
  legendY: number,
  neutral: boolean,
  anyUnverified: boolean,
): void {
  let lx = LEFT_MARGIN;
  if (neutral) {
    lx = canvas.text(lx, legendY, map.kind!, 'faint');
    const seen = new Set<string>();
    for (const n of map.nodes) {
      const k = n.kind as string | undefined;
      if (k === undefined || seen.has(k) || kindGlyph(k, opts.unicode) === undefined) continue;
      seen.add(k);
      lx = canvas.text(lx, legendY, '   ', 'none');
      lx = canvas.text(lx, legendY, `${kindGlyph(k, opts.unicode)} ${k}`, 'none');
    }
    return;
  }
  const legendOpts: RenderOptions = { ...opts, spinnerFrame: 0 };
  const faces: StatusFace[] = ['planned', 'in-progress', 'done', 'regressed'];
  if (anyUnverified) faces.push('done-unverified');
  for (const face of faces) {
    if (lx > LEFT_MARGIN) lx = canvas.text(lx, legendY, '   ', 'none');
    const word = face === 'done-unverified' ? 'done, no evidence' : face;
    lx = canvas.text(lx, legendY, `${glyphFor(face, legendOpts)} ${word}`, styleFor(face));
  }
}
