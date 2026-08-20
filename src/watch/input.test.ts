/**
 * Spec for the terminal input parser: plain keys, arrow CSI sequences and
 * SGR mouse reports become semantic events; split escape sequences survive
 * chunk boundaries via `rest`.
 */

import { describe, expect, it } from 'vitest';

import { parseInput } from './input.js';

describe('keyboard', () => {
  it('maps q / Q / Ctrl-C / Ctrl-D to quit and 0 to reset', () => {
    expect(parseInput('q').events).toEqual([{ kind: 'quit' }]);
    expect(parseInput('Q').events).toEqual([{ kind: 'quit' }]);
    expect(parseInput('\x03').events).toEqual([{ kind: 'quit' }]);
    expect(parseInput('\x04').events).toEqual([{ kind: 'quit' }]);
    expect(parseInput('0').events).toEqual([{ kind: 'reset' }]);
  });

  it('maps hjkl and arrow keys to pans of the same steps', () => {
    expect(parseInput('h').events).toEqual([{ kind: 'pan', dx: -4, dy: 0 }]);
    expect(parseInput('\x1b[D').events).toEqual([{ kind: 'pan', dx: -4, dy: 0 }]);
    expect(parseInput('j').events).toEqual([{ kind: 'pan', dx: 0, dy: 2 }]);
    expect(parseInput('\x1b[B').events).toEqual([{ kind: 'pan', dx: 0, dy: 2 }]);
    expect(parseInput('k').events).toEqual([{ kind: 'pan', dx: 0, dy: -2 }]);
    expect(parseInput('l').events).toEqual([{ kind: 'pan', dx: 4, dy: 0 }]);
  });

  it('ignores unknown characters', () => {
    expect(parseInput('zy!').events).toEqual([]);
  });
});

describe('SGR mouse', () => {
  it('parses press, drag and release of the left button', () => {
    expect(parseInput('\x1b[<0;15;7M').events).toEqual([{ kind: 'mouse-down', x: 15, y: 7 }]);
    expect(parseInput('\x1b[<32;18;9M').events).toEqual([{ kind: 'mouse-drag', x: 18, y: 9 }]);
    expect(parseInput('\x1b[<0;18;9m').events).toEqual([{ kind: 'mouse-up', x: 18, y: 9 }]);
  });

  it('parses buttonless motion (any-event tracking) as hover moves', () => {
    expect(parseInput('\x1b[<35;22;4M').events).toEqual([{ kind: 'mouse-move', x: 22, y: 4 }]);
  });

  it('maps a lone Esc byte to clear', () => {
    expect(parseInput('\x1b')).toEqual({ events: [{ kind: 'clear' }], rest: '' });
  });

  it('maps the wheel to zoom steps (up = closer) and shift+wheel to scrolling', () => {
    expect(parseInput('\x1b[<64;5;5M').events).toEqual([{ kind: 'zoom', delta: 1, at: { x: 5, y: 5 } }]);
    expect(parseInput('\x1b[<65;5;5M').events).toEqual([{ kind: 'zoom', delta: -1, at: { x: 5, y: 5 } }]);
    expect(parseInput('\x1b[<68;5;5M').events).toEqual([{ kind: 'pan', dx: 0, dy: -3 }]);
    expect(parseInput('\x1b[<69;5;5M').events).toEqual([{ kind: 'pan', dx: 0, dy: 3 }]);
  });

  it('pans sideways on a horizontal wheel tilt instead of zooming', () => {
    expect(parseInput('\x1b[<66;5;5M').events).toEqual([{ kind: 'pan', dx: -4, dy: 0 }]);
    expect(parseInput('\x1b[<67;5;5M').events).toEqual([{ kind: 'pan', dx: 4, dy: 0 }]);
    expect(parseInput('\x1b[<70;5;5M').events).toEqual([{ kind: 'pan', dx: -4, dy: 0 }]); // shift held
  });

  it('maps + / = / - keys to zoom steps', () => {
    expect(parseInput('+').events).toEqual([{ kind: 'zoom', delta: 1 }]);
    expect(parseInput('=').events).toEqual([{ kind: 'zoom', delta: 1 }]);
    expect(parseInput('-').events).toEqual([{ kind: 'zoom', delta: -1 }]);
  });

  it('maps Backspace to climbing out of a sub-map dive', () => {
    expect(parseInput('\x7f').events).toEqual([{ kind: 'back' }]);
    expect(parseInput('\x08').events).toEqual([{ kind: 'back' }]);
  });

  it('maps f to the auto-follow toggle', () => {
    expect(parseInput('f').events).toEqual([{ kind: 'follow-toggle' }]);
    expect(parseInput('F').events).toEqual([{ kind: 'follow-toggle' }]);
  });

  it('maps x to a page-delete REQUEST, once per press — the parser never counts them', () => {
    expect(parseInput('x').events).toEqual([{ kind: 'delete-page' }]);
    expect(parseInput('X').events).toEqual([{ kind: 'delete-page' }]);
    // two presses in one chunk are two requests; whether the second confirms
    // the first is the reducer's judgement, and it needs a clock this has not
    expect(parseInput('xx').events).toEqual([{ kind: 'delete-page' }, { kind: 'delete-page' }]);
  });

  it('maps Tab / Shift+Tab to page cycling and digits 1-9 to page jumps', () => {
    expect(parseInput('\t').events).toEqual([{ kind: 'next-page' }]);
    expect(parseInput('\x1b[Z').events).toEqual([{ kind: 'prev-page' }]);
    expect(parseInput('1').events).toEqual([{ kind: 'page', index: 0 }]);
    expect(parseInput('9').events).toEqual([{ kind: 'page', index: 8 }]);
    expect(parseInput('0').events).toEqual([{ kind: 'reset' }]); // 0 stays reset
  });

  it('ignores non-left buttons', () => {
    expect(parseInput('\x1b[<2;5;5M').events).toEqual([]); // right button press
    expect(parseInput('\x1b[<34;5;5M').events).toEqual([]); // right button drag
  });

  it('parses a burst of events in one chunk', () => {
    const burst = '\x1b[<0;10;5M\x1b[<32;11;5M\x1b[<32;12;6M\x1b[<0;12;6m';
    expect(parseInput(burst).events.map((e) => e.kind)).toEqual(['mouse-down', 'mouse-drag', 'mouse-drag', 'mouse-up']);
  });
});

describe('keys this pane has no use for', () => {
  it('swallows a complete sequence whole instead of reading its bytes as hotkeys', () => {
    // F2 ends in Q (quit), End in F (follow-toggle), PgUp carries 5 (page 5)
    expect(parseInput('\x1bOQ').events).toEqual([]); // F2
    expect(parseInput('\x1bOP\x1bOR\x1bOS').events).toEqual([]); // F1 F3 F4
    expect(parseInput('\x1b[H').events).toEqual([]); // Home
    expect(parseInput('\x1b[F').events).toEqual([]); // End
    expect(parseInput('\x1b[5~').events).toEqual([]); // PgUp
    expect(parseInput('\x1b[6~').events).toEqual([]); // PgDn
    expect(parseInput('\x1b[2~').events).toEqual([]); // Insert
    expect(parseInput('\x1b[3~').events).toEqual([]); // Delete
    expect(parseInput('\x1b[15~').events).toEqual([]); // F5
    expect(parseInput('\x1b[1;5C').events).toEqual([]); // Ctrl+Right
  });

  it('still reads the very next keypress after one', () => {
    expect(parseInput('\x1b[5~q').events).toEqual([{ kind: 'quit' }]);
  });
});

describe('split escape sequences', () => {
  it('holds an incomplete sequence as rest and completes it on the next chunk', () => {
    const first = parseInput('j\x1b[<32;14');
    expect(first.events).toEqual([{ kind: 'pan', dx: 0, dy: 2 }]);
    expect(first.rest).toBe('\x1b[<32;14');

    const second = parseInput(first.rest + ';6M0');
    expect(second.events).toEqual([{ kind: 'mouse-drag', x: 14, y: 6 }, { kind: 'reset' }]);
    expect(second.rest).toBe('');
  });

  it('holds a bare CSI or SS3 head, which cannot yet be anything else', () => {
    expect(parseInput('\x1b[').rest).toBe('\x1b[');
    expect(parseInput('\x1bO').rest).toBe('\x1bO');
    expect(parseInput('\x1b[1;5').rest).toBe('\x1b[1;5');
  });

  it('reads a trailing ESC as the Esc key, so Esc keeps working afterwards', () => {
    // Held as `rest`, that ESC prefixed the next chunk and every later Esc
    // arrived as ESC ESC — unmatched, and swallowed for the life of the pane.
    const first = parseInput('h\x1b');
    expect(first.events).toEqual([{ kind: 'pan', dx: -4, dy: 0 }, { kind: 'clear' }]);
    expect(first.rest).toBe('');
    expect(parseInput(first.rest + '\x1b').events).toEqual([{ kind: 'clear' }]);
  });
});
