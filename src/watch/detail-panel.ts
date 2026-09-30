/** Width-aware node/group details shared by the compact panel and inspector. */
import type { MellosMap, NodeStatus } from '../domain/types.js';
import { focusInfo, isNeutralKind, kindGlyph, statusGlyph, type NeighborRef } from '../semantics/semantics.js';
import { statusSgr } from '../render/skins.js';
import { fitWidth, wrapWidth } from '../render/width.js';

export interface PanelLine {
  readonly text: string;
  readonly sgr: string; // '' = default color
}

export type DetailSection = 'name' | 'metadata' | 'evidence' | 'uses' | 'usedBy' | 'notes' | 'members';

/** A wrapped inspector line; only actual neighbor/member rows are links. */
export interface DetailLine extends PanelLine {
  readonly section: DetailSection;
  readonly targetId?: string;
}

interface DetailBlock {
  readonly section: DetailSection;
  readonly text: string;
  readonly sgr: string;
}

interface Presentation {
  readonly name: string;
  readonly metadata: string;
  readonly header: string;
  readonly headerSgr: string;
  readonly blocks: readonly DetailBlock[];
  readonly uses: readonly NeighborRef[];
  readonly usedBy: readonly NeighborRef[];
  readonly members?: readonly NeighborRef[];
  readonly usesWord: string;
  readonly usedByWord: string;
}

function presentation(map: MellosMap, focusId: string, unicode: boolean, pinned: boolean): Presentation | undefined {
  const focus = focusInfo(map, focusId);
  if (focus === undefined) return undefined;
  const g = (status: NodeStatus): string => statusGlyph(status, unicode);
  const pin = pinned ? (unicode ? '  ⊙ pinned' : '  * pinned') : '';
  const refText = (ref: NeighborRef): string =>
    `${g(ref.status)} ${ref.label}${ref.edgeLabel !== undefined ? ` (${ref.edgeLabel})` : ''}`;
  const [right, left] = unicode ? ['→', '←'] : ['->', '<-'];
  const [usesWord, usedByWord] = focus.kind === 'node' && map.kind === 'sequence'
    ? ['after', 'before'] : ['uses', 'used by'];
  const wires: DetailBlock[] = [
    { section: 'uses', text: `${usesWord} ${right}  ${focus.uses.map(refText).join('  ') || '—'}`, sgr: '' },
    { section: 'usedBy', text: `${usedByWord} ${left}  ${focus.usedBy.map(refText).join('  ') || '—'}`, sgr: '' },
  ];
  if (focus.kind === 'group') {
    const { group, status, layerName, members } = focus;
    const name = `${g(status)} ${group.label}`;
    const metadata = `[${group.id}] · ${layerName} · ${status} · ${members.length} member(s)`;
    return {
      name, metadata: metadata + pin, header: `${name} ${metadata}${pin}`, headerSgr: `${statusSgr(status)};1`,
      blocks: [
        { section: 'members', text: `members: ${members.map(refText).join('  ') || '—'}`, sgr: '' },
        ...wires,
      ],
      uses: focus.uses, usedBy: focus.usedBy, members, usesWord, usedByWord,
    };
  }
  const { node, layerName, laneLabel } = focus;
  const neutral = isNeutralKind(map);
  const glyph = neutral
    ? (node.kind !== undefined ? kindGlyph(node.kind as string, unicode) : undefined) ?? (unicode ? '·' : '.')
    : g(node.status);
  const name = `${glyph} ${node.label}`;
  const metadata = [
    `[${node.id}]`, layerName,
    ...(laneLabel !== undefined ? [laneLabel] : []),
    ...(node.kind !== undefined ? [node.kind as string] : []),
    ...(neutral ? [] : [node.status]),
    ...(node.submap !== undefined ? [`${unicode ? '⊞' : '+'} ${node.submap}`] : []),
  ].join(' · ');
  return {
    name, metadata: metadata + pin, header: `${name} ${metadata}${pin}`,
    headerSgr: neutral ? '1' : `${statusSgr(node.status)};1`,
    blocks: [
      { section: 'evidence', text: `evidence: ${node.evidence ?? '—'}`, sgr: '90' },
      ...wires,
      { section: 'notes', text: node.detail ?? '(no design notes yet)', sgr: node.detail !== undefined ? '' : '90' },
    ],
    uses: focus.uses, usedBy: focus.usedBy, usesWord, usedByWord,
  };
}

/** Always show the continuation mark, even when the visible row was full. */
function continued(text: string, width: number): string {
  if (!(width >= 1)) return '';
  return fitWidth(text.trimEnd().replace(/…$/, '') + '…', width);
}

/**
 * A fixed-height preview. Each section gets a foothold, then the full name
 * takes priority over metadata and the remaining height expands evidence,
 * both wire directions and notes fairly. Every clipped section says so.
 */
export function nodePanel(
  map: MellosMap,
  focusId: string,
  unicode: boolean,
  width: number,
  pinned: boolean,
  rows: number = 6,
): PanelLine[] | undefined {
  const data = presentation(map, focusId, unicode, pinned);
  if (data === undefined) return undefined;
  const height = Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 0;
  const columns = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  if (height === 0) return [];
  const blocks: DetailBlock[] = [{ section: 'name', text: data.header, sgr: data.headerSgr }, ...data.blocks];
  const wrapped = blocks.map(block => wrapWidth(block.text, columns));
  const quotas = blocks.map((_, index) => index < height ? 1 : 0);
  let extra = Math.max(0, height - blocks.length);
  // Reserve the continuation column while deciding how much space the name
  // needs, so marking hidden metadata cannot shave the last letter off an
  // otherwise complete name when another header row is available.
  const nameRows = wrapWidth(data.name, Math.max(1, columns - 1)).length;
  const nameExtra = Math.min(extra, Math.max(0, nameRows - 1));
  quotas[0]! += nameExtra;
  extra -= nameExtra;
  // Metadata never crowds out the evidence, neighbors or notes. Within those
  // sections, one row per pass prevents a huge evidence paragraph starving all
  // the others when the user drags the divider upwards.
  while (extra > 0) {
    let grew = false;
    for (let index = 1; index < blocks.length && extra > 0; index++) {
      if (quotas[index]! >= wrapped[index]!.length) continue;
      quotas[index]!++;
      extra--;
      grew = true;
    }
    if (!grew) break;
  }
  const metadataExtra = Math.min(extra, Math.max(0, wrapped[0]!.length - quotas[0]!));
  quotas[0]! += metadataExtra;
  const lines: PanelLine[] = [];
  for (const [index, block] of blocks.entries()) {
    const take = quotas[index]!;
    for (let row = 0; row < take; row++) {
      const text = wrapped[index]![row] ?? '';
      lines.push({
        text: row === take - 1 && take < wrapped[index]!.length ? continued(text, columns) : text,
        sgr: block.sgr,
      });
    }
  }
  if (quotas.some(quota => quota === 0) && lines.length > 0) {
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] = { ...last, text: continued(last.text, columns) };
  }
  while (lines.length < height) lines.push({ text: '', sgr: '' });
  return lines;
}

/**
 * Complete, scrollable details. No content is abbreviated; each wrapped link
 * retains its destination so the inspector can hit-test any of its rows.
 */
export function nodeDetailLines(
  map: MellosMap,
  focusId: string,
  unicode: boolean,
  width: number,
  pinned: boolean = false,
): DetailLine[] | undefined {
  const data = presentation(map, focusId, unicode, pinned);
  if (data === undefined) return undefined;
  const lines: DetailLine[] = [];
  const add = (section: DetailSection, text: string, sgr = '', targetId?: string): void => {
    for (const part of wrapWidth(text, width)) {
      lines.push({ text: part, sgr, section, ...(targetId !== undefined ? { targetId } : {}) });
    }
  };
  const heading = (section: DetailSection, text: string): void => {
    lines.push({ text: '', sgr: '', section });
    add(section, text, '1');
  };
  const neighbors = (section: 'uses' | 'usedBy' | 'members', title: string, refs: readonly NeighborRef[]): void => {
    heading(section, `${title} (${refs.length})`);
    if (refs.length === 0) add(section, '—', '90');
    for (const ref of refs) {
      add(section, `${statusGlyph(ref.status, unicode)} ${ref.label} [${ref.id}]${ref.edgeLabel !== undefined ? ` (${ref.edgeLabel})` : ''}`, statusSgr(ref.status), ref.id);
    }
  };
  add('name', data.name, data.headerSgr);
  add('metadata', data.metadata, '90');
  if (data.members !== undefined) neighbors('members', 'Members / 成员', data.members);
  else {
    heading('evidence', 'Evidence / 证据');
    const evidence = data.blocks.find(block => block.section === 'evidence')!;
    add('evidence', evidence.text.slice('evidence: '.length), '90');
  }
  neighbors('uses', data.usesWord === 'after' ? 'After / 之后' : 'Uses / 依赖', data.uses);
  neighbors('usedBy', data.usedByWord === 'before' ? 'Before / 之前' : 'Used by / 被依赖', data.usedBy);
  const notes = data.blocks.find(block => block.section === 'notes');
  if (notes !== undefined) {
    heading('notes', 'Notes / 说明');
    add('notes', notes.text, notes.sgr);
  }
  return lines;
}
