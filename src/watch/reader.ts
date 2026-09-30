/** In-memory reading screens. They never modify the map or its graph viewport. */
import type { MellosMap } from '../domain/types.js';
import { focusInfo, statusGlyph } from '../semantics/semantics.js';
import { fitWidth, wrapWidth } from '../render/width.js';
import { statusSgr } from '../render/skins.js';
import { nodeDetailLines, type PanelLine } from './detail-panel.js';
import type { InputEvent } from './input.js';

export type ReaderPage =
  | { readonly kind: 'nodes' }
  | { readonly kind: 'groups' }
  | { readonly kind: 'group' | 'node'; readonly id: string };
interface ReaderPosition {
  readonly page: ReaderPage;
  readonly scroll: number;
  readonly selected: string | undefined;
}
export interface ReaderState extends ReaderPosition {
  readonly history: readonly ReaderPosition[];
  readonly press: { readonly x: number; readonly y: number; readonly moved: boolean } | undefined;
}
export interface ReaderLine extends PanelLine { readonly targetId?: string }
export interface ReaderContent {
  readonly lines: readonly ReaderLine[];
  readonly links: readonly string[];
}
export function openReader(page: ReaderPage, previous?: ReaderState): ReaderState {
  return { page, scroll: 0, selected: undefined, press: undefined,
    history: previous === undefined ? [] : [...previous.history, {
      page: previous.page, scroll: previous.scroll, selected: previous.selected,
    }] };
}
export function readerBack(state: ReaderState): ReaderState | undefined {
  const previous = state.history.at(-1);
  return previous === undefined ? undefined : { ...previous, history: state.history.slice(0, -1), press: undefined };
}
const wrap = (text: string, width: number, sgr = '', targetId?: string): ReaderLine[] =>
  wrapWidth(text, Math.max(2, width)).map(text => ({ text, sgr, ...(targetId === undefined ? {} : { targetId }) }));

/** Full labels and IDs remain readable at every width; scrolling never truncates content. */
export function readerContent(map: MellosMap, page: ReaderPage, unicode: boolean, width: number): ReaderContent {
  let lines: ReaderLine[];
  if (page.kind === 'node') {
    lines = nodeDetailLines(map, page.id, unicode, width) ??
      wrap(`This node was removed: [${page.id}]. Back returns to the previous view.`, width);
  } else if (page.kind === 'groups') {
    lines = [...wrap(`Groups / 分组 (${map.groups.length})`, width, '1'), { text: '', sgr: '' }];
    for (const group of map.groups) {
      const info = focusInfo(map, group.id);
      if (info?.kind !== 'group') continue;
      lines.push(...wrap(`${statusGlyph(info.status, unicode)} ${group.label} [${group.id}] · ${info.members.length} members`,
        width, `${statusSgr(info.status)};1`, group.id), { text: '', sgr: '' });
    }
    if (map.groups.length === 0) lines.push(...wrap('No groups declared. Press n for the full node list.', width));
  } else {
    const group = page.kind === 'group' ? map.groups.find(group => group.id === page.id) : undefined;
    const nodes = page.kind === 'group' ? map.nodes.filter(node => node.group === page.id) : map.nodes;
    const title = page.kind === 'nodes' ? `Nodes / 节点 (${nodes.length})`
      : group === undefined ? `Group removed: [${page.id}]` : `${group.label} [${group.id}] · ${nodes.length} members`;
    lines = [...wrap(title, width, '1'), { text: '', sgr: '' }];
    for (const node of nodes) {
      const layer = map.layers.find(layer => layer.id === node.layer)?.name ?? node.layer;
      lines.push(...wrap(`${statusGlyph(node.status, unicode)} ${node.label} [${node.id}]`, width, `${statusSgr(node.status)};1`, node.id),
        ...wrap(`  ${layer} · ${node.status}`, width, '', node.id), { text: '', sgr: '' });
    }
    if (nodes.length === 0) lines.push(...wrap('No members remain. Press n for all nodes.', width));
  }
  return { lines, links: [...new Set(lines.flatMap(line => line.targetId === undefined ? [] : [line.targetId]))] };
}
export function readerScroll(state: ReaderState, content: ReaderContent, height: number): number {
  return Math.min(Math.max(0, state.scroll), Math.max(0, content.lines.length - Math.max(1, height)));
}
export function readerRows(state: ReaderState, content: ReaderContent, width: number, height: number, color: boolean, notice = ''): string[] {
  const bodyHeight = Math.max(1, height - 2);
  const scroll = readerScroll(state, content, bodyHeight);
  const selected = content.links.includes(state.selected ?? '') ? state.selected : content.links[0];
  const rows = [fitWidth(`[Back] [Overview] ${Math.min(scroll + 1, content.lines.length)}-${Math.min(scroll + bodyHeight, content.lines.length)}/${content.lines.length}`, width)];
  for (let index = 0; index < bodyHeight; index++) {
    const line = content.lines[scroll + index];
    if (line === undefined) { rows.push(''); continue; }
    const isSelected = line.targetId !== undefined && line.targetId === selected;
    const text = `${isSelected ? '>' : ' '} ${line.text}`;
    rows.push(color && (isSelected || line.sgr !== '') ? `\x1b[${isSelected ? '7' : line.sgr}m${text}\x1b[0m` : text);
  }
  rows.push(fitWidth(notice === '' ? '↑↓ scroll · Tab/Enter links · Esc back' : `! STALE: ${notice}`, width));
  return rows.slice(0, height);
}

/** Every reader key is consumed here, so graph shortcuts and gestures cannot leak. */
export function readerInput(state: ReaderState, event: InputEvent, map: MellosMap, unicode: boolean,
  width: number, height: number): { state: ReaderState | undefined; overview?: true } {
  const content = readerContent(map, state.page, unicode, Math.max(2, width - 2));
  const bodyHeight = Math.max(1, height - 2);
  const scroll = readerScroll(state, content, bodyHeight);
  const current = { ...state, scroll, selected: content.links.includes(state.selected ?? '') ? state.selected : content.links[0] };
  const boundedScroll = (value: number): number => Math.min(Math.max(0, value), Math.max(0, content.lines.length - bodyHeight));
  const enter = (id: string | undefined): ReaderState => id === undefined ? current : openReader({
    kind: map.groups.some(group => group.id === id) ? 'group' : 'node', id,
  }, { ...current, selected: id });
  switch (event.kind) {
    case 'clear': case 'back': return { state: readerBack(current) };
    case 'overview': return { state: undefined, overview: true };
    case 'nodes': return { state: openReader({ kind: 'nodes' }, current) };
    case 'groups': return { state: openReader({ kind: 'groups' }, current) };
    case 'pan': return { state: { ...current, scroll: boundedScroll(scroll + event.dy) } };
    case 'zoom': return { state: event.at === undefined ? current : { ...current, scroll: boundedScroll(scroll - event.delta * 3) } };
    case 'next-page': case 'prev-page': {
      if (content.links.length === 0) return { state: current };
      const index = Math.max(0, content.links.indexOf(current.selected ?? content.links[0]!));
      const selected = content.links[(index + (event.kind === 'next-page' ? 1 : -1) + content.links.length) % content.links.length]!;
      const line = content.lines.findIndex(line => line.targetId === selected);
      return { state: { ...current, selected, scroll: line < scroll || line >= scroll + bodyHeight ? boundedScroll(line) : scroll } };
    }
    case 'activate': return { state: enter(current.selected ?? content.links[0]) };
    case 'mouse-down': return { state: { ...current, press: { x: event.x, y: event.y, moved: false } } };
    case 'mouse-drag': return { state: { ...current, press: current.press === undefined ? undefined : { ...current.press, moved: true } } };
    case 'mouse-up': {
      const press = current.press;
      const released = { ...current, press: undefined };
      if (press === undefined || press.moved || event.x !== press.x || event.y !== press.y) return { state: released };
      if (event.y === 1 && event.x <= 6) return { state: readerBack(released) };
      if (event.y === 1 && event.x >= 8 && event.x <= 17) return { state: undefined, overview: true };
      if (event.y < 2 || event.y > height - 1) return { state: released };
      return { state: enter(content.lines[scroll + event.y - 2]?.targetId) };
    }
    default: return { state: current };
  }
}
