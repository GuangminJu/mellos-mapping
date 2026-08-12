/**
 * Layer 4 (presentation) — pure rendering of a MellosMap to terminal lines.
 *
 * Shared by the MCP `mmap_view` tool (monochrome) and the split-pane watcher
 * (colored, animated). Pure function of (map, options): no I/O, no clock —
 * animation is driven by the caller passing a spinner frame index.
 *
 * Visual language:
 *   rank 0 renders at the BOTTOM of the picture, matching the mental model
 *   "primitives are the ground". Every band is introduced by a full-width
 *   bar carrying its name; dependency lines only ever travel downward.
 *
 *   planned      dashed dim box, glyph '·'   — a ghost: designed, not built
 *   in-progress  light amber box, spinner    — where attention currently is
 *   done         heavy green box, glyph '■'  — built and verified
 *   regressed    heavy red box, glyph '✗'    — was done, foundation cracked
 *
 * Layout is deliberately primitive (one row of boxes per band; skip-level
 * edges routed along the right margin). Edge crossings merge into proper
 * junction characters via a direction-bitmask union instead of any routing
 * cleverness.
 */

import type { MapNode, MellosMap, NodeStatus } from '../domain/types.js';

export interface RenderOptions {
  /** Emit ANSI color codes. */
  readonly color: boolean;
  /** Use box-drawing characters; false falls back to pure ASCII. */
  readonly unicode: boolean;
  /** Spinner frame index for in-progress nodes; caller advances it over time. */
  readonly spinnerFrame: number;
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

type Style = 'none' | 'dim' | 'amber' | 'green' | 'red';

const ANSI: Readonly<Record<Style, string>> = {
  none: '',
  dim: '\x1b[2m',
  amber: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
};
const ANSI_RESET = '\x1b[0m';

interface Cell {
  /** Literal character (labels, box borders); takes precedence over mask. */
  literal?: string;
  /** Direction bitmask for routed lines. */
  mask: number;
  /** The bar row uses heavy horizontals; crossings become ┿. */
  heavyHorizontal: boolean;
  style: Style;
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
    while (row.length <= x) row.push({ mask: 0, heavyHorizontal: false, style: 'none' });
    return row[x]!;
  }

  /** Write literal text starting at (x, y). */
  text(x: number, y: number, s: string, style: Style): void {
    let cx = x;
    for (const ch of s) {
      const c = this.cell(cx, y);
      c.literal = ch;
      c.style = style;
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
  }

  /** Merge a routed-line direction mask into (x, y). */
  line(x: number, y: number, mask: number, heavyHorizontal = false): void {
    const c = this.cell(x, y);
    if (c.literal !== undefined) {
      const junction = BORDER_JUNCTION[c.literal];
      const replacement = mask & DOWN ? junction?.down : mask & UP ? junction?.up : undefined;
      if (replacement !== undefined) c.literal = replacement;
      return; // literals other than borders (labels) are never overdrawn
    }
    c.mask |= mask;
    c.heavyHorizontal = c.heavyHorizontal || heavyHorizontal;
  }

  emit(opts: RenderOptions): string[] {
    return this.rows.map((row) => {
      let out = '';
      let open: Style = 'none';
      for (const c of row) {
        const ch =
          c.literal !== undefined ? c.literal : c.mask !== 0 ? maskChar(c.mask, c.heavyHorizontal, opts.unicode) : ' ';
        if (ch === '') continue; // phantom half of a wide character
        const style = ch === ' ' ? 'none' : c.style;
        if (opts.color && style !== open) {
          out += (open !== 'none' ? ANSI_RESET : '') + ANSI[style];
          open = style;
        }
        out += ch;
      }
      if (opts.color && open !== 'none') out += ANSI_RESET;
      return out.replace(/ +$/, '');
    });
  }
}

/**
 * Draw an orthogonal polyline through `points` (consecutive points must share
 * an x or a y). Interior cells of a segment carry the segment's axis mask;
 * every point cell carries only the directions of the segments that actually
 * touch it — so path endpoints become clean junction stubs (e.g. ┬ when
 * entering a box border) and turning points become corner characters, all via
 * the same mask union.
 */
function drawPath(canvas: Canvas, points: ReadonlyArray<readonly [number, number]>): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[i + 1]!;
    if (x1 === x2 && y1 === y2) continue;
    if (x1 === x2) {
      const [lo, hi] = y1 < y2 ? [y1, y2] : [y2, y1];
      for (let yy = lo + 1; yy < hi; yy++) canvas.line(x1, yy, UP | DOWN);
      canvas.line(x1, y1, y2 > y1 ? DOWN : UP);
      canvas.line(x1, y2, y2 > y1 ? UP : DOWN);
    } else {
      const [lo, hi] = x1 < x2 ? [x1, x2] : [x2, x1];
      for (let xx = lo + 1; xx < hi; xx++) canvas.line(xx, y1, LEFT | RIGHT);
      canvas.line(x1, y1, x2 > x1 ? RIGHT : LEFT);
      canvas.line(x2, y1, x2 > x1 ? LEFT : RIGHT);
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
      return { h: '╌', v: '╎', corners: ['┌', '┐', '└', '┘'], style };
    case 'in-progress':
      return { h: '─', v: '│', corners: ['┌', '┐', '└', '┘'], style };
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

interface BoxLayout {
  readonly node: MapNode;
  readonly x: number;
  readonly w: number;
  /** filled in during vertical layout */
  y: number;
}

interface EdgeRoute {
  readonly fromBox: BoxLayout;
  readonly toBox: BoxLayout;
  readonly fromBand: number;
  readonly toBand: number;
}

/** Render the map as terminal lines. The only public entry point. */
export function renderMap(map: MellosMap, opts: RenderOptions): string[] {
  const canvas = new Canvas();
  const bands = [...map.layers].sort((a, b) => b.rank - a.rank); // index 0 = top band

  if (bands.length === 0) {
    canvas.text(0, 0, map.title ?? 'mellos mapping', 'none');
    canvas.text(0, 2, '(empty map — declare layers and nodes to begin)', 'dim');
    return canvas.emit(opts);
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
      x: prev ? prev.x + prev.w + BOX_GAP : LEFT_MARGIN,
      w: displayWidth(node.label) + 6, // borders + padding + glyph
      y: 0,
    };
    row.push(box);
    boxes.set(node.id as string, box);
  }

  // -- edge analysis --
  // Every edge's horizontal segment lives on its own row ("track") inside the
  // gap directly above the target band; skip-level edges additionally get a
  // jog track in the gap below their source band, from which they travel to a
  // private column on the right margin and descend outside all content.
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
  const gapCount = bands.length - 1;
  const exitTracks: EdgeRoute[][] = Array.from({ length: gapCount }, () => []);
  const landingTracks: EdgeRoute[][] = Array.from({ length: gapCount }, () => []);
  const skipRoutes: EdgeRoute[] = [];
  for (const r of routes) {
    landingTracks[r.toBand - 1]!.push(r);
    if (r.toBand - r.fromBand > 1) {
      exitTracks[r.fromBand]!.push(r);
      skipRoutes.push(r);
    }
  }

  // -- vertical layout --
  let y = 0;
  if (map.title !== undefined) y += 2; // title row + blank
  const barY: number[] = [];
  const landingY = new Map<EdgeRoute, number>();
  const jogY = new Map<EdgeRoute, number>();
  for (let b = 0; b < bands.length; b++) {
    barY.push(y);
    y += 2; // bar + blank
    for (const box of bandBoxes[b]!) box.y = y;
    y += BOX_H;
    if (b < gapCount) {
      y += 1; // breathing row below the boxes
      for (const r of exitTracks[b]!) jogY.set(r, y++);
      for (const r of landingTracks[b]!) landingY.set(r, y++);
      y += 1; // breathing row above the next bar
    }
  }
  const legendY = y + 1;

  // -- content width, then private margin columns for skip-level descents --
  let contentWidth = LEFT_MARGIN;
  for (const row of bandBoxes) {
    const last = row[row.length - 1];
    if (last) contentWidth = Math.max(contentWidth, last.x + last.w);
  }
  for (const l of bands) contentWidth = Math.max(contentWidth, LEFT_MARGIN + displayWidth(l.name) + 8);
  const marginX = new Map<EdgeRoute, number>(skipRoutes.map((r, i) => [r, contentWidth + 2 + i * 2]));
  const totalWidth = contentWidth + 2 + skipRoutes.length * 2;

  // -- draw: title, band bars, boxes --
  if (map.title !== undefined) canvas.text(LEFT_MARGIN, 0, map.title, 'none');

  for (let b = 0; b < bands.length; b++) {
    const label = ` ${bands[b]!.name} `;
    for (let x = 0; x < totalWidth; x++) canvas.line(x, barY[b]!, LEFT | RIGHT, true);
    // The label ends at the content edge so it can never cover the margin
    // columns where skip-level edges descend.
    canvas.text(contentWidth - displayWidth(label), barY[b]!, label, 'none');
  }

  for (const box of boxes.values()) drawBox(canvas, box, opts);

  // -- draw: edges --
  // Attach slots spread a node's edges across its border; distinct boxes
  // occupy distinct column spans, so slots never collide across boxes.
  const outgoing = new Map<BoxLayout, EdgeRoute[]>();
  const incoming = new Map<BoxLayout, EdgeRoute[]>();
  for (const r of routes) {
    outgoing.set(r.fromBox, [...(outgoing.get(r.fromBox) ?? []), r]);
    incoming.set(r.toBox, [...(incoming.get(r.toBox) ?? []), r]);
  }
  const slot = (box: BoxLayout, k: number, n: number): number =>
    box.x + Math.min(box.w - 2, Math.max(1, Math.round(((k + 1) * (box.w - 1)) / (n + 1))));

  for (const r of routes) {
    const outs = outgoing.get(r.fromBox)!;
    const ins = incoming.get(r.toBox)!;
    const sx = slot(r.fromBox, outs.indexOf(r), outs.length);
    const ex = slot(r.toBox, ins.indexOf(r), ins.length);
    const sy = r.fromBox.y + BOX_H - 1; // bottom border row of the source box
    const ey = r.toBox.y; // top border row of the target box
    const landing = landingY.get(r)!;

    if (r.toBand - r.fromBand === 1) {
      drawPath(canvas, [
        [sx, sy],
        [sx, landing],
        [ex, landing],
        [ex, ey],
      ]);
    } else {
      const jog = jogY.get(r)!;
      const mx = marginX.get(r)!;
      drawPath(canvas, [
        [sx, sy],
        [sx, jog],
        [mx, jog],
        [mx, landing],
        [ex, landing],
        [ex, ey],
      ]);
    }
  }

  // -- legend --
  // The legend is a key, not an animation: its in-progress glyph stays on
  // frame 0 no matter what the boxes are doing.
  const legendOpts: RenderOptions = { ...opts, spinnerFrame: 0 };
  const legend = [
    `${glyphFor('planned', legendOpts)} planned`,
    `${glyphFor('in-progress', legendOpts)} in-progress`,
    `${glyphFor('done', legendOpts)} done`,
    `${glyphFor('regressed', legendOpts)} regressed`,
  ].join('   ');
  canvas.text(LEFT_MARGIN, legendY, legend, 'dim');

  return canvas.emit(opts);
}

function drawBox(canvas: Canvas, box: BoxLayout, opts: RenderOptions): void {
  const { node, x, y, w } = box;
  const skin = skinFor(node.status, opts.unicode);
  const inner = w - 2;

  canvas.text(x, y, skin.corners[0] + skin.h.repeat(inner) + skin.corners[1], skin.style);
  canvas.text(x, y + 1, skin.v + ` ${glyphFor(node.status, opts)} ${node.label} `, skin.style);
  canvas.text(x + w - 1, y + 1, skin.v, skin.style);
  canvas.text(x, y + 2, skin.corners[2] + skin.h.repeat(inner) + skin.corners[3], skin.style);
}
