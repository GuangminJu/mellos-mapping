/**
 * Layer 4 (presentation) — pure rendering of a MellosMap to terminal lines.
 *
 * Shared by the MCP `mmap_view` tool (monochrome) and the split-pane watcher
 * (colored, animated). Pure function of (map, options): no I/O, no clock —
 * animation is driven by the caller passing a spinner frame index.
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
 *   regressed    heavy red box, '✗'           — was done, foundation cracked
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
 * Crossings merge into proper junction characters via a direction-bitmask
 * union instead of any routing cleverness.
 *
 * Zoom — terminals cannot scale glyphs, so zooming out first COMPRESSES the
 * geometry (gaps, breathing rows, padding shrink; labels truncate toward a
 * scale-proportional budget) while boxes stay boxes. Only when a further
 * step would leave labels too short to mean anything does the picture switch
 * mode — to a borderless glyph constellation whose band bars carry
 * done/total counts. Zooming in past 100% unfolds evidence and design notes
 * inside the boxes. The ladder, one wheel tick per step:
 *   +1   detail        evidence + design notes unfold inside boxes
 *    0   100%          the standard working view (default, unchanged)
 *   -1   85%           labels truncated to 85%, geometry still roomy
 *   -2   70%           padding and breathing rows collapse
 *   -3   55%           tightest meaningful boxes; band bars gain done/total
 *   -4   overview      MODE SWITCH: borderless status glyphs, pure topology
 * The same layout/routing machinery runs at every step; only the per-node
 * box spec (size, border, content) and the whitespace geometry change.
 */

import type { MapNode, MellosMap, NodeStatus } from '../domain/types.js';

/** One wheel tick on the zoom ladder; see module header. */
export type ZoomStep = -4 | -3 | -2 | -1 | 0 | 1;

export const ZOOM_MIN: ZoomStep = -4;
export const ZOOM_MAX: ZoomStep = 1;
export const ZOOM_DEFAULT: ZoomStep = 0;

export function clampZoom(n: number): ZoomStep {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(n))) as ZoomStep;
}

/** What the footer shows: a percentage while scaling, a mode name at the ends. */
export function zoomLabel(zoom: ZoomStep): string {
  switch (zoom) {
    case 1:
      return 'detail';
    case 0:
      return '100%';
    case -1:
      return '85%';
    case -2:
      return '70%';
    case -3:
      return '55%';
    case -4:
      return 'overview';
  }
}

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

// ---------------------------------------------------------------------------
// display width — CJK-aware, because labels will often be Chinese
// ---------------------------------------------------------------------------

const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0xa4cf], // CJK radicals .. Yi (covers CJK Unified Ideographs)
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd], // CJK extension planes
];

function charWidth(cp: number): number {
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp >= lo && cp <= hi) return 2;
  }
  return 1;
}

/** Terminal column width of a string (CJK chars occupy two columns). */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/** Truncate to a display width, ANSI-free input, appending … when cut. */
export function fitWidth(s: string, width: number): string {
  if (displayWidth(s) <= width) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

/** Hard word-wrap by display width (CJK-aware, splits anywhere). */
export function wrapWidth(s: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  let w = 0;
  for (const ch of s.replace(/\r/g, '')) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      w = 0;
      continue;
    }
    const cw = displayWidth(ch);
    if (w + cw > width) {
      lines.push(line);
      line = '';
      w = 0;
    }
    line += ch;
    w += cw;
  }
  if (line !== '') lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------
// line-character algebra — junctions emerge from direction bitmask unions
// ---------------------------------------------------------------------------

const UP = 1;
const DOWN = 2;
const LEFT = 4;
const RIGHT = 8;

const LIGHT_BY_MASK: Readonly<Record<number, string>> = {
  [UP]: '│',
  [DOWN]: '│',
  [LEFT]: '─',
  [RIGHT]: '─',
  [UP | DOWN]: '│',
  [LEFT | RIGHT]: '─',
  [DOWN | RIGHT]: '┌',
  [DOWN | LEFT]: '┐',
  [UP | RIGHT]: '└',
  [UP | LEFT]: '┘',
  [UP | DOWN | RIGHT]: '├',
  [UP | DOWN | LEFT]: '┤',
  [DOWN | LEFT | RIGHT]: '┬',
  [UP | LEFT | RIGHT]: '┴',
  [UP | DOWN | LEFT | RIGHT]: '┼',
};

function maskChar(mask: number, heavyHorizontal: boolean, unicode: boolean): string {
  if (!unicode) {
    const hasV = (mask & (UP | DOWN)) !== 0;
    const hasH = (mask & (LEFT | RIGHT)) !== 0;
    if (hasV && hasH) return '+';
    return hasV ? '|' : '-';
  }
  if (heavyHorizontal) {
    if (mask === (LEFT | RIGHT)) return '━';
    if (mask === (UP | DOWN | LEFT | RIGHT)) return '┿';
  }
  return LIGHT_BY_MASK[mask] ?? '┼';
}

// ---------------------------------------------------------------------------
// canvas — a grid of cells that knows how to merge crossing lines
// ---------------------------------------------------------------------------

type Style = 'none' | 'dim' | 'amber' | 'green' | 'red' | 'faint';

/** SGR parameter per style; combined with bold ("1") at emit time. */
const SGR: Readonly<Record<Style, string>> = {
  none: '',
  dim: '2',
  amber: '33',
  green: '32',
  red: '31',
  faint: '90',
};
const ANSI_RESET = '\x1b[0m';

interface Cell {
  /** Literal character (labels, box borders); takes precedence over mask. */
  literal?: string;
  /** Direction bitmask for routed lines. */
  mask: number;
  /** The bar row uses heavy horizontals; crossings become ┿. */
  heavyHorizontal: boolean;
  /** A spotlighted wire cell: emits bright instead of faint. */
  bright: boolean;
  style: Style;
  bold: boolean;
}

/** Junction replacements when a routed line meets a literal border character. */
const BORDER_JUNCTION: Readonly<Record<string, Partial<Record<'up' | 'down', string>>>> = {
  '─': { down: '┬', up: '┴' },
  '╌': { down: '┬', up: '┴' },
  '━': { down: '┯', up: '┷' },
  '-': { down: '+', up: '+' },
  '.': { down: '+', up: '+' },
};

class Canvas {
  private readonly rows: Cell[][] = [];

  private cell(x: number, y: number): Cell {
    while (this.rows.length <= y) this.rows.push([]);
    const row = this.rows[y]!;
    while (row.length <= x) row.push({ mask: 0, heavyHorizontal: false, bright: false, style: 'none', bold: false });
    return row[x]!;
  }

  get height(): number {
    return this.rows.length;
  }

  get width(): number {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }

  /** Write literal text starting at (x, y). Returns the column just past it. */
  text(x: number, y: number, s: string, style: Style, bold = false): number {
    let cx = x;
    for (const ch of s) {
      const c = this.cell(cx, y);
      c.literal = ch;
      c.style = style;
      c.bold = bold;
      const w = charWidth(ch.codePointAt(0)!);
      if (w === 2) {
        // The second column of a wide character is a phantom cell: it must
        // exist so later writes don't overlap, but it emits nothing.
        const phantom = this.cell(cx + 1, y);
        phantom.literal = '';
        phantom.style = style;
      }
      cx += w;
    }
    return cx;
  }

  /** Merge a routed-line direction mask into (x, y). */
  line(x: number, y: number, mask: number, heavyHorizontal = false, bright = false): void {
    const c = this.cell(x, y);
    if (c.literal !== undefined) {
      const junction = BORDER_JUNCTION[c.literal];
      const replacement = mask & DOWN ? junction?.down : mask & UP ? junction?.up : undefined;
      if (replacement !== undefined) c.literal = replacement;
      return; // literals other than borders (labels) are never overdrawn
    }
    c.mask |= mask;
    c.heavyHorizontal = c.heavyHorizontal || heavyHorizontal;
    c.bright = c.bright || bright;
  }

  /**
   * Emit terminal lines, optionally windowed to a viewport. Slicing happens
   * at the cell level so ANSI codes reopen correctly inside the window and a
   * CJK character cut in half at either edge degrades to a space instead of
   * shifting the whole row. Routed wiring (mask cells) emits FAINT — the
   * circuit board recedes, the boxes glow.
   */
  emit(opts: RenderOptions, viewport?: Viewport): string[] {
    const vp = viewport ?? { x: 0, y: 0, width: this.width, height: this.height };
    const out: string[] = [];
    for (let y = vp.y; y < vp.y + vp.height; y++) {
      const row = this.rows[y] ?? [];
      let line = '';
      let open = '';
      const end = Math.min(vp.x + vp.width, row.length);
      for (let x = Math.max(0, vp.x); x < end; x++) {
        const c = row[x]!;
        const isWire = c.literal === undefined && c.mask !== 0;
        let ch = c.literal !== undefined ? c.literal : isWire ? maskChar(c.mask, c.heavyHorizontal, opts.unicode) : ' ';
        if (ch === '') {
          if (x !== Math.max(0, vp.x)) continue; // phantom half inside the window: already emitted
          ch = ' '; // window starts on the right half of a wide character
        } else if (charWidth(ch.codePointAt(0)!) === 2 && x + 1 >= vp.x + vp.width) {
          ch = ' '; // wide character whose right half would spill past the window
        }
        const params =
          ch === ' '
            ? ''
            : isWire
              ? c.bright
                ? '1' // spotlighted wire: bold default color against the faint board
                : SGR.faint
              : [SGR[c.style], c.bold ? '1' : ''].filter(Boolean).join(';');
        if (opts.color && params !== open) {
          line += (open !== '' ? ANSI_RESET : '') + (params !== '' ? `\x1b[${params}m` : '');
          open = params;
        }
        line += ch;
      }
      if (opts.color && open !== '') line += ANSI_RESET;
      out.push(line.replace(/ +$/, ''));
    }
    return out;
  }
}

/**
 * Draw an orthogonal polyline through `points` (consecutive points must share
 * an x or a y). Interior cells of a segment carry the segment's axis mask;
 * every point cell carries only the directions of the segments that actually
 * touch it — so path endpoints become clean junction stubs (e.g. ┬ when
 * entering a box border) and turning points become corner characters, all via
 * the same mask union. Zero-length segments vanish naturally.
 */
function drawPath(canvas: Canvas, points: ReadonlyArray<readonly [number, number]>, bright = false): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[i + 1]!;
    if (x1 === x2 && y1 === y2) continue;
    if (x1 === x2) {
      const [lo, hi] = y1 < y2 ? [y1, y2] : [y2, y1];
      for (let yy = lo + 1; yy < hi; yy++) canvas.line(x1, yy, UP | DOWN, false, bright);
      canvas.line(x1, y1, y2 > y1 ? DOWN : UP, false, bright);
      canvas.line(x1, y2, y2 > y1 ? UP : DOWN, false, bright);
    } else {
      const [lo, hi] = x1 < x2 ? [x1, x2] : [x2, x1];
      for (let xx = lo + 1; xx < hi; xx++) canvas.line(xx, y1, LEFT | RIGHT, false, bright);
      canvas.line(x1, y1, x2 > x1 ? RIGHT : LEFT, false, bright);
      canvas.line(x2, y1, x2 > x1 ? LEFT : RIGHT, false, bright);
    }
  }
}

// ---------------------------------------------------------------------------
// status vocabulary -> visual vocabulary
// ---------------------------------------------------------------------------

const SPINNER_UNICODE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const SPINNER_ASCII = ['|', '/', '-', '\\'] as const;

interface BoxSkin {
  readonly h: string;
  readonly v: string;
  readonly corners: readonly [string, string, string, string]; // tl tr bl br
  readonly style: Style;
}

function skinFor(status: NodeStatus, unicode: boolean): BoxSkin {
  const style: Style =
    status === 'planned' ? 'dim' : status === 'in-progress' ? 'amber' : status === 'done' ? 'green' : 'red';
  if (!unicode) {
    return status === 'planned'
      ? { h: '.', v: ':', corners: ['+', '+', '+', '+'], style }
      : { h: '-', v: '|', corners: ['+', '+', '+', '+'], style };
  }
  switch (status) {
    case 'planned':
      return { h: '╌', v: '╎', corners: ['╭', '╮', '╰', '╯'], style };
    case 'in-progress':
      return { h: '─', v: '│', corners: ['╭', '╮', '╰', '╯'], style };
    case 'done':
    case 'regressed':
      return { h: '━', v: '┃', corners: ['┏', '┓', '┗', '┛'], style };
  }
}

function glyphFor(status: NodeStatus, opts: RenderOptions): string {
  const spinner = opts.unicode ? SPINNER_UNICODE : SPINNER_ASCII;
  switch (status) {
    case 'planned':
      return opts.unicode ? '·' : '.';
    case 'in-progress':
      return spinner[opts.spinnerFrame % spinner.length]!;
    case 'done':
      return opts.unicode ? '■' : '#';
    case 'regressed':
      return opts.unicode ? '✗' : 'X';
  }
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

const BOX_H = 3;
const BOX_GAP = 2;
const LEFT_MARGIN = 2;

/** How one zoom step translates into whitespace geometry; see module header. */
interface ZoomGeometry {
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
}

function zoomGeometry(zoom: ZoomStep): ZoomGeometry {
  switch (zoom) {
    case 1:
      return { mode: 'detail', scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false };
    case 0:
      return { mode: 'boxes', scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false };
    case -1:
      return { mode: 'boxes', scale: 0.85, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false };
    case -2:
      return { mode: 'boxes', scale: 0.7, pad: 0, boxGap: BOX_GAP, breathe: 0, titleGap: 0, barGap: 1, bandCounts: false };
    case -3:
      return { mode: 'boxes', scale: 0.55, pad: 0, boxGap: 1, breathe: 0, titleGap: 0, barGap: 1, bandCounts: true };
    case -4:
      return { mode: 'constellation', scale: 0, pad: 0, boxGap: BOX_GAP, breathe: 0, titleGap: 0, barGap: 1, bandCounts: true };
  }
}

/** In-box rows below the label row (detail mode only). */
interface ExtraRow {
  readonly text: string;
  readonly style: Style;
}

interface BoxLayout {
  readonly node: MapNode;
  readonly x: number;
  readonly w: number;
  readonly h: number;
  /** Label truncated to the zoom's budget; '' in constellation mode. */
  readonly label: string;
  readonly pad: 0 | 1;
  readonly borderless: boolean;
  readonly extra: readonly ExtraRow[];
  /** filled in during vertical layout */
  y: number;
}

const DETAIL_INNER_MIN = 22;
const DETAIL_INNER_MAX = 32;
const DETAIL_NOTE_ROWS = 3;
const LABEL_BUDGET_MIN = 4;

/** Size and content of one node's box under the given zoom geometry. */
function boxSpec(node: MapNode, geo: ZoomGeometry): Omit<BoxLayout, 'node' | 'x' | 'y'> {
  if (geo.mode === 'constellation') {
    return { w: 3, h: 1, label: '', pad: 0, borderless: true, extra: [] };
  }
  if (geo.mode === 'detail') {
    const innerW = Math.min(Math.max(displayWidth(node.label) + 4, DETAIL_INNER_MIN), DETAIL_INNER_MAX);
    const extra: ExtraRow[] = [];
    if (node.evidence !== undefined) extra.push({ text: fitWidth(` ${node.evidence}`, innerW), style: 'faint' });
    if (node.detail !== undefined) {
      const wrapped = wrapWidth(node.detail, innerW - 2);
      for (let i = 0; i < Math.min(wrapped.length, DETAIL_NOTE_ROWS); i++) {
        const cut = i === DETAIL_NOTE_ROWS - 1 && wrapped.length > DETAIL_NOTE_ROWS;
        extra.push({ text: ` ${cut ? fitWidth(wrapped[i]! + '…', innerW - 2) : wrapped[i]!}`, style: 'none' });
      }
    }
    return {
      w: innerW + 2,
      h: BOX_H + extra.length,
      label: fitWidth(node.label, innerW - 4),
      pad: 1,
      borderless: false,
      extra,
    };
  }
  const budget = Math.max(LABEL_BUDGET_MIN, Math.ceil(displayWidth(node.label) * geo.scale));
  const label = fitWidth(node.label, budget);
  return {
    w: displayWidth(label) + 4 + 2 * geo.pad,
    h: BOX_H,
    label,
    pad: geo.pad,
    borderless: false,
    extra: [],
  };
}

interface EdgeRoute {
  readonly fromBox: BoxLayout;
  readonly toBox: BoxLayout;
  readonly fromBand: number;
  readonly toBand: number;
}

/** A horizontal wire segment inside a band gap, packed onto shared rows. */
interface GapSegment {
  readonly route: EdgeRoute;
  readonly kind: 'exit' | 'landing';
  readonly lo: number;
  readonly hi: number;
}

/** Render the whole map as terminal lines. */
export function renderMap(map: MellosMap, opts: RenderOptions): string[] {
  const built = buildCanvas(map, opts);
  return built.canvas.emit(opts);
}

/** Where a node's box sits on the full (unwindowed) picture, for hit testing. */
export interface BoxHit {
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
  const canvas = new Canvas();
  const geo = zoomGeometry(opts.zoom ?? ZOOM_DEFAULT);
  const bands = [...map.layers].sort((a, b) => b.rank - a.rank); // index 0 = top band

  if (bands.length === 0) {
    canvas.text(0, 0, map.title ?? 'mellos mapping', 'none', true);
    canvas.text(0, 2, '(empty map — declare layers and nodes to begin)', 'dim');
    return { canvas, hits: [] };
  }

  // -- horizontal layout: one row of boxes per band --
  const bandIndexOf = new Map<string, number>(bands.map((l, i) => [l.id as string, i]));
  const boxes = new Map<string, BoxLayout>();
  const bandBoxes: BoxLayout[][] = bands.map(() => []);
  for (const node of map.nodes) {
    const band = bandIndexOf.get(node.layer as string)!;
    const row = bandBoxes[band]!;
    const prev = row[row.length - 1];
    const box: BoxLayout = {
      node,
      ...boxSpec(node, geo),
      x: prev ? prev.x + prev.w + geo.boxGap : LEFT_MARGIN,
      y: 0,
    };
    row.push(box);
    boxes.set(node.id as string, box);
  }

  // Band bar labels; at small scales the boxes go mute, so the bars carry
  // the aggregate progress (done/total) for their band instead.
  const bandLabel = bands.map((l, i) => {
    const row = bandBoxes[i]!;
    const done = row.filter((b) => b.node.status === 'done').length;
    return geo.bandCounts && row.length > 0 ? ` ${l.name} ${done}/${row.length}` : ` ${l.name}`;
  });

  let contentWidth = LEFT_MARGIN;
  for (const row of bandBoxes) {
    const last = row[row.length - 1];
    if (last) contentWidth = Math.max(contentWidth, last.x + last.w);
  }
  for (const label of bandLabel) contentWidth = Math.max(contentWidth, LEFT_MARGIN + displayWidth(label) + 7);

  // -- edge analysis (see module header for the routing preference order) --
  const routes: EdgeRoute[] = map.edges.map((e) => {
    const fromBox = boxes.get(e.from as string)!;
    const toBox = boxes.get(e.to as string)!;
    return {
      fromBox,
      toBox,
      fromBand: bandIndexOf.get(fromBox.node.layer as string)!,
      toBand: bandIndexOf.get(toBox.node.layer as string)!,
    };
  });

  // Attach columns already promised on a box's border (either side).
  const claimedColumns = new Map<BoxLayout, Set<number>>();
  const isFree = (box: BoxLayout, x: number): boolean => !(claimedColumns.get(box)?.has(x) ?? false);
  const claim = (box: BoxLayout, x: number): number => {
    let set = claimedColumns.get(box);
    if (!set) claimedColumns.set(box, (set = new Set()));
    set.add(x);
    return x;
  };

  // 1. STRAIGHT edges
  const straightX = new Map<EdgeRoute, number>();
  for (const r of routes) {
    if (r.toBand - r.fromBand !== 1) continue;
    const lo = Math.max(r.fromBox.x + 1, r.toBox.x + 1);
    const hi = Math.min(r.fromBox.x + r.fromBox.w - 2, r.toBox.x + r.toBox.w - 2);
    if (lo > hi) continue; // no vertical overlap — a dogleg is genuinely needed
    const mid = Math.floor((lo + hi) / 2);
    for (let d = 0; d <= hi - lo && !straightX.has(r); d++) {
      for (const x of d === 0 ? [mid] : [mid - d, mid + d]) {
        if (x >= lo && x <= hi && isFree(r.fromBox, x) && isFree(r.toBox, x)) {
          straightX.set(r, claim(r.toBox, claim(r.fromBox, x)));
          break;
        }
      }
    }
  }

  // 2. attach slots for the bent rest, nudged off claimed columns
  const bent = routes.filter((r) => !straightX.has(r));
  const outgoing = new Map<BoxLayout, EdgeRoute[]>();
  const incoming = new Map<BoxLayout, EdgeRoute[]>();
  for (const r of bent) {
    outgoing.set(r.fromBox, [...(outgoing.get(r.fromBox) ?? []), r]);
    incoming.set(r.toBox, [...(incoming.get(r.toBox) ?? []), r]);
  }
  const freeSlot = (box: BoxLayout, k: number, n: number): number => {
    const lo = box.x + 1;
    const hi = box.x + box.w - 2;
    const ideal = box.x + Math.min(box.w - 2, Math.max(1, Math.round(((k + 1) * (box.w - 1)) / (n + 1))));
    for (let d = 0; d <= hi - lo; d++) {
      for (const x of d === 0 ? [ideal] : [ideal - d, ideal + d]) {
        if (x >= lo && x <= hi && isFree(box, x)) return claim(box, x);
      }
    }
    return ideal; // every column claimed (extremely crowded box) — overlap and live with it
  };
  const attach = new Map<EdgeRoute, { sx: number; ex: number }>();
  for (const r of bent) {
    const outs = outgoing.get(r.fromBox)!;
    const ins = incoming.get(r.toBox)!;
    attach.set(r, {
      sx: freeSlot(r.fromBox, outs.indexOf(r), outs.length),
      ex: freeSlot(r.toBox, ins.indexOf(r), ins.length),
    });
  }

  // 3. THREAD descent columns for skip-level edges
  const skipRoutes = bent.filter((r) => r.toBand - r.fromBand > 1);
  const usedDescent = new Set<number>();
  const descentX = new Map<EdgeRoute, number>();
  let fallbackCount = 0;
  const blockedByBox = (band: number, x: number): boolean =>
    bandBoxes[band]!.some((b) => x >= b.x && x <= b.x + b.w - 1);
  for (const r of skipRoutes) {
    const { ex } = attach.get(r)!;
    let chosen: number | undefined;
    for (let d = 0; d <= contentWidth && chosen === undefined; d++) {
      for (const c of d === 0 ? [ex] : [ex - d, ex + d]) {
        if (c < LEFT_MARGIN || c > contentWidth + 1 || usedDescent.has(c)) continue;
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
    descentX.set(r, chosen);
  }
  const totalWidth = fallbackCount > 0 ? contentWidth + 2 + fallbackCount * 2 : contentWidth;

  // 4. pack horizontal segments into shared track rows per gap
  const gapCount = bands.length - 1;
  const gapSegments: GapSegment[][] = Array.from({ length: gapCount }, () => []);
  const segmentOf = new Map<EdgeRoute, { exit?: GapSegment; landing: GapSegment }>();
  for (const r of bent) {
    const { sx, ex } = attach.get(r)!;
    if (r.toBand - r.fromBand === 1) {
      const landing: GapSegment = { route: r, kind: 'landing', lo: Math.min(sx, ex), hi: Math.max(sx, ex) };
      gapSegments[r.toBand - 1]!.push(landing);
      segmentOf.set(r, { landing });
    } else {
      const c = descentX.get(r)!;
      const exit: GapSegment = { route: r, kind: 'exit', lo: Math.min(sx, c), hi: Math.max(sx, c) };
      const landing: GapSegment = { route: r, kind: 'landing', lo: Math.min(c, ex), hi: Math.max(c, ex) };
      gapSegments[r.fromBand]!.push(exit);
      gapSegments[r.toBand - 1]!.push(landing);
      segmentOf.set(r, { exit, landing });
    }
  }
  const segmentRow = new Map<GapSegment, number>();
  const gapRowCount: number[] = gapSegments.map((segments) => {
    const rowEnds: number[] = []; // rightmost occupied column per packed row
    for (const s of [...segments].sort((a, b) => a.lo - b.lo)) {
      let row = rowEnds.findIndex((end) => s.lo > end + 1);
      if (row === -1) {
        rowEnds.push(s.hi);
        row = rowEnds.length - 1;
      } else {
        rowEnds[row] = Math.max(rowEnds[row]!, s.hi);
      }
      segmentRow.set(s, row);
    }
    return rowEnds.length;
  });

  // -- vertical layout --
  let y = 0;
  if (map.title !== undefined) y += 1 + geo.titleGap;
  const barY: number[] = [];
  const gapTrackStartY: number[] = [];
  for (let b = 0; b < bands.length; b++) {
    barY.push(y);
    y += 1 + geo.barGap;
    const row = bandBoxes[b]!;
    for (const box of row) box.y = y;
    y += row.reduce((max, box) => Math.max(max, box.h), geo.mode === 'constellation' ? 1 : BOX_H);
    if (b < gapCount) {
      y += geo.breathe; // breathing row below the boxes
      gapTrackStartY.push(y);
      y += gapRowCount[b]!;
      y += geo.breathe; // breathing row above the next bar
    }
  }
  const legendY = y + 1;
  const rowYOf = (gap: number, s: GapSegment): number => gapTrackStartY[gap]! + segmentRow.get(s)!;

  // -- draw: title, band bars, boxes --
  if (map.title !== undefined) canvas.text(LEFT_MARGIN, 0, map.title, 'none', true);

  for (let b = 0; b < bands.length; b++) {
    const label = bandLabel[b]!;
    for (let x = 0; x < totalWidth; x++) canvas.line(x, barY[b]!, LEFT | RIGHT, true);
    // flush right; only a margin-fallback column pushes it back to the content edge
    const labelStart = (fallbackCount > 0 ? contentWidth : totalWidth) - displayWidth(label);
    canvas.text(labelStart, barY[b]!, label, 'none', true);
  }

  for (const box of boxes.values()) {
    drawBox(canvas, box, opts, opts.focus !== undefined && (box.node.id as string) === opts.focus);
  }

  // -- draw: edges (wires touching the focused node render bright) --
  for (const r of routes) {
    const sy = r.fromBox.y + r.fromBox.h - 1; // bottom border row of the source box
    const ey = r.toBox.y; // top border row of the target box
    const bright =
      opts.focus !== undefined &&
      ((r.fromBox.node.id as string) === opts.focus || (r.toBox.node.id as string) === opts.focus);

    const direct = straightX.get(r);
    if (direct !== undefined) {
      drawPath(
        canvas,
        [
          [direct, sy],
          [direct, ey],
        ],
        bright,
      );
      continue;
    }

    const { sx, ex } = attach.get(r)!;
    const segments = segmentOf.get(r)!;
    const landingY = rowYOf(r.toBand - 1, segments.landing);

    if (r.toBand - r.fromBand === 1) {
      drawPath(
        canvas,
        [
          [sx, sy],
          [sx, landingY],
          [ex, landingY],
          [ex, ey],
        ],
        bright,
      );
    } else {
      const c = descentX.get(r)!;
      const exitY = rowYOf(r.fromBand, segments.exit!);
      drawPath(
        canvas,
        [
          [sx, sy],
          [sx, exitY],
          [c, exitY],
          [c, landingY],
          [ex, landingY],
          [ex, ey],
        ],
        bright,
      );
    }
  }

  // -- legend, each glyph in its real color --
  const legendOpts: RenderOptions = { ...opts, spinnerFrame: 0 };
  let lx = LEFT_MARGIN;
  const legendEntries: ReadonlyArray<readonly [NodeStatus, Style]> = [
    ['planned', 'dim'],
    ['in-progress', 'amber'],
    ['done', 'green'],
    ['regressed', 'red'],
  ];
  for (const [status, style] of legendEntries) {
    if (lx > LEFT_MARGIN) lx = canvas.text(lx, legendY, '   ', 'none');
    lx = canvas.text(lx, legendY, `${glyphFor(status, legendOpts)} ${status}`, style);
  }

  const hits: BoxHit[] = [...boxes.values()].map((b) => ({
    id: b.node.id as string,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
  }));
  return { canvas, hits };
}

function drawBox(canvas: Canvas, box: BoxLayout, opts: RenderOptions, focused = false): void {
  const { node, x, y, w } = box;
  const skin = skinFor(node.status, opts.unicode);

  if (box.borderless) {
    // Constellation mode: the node IS its status glyph. Wires simply end
    // beside it — a glyph is not a border, so no junction chars appear.
    canvas.text(x + 1, y, glyphFor(node.status, opts), skin.style, true);
    return;
  }

  const inner = w - 2;
  const pad = box.pad === 1 ? ' ' : '';
  canvas.text(x, y, skin.corners[0] + skin.h.repeat(inner) + skin.corners[1], skin.style, focused);
  canvas.text(x, y + 1, skin.v, skin.style, focused);
  canvas.text(x + 1, y + 1, `${pad}${glyphFor(node.status, opts)} ${box.label}${pad}`, skin.style, true);
  canvas.text(x + w - 1, y + 1, skin.v, skin.style, focused);
  for (let i = 0; i < box.extra.length; i++) {
    const row = box.extra[i]!;
    const yy = y + 2 + i;
    canvas.text(x, yy, skin.v, skin.style, focused);
    canvas.text(x + 1, yy, row.text, row.style);
    canvas.text(x + w - 1, yy, skin.v, skin.style, focused);
  }
  canvas.text(x, y + box.h - 1, skin.corners[2] + skin.h.repeat(inner) + skin.corners[3], skin.style, focused);
}
