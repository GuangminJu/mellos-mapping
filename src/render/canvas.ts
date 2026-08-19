/**
 * Layer 4a — the drawing surface: a grid of cells that knows how to merge
 * crossing lines, and how to emit itself as terminal rows.
 *
 * Two kinds of ink live in a cell. A LITERAL is a character somebody chose (a
 * label, a box border); a MASK is a set of directions a routed line passes
 * through, and the character comes out of the mask at emit time. That is what
 * makes junctions free: two wires crossing simply union their masks, and ┼
 * appears without anyone routing around anything.
 *
 * The surface knows nothing about maps, statuses or zoom — it takes a Style
 * (the ink palette below) and coordinates, and it is the only place ANSI is
 * produced.
 */

import type { RenderOptions, Viewport } from './options.js';
import { charWidth } from './width.js';

// ---------------------------------------------------------------------------
// ink — the palette every drawing stage paints with
// ---------------------------------------------------------------------------

export type Style = 'none' | 'dim' | 'amber' | 'green' | 'greenDim' | 'red' | 'faint';

/** SGR parameter per style; combined with bold ("1") at emit time. */
export const SGR: Readonly<Record<Style, string>> = {
  none: '',
  dim: '2',
  amber: '33',
  green: '32',
  greenDim: '32;2', // done, but nothing behind the claim: green, not fully lit
  red: '31',
  faint: '90',
};
export const ANSI_RESET = '\x1b[0m';

// ---------------------------------------------------------------------------
// line-character algebra — junctions emerge from direction bitmask unions
// ---------------------------------------------------------------------------

export const UP = 1;
export const DOWN = 2;
export const LEFT = 4;
export const RIGHT = 8;

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

export class Canvas {
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
      const w = charWidth(ch.codePointAt(0)!);
      if (w === 0) {
        // A combining mark, a variation selector or a skin tone takes no
        // column of its own: it rides on the cell it modifies. Given one, it
        // would overwrite the base character and the row would shift left.
        const base = this.cell(Math.max(0, cx - 1), y);
        const target = base.literal === '' ? this.cell(Math.max(0, cx - 2), y) : base; // skip a wide char's phantom half
        target.literal = (target.literal ?? '') + ch;
        continue;
      }
      const c = this.cell(cx, y);
      c.literal = ch;
      c.style = style;
      c.bold = bold;
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
export function drawPath(canvas: Canvas, points: ReadonlyArray<readonly [number, number]>, bright = false): void {
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
