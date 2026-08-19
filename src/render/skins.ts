/**
 * Layer 4a — the status vocabulary as this medium wears it.
 *
 * The GLYPHS are the map's shared alphabet and live in ../semantics; what a
 * TERMINAL owns is decided here and only here: which border repertoire a
 * status draws with, and which SGR color it burns. One table, so the pane's
 * chrome (tab strip, panel header) and the picture's boxes cannot drift
 * apart — the pane reads statusSgr from this very file.
 */

import type { MapNode, MellosMap, NodeStatus } from '../domain/types.js';
import { kindGlyph, spinnerGlyph, statusGlyph, unverifiedDoneGlyph } from '../semantics/semantics.js';
import { SGR, type Style } from './canvas.js';
import type { RenderOptions } from './options.js';

export interface BoxSkin {
  readonly h: string;
  readonly v: string;
  readonly corners: readonly [string, string, string, string]; // tl tr bl br
  readonly style: Style;
}

/**
 * What a box paints for its status. `done` has two FACES, because the ledger
 * has a rule about it ("no evidence, no done") that the picture could not
 * show: a node built and verified and a node merely declared done were the
 * same solid green square at every zoom. This is not a fifth status —
 * evidence is a property of a node, and whether it exists is presentation.
 */
export type StatusFace = NodeStatus | 'done-unverified';

/** The color role a status face wears in a terminal. */
export function styleFor(face: StatusFace): Style {
  switch (face) {
    case 'planned':
      return 'dim';
    case 'in-progress':
      return 'amber';
    case 'done':
      return 'green';
    case 'done-unverified':
      return 'greenDim';
    case 'regressed':
      return 'red';
  }
}

/**
 * SGR parameters of a status' skin, for terminal chrome painted outside the
 * canvas (a tab strip, a panel header). The pane's chrome and the picture's
 * boxes therefore wear one palette by construction, not by a second table.
 */
export function statusSgr(status: NodeStatus): string {
  return SGR[styleFor(status)];
}

export function skinFor(face: StatusFace, unicode: boolean): BoxSkin {
  const style = styleFor(face);
  if (!unicode) {
    return face === 'planned'
      ? { h: '.', v: ':', corners: ['+', '+', '+', '+'], style }
      : { h: '-', v: '|', corners: ['+', '+', '+', '+'], style };
  }
  switch (face) {
    case 'planned':
      return { h: '╌', v: '╎', corners: ['╭', '╮', '╰', '╯'], style };
    case 'in-progress':
      return { h: '─', v: '│', corners: ['╭', '╮', '╰', '╯'], style };
    // an unverified done keeps the heavy border of done — it is the same
    // claim, told with a hollow glyph and a dimmer green
    case 'done':
    case 'done-unverified':
    case 'regressed':
      return { h: '━', v: '┃', corners: ['┏', '┓', '┗', '┛'], style };
  }
}

/**
 * The glyph a node shows for its status face. A terminal box CAN animate, so
 * in-progress spins through the shared frames; every other face is a shared
 * static glyph.
 */
export function glyphFor(face: StatusFace, opts: RenderOptions): string {
  if (face === 'in-progress') return spinnerGlyph(opts.spinnerFrame, opts.unicode);
  return face === 'done-unverified' ? unverifiedDoneGlyph(opts.unicode) : statusGlyph(face, opts.unicode);
}

/** Plain solid box for documentation diagrams — presence, not progress. */
export function neutralSkin(unicode: boolean): BoxSkin {
  return unicode
    ? { h: '─', v: '│', corners: ['╭', '╮', '╰', '╯'], style: 'none' }
    : { h: '-', v: '|', corners: ['+', '+', '+', '+'], style: 'none' };
}

/** The glyph slot of a box on a documentation page: the KIND, or a bullet. */
export function neutralGlyph(node: MapNode, unicode: boolean): string {
  return (
    (node.kind !== undefined ? kindGlyph(node.kind as string, unicode) : undefined) ?? (unicode ? '·' : '.')
  );
}

/**
 * Ids of the boxes whose `done` has nothing behind it.
 *
 * Computed against the map as DECLARED, not as drawn: an aggregated group box
 * carries no evidence field of its own, and reading that absence literally
 * would paint every grouped far-zoom view as unverified. A group is exactly
 * as backed as the members it stands for.
 */
export function unverifiedDoneIds(declared: MellosMap, drawn: MellosMap): Set<string> {
  const out = new Set<string>();
  const declaredById = new Map(declared.nodes.map((n) => [n.id as string, n]));
  for (const node of drawn.nodes) {
    if (node.status !== 'done') continue;
    const own = declaredById.get(node.id as string);
    if (own !== undefined) {
      if (own.evidence === undefined) out.add(node.id as string);
    } else if (
      declared.nodes.some(
        (m) => (m.group as string | undefined) === (node.id as string) && m.status === 'done' && m.evidence === undefined,
      )
    ) {
      out.add(node.id as string); // a group box stands for a member nobody verified
    }
  }
  return out;
}
