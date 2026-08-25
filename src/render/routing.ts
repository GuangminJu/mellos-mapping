/**
 * Layer 4a — how a dependency edge gets from one box to another.
 *
 * Routing preference, in order:
 *   1. STRAIGHT — an adjacent-band edge whose box borders share a free
 *      column is one vertical line, no corners.
 *   2. DOGLEG — descend, run horizontally on a track row in the gap above
 *      the target band, descend. Tracks are PACKED: segments that do not
 *      overlap share a row, keeping bands close together.
 *   3. THREAD — a skip-level edge descends through the nearest column that
 *      is free of boxes in every intermediate band (threading the needle
 *      between boxes); only if no such column exists does it fall back to a
 *      private column on the right margin.
 *
 * The output is a value, not a drawing: every edge comes back as the columns
 * and track rows it will use, and a separate step turns that into a polyline
 * once the rows are placed. Crossings need no cleverness at all — the canvas
 * merges masks, so two wires meeting become ┼ by construction.
 */

import type { MellosMap } from '../domain/types.js';
import type { ColumnedBox, ColumnLayout, RowLayout } from './layout.js';
import { LEFT_MARGIN } from './zoom-geometry.js';

/** An edge, resolved to the columns and rows it occupies. */
export type RoutedEdge = {
  readonly from: ColumnedBox;
  readonly to: ColumnedBox;
  readonly fromBand: number;
  readonly toBand: number;
} & (
  | { readonly kind: 'straight'; readonly x: number }
  | { readonly kind: 'dogleg'; readonly exitX: number; readonly entryX: number; readonly landingRow: number }
  | {
      readonly kind: 'thread';
      readonly exitX: number;
      readonly entryX: number;
      readonly descentX: number;
      readonly exitRow: number;
      readonly landingRow: number;
    }
);

export interface Routing {
  readonly edges: readonly RoutedEdge[];
  /** Track rows each band gap needs; the row layout turns these into space. */
  readonly gapRowCount: readonly number[];
  /** Skip edges that found no column between the boxes and took the margin. */
  readonly fallbackCount: number;
}

/** A horizontal wire segment inside a band gap, packed onto shared rows. */
interface GapSegment {
  readonly lo: number;
  readonly hi: number;
}

/** An edge before its track rows are packed. */
interface PendingEdge {
  readonly from: ColumnedBox;
  readonly to: ColumnedBox;
  readonly fromBand: number;
  readonly toBand: number;
  straightX?: number;
  exitX?: number;
  entryX?: number;
  descentX?: number;
}

export function routeEdges(map: MellosMap, columns: ColumnLayout): Routing {
  const { bandIndexOf, bandBoxes, boxOf, contentWidth } = columns;
  const pending: PendingEdge[] = map.edges.map((e) => {
    const from = boxOf.get(e.from as string)!;
    const to = boxOf.get(e.to as string)!;
    return {
      from,
      to,
      fromBand: bandIndexOf.get(from.node.layer as string)!,
      toBand: bandIndexOf.get(to.node.layer as string)!,
    };
  });

  /**
   * Columns already carrying a VERTICAL run inside each band gap, and the
   * edge that owns each.
   *
   * Two edges given the same column in one gap do not cross there — they run
   * on top of each other for the whole gap, and where the shorter one turns
   * onto its track row the union of masks becomes ├ or ┤: one wire that
   * appears to branch, which is a lie about the dependencies. Packing tracks
   * by horizontal extent alone could not see this, because the collision is
   * vertical. A wire may of course reuse a column it owns itself — a skip
   * edge descending straight out of its own exit slot is the ideal route, not
   * a collision — and horizontal segments still cross verticals freely, which
   * is an honest ┼.
   */
  const gapVerticals: Map<number, PendingEdge>[] = Array.from(
    { length: Math.max(0, columns.bands.length - 1) },
    () => new Map<number, PendingEdge>(),
  );
  const verticalFree = (gap: number, x: number, edge: PendingEdge): boolean => {
    const owner = gapVerticals[gap]?.get(x);
    return owner === undefined || owner === edge;
  };
  const takeVertical = (gap: number, x: number, edge: PendingEdge): void => {
    gapVerticals[gap]?.set(x, edge);
  };

  // Attach columns already promised on a box's border (either side).
  const claimedColumns = new Map<ColumnedBox, Set<number>>();
  const isFree = (box: ColumnedBox, x: number): boolean => !(claimedColumns.get(box)?.has(x) ?? false);
  const claim = (box: ColumnedBox, x: number): number => {
    let set = claimedColumns.get(box);
    if (!set) claimedColumns.set(box, (set = new Set()));
    set.add(x);
    return x;
  };

  // 1. STRAIGHT edges
  for (const r of pending) {
    if (r.toBand - r.fromBand !== 1) continue;
    const lo = Math.max(r.from.x + 1, r.to.x + 1);
    const hi = Math.min(r.from.x + r.from.w - 2, r.to.x + r.to.w - 2);
    if (lo > hi) continue; // no vertical overlap — a dogleg is genuinely needed
    const mid = Math.floor((lo + hi) / 2);
    for (let d = 0; d <= hi - lo && r.straightX === undefined; d++) {
      for (const x of d === 0 ? [mid] : [mid - d, mid + d]) {
        if (x >= lo && x <= hi && isFree(r.from, x) && isFree(r.to, x) && verticalFree(r.fromBand, x, r)) {
          r.straightX = claim(r.to, claim(r.from, x));
          takeVertical(r.fromBand, x, r);
          break;
        }
      }
    }
  }

  // 2. attach slots for the bent rest, nudged off claimed columns
  const bent = pending.filter((r) => r.straightX === undefined);
  const outgoing = new Map<ColumnedBox, PendingEdge[]>();
  const incoming = new Map<ColumnedBox, PendingEdge[]>();
  for (const r of bent) {
    outgoing.set(r.from, [...(outgoing.get(r.from) ?? []), r]);
    incoming.set(r.to, [...(incoming.get(r.to) ?? []), r]);
  }
  const freeSlot = (box: ColumnedBox, k: number, n: number, edge: PendingEdge, gap: number): number => {
    const lo = box.x + 1;
    const hi = box.x + box.w - 2;
    const ideal = box.x + Math.min(box.w - 2, Math.max(1, Math.round(((k + 1) * (box.w - 1)) / (n + 1))));
    for (let d = 0; d <= hi - lo; d++) {
      for (const x of d === 0 ? [ideal] : [ideal - d, ideal + d]) {
        if (x >= lo && x <= hi && isFree(box, x) && verticalFree(gap, x, edge)) {
          takeVertical(gap, x, edge);
          return claim(box, x);
        }
      }
    }
    return ideal; // every column claimed (extremely crowded box) — overlap and live with it
  };
  for (const r of bent) {
    const outs = outgoing.get(r.from)!;
    const ins = incoming.get(r.to)!;
    // The exit descends through the gap below the source band; the entry
    // climbs out of the gap above the target band. For an adjacent edge those
    // are one gap, so the entry column also avoids the exit column.
    r.exitX = freeSlot(r.from, outs.indexOf(r), outs.length, r, r.fromBand);
    r.entryX = freeSlot(r.to, ins.indexOf(r), ins.length, r, r.toBand - 1);
  }

  // 3. THREAD descent columns for skip-level edges
  const usedDescent = new Set<number>();
  let fallbackCount = 0;
  const blockedByBox = (band: number, x: number): boolean =>
    bandBoxes[band]!.some((b) => x >= b.x && x <= b.x + b.w - 1);
  /** The descent runs through every gap from the source band to the target's. */
  const descentGapsFree = (r: PendingEdge, c: number): boolean => {
    for (let g = r.fromBand; g <= r.toBand - 1; g++) {
      if (!verticalFree(g, c, r)) return false;
    }
    return true;
  };
  for (const r of bent.filter((e) => e.toBand - e.fromBand > 1)) {
    const ex = r.entryX!;
    let chosen: number | undefined;
    for (let d = 0; d <= contentWidth && chosen === undefined; d++) {
      for (const c of d === 0 ? [ex] : [ex - d, ex + d]) {
        if (c < LEFT_MARGIN || c > contentWidth + 1 || usedDescent.has(c)) continue;
        if (!descentGapsFree(r, c)) continue;
        let blocked = false;
        for (let b = r.fromBand + 1; b < r.toBand && !blocked; b++) blocked = blockedByBox(b, c);
        if (!blocked) {
          chosen = c;
          break;
        }
      }
    }
    if (chosen === undefined) chosen = contentWidth + 2 + fallbackCount++ * 2; // margin fallback
    usedDescent.add(chosen);
    for (let g = r.fromBand; g <= r.toBand - 1; g++) takeVertical(g, chosen, r);
    r.descentX = chosen;
  }

  // 4. pack horizontal segments into shared track rows per gap
  const gapCount = Math.max(0, columns.bands.length - 1);
  const gapSegments: { edge: PendingEdge; kind: 'exit' | 'landing'; segment: GapSegment }[][] = Array.from(
    { length: gapCount },
    () => [],
  );
  for (const r of bent) {
    const sx = r.exitX!;
    const ex = r.entryX!;
    if (r.descentX === undefined) {
      gapSegments[r.toBand - 1]!.push({
        edge: r,
        kind: 'landing',
        segment: { lo: Math.min(sx, ex), hi: Math.max(sx, ex) },
      });
    } else {
      const c = r.descentX;
      gapSegments[r.fromBand]!.push({ edge: r, kind: 'exit', segment: { lo: Math.min(sx, c), hi: Math.max(sx, c) } });
      gapSegments[r.toBand - 1]!.push({
        edge: r,
        kind: 'landing',
        segment: { lo: Math.min(c, ex), hi: Math.max(c, ex) },
      });
    }
  }
  const exitRow = new Map<PendingEdge, number>();
  const landingRow = new Map<PendingEdge, number>();
  const gapRowCount: number[] = gapSegments.map((entries) => {
    const rowEnds: number[] = []; // rightmost occupied column per packed row
    for (const e of [...entries].sort((a, b) => a.segment.lo - b.segment.lo)) {
      let row = rowEnds.findIndex((end) => e.segment.lo > end + 1);
      if (row === -1) {
        rowEnds.push(e.segment.hi);
        row = rowEnds.length - 1;
      } else {
        rowEnds[row] = Math.max(rowEnds[row]!, e.segment.hi);
      }
      (e.kind === 'exit' ? exitRow : landingRow).set(e.edge, row);
    }
    return rowEnds.length;
  });

  const edges: RoutedEdge[] = pending.map((r) => {
    const common = { from: r.from, to: r.to, fromBand: r.fromBand, toBand: r.toBand };
    if (r.straightX !== undefined) return { ...common, kind: 'straight', x: r.straightX };
    if (r.descentX === undefined) {
      return { ...common, kind: 'dogleg', exitX: r.exitX!, entryX: r.entryX!, landingRow: landingRow.get(r)! };
    }
    return {
      ...common,
      kind: 'thread',
      exitX: r.exitX!,
      entryX: r.entryX!,
      descentX: r.descentX,
      exitRow: exitRow.get(r)!,
      landingRow: landingRow.get(r)!,
    };
  });

  return { edges, gapRowCount, fallbackCount };
}

/**
 * The polyline one edge draws, once the rows are placed: box bottom border,
 * down the exit column, along a track row, and into the target's top border.
 */
export function edgePolyline(edge: RoutedEdge, rows: RowLayout): ReadonlyArray<readonly [number, number]> {
  const from = rows.boxOf.get(edge.from.node.id as string)!;
  const to = rows.boxOf.get(edge.to.node.id as string)!;
  const sy = from.y + from.h - 1; // bottom border row of the source box
  const ey = to.y; // top border row of the target box
  if (edge.kind === 'straight') {
    return [
      [edge.x, sy],
      [edge.x, ey],
    ];
  }
  const landingY = rows.gapTrackStartY[edge.toBand - 1]! + edge.landingRow;
  if (edge.kind === 'dogleg') {
    return [
      [edge.exitX, sy],
      [edge.exitX, landingY],
      [edge.entryX, landingY],
      [edge.entryX, ey],
    ];
  }
  const exitY = rows.gapTrackStartY[edge.fromBand]! + edge.exitRow;
  return [
    [edge.exitX, sy],
    [edge.exitX, exitY],
    [edge.descentX, exitY],
    [edge.descentX, landingY],
    [edge.entryX, landingY],
    [edge.entryX, ey],
  ];
}
