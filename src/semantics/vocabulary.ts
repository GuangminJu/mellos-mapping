/**
 * Layer 1c — the medium-neutral VISUAL VOCABULARY of a map.
 *
 * A status and a node kind each have ONE agreed glyph. Not because glyphs are
 * semantics — they are not — but because they are the map's shared alphabet:
 * the terminal picture, the pane's tab strip and detail panel, and a browser
 * view all show the same map to the same person, and a status that reads ⠿ in
 * one place and ◐ in another is a lie about the map being one thing. The
 * table lived in three files and had already drifted; it lives here now, and
 * every medium reads it.
 *
 * What stays with each renderer is what its medium OWNS: SGR parameters and
 * cell geometry in the terminal, CSS and SVG in a browser. This module has no
 * colors, no cells, no DOM, no I/O — and no node:* imports, so it loads in a
 * browser as-is (see ../browser-safe.test.ts).
 *
 * Exported through ./semantics.js so consumers keep one import site.
 */

import type { NodeStatus } from '../domain/types.js';

/**
 * Status -> [unicode, ascii] glyph, both display width 1.
 *
 * The in-progress glyph is the braille spinner AT REST: a surface that cannot
 * animate (a tab, a panel line, a static page) shows the settled form of the
 * same shape the animated boxes cycle through, so one status still reads as
 * one thing across media.
 */
export const STATUS_GLYPHS: Readonly<Record<NodeStatus, readonly [unicode: string, ascii: string]>> = {
  planned: ['·', '.'],
  'in-progress': ['⠿', '*'],
  done: ['■', '#'],
  regressed: ['✗', 'X'],
};

/**
 * The glyph a status shows where nothing animates.
 * @param unicode - false selects the ASCII fallback for terminals that cannot
 *   draw the box-drawing/braille repertoire.
 */
export function statusGlyph(status: NodeStatus, unicode: boolean): string {
  const [uni, ascii] = STATUS_GLYPHS[status];
  return unicode ? uni : ascii;
}

/**
 * The glyph a DONE node wears when nothing was recorded to back the claim.
 *
 * "No evidence, no done" is the fourth rule of the ledger, and until now the
 * picture could not say when it was broken: a done node with a test run
 * behind it and a done node with nothing behind it were the same solid
 * square. The hollow square is deliberately the SAME SHAPE — this is still
 * done, just not filled in — so it reads as a degree of done, not as a fifth
 * status. There is no fifth status: evidence is a property of a node, and
 * whether it exists is presentation, not structure.
 */
export const UNVERIFIED_DONE_GLYPHS: readonly [unicode: string, ascii: string] = ['□', 'o'];

/** The glyph for a done node with no evidence; see {@link UNVERIFIED_DONE_GLYPHS}. */
export function unverifiedDoneGlyph(unicode: boolean): string {
  const [uni, ascii] = UNVERIFIED_DONE_GLYPHS;
  return unicode ? uni : ascii;
}

/**
 * Animation frames for in-progress work, per repertoire. The caller owns the
 * clock: it advances a frame index and this module maps it to a glyph, so
 * every animated surface spins at whatever rate its medium can paint while
 * showing the same shapes.
 */
export const SPINNER_FRAMES: Readonly<Record<'unicode' | 'ascii', readonly string[]>> = {
  unicode: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  ascii: ['|', '/', '-', '\\'],
};

/**
 * One spinner frame.
 * @param frame - any integer; it wraps, negatives included, so a caller's
 *   clock never has to be normalized before it is used.
 */
export function spinnerGlyph(frame: number, unicode: boolean): string {
  const frames = SPINNER_FRAMES[unicode ? 'unicode' : 'ascii'];
  return frames[((frame % frames.length) + frames.length) % frames.length]!;
}

/**
 * Known node kinds -> [unicode, ascii] glyphs (all display width 1).
 * Behavior trees, dataflow and architecture vocabularies; an unknown kind
 * renders without a glyph and stays readable in a detail panel.
 */
export const NODE_KIND_GLYPHS: Readonly<Record<string, readonly [string, string]>> = {
  selector: ['?', '?'],
  sequence: ['»', '>'],
  parallel: ['‖', '='],
  decorator: ['◌', 'o'],
  condition: ['◇', 'c'],
  action: ['·', '.'],
  source: ['○', 'o'],
  transform: ['◐', '%'],
  sink: ['●', '*'],
  service: ['◆', 'S'],
  db: ['▤', 'D'],
  queue: ['≣', 'Q'],
  ui: ['▣', 'U'],
};

/**
 * Glyph for a node kind, or undefined for the open vocabulary's unknown kinds.
 *
 * VIOLATION: no-primitive-obsession - `kind` is a raw string where NodeKind
 * exists. NodeKind is an OPEN vocabulary by design (the domain accepts any
 * slug; this table knows thirteen of them), so the brand carries no
 * information this function could use — it answers undefined for anything it
 * does not know, branded or not. Requiring NodeKind would only force every
 * caller reading `node.kind` to unwrap and re-wrap it, and would not let a
 * single wrong call through any less.
 */
export function kindGlyph(kind: string, unicode: boolean): string | undefined {
  const pair = NODE_KIND_GLYPHS[kind];
  return pair === undefined ? undefined : unicode ? pair[0] : pair[1];
}
