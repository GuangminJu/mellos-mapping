/**
 * Pure geometry over a Mellos map value at one zoom step: bands stacked
 * top-down by descending rank (primitives at the bottom, matching the
 * terminal pane), boxes packed left-to-right per band — under lane columns
 * when the map declares lanes — and downward edges between box centers.
 *
 * Medium semantics (zoom-step meaning, far-zoom aggregation, sequence
 * orientation, neutral kinds) come from the mellos-mapping semantics library
 * so this view and the terminal pane can never disagree on what a map MEANS.
 * What zoom LOOKS like is owned here, in the medium's own strength: the view
 * scales geometry CONTINUOUSLY (SVG scales for free where a terminal must
 * compress whitespace) and this module maps the scale to a content step by
 * thresholds — the detail steps unfold evidence and notes inside
 * the boxes, and the overview step renders the aggregated map. A map without
 * groups has no aggregate and simply stays itself at the far step — the
 * terminal's glyph constellation is a character-grid necessity, not a
 * semantic obligation.
 */

import type { MapNode, MellosMap } from 'mellos-mapping/domain/types'
import { type ZoomStep, aggregateMap, flipForSequence, isNeutralKind, zoomMode } from 'mellos-mapping/semantics'
import { kindGlyph } from 'mellos-mapping/render'

/** Pixel geometry constants at the view's base font size. */
const LINE_H = 17
const BOX_PAD_Y = 8
const PAD_X = 14
const GAP_X = 18
const LANE_GAP = 34
const BAND_LABEL_H = 24
const LANE_HEADER_H = 22
const MARGIN = 16
const MIN_BOX_W = 64

/** Wire-routing geometry, the terminal renderer's routing preference in
 * pixels. Horizontal runs pack into shared track rows per band gap, so the
 * gap between two bands is as tall as its traffic needs and no taller —
 * packing is what keeps the bands close together. */
const TRACK_H = 13
/** Breathing room above the top track row; taller than below because edge
 * labels sit 4px above their run. */
const GAP_BREATHE_TOP = 18
const GAP_BREATHE_BOTTOM = 14
/** A gap no horizontal run crosses: bands pull close. */
const GAP_EMPTY = 30
/** Two runs may share one track row when a clear break this wide separates
 * them; anything closer reads as one line and gets its own row. */
const TRACK_CLEARANCE = 14
/** Minimum distance between attach columns promised on one box border. */
const SEAT_MIN = 10
/** Search step when nudging an attach column off a claimed one. */
const SEAT_STEP = 6
/** Attach columns keep off the box corners by this much. */
const EDGE_INSET = 8
/** A thread descent column keeps this clear of every intermediate box. */
const THREAD_CLEAR = 6
/** Corridor search step for thread descent columns. */
const THREAD_STEP = 4
/** Minimum distance between two descent columns. */
const THREAD_SEP = 8
/** First right-margin fallback column sits this far beyond the content. */
const THREAD_FALLBACK_PAD = 14

/** Character budget and note-line cap of the two detail steps. The first
 * step unfolds gently (evidence plus one note line) so crossing its
 * threshold reflows a few lines, not a wall of text; the far step opens up. */
const DETAIL_BUDGET = { chars: 34, noteLines: 1 }
const DETAIL_PLUS_BUDGET = { chars: 48, noteLines: 12 }

/** Continuous display-scale range; the view multiplies geometry by it. */
export const SCALE_MIN = 0.4
export const SCALE_MAX = 2.4
export const SCALE_DEFAULT = 1

/**
 * Fold a value into the scale range. Non-finite input (a viewpoint persisted
 * by an older build carried ladder steps in this seat) lands on the default.
 * @param value - candidate scale.
 * @returns a usable scale inside the contract range.
 */
export function clampScale(value: number): number {
  return Number.isFinite(value) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, value)) : SCALE_DEFAULT
}

/** Content-step thresholds, descending; scale >= at renders as `above`.
 * Boundary values dodge the landing spots of the standard gestures (a wheel
 * detent is x1.162 per click, the +/- keys x1.25), so ordinary zoom paths
 * clear the hysteresis band instead of parking inside it. */
const STEP_BOUNDS: ReadonlyArray<{ at: number; above: ZoomStep }> = [
  { at: 1.5, above: 2 },
  { at: 1.2, above: 1 },
  { at: 0.625, above: 0 },
  { at: 0.505, above: -3 },
]
/** Schmitt margin: leaving the current step requires clearing a boundary by
 * this much. Wide enough for wheel jitter (well under one percent of scale),
 * narrow enough that a full detent always clears it — the same scale must
 * not show different content depending on the approach direction. */
const STEP_HYSTERESIS = 0.02

/**
 * The semantic step a continuous scale renders with: a magnified picture
 * unfolds detail inside the boxes, a small one carries counts on the band
 * bars, and the far end aggregates groups. Thresholds instead of discrete
 * stops — the wheel zooms geometrically and the content follows. With the
 * current step supplied, boundaries act as a Schmitt trigger: hovering at a
 * threshold cannot flap the layout open and shut on wheel jitter.
 * @param scale - continuous display scale.
 * @param current - step currently rendered, engages hysteresis when given.
 * @returns the content step to lay out with.
 */
export function stepForScale(scale: number, current?: ZoomStep): ZoomStep {
  let raw: ZoomStep = -4
  for (const bound of STEP_BOUNDS) {
    if (scale >= bound.at) {
      raw = bound.above
      break
    }
  }
  if (current === undefined || raw === current) return raw
  const crossed = STEP_BOUNDS.find(bound => bound.above === (raw > current ? raw : current))
  return crossed !== undefined && Math.abs(scale - crossed.at) < STEP_HYSTERESIS ? current : raw
}

/** One text line inside a node box. */
export interface BoxLine {
  readonly text: string
  readonly role: 'label' | 'evidence' | 'note'
}

/** One positioned node box with its unfolded content. */
export interface NodeBox {
  readonly node: MapNode
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly lines: readonly BoxLine[]
}

/** One band separator: the rule the band's name sits on. */
export interface BandRule {
  readonly name: string
  readonly y: number
  /** Members done/total, present when the step carries counts on the bars. */
  readonly counts?: string
}

/** One lane column header. */
export interface LaneHeader {
  readonly label: string
  readonly x: number
  readonly w: number
}

/** One routed edge with optional label, from the using box down into the used box. */
export interface EdgeLine {
  readonly from: string
  readonly to: string
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  /** Y of the primary horizontal run (the packed track row below the source
   * box); a STRAIGHT edge has no run and carries its own midpoint here. */
  readonly midY: number
  /** Full orthogonal polyline from the source seat to the target seat, the
   *  terminal renderer's routing preference: a STRAIGHT edge (adjacent bands,
   *  boxes vertically aligned) is one vertical line — two points; a dogleg
   *  drops onto a packed track row and re-drops — four points; a multi-band
   *  edge drops into the source gap, descends a THREAD column that passes
   *  between the intermediate bands' boxes (right-margin fallback only when
   *  no such corridor exists), and enters via the target gap — six points.
   *  No segment ever passes behind a box. */
  readonly points: ReadonlyArray<readonly [number, number]>
  readonly label: string | undefined
  /** Label baseline, over the primary horizontal run (always inside a gap). */
  readonly labelX: number
  readonly labelY: number
}

/** The whole computed picture. */
export interface MapLayout {
  readonly width: number
  readonly height: number
  readonly bands: readonly BandRule[]
  readonly boxes: readonly NodeBox[]
  readonly edges: readonly EdgeLine[]
  readonly lanes: readonly LaneHeader[]
  /** Documentation kinds render neutrally: no status skins or spinners. */
  readonly neutral: boolean
  /** The far step drew the aggregated map: boxes are groups, not nodes. */
  readonly aggregated: boolean
}

/**
 * Approximate rendered width of a label at the view's base font: CJK glyphs
 * occupy roughly double an ASCII glyph. An estimate is enough — boxes carry
 * padding, and exact text measurement would drag DOM layout into a pure
 * function.
 * @param text - label text.
 * @returns estimated pixel width.
 */
export function estimateTextWidth(text: string): number {
  let width = 0
  for (const ch of text) width += (ch.codePointAt(0) ?? 0) > 0xff ? 13 : 7.2
  return width
}

/** Hard word-wrap by character budget (CJK counts double), for in-box notes. */
export function wrapChars(text: string, budget: number): string[] {
  const out: string[] = []
  let line = ''
  let cost = 0
  for (const ch of text) {
    const w = (ch.codePointAt(0) ?? 0) > 0xff ? 2 : 1
    if (cost + w > budget && line !== '') {
      out.push(line)
      line = ''
      cost = 0
    }
    line += ch
    cost += w
  }
  if (line !== '') out.push(line)
  return out
}

/** Status glyphs of the terminal pane's glyphFor, the spinner held at ◐. */
const STATUS_GLYPHS: Readonly<Record<string, string>> = {
  'planned': '·', 'in-progress': '◐', 'done': '■', 'regressed': '✗',
}

/** The text lines one node box carries at this zoom step. */
function boxLines(node: MapNode, zoom: ZoomStep, neutral: boolean): BoxLine[] {
  // Dev pages give the glyph slot to the status; documentation kinds keep
  // their kind glyph — the status skin means nothing there.
  const glyph = neutral
    ? (node.kind !== undefined ? kindGlyph(node.kind as string, true) : undefined)
    : STATUS_GLYPHS[node.status]
  const label = glyph !== undefined ? `${glyph} ${node.label}` : node.label
  const lines: BoxLine[] = [{ text: label, role: 'label' }]
  if (zoomMode(zoom) !== 'detail') return lines
  const budget = zoom >= 2 ? DETAIL_PLUS_BUDGET : DETAIL_BUDGET
  if (!neutral && node.evidence !== undefined) {
    for (const text of wrapChars(node.evidence, budget.chars).slice(0, 2)) lines.push({ text, role: 'evidence' })
  }
  if (node.detail !== undefined) {
    for (const text of wrapChars(node.detail, budget.chars).slice(0, budget.noteLines)) lines.push({ text, role: 'note' })
  }
  return lines
}

/**
 * Compute the full layered picture for one map value at one zoom step.
 * @param map - a validated Mellos map value.
 * @param zoom - position on the semantic zoom ladder.
 * @returns positioned bands, lanes, boxes, and edges with the content extent.
 */
export function computeLayout(map: MellosMap, zoom: ZoomStep = 0): MapLayout {
  const oriented = flipForSequence(map)
  const mode = zoomMode(zoom)
  const aggregated = mode === 'overview' ? aggregateMap(oriented) : undefined
  const working = aggregated ?? oriented
  const neutral = isNeutralKind(working)
  const bands = [...working.layers].sort((a, b) => b.rank - a.rank)
  const withCounts = zoom <= -3 && !neutral

  // -- box specs, paired with their nodes so no later lookup can miss --
  interface Spec { readonly w: number; readonly h: number; readonly lines: readonly BoxLine[] }
  const speced: ReadonlyArray<{ node: MapNode; spec: Spec }> = working.nodes.map((node) => {
    const lines = boxLines(node, zoom, neutral)
    return {
      node,
      spec: {
        w: Math.max(MIN_BOX_W, Math.round(Math.max(...lines.map(l => estimateTextWidth(l.text)))) + PAD_X * 2),
        h: BOX_PAD_Y * 2 + LINE_H * lines.length,
        lines,
      },
    }
  })

  // -- lane columns: region widths from the widest band row or the header --
  const laneCount = working.lanes.length
  const laneIndexOf = new Map<string, number>(working.lanes.map((l, i) => [l.id as string, i]))
  const regions = laneCount + 1 // trailing region for off-lane nodes
  // The store guarantees a node's lane exists (I9); the fallback region only
  // keeps a torn value from crashing the whole panel.
  const regionOf = (node: MapNode): number =>
    node.lane !== undefined ? laneIndexOf.get(node.lane as string) ?? regions - 1 : regions - 1
  const laneX: number[] = []
  const laneW: number[] = []
  if (laneCount > 0) {
    const regionW: number[] = Array.from({ length: regions }, () => 0)
    for (const band of bands) {
      const rowW: number[] = Array.from({ length: regions }, () => 0)
      for (const { node, spec } of speced) {
        if (node.layer !== band.id) continue
        const region = regionOf(node)
        rowW[region] = (rowW[region] ?? 0) + spec.w + ((rowW[region] ?? 0) > 0 ? GAP_X : 0)
      }
      for (let i = 0; i < regions; i++) regionW[i] = Math.max(regionW[i] ?? 0, rowW[i] ?? 0)
    }
    for (const [i, lane] of working.lanes.entries()) {
      regionW[i] = Math.max(regionW[i] ?? 0, Math.round(estimateTextWidth(lane.label)) + PAD_X)
    }
    let x0 = MARGIN
    for (let i = 0; i < regions; i++) {
      const w = regionW[i] ?? 0
      laneX.push(x0)
      laneW.push(w)
      x0 += w + (w > 0 ? LANE_GAP : 0)
    }
  }

  // -- horizontal placement: per-band x cursors; the y plane waits for the
  // routing, because each band gap is exactly as tall as the track rows the
  // wires need there --
  interface Placed {
    readonly node: MapNode
    readonly x: number
    readonly w: number
    readonly h: number
    readonly lines: readonly BoxLine[]
    y: number
  }
  const placed: Placed[] = []
  const bandMembers: Placed[][] = []
  const byId = new Map<string, Placed>()
  let width = MARGIN * 2
  for (const band of bands) {
    const row: Placed[] = []
    const cursors = laneCount === 0 ? [MARGIN] : [...laneX]
    for (const { node, spec } of speced) {
      if (node.layer !== band.id) continue
      const region = laneCount === 0 ? 0 : regionOf(node)
      const x = cursors[region] ?? MARGIN
      const box: Placed = { node, x, w: spec.w, h: spec.h, lines: spec.lines, y: 0 }
      row.push(box)
      placed.push(box)
      byId.set(node.id as string, box)
      cursors[region] = x + spec.w + GAP_X
    }
    bandMembers.push(row)
    width = Math.max(width, ...cursors.map(c => c - GAP_X + MARGIN))
  }
  const laneHeaders: LaneHeader[] = working.lanes.map((lane, i) => ({
    label: lane.label,
    x: laneX[i] ?? MARGIN,
    w: laneW[i] ?? 0,
  }))
  for (const header of laneHeaders) width = Math.max(width, header.x + header.w + MARGIN)

  // -- wire routing on the x plane, the terminal pane's preference order --
  // 1. STRAIGHT — an adjacent-band edge whose boxes align vertically is one
  //    vertical line, no corners, on a column claimed on both borders.
  // 2. DOGLEG — everything else leaves a fanned seat (ordered by the
  //    counterpart's center so wires do not cross at birth, nudged off
  //    claimed columns), rides a horizontal run on a PACKED track row in a
  //    band gap, and drops into its target seat. Two runs that do not
  //    overlap share a row — packing is what keeps the bands close.
  // 3. THREAD — a multi-band edge descends through the nearest column that
  //    passes clear of every intermediate band's boxes, threading between
  //    them like the terminal pane; only when no such corridor exists does
  //    it fall back to a private column on the right margin.
  // No two wires are ever drawn on top of each other, and no segment ever
  // passes behind a box.
  interface Routed {
    readonly from: string
    readonly to: string
    readonly a: Placed
    readonly b: Placed
    readonly label: string | undefined
    readonly si: number
    readonly ti: number
    sx: number
    ex: number
    straightX?: number
    cx?: number
  }
  const bandIndexOf = new Map<string, number>(bands.map((band, index) => [band.id as string, index]))
  const routed: Routed[] = []
  for (const edge of working.edges) {
    const a = byId.get(edge.from as string)
    const b = byId.get(edge.to as string)
    // The store's invariants guarantee both ends exist on strictly downward
    // edges; the guards only keep a torn value from crashing the panel.
    if (a === undefined || b === undefined) continue
    const si = bandIndexOf.get(a.node.layer as string)
    const ti = bandIndexOf.get(b.node.layer as string)
    if (si === undefined || ti === undefined || ti <= si) continue
    routed.push({
      from: edge.from as string, to: edge.to as string, a, b, label: edge.label,
      si, ti, sx: a.x + a.w / 2, ex: b.x + b.w / 2,
    })
  }

  // Attach columns already promised on a box's border (either side).
  const claimed = new Map<Placed, number[]>()
  const isFree = (box: Placed, x: number): boolean =>
    (claimed.get(box) ?? []).every(taken => Math.abs(taken - x) >= SEAT_MIN)
  const claim = (box: Placed, x: number): number => {
    claimed.set(box, [...(claimed.get(box) ?? []), x])
    return x
  }
  const freeColumn = (ideal: number, lo: number, hi: number, ok: (x: number) => boolean): number | undefined => {
    for (let d = 0; d * SEAT_STEP <= hi - lo; d++) {
      for (const x of d === 0 ? [ideal] : [ideal - d * SEAT_STEP, ideal + d * SEAT_STEP]) {
        if (x >= lo && x <= hi && ok(x)) return x
      }
    }
    return undefined
  }

  // 1. STRAIGHT columns, centered in the boxes' shared span
  for (const wire of routed) {
    if (wire.ti - wire.si !== 1) continue
    const lo = Math.max(wire.a.x, wire.b.x) + EDGE_INSET
    const hi = Math.min(wire.a.x + wire.a.w, wire.b.x + wire.b.w) - EDGE_INSET
    if (lo > hi) continue // no vertical alignment — a dogleg is genuinely needed
    const x = freeColumn(Math.round((lo + hi) / 2), lo, hi, c => isFree(wire.a, c) && isFree(wire.b, c))
    if (x !== undefined) {
      wire.straightX = claim(wire.b, claim(wire.a, x))
      wire.sx = x
      wire.ex = x
    }
  }

  // 2. fanned seats for the bent rest
  const bent = routed.filter(wire => wire.straightX === undefined)
  const fan = (
    groupOf: (wire: Routed) => string,
    counterpartX: (wire: Routed) => number,
    boxOf: (wire: Routed) => Placed,
    assign: (wire: Routed, x: number) => void,
  ): void => {
    const groups = new Map<string, Routed[]>()
    for (const wire of bent) {
      const key = groupOf(wire)
      groups.set(key, [...(groups.get(key) ?? []), wire])
    }
    for (const wires of groups.values()) {
      wires.sort((m, n) => counterpartX(m) - counterpartX(n))
      wires.forEach((wire, index) => {
        const box = boxOf(wire)
        const ideal = Math.round(box.x + box.w * ((index + 1) / (wires.length + 1)))
        const x = freeColumn(ideal, box.x + EDGE_INSET, box.x + box.w - EDGE_INSET, c => isFree(box, c)) ?? ideal
        assign(wire, claim(box, x))
      })
    }
  }
  fan(wire => wire.from, wire => wire.b.x + wire.b.w / 2, wire => wire.a, (wire, x) => { wire.sx = x })
  fan(wire => wire.to, wire => wire.a.x + wire.a.w / 2, wire => wire.b, (wire, x) => { wire.ex = x })

  // 3. THREAD descent columns, searched outward from the target seat
  const descents: number[] = []
  let fallbackCount = 0
  const blockedByBox = (band: number, x: number): boolean =>
    (bandMembers[band] ?? []).some(box => x >= box.x - THREAD_CLEAR && x <= box.x + box.w + THREAD_CLEAR)
  for (const wire of bent) {
    if (wire.ti - wire.si <= 1) continue
    let chosen: number | undefined
    const lo = MARGIN
    const hi = width - MARGIN
    for (let d = 0; chosen === undefined && d * THREAD_STEP <= hi - lo; d++) {
      for (const c of d === 0 ? [wire.ex] : [wire.ex - d * THREAD_STEP, wire.ex + d * THREAD_STEP]) {
        if (c < lo || c > hi) continue
        if (descents.some(taken => Math.abs(taken - c) < THREAD_SEP)) continue
        let hit = false
        for (let band = wire.si + 1; band < wire.ti && !hit; band++) hit = blockedByBox(band, c)
        if (!hit) {
          chosen = c
          break
        }
      }
    }
    if (chosen === undefined) chosen = width - MARGIN + THREAD_FALLBACK_PAD + fallbackCount++ * THREAD_SEP
    descents.push(chosen)
    wire.cx = chosen
  }
  const widthFinal = Math.max(width, ...descents.map(c => c + MARGIN))

  // 4. pack horizontal runs into shared track rows per band gap: first-fit
  // by left edge, a row reused only across a clear break
  interface Run {
    readonly wire: Routed
    readonly gap: number
    readonly lo: number
    readonly hi: number
    row: number
  }
  const runs: Run[] = []
  const runsOf = new Map<Routed, { entry?: Run; landing: Run }>()
  for (const wire of bent) {
    if (wire.cx === undefined) {
      const landing: Run = { wire, gap: wire.si, lo: Math.min(wire.sx, wire.ex), hi: Math.max(wire.sx, wire.ex), row: 0 }
      runs.push(landing)
      runsOf.set(wire, { landing })
    } else {
      const entry: Run = { wire, gap: wire.si, lo: Math.min(wire.sx, wire.cx), hi: Math.max(wire.sx, wire.cx), row: 0 }
      const landing: Run = { wire, gap: wire.ti - 1, lo: Math.min(wire.cx, wire.ex), hi: Math.max(wire.cx, wire.ex), row: 0 }
      runs.push(entry, landing)
      runsOf.set(wire, { entry, landing })
    }
  }
  const gapRows: number[] = Array.from({ length: Math.max(0, bands.length - 1) }, () => 0)
  for (let gap = 0; gap < gapRows.length; gap++) {
    const rowEnds: number[] = [] // rightmost occupied x per packed row
    for (const run of runs.filter(r => r.gap === gap).sort((m, n) => m.lo - n.lo)) {
      const row = rowEnds.findIndex(end => run.lo > end + TRACK_CLEARANCE)
      if (row === -1) {
        rowEnds.push(run.hi)
        run.row = rowEnds.length - 1
      } else {
        rowEnds[row] = Math.max(rowEnds[row] ?? run.hi, run.hi)
        run.row = row
      }
    }
    gapRows[gap] = rowEnds.length
  }

  // -- vertical stacking: lane headers, then bands top-down; each band gap
  // as tall as its packed track rows need --
  const bandRules: BandRule[] = []
  const gapTop: number[] = []
  let y = MARGIN + (laneCount > 0 ? LANE_HEADER_H : 0)
  bands.forEach((band, index) => {
    const row = bandMembers[index] ?? []
    const done = row.filter(box => box.node.status === 'done').length
    bandRules.push({
      name: band.name,
      y: y + BAND_LABEL_H / 2,
      ...(withCounts && row.length > 0 ? { counts: `${done}/${row.length}` } : {}),
    })
    y += BAND_LABEL_H
    const rowH = Math.max(0, ...row.map(box => box.h))
    for (const box of row) box.y = y
    y += row.length > 0 ? rowH : 0
    if (index < bands.length - 1) {
      gapTop.push(y)
      const tracks = gapRows[index] ?? 0
      y += tracks === 0 ? GAP_EMPTY : GAP_BREATHE_TOP + tracks * TRACK_H + GAP_BREATHE_BOTTOM
    }
  })
  const height = bands.length === 0 ? MARGIN * 2 : y + MARGIN
  const boxes: NodeBox[] = placed
  const trackY = (run: Run): number => (gapTop[run.gap] ?? 0) + GAP_BREATHE_TOP + (run.row + 0.5) * TRACK_H

  // -- emit the polylines --
  const edges: EdgeLine[] = []
  for (const wire of routed) {
    const y1 = wire.a.y + wire.a.h
    const y2 = wire.b.y
    if (wire.straightX !== undefined) {
      const x = wire.straightX
      const midY = (y1 + y2) / 2
      edges.push({
        from: wire.from, to: wire.to,
        x1: x, y1, x2: x, y2, midY,
        points: [[x, y1], [x, y2]],
        label: wire.label,
        // A straight line has no run to sit over: the label rides beside the
        // line at mid-height, its centered text box cleared off the stroke.
        labelX: x + 6 + (wire.label !== undefined ? estimateTextWidth(wire.label) / 2 : 0),
        labelY: midY + 3,
      })
      continue
    }
    const wireRuns = runsOf.get(wire)
    if (wireRuns === undefined) continue // unreachable: every bent wire packed its runs
    if (wire.cx === undefined) {
      const midY = trackY(wireRuns.landing)
      edges.push({
        from: wire.from, to: wire.to,
        x1: wire.sx, y1, x2: wire.ex, y2, midY,
        points: [[wire.sx, y1], [wire.sx, midY], [wire.ex, midY], [wire.ex, y2]],
        label: wire.label,
        labelX: (wire.sx + wire.ex) / 2, labelY: midY - 4,
      })
    } else {
      const entryY = wireRuns.entry === undefined ? trackY(wireRuns.landing) : trackY(wireRuns.entry)
      const exitY = trackY(wireRuns.landing)
      edges.push({
        from: wire.from, to: wire.to,
        x1: wire.sx, y1, x2: wire.ex, y2, midY: entryY,
        points: [[wire.sx, y1], [wire.sx, entryY], [wire.cx, entryY], [wire.cx, exitY], [wire.ex, exitY], [wire.ex, y2]],
        label: wire.label,
        labelX: (wire.sx + wire.cx) / 2, labelY: entryY - 4,
      })
    }
  }

  return {
    width: widthFinal,
    height,
    bands: bandRules,
    boxes,
    edges,
    lanes: laneHeaders,
    neutral,
    aggregated: aggregated !== undefined,
  }
}
