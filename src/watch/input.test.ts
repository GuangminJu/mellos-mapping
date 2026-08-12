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
    expect(parseInput('zx!').events).toEqual([]);
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

  it('maps the wheel to vertical pans and shift+wheel to horizontal', () => {
    expect(parseInput('\x1b[<64;5;5M').events).toEqual([{ kind: 'pan', dx: 0, dy: -3 }]);
    expect(parseInput('\x1b[<65;5;5M').events).toEqual([{ kind: 'pan', dx: 0, dy: 3 }]);
    expect(parseInput('\x1b[<68;5;5M').events).toEqual([{ kind: 'pan', dx: -6, dy: 0 }]);
    expect(parseInput('\x1b[<69;5;5M').events).toEqual([{ kind: 'pan', dx: 6, dy: 0 }]);
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

describe('split escape sequences', () => {
  it('holds an incomplete sequence as rest and completes it on the next chunk', () => {
    const first = parseInput('j\x1b[<32;14');
    expect(first.events).toEqual([{ kind: 'pan', dx: 0, dy: 2 }]);
    expect(first.rest).toBe('\x1b[<32;14');

    const second = parseInput(first.rest + ';6M0');
    expect(second.events).toEqual([{ kind: 'mouse-drag', x: 14, y: 6 }, { kind: 'reset' }]);
    expect(second.rest).toBe('');
  });

  it('holds a bare CSI head (but a lone ESC is the Esc key, handled above)', () => {
    expect(parseInput('\x1b[').rest).toBe('\x1b[');
    expect(parseInput('j\x1b').rest).toBe('\x1b'); // trailing ESC mid-stream still buffers
  });
});
