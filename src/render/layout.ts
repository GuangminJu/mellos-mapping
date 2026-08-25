/**
 * Layer 4a — where everything goes, decided before anything is drawn.
 *
 * Two stages, because the picture's height cannot be known until the wires
 * are routed: first COLUMNS (how wide each box is and which column it starts
 * at, which fixes the picture's width), then — once routing has said how many
 * track rows each band gap needs — ROWS. Nothing here draws; nothing here
 * mutates a box after placing it, so a position is a value another stage can
 * hold on to.
 *
 * Bands are the map's layers, top band first: rank 0 renders at the BOTTOM
 * ("primitives are the ground"), so the sort is descending.
 */

import type { MapLayer, MapNode, MellosMap } from '../domain/types.js';
import { kindGlyph } from '../semantics/semantics.js';
import type { Style } from './canvas.js';
import { BAR_MIN_RUN, BOX_H, LEFT_MARGIN, type ZoomGeometry } from './zoom-geometry.js';
import { displayWidth, fitWidth, wrapWidth } from './width.js';

/** In-box rows below the label row (detail mode only). */
export interface ExtraRow {
  readonly text: string;
  readonly style: Style;
}

/** A box sized for the zoom — content and extent, no position yet. */
export interface BoxSpec {
  readonly node: MapNode;
  readonly w: number;
  readonly h: number;
  /** Label truncated to the zoom's budget; '' in constellation mode. */
  readonly label: string;
  readonly pad: 0 | 1;
  readonly borderless: boolean;
  readonly extra: readonly ExtraRow[];
}

/** A sized box with its column decided. */
export interface ColumnedBox extends BoxSpec {
  readonly x: number;
}

/** A box on the picture. */
export interface PlacedBox extends ColumnedBox {
  readonly y: number;
}

/** A lane's column region (the last one holds the boxes in no lane at all). */
export interface LaneRegion {
  readonly x: number;
  readonly w: number;
}

/** The picture's horizontal decisions. */
export interface ColumnLayout {
  /** Layers sorted top band first (descending rank). */
  readonly bands: readonly MapLayer[];
  readonly bandIndexOf: ReadonlyMap<string, number>;
  /** Boxes per band, in declaration order (which is also left-to-right without lanes). */
  readonly bandBoxes: readonly (readonly ColumnedBox[])[];
  /** Every box by node id, in declaration order. */
  readonly boxOf: ReadonlyMap<string, ColumnedBox>;
  /** Lane regions, empty when the map declares no lanes. */
  readonly lanes: readonly LaneRegion[];
  /** The text each band bar carries, one per band. */
  readonly bandLabel: readonly string[];
  /** Rightmost column any box or lane occupies, plus the left margin. */
  readonly contentWidth: number;
}

/** The picture's vertical decisions. */
export interface RowLayout {
  readonly boxOf: ReadonlyMap<string, PlacedBox>;
  readonly bandBoxes: readonly (readonly PlacedBox[])[];
  /** Row of each band's bar. */
  readonly barY: readonly number[];
  /** First track row of each band gap; a segment's row index is added to it. */
  readonly gapTrackStartY: readonly number[];
  /** Row of the lane header strip, when the map has lanes. */
  readonly laneHeaderY: number | undefined;
  readonly legendY: number;
}

const LABEL_BUDGET_MIN = 4;

/** Size and content of one node's box under the given zoom geometry. */
export function boxSpec(node: MapNode, geo: ZoomGeometry, unicode: boolean, neutral: boolean): Omit<BoxSpec, 'node'> {
  // On dev pages the glyph slot belongs to the status, so a known kind glyph
  // joins the label text; on neutral pages the kind takes the slot itself.
  // A node with a child map wears the dive badge at the end of its label —
  // appended AFTER width fitting, so truncation can never eat the badge.
  const glyph = node.kind !== undefined ? kindGlyph(node.kind as string, unicode) : undefined;
  const badge = node.submap !== undefined ? (unicode ? ' ⊞' : ' +') : '';
  const badgeW = displayWidth(badge);
  const text = !neutral && glyph !== undefined ? `${glyph} ${node.label}` : node.label;
  if (geo.mode === 'constellation') {
    return { w: 3, h: 1, label: '', pad: 0, borderless: true, extra: [] };
  }
  if (geo.mode === 'detail' && geo.detail !== undefined) {
    const budget = geo.detail;
    const innerW = Math.min(Math.max(displayWidth(text) + badgeW + 4, budget.innerMin), budget.innerMax);
    const extra: ExtraRow[] = [];
    if (node.evidence !== undefined) extra.push({ text: fitWidth(` ${node.evidence}`, innerW), style: 'faint' });
    if (node.detail !== undefined) {
      const wrapped = wrapWidth(node.detail, innerW - 2);
      for (let i = 0; i < Math.min(wrapped.length, budget.noteRows); i++) {
        const cut = i === budget.noteRows - 1 && wrapped.length > budget.noteRows;
        extra.push({ text: ` ${cut ? fitWidth(wrapped[i]! + '…', innerW - 2) : wrapped[i]!}`, style: 'none' });
      }
    }
    return {
      w: innerW + 2,
      h: BOX_H + extra.length,
      label: fitWidth(text, innerW - 4 - badgeW) + badge,
      pad: 1,
      borderless: false,
      extra,
    };
  }
  const budget = Math.max(LABEL_BUDGET_MIN, Math.ceil(displayWidth(text) * geo.scale));
  const label = fitWidth(text, budget) + badge;
  return {
    w: displayWidth(label) + 4 + 2 * geo.pad,
    h: BOX_H,
    label,
    pad: geo.pad,
    borderless: false,
    extra: [],
  };
}

/**
 * Column assignment. Without lanes each band packs left-to-right in
 * declaration order. With lanes every band is partitioned into the lane
 * columns (plus a trailing region for boxes in no lane); a lane is as wide as
 * its widest band row or its own header label, so members align vertically
 * under their column across all bands.
 */
export function layoutColumns(map: MellosMap, geo: ZoomGeometry, unicode: boolean, neutral: boolean): ColumnLayout {
  const bands = [...map.layers].sort((a, b) => b.rank - a.rank); // index 0 = top band
  const bandIndexOf = new Map<string, number>(bands.map((l, i) => [l.id as string, i]));

  const sized = new Map<string, BoxSpec>();
  const bandSized: BoxSpec[][] = bands.map(() => []);
  for (const node of map.nodes) {
    const spec: BoxSpec = { node, ...boxSpec(node, geo, unicode, neutral) };
    bandSized[bandIndexOf.get(node.layer as string)!]!.push(spec);
    sized.set(node.id as string, spec);
  }

  const columnOf = new Map<BoxSpec, number>();
  const lanes: LaneRegion[] = [];
  if (map.lanes.length === 0) {
    for (const row of bandSized) {
      let x = LEFT_MARGIN;
      for (const spec of row) {
        columnOf.set(spec, x);
        x += spec.w + geo.boxGap;
      }
    }
  } else {
    const laneCount = map.lanes.length;
    const laneGap = geo.boxGap + 2;
    const laneIndexOf = new Map<string, number>(map.lanes.map((l, i) => [l.id as string, i]));
    const regions = laneCount + 1; // trailing region for off-lane nodes
    const grouped: BoxSpec[][][] = bandSized.map((row) => {
      const cells: BoxSpec[][] = Array.from({ length: regions }, () => []);
      for (const spec of row) {
        const lane = spec.node.lane;
        cells[lane !== undefined ? laneIndexOf.get(lane as string)! : regions - 1]!.push(spec);
      }
      return cells;
    });
    const regionW: number[] = Array.from({ length: regions }, () => 0);
    for (const cells of grouped) {
      for (let i = 0; i < regions; i++) {
        const rowW = cells[i]!.reduce((sum, b, k) => sum + b.w + (k > 0 ? geo.boxGap : 0), 0);
        regionW[i] = Math.max(regionW[i]!, rowW);
      }
    }
    for (let i = 0; i < laneCount; i++) regionW[i] = Math.max(regionW[i]!, displayWidth(map.lanes[i]!.label) + 2);
    let x0 = LEFT_MARGIN;
    // Every region gets an entry, the trailing off-lane one included: it holds
    // real boxes (a group node carries no lane, and aggregateMap emits those
    // first), and a picture that forgets its last region measures short.
    for (let i = 0; i < regions; i++) {
      lanes.push({ x: x0, w: regionW[i]! });
      x0 += regionW[i]! + laneGap;
    }
    for (const cells of grouped) {
      for (let i = 0; i < regions; i++) {
        let x = lanes[i]!.x;
        for (const spec of cells[i]!) {
          columnOf.set(spec, x);
          x += spec.w + geo.boxGap;
        }
      }
    }
  }

  // One instance per box, shared by both views of it: later stages key maps
  // on the box itself, and two copies of one box are two boxes to them.
  const placed = new Map<BoxSpec, ColumnedBox>();
  for (const [, spec] of sized) placed.set(spec, { ...spec, x: columnOf.get(spec) ?? LEFT_MARGIN });
  const bandBoxes = bandSized.map((row) => row.map((spec) => placed.get(spec)!));
  // Declaration order, which is the order boxes are drawn and reported as hits.
  const boxOf = new Map<string, ColumnedBox>();
  for (const node of map.nodes) boxOf.set(node.id as string, placed.get(sized.get(node.id as string)!)!);

  // Band bar labels; at small scales the boxes go mute, so the bars carry
  // the aggregate progress (done/total) for their band instead. Neutral
  // documentation kinds never count progress.
  const bandLabel = bands.map((l, i) => {
    const row = bandBoxes[i]!;
    const done = row.filter((b) => b.node.status === 'done').length;
    return geo.bandCounts && row.length > 0 && !neutral ? ` ${l.name} ${done}/${row.length}` : ` ${l.name}`;
  });

  // The RIGHTMOST box, not the last-declared one: lanes reorder a band into
  // its lane regions, so declaration order says nothing about position, and a
  // measurement taken from the wrong box left every band bar short.
  let contentWidth = LEFT_MARGIN + BAR_MIN_RUN;
  for (const row of bandBoxes) for (const box of row) contentWidth = Math.max(contentWidth, box.x + box.w);
  for (const lane of lanes) contentWidth = Math.max(contentWidth, lane.x + lane.w);

  return { bands, bandIndexOf, bandBoxes, boxOf, lanes, bandLabel, contentWidth };
}

/**
 * Row assignment, once routing has said how many track rows each band gap
 * needs: title, lane headers, then band after band — bar, breathing row,
 * boxes, breathing row, tracks — and the legend under everything.
 */
export function layoutRows(
  columns: ColumnLayout,
  geo: ZoomGeometry,
  gapRowCount: readonly number[],
  hasTitle: boolean,
  hasLanes: boolean,
): RowLayout {
  let y = 0;
  if (hasTitle) y += 1 + geo.titleGap;
  let laneHeaderY: number | undefined;
  if (hasLanes) {
    laneHeaderY = y;
    y += 1 + geo.barGap;
  }
  const barY: number[] = [];
  const gapTrackStartY: number[] = [];
  const bandBoxes: PlacedBox[][] = [];
  const placed = new Map<ColumnedBox, PlacedBox>();
  const gapCount = columns.bands.length - 1;
  for (let b = 0; b < columns.bands.length; b++) {
    barY.push(y);
    y += 1 + geo.barGap;
    const row = columns.bandBoxes[b]!;
    for (const box of row) placed.set(box, { ...box, y });
    bandBoxes.push(row.map((box) => placed.get(box)!));
    y += row.reduce((max, box) => Math.max(max, box.h), geo.mode === 'constellation' ? 1 : BOX_H);
    if (b < gapCount) {
      y += geo.breathe; // breathing row below the boxes
      gapTrackStartY.push(y);
      y += gapRowCount[b]!;
      y += geo.breathe; // breathing row above the next bar
    }
  }
  // Declaration order again — the columns layout already holds it.
  const boxOf = new Map<string, PlacedBox>();
  for (const [id, box] of columns.boxOf) boxOf.set(id, placed.get(box)!);
  return { boxOf, bandBoxes, barY, gapTrackStartY, laneHeaderY, legendY: y + 1 };
}
