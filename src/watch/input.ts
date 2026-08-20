/**
 * Layer 4b support — pure parsing of terminal input into semantic events
 * (pan, zoom, mouse, quit).
 *
 * The watcher enables xterm any-event mouse tracking (CSI ?1003h + ?1006h),
 * so stdin carries a mix of plain keys, arrow-key CSI sequences and SGR mouse
 * reports like `\x1b[<32;14;6M`. This module turns a chunk of that stream
 * into semantic events and hands back any trailing incomplete escape
 * sequence, so a sequence split across two reads is never mangled.
 *
 * Two rules keep a key this parser does NOT know from acting like one it
 * does:
 *
 *   1. A COMPLETE escape sequence is always consumed whole, even when it
 *      means nothing here. A terminal sends far more than arrows — F1-F4 as
 *      `ESC O P..S`, Home/End as `ESC [ H/F`, PgUp/PgDn/Ins/Del and F5+ as
 *      `ESC [ <n> ~`, modified arrows as `ESC [ 1;5 C`. Letting those fall
 *      through to the single-character scanner meant their payload bytes were
 *      read as hotkeys: F2 quit the pane, End toggled auto-follow, PgUp
 *      jumped to page 5 and turned auto-follow off.
 *   2. A lone trailing ESC is the Esc KEY, not a sequence head. Terminals
 *      deliver an escape sequence in one write, so an ESC with nothing after
 *      it is a keypress. Holding it as `rest` instead — the old behavior —
 *      prefixed the NEXT chunk with it, and every later Esc arrived as
 *      `ESC ESC`, matched nothing, and was swallowed for the life of the
 *      pane. Only a sequence head that cannot be anything else (`ESC [`,
 *      `ESC O`, `ESC [ <params>`) waits for more bytes.
 *
 * Pure string -> events; no process, no terminal state.
 */

export type InputEvent =
  | { readonly kind: 'quit' }
  | { readonly kind: 'reset' }
  /** Esc: clear the pinned selection. */
  | { readonly kind: 'clear' }
  /** Pan the VIEW by a delta (keyboard / shift+wheel). */
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number }
  /**
   * One step on the zoom ladder (wheel / +/- keys); +1 = closer. A wheel
   * event carries the cell it happened over (`at`), so the watcher can
   * route a wheel on the tab strip to strip browsing; keyboard zoom
   * has no position.
   */
  | { readonly kind: 'zoom'; readonly delta: 1 | -1; readonly at?: { readonly x: number; readonly y: number } }
  /** Cycle pages: Tab forward, Shift+Tab back. */
  | { readonly kind: 'next-page' }
  | { readonly kind: 'prev-page' }
  /** Jump straight to a page by number key 1-9 (0-based index). */
  | { readonly kind: 'page'; readonly index: number }
  /** Backspace: climb back out of a sub-map dive. */
  | { readonly kind: 'back' }
  /** f: toggle auto-follow (pane switches to the page last written). */
  | { readonly kind: 'follow-toggle' }
  /**
   * x: delete the page on screen — the request, not the deed. It takes two
   * of these to remove a file; the second-press rule lives in the pane's
   * reducer (./pane-state.ts), because a parser has no clock and no state.
   */
  | { readonly kind: 'delete-page' }
  /** Left button pressed at terminal cell (1-based). */
  | { readonly kind: 'mouse-down'; readonly x: number; readonly y: number }
  /** Motion while the left button is held. */
  | { readonly kind: 'mouse-drag'; readonly x: number; readonly y: number }
  /** Motion with no button held (any-event tracking) — hover. */
  | { readonly kind: 'mouse-move'; readonly x: number; readonly y: number }
  | { readonly kind: 'mouse-up'; readonly x: number; readonly y: number };

export interface ParsedInput {
  readonly events: InputEvent[];
  /** Trailing bytes that might be the head of a split escape sequence. */
  readonly rest: string;
}

const KEY_H_STEP = 4;
const KEY_V_STEP = 2;
const WHEEL_V_STEP = 3;
const WHEEL_H_STEP = 4;

// SGR mouse button code bit layout
const MOTION = 32;
const WHEEL = 64;
const SHIFT = 4;
const BUTTON_BITS = 3;
/** Wheel direction within a wheel report: 0 up, 1 down, 2 left, 3 right. */
const WHEEL_BITS = 3;

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const ARROW = /^\x1b\[([ABCD])/;
const SHIFT_TAB = /^\x1b\[Z/;
/**
 * Any COMPLETE control sequence: CSI (`ESC [` params intermediates final) and
 * SS3 (`ESC O` final), per ECMA-48. Whatever the specific matchers above did
 * not claim is consumed by these and dropped — see rule 1 in the header.
 */
const CSI_SEQUENCE = /^\x1b\[[0-9;:<=>?]*[ -/]*[@-~]/;
const SS3_SEQUENCE = /^\x1bO[@-~]/;
/** A sequence head that cannot be anything else yet — wait for more bytes. */
const PARTIAL_ESCAPE = /^(?:\x1b\[[0-9;:<=>?]*[ -/]*|\x1bO)$/;

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
    // 64/65 = wheel up/down, 66/67 = tilt left/right (+4 with shift held).
    // Reading bit 0 alone made a horizontal tilt zoom the picture: a sideways
    // nudge of the wheel jumped the whole map a zoom step.
    switch (code & WHEEL_BITS) {
      case 0:
      case 1: {
        const down = (code & 1) !== 0;
        return code & SHIFT
          ? { kind: 'pan', dx: 0, dy: (down ? 1 : -1) * WHEEL_V_STEP } // shift+wheel scrolls
          : { kind: 'zoom', delta: down ? -1 : 1, at: { x, y } }; // plain wheel zooms; up = closer
      }
      default: {
        const right = (code & 1) !== 0;
        return { kind: 'pan', dx: (right ? 1 : -1) * WHEEL_H_STEP, dy: 0 };
      }
    }
  }
  const buttons = code & BUTTON_BITS;
  if (final === 'm') return buttons === 0 ? { kind: 'mouse-up', x, y } : undefined;
  if (code & MOTION) {
    if (buttons === 3) return { kind: 'mouse-move', x, y }; // no button held — hover
    if (buttons === 0) return { kind: 'mouse-drag', x, y };
    return undefined;
  }
  return buttons === 0 ? { kind: 'mouse-down', x, y } : undefined; // only the left button interacts
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

    const shiftTab = SHIFT_TAB.exec(slice);
    if (shiftTab) {
      events.push({ kind: 'prev-page' });
      i += shiftTab[0].length;
      continue;
    }

    // Any other complete sequence: consumed whole, meaning nothing. Its
    // payload bytes must never reach the key scanner below (header rule 1).
    const sequence = CSI_SEQUENCE.exec(slice) ?? SS3_SEQUENCE.exec(slice);
    if (sequence) {
      i += sequence[0].length;
      continue;
    }

    if (PARTIAL_ESCAPE.test(slice)) {
      return { events, rest: slice }; // incomplete sequence — wait for more bytes
    }

    const ch = chunk[i]!;
    if (ch === '\x1b') events.push({ kind: 'clear' }); // a bare ESC is the Esc key (header rule 2)
    else if (ch === 'q' || ch === 'Q' || ch === '\x03' || ch === '\x04') events.push({ kind: 'quit' });
    else if (ch === '0') events.push({ kind: 'reset' });
    else if (ch === '+' || ch === '=') events.push({ kind: 'zoom', delta: 1 });
    else if (ch === '-') events.push({ kind: 'zoom', delta: -1 });
    else if (ch === '\t') events.push({ kind: 'next-page' });
    else if (ch === '\x7f' || ch === '\x08') events.push({ kind: 'back' });
    else if (ch === 'f' || ch === 'F') events.push({ kind: 'follow-toggle' });
    else if (ch === 'x' || ch === 'X') events.push({ kind: 'delete-page' });
    else if (ch >= '1' && ch <= '9') events.push({ kind: 'page', index: ch.charCodeAt(0) - '1'.charCodeAt(0) });
    else if (KEY_PAN[ch]) events.push({ kind: 'pan', ...KEY_PAN[ch]! });
    // any other single character is ignored; sequence payloads never get here
    i += 1;
  }
  return { events, rest: '' };
}
