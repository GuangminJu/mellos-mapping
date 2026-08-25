/**
 * Layer 4a — how many terminal columns a string occupies.
 *
 * Everything above this file lays out a grid, and a grid is only as honest as
 * its widths: a label measured one column short shears every row below its
 * box, and one column long leaves a gap no border closes. Labels are DATA —
 * people write Chinese, emoji and accented letters — so this is not a detail
 * of the drawing code but its foundation.
 *
 * The two tables are the Unicode East Asian Width W/F set and the
 * zero-advance set, kept deliberately narrow: everything the standard calls
 * AMBIGUOUS (■ ● ✗ ○ and the rest of this map's own glyph alphabet) stays ONE
 * column, which is what a Western terminal draws.
 *
 * Pure functions of a string; no canvas, no options, no I/O.
 */

const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  // Wide symbols scattered through the BMP — mostly emoji that predate the
  // emoji planes (⌚ ⏰ ⚡ ✅ ✨ ❌ ❓ ⭐ ⬛ …).
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0xa4cf], // CJK radicals .. Yi (covers CJK Unified Ideographs)
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], // pictographs, transport, emoticons (🚀 🎯 😀 …)
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff], // supplemental symbols (🤖 🧱 …)
  [0x1fa70, 0x1faff], // symbols extended-A
  [0x20000, 0x3fffd], // CJK extension planes
];

/** Code points that advance the cursor by nothing at all. */
const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f], // combining diacritical marks (decomposed 'e' + ´)
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x200b, 0x200f], // zero-width space .. RLM, zero-width joiner among them
  [0x20d0, 0x20f0], // combining marks for symbols
  [0xfe00, 0xfe0f], // variation selectors, VS16 (emoji presentation) included
  [0xfe20, 0xfe2f], // combining half marks
  [0x1f3fb, 0x1f3ff], // emoji skin tone modifiers — always applied to a base
];

function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/** Columns one code point occupies: 0 (a mark riding on its base), 1, or 2. */
export function charWidth(cp: number): number {
  if (inRanges(cp, ZERO_WIDTH_RANGES)) return 0;
  return inRanges(cp, WIDE_RANGES) ? 2 : 1;
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
