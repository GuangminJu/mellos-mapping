/**
 * Layer 4b support — pure parsing of terminal input into pan/quit events.
 *
 * The watcher enables xterm SGR mouse tracking (CSI ?1002h + ?1006h), so
 * stdin carries a mix of plain keys, arrow-key CSI sequences and SGR mouse
 * reports like `\x1b[<32;14;6M`. This module turns a chunk of that stream
 * into semantic events and hands back any trailing incomplete escape
 * sequence, so a sequence split across two reads is never mangled.
 *
 * Pure string -> events; no process, no terminal state.
 */

export type InputEvent =
  | { readonly kind: 'quit' }
  | { readonly kind: 'reset' }
  /** Pan the VIEW by a delta (keyboard / wheel). */
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number }
  /** Left button pressed at terminal cell (1-based). */
  | { readonly kind: 'mouse-down'; readonly x: number; readonly y: number }
  /** Motion while the left button is held. */
  | { readonly kind: 'mouse-drag'; readonly x: number; readonly y: number }
  | { readonly kind: 'mouse-up' };

export interface ParsedInput {
  readonly events: InputEvent[];
  /** Trailing bytes that might be the head of a split escape sequence. */
  readonly rest: string;
}

const KEY_H_STEP = 4;
const KEY_V_STEP = 2;
const WHEEL_V_STEP = 3;
const WHEEL_H_STEP = 6;

// SGR mouse button code bit layout
const MOTION = 32;
const WHEEL = 64;
const SHIFT = 4;
const BUTTON_BITS = 3;

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const ARROW = /^\x1b\[([ABCD])/;
/** A prefix that could still grow into a sequence we understand. */
const PARTIAL_ESCAPE = /(?:\x1b|\x1b\[|\x1b\[<[\d;]*)$/;

const ARROW_PAN: Readonly<Record<string, { dx: number; dy: number }>> = {
  A: { dx: 0, dy: -KEY_V_STEP },
  B: { dx: 0, dy: KEY_V_STEP },
  C: { dx: KEY_H_STEP, dy: 0 },
  D: { dx: -KEY_H_STEP, dy: 0 },
};

const KEY_PAN: Readonly<Record<string, { dx: number; dy: number }>> = {
  k: { dx: 0, dy: -KEY_V_STEP },
  j: { dx: 0, dy: KEY_V_STEP },
  l: { dx: KEY_H_STEP, dy: 0 },
  h: { dx: -KEY_H_STEP, dy: 0 },
};

function mouseEvent(code: number, x: number, y: number, final: string): InputEvent | undefined {
  if (code & WHEEL) {
    const direction = code & 1 ? 1 : -1; // 65/69 = wheel down, 64/68 = wheel up
    return code & SHIFT
      ? { kind: 'pan', dx: direction * WHEEL_H_STEP, dy: 0 }
      : { kind: 'pan', dx: 0, dy: direction * WHEEL_V_STEP };
  }
  if (final === 'm') return { kind: 'mouse-up' };
  if ((code & BUTTON_BITS) !== 0) return undefined; // only the left button pans
  return code & MOTION ? { kind: 'mouse-drag', x, y } : { kind: 'mouse-down', x, y };
}

/** Parse one stdin chunk (prepend the previous call's `rest`). */
export function parseInput(chunk: string): ParsedInput {
  const events: InputEvent[] = [];
  let i = 0;
  while (i < chunk.length) {
    const slice = chunk.slice(i);

    const mouse = SGR_MOUSE.exec(slice);
    if (mouse) {
      const event = mouseEvent(Number(mouse[1]), Number(mouse[2]), Number(mouse[3]), mouse[4]!);
      if (event) events.push(event);
      i += mouse[0].length;
      continue;
    }

    const arrow = ARROW.exec(slice);
    if (arrow) {
      const pan = ARROW_PAN[arrow[1]!]!;
      events.push({ kind: 'pan', ...pan });
      i += arrow[0].length;
      continue;
    }

    const partial = PARTIAL_ESCAPE.exec(slice);
    if (partial && partial.index === 0) {
      return { events, rest: slice }; // incomplete sequence — wait for more bytes
    }

    const ch = chunk[i]!;
    if (ch === 'q' || ch === 'Q' || ch === '\x03' || ch === '\x04') events.push({ kind: 'quit' });
    else if (ch === '0') events.push({ kind: 'reset' });
    else if (KEY_PAN[ch]) events.push({ kind: 'pan', ...KEY_PAN[ch]! });
    // anything else (including unknown escape sequences' stray bytes) is ignored
    i += 1;
  }
  return { events, rest: '' };
}
