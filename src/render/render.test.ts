/**
 * Spec for Layer 4 rendering.
 *
 * Structural assertions pin the visual contract (alignment, junctions,
 * animation, ASCII fallback); one snapshot pins the whole picture of a
 * representative map as the living example of the visual language.
 */

import { describe, expect, it } from 'vitest';

import { declareGroup, declareLane, declareLayer, declareNode, linkNodes, setKind, setTitle, updateNode } from '../domain/ops.js';
import {
  EMPTY_MAP,
  type GroupId,
  type LaneId,
  type LayerId,
  type MapKind,
  type MellosMap,
  type NodeId,
  type NodeKind,
  type Result,
} from '../domain/types.js';
import { type ZoomStep, clampZoom, displayWidth, renderMap, renderMapWindow, zoomLabel } from './render.js';

function must<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}
const lid = (s: string): LayerId => s as LayerId;
const nid = (s: string): NodeId => s as NodeId;
const gid = (s: string): GroupId => s as GroupId;
const laid = (s: string): LaneId => s as LaneId;

const MONO = { color: false, unicode: true, spinnerFrame: 0 } as const;

/** The map of this very plugin, mid-development — the canonical sample. */
function sampleMap(): MellosMap {
  let map = setTitle(EMPTY_MAP, '梅勒斯地图 · mellos-mapping 插件');
  map = must(declareLayer(map, { id: lid('primitives'), name: '原语层', rank: 0 }));
  map = must(declareLayer(map, { id: lid('contracts'), name: '契约层', rank: 1 }));
  map = must(declareLayer(map, { id: lid('orchestration'), name: '编排层', rank: 2 }));
  map = must(declareNode(map, { id: nid('domain'), label: '图领域模型', layer: lid('primitives'), status: 'done' }));
  map = must(declareNode(map, { id: nid('render'), label: 'ASCII渲染', layer: lid('primitives'), status: 'in-progress' }));
  map = must(declareNode(map, { id: nid('store'), label: '状态存储', layer: lid('contracts'), status: 'done' }));
  map = must(declareNode(map, { id: nid('watch'), label: 'Watcher', layer: lid('contracts'), status: 'planned' }));
  map = must(declareNode(map, { id: nid('server'), label: 'MCP Server', layer: lid('orchestration'), status: 'planned' }));
  map = must(updateNode(map, { id: nid('domain'), evidence: 'vitest 23 passed' }));
  map = must(updateNode(map, { id: nid('domain'), detail: '结构不变量的唯一持有者：层全序、边严格向下，无环是推论。' }));
  map = must(linkNodes(map, nid('store'), nid('domain')));
  map = must(linkNodes(map, nid('watch'), nid('render')));
  map = must(linkNodes(map, nid('server'), nid('store')));
  map = must(linkNodes(map, nid('server'), nid('watch')));
  map = must(linkNodes(map, nid('server'), nid('domain'))); // skip-level edge
  return map;
}

describe('displayWidth', () => {
  it('counts CJK characters as two columns', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('地图')).toBe(4);
    expect(displayWidth('图a图')).toBe(5);
    expect(displayWidth('⠋')).toBe(1); // braille spinner is narrow
  });
});

describe('renderMap', () => {
  it('renders the canonical sample (visual spec)', () => {
    expect(renderMap(sampleMap(), MONO).join('\n')).toMatchSnapshot();
  });

  it('keeps CJK-labelled boxes rectangular', () => {
    const lines = renderMap(sampleMap(), MONO);
    const top = lines.find((l) => l.includes('┏'))!;
    const body = lines.find((l) => l.includes('状态存储'))!;
    const boxStart = top.indexOf('┏');
    const boxEnd = top.indexOf('┓');
    expect(displayWidth(body.slice(body.indexOf('┃'), body.lastIndexOf('┃') + 1))).toBe(
      displayWidth(top.slice(boxStart, boxEnd + 1)),
    );
  });

  it('puts rank 0 at the bottom and higher ranks above', () => {
    const text = renderMap(sampleMap(), MONO).join('\n');
    expect(text.indexOf('编排层')).toBeLessThan(text.indexOf('契约层'));
    expect(text.indexOf('契约层')).toBeLessThan(text.indexOf('原语层'));
  });

  it('draws junctions where edges leave and enter boxes', () => {
    const text = renderMap(sampleMap(), MONO).join('\n');
    expect(text).toContain('┬'); // edge leaving a light bottom border
    expect(text).toContain('┷'); // edge entering a heavy (done) top border
    expect(text).toContain('┿'); // edge crossing a band bar
  });

  it('animates the spinner with the frame index and only there', () => {
    const f0 = renderMap(sampleMap(), MONO).join('\n');
    const f1 = renderMap(sampleMap(), { ...MONO, spinnerFrame: 1 }).join('\n');
    expect(f0).toContain('⠋');
    expect(f1).toContain('⠙');
    expect(f0.replace('⠋', '')).toBe(f1.replace('⠙', ''));
  });

  it('falls back to pure ASCII structure when unicode is off', () => {
    const text = renderMap(sampleMap(), { ...MONO, unicode: false }).join('\n');
    // Data (title, labels) may contain any characters; the STRUCTURE must not:
    // no box-drawing, block, geometric, dingbat or braille glyphs remain.
    const structural = [...text].filter((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp >= 0x2500 && cp <= 0x28ff;
    });
    expect(structural).toEqual([]);
    expect(text).toContain('# 状态存储'); // done glyph in ASCII
  });

  it('emits ANSI codes only when color is on', () => {
    expect(renderMap(sampleMap(), MONO).join('\n')).not.toContain('\x1b[');
    const colored = renderMap(sampleMap(), { ...MONO, color: true }).join('\n');
    expect(colored).toContain('\x1b[32m'); // green for done
    expect(colored).toContain('\x1b[0m');
  });

  it('explains itself when the map is empty', () => {
    const text = renderMap(EMPTY_MAP, MONO).join('\n');
    expect(text).toContain('declare layers and nodes');
  });

  it('windows the picture: slice matches the full render, extent enables clamping', () => {
    const full = renderMap(sampleMap(), MONO);
    const windowed = renderMapWindow(sampleMap(), MONO, { x: 0, y: 2, width: 200, height: 3 });
    expect(windowed.lines).toEqual(full.slice(2, 5).map((l) => l.replace(/ +$/, '')));
    expect(windowed.contentHeight).toBe(full.length);
    expect(windowed.contentWidth).toBeGreaterThanOrEqual(Math.max(...full.map((l) => displayWidth(l))));
    expect(renderMapWindow(sampleMap(), MONO, { x: 4, y: 0, width: 10, height: 2 }).lines[0]!.length).toBeLessThanOrEqual(
      10,
    );
  });

  it('degrades a CJK character cut at the window edge to a space instead of shifting the row', () => {
    // '状态存储' starts after '┃ ■ ' inside its box; slicing one column into
    // the first ideograph must yield a space, and every emitted line must
    // still fit the window width.
    const full = renderMap(sampleMap(), MONO);
    const rowIndex = full.findIndex((l) => l.includes('状态存储'));
    const col = full[rowIndex]!.indexOf('状'); // string index == column here (all narrow before it)
    const cut = renderMapWindow(sampleMap(), MONO, { x: col + 1, y: rowIndex, width: 20, height: 1 });
    expect(cut.lines[0]!.startsWith(' ')).toBe(true); // right half of 状 became a space
    expect(cut.lines[0]!).toContain('态存储');
    for (const line of cut.lines) expect(displayWidth(line)).toBeLessThanOrEqual(20);
  });

  it('reopens ANSI styles inside a window', () => {
    const full = renderMap(sampleMap(), { ...MONO, color: true });
    const greenRow = full.findIndex((l) => l.includes('状态存储'));
    const windowed = renderMapWindow(
      sampleMap(),
      { ...MONO, color: true },
      { x: 4, y: greenRow, width: 40, height: 1 },
    );
    // The window starts INSIDE the green box: the color must be reopened
    // and every opened style must be closed again within the line.
    expect(windowed.lines[0]).toContain('32m');
    const codes = windowed.lines[0]!.match(/\x1b\[[\d;]+m/g) ?? [];
    expect(codes.filter((c) => c !== '\x1b[0m').length).toBe(codes.filter((c) => c === '\x1b[0m').length);
  });

  it('draws a straight vertical when the two boxes overlap — no pointless dogleg', () => {
    let map = EMPTY_MAP;
    map = must(declareLayer(map, { id: lid('base'), name: 'Base', rank: 0 }));
    map = must(declareLayer(map, { id: lid('top'), name: 'Top', rank: 1 }));
    map = must(declareNode(map, { id: nid('core'), label: 'CoreModule', layer: lid('base'), status: 'done' }));
    map = must(declareNode(map, { id: nid('shell'), label: 'Shell', layer: lid('top'), status: 'done' }));
    map = must(linkNodes(map, nid('shell'), nid('core')));

    const text = renderMap(map, MONO).join('\n');
    for (const corner of ['┌', '┐', '└', '┘']) expect(text).not.toContain(corner);
    expect(text).toContain('┯'); // straight exit through the heavy bottom border
    expect(text).toContain('┷'); // straight entry through the heavy top border
  });

  it('gives parallel edges between overlapping boxes distinct columns', () => {
    let map = EMPTY_MAP;
    map = must(declareLayer(map, { id: lid('base'), name: 'Base', rank: 0 }));
    map = must(declareLayer(map, { id: lid('top'), name: 'Top', rank: 1 }));
    map = must(declareNode(map, { id: nid('wide'), label: 'WideFoundation', layer: lid('base'), status: 'done' }));
    map = must(declareNode(map, { id: nid('a'), label: 'A', layer: lid('top'), status: 'done' }));
    map = must(declareNode(map, { id: nid('b'), label: 'B', layer: lid('top'), status: 'done' }));
    map = must(linkNodes(map, nid('a'), nid('wide')));
    map = must(linkNodes(map, nid('b'), nid('wide')));

    const lines = renderMap(map, MONO);
    const foundationTop = lines.find((l) => l.includes('┷'))!;
    expect([...foundationTop].filter((ch) => ch === '┷')).toHaveLength(2); // both landed, different columns
  });

  it('reports node hit regions matching the picture', () => {
    const { hits, lines } = renderMapWindow(sampleMap(), MONO, { x: 0, y: 0, width: 200, height: 100 });
    expect(hits).toHaveLength(sampleMap().nodes.length);
    const store = hits.find((h) => h.id === 'store')!;
    // the label really sits inside the reported rectangle
    const labelRow = lines[store.y + 1]!;
    expect(labelRow).toContain('状态存储');
    expect(store.h).toBe(3);
  });

  it('spotlights the focused node and its wires in color mode', () => {
    const plain = renderMap(sampleMap(), { ...MONO, color: true }).join('\n');
    const focused = renderMap(sampleMap(), { ...MONO, color: true, focus: 'domain' }).join('\n');
    expect(focused).not.toBe(plain); // wires touching domain brightened
    // monochrome output is unaffected by focus
    expect(renderMap(sampleMap(), { ...MONO, focus: 'domain' }).join('\n')).toBe(renderMap(sampleMap(), MONO).join('\n'));
  });

  it('zoom 0 IS the default view — the ladder does not disturb the standard picture', () => {
    expect(renderMap(sampleMap(), { ...MONO, zoom: 0 }).join('\n')).toBe(renderMap(sampleMap(), MONO).join('\n'));
  });

  it('scales the picture down step by step, boxes staying boxes (no early mode switch)', () => {
    const barWidth = (zoom: ZoomStep): number =>
      Math.max(...renderMap(sampleMap(), { ...MONO, zoom }).filter((l) => l.includes('━')).map(displayWidth));
    expect(barWidth(-1)).toBeLessThan(barWidth(0));
    expect(barWidth(-2)).toBeLessThan(barWidth(-1));
    expect(barWidth(-3)).toBeLessThan(barWidth(-2));
    const height = (zoom: ZoomStep): number => renderMap(sampleMap(), { ...MONO, zoom }).length;
    expect(height(-2)).toBeLessThan(height(0));
    for (const zoom of [-1, -2, -3] as const) {
      const text = renderMap(sampleMap(), { ...MONO, zoom }).join('\n');
      expect(text).toContain('┏'); // done boxes still have borders
      expect(text).toContain('…'); // labels truncated, not dropped
    }
  });

  it('aggregates into labeled group boxes at the far zoom when groups exist', () => {
    let map = sampleMap();
    map = must(declareGroup(map, { id: gid('ground'), label: '地基子系统', layer: lid('primitives') }));
    map = must(updateNode(map, { id: nid('domain'), group: gid('ground') }));
    map = must(updateNode(map, { id: nid('render'), group: gid('ground') }));

    const lines = renderMap(map, { ...MONO, zoom: -4 });
    const text = lines.join('\n');
    expect(text).toContain('地基子系统 1/2'); // one member done, one spinning
    expect(text).toContain('⠋ 地基子系统'); // derived status: a member spins, the group spins
    expect(text).toContain('┏'); // NOT the anonymous constellation — labeled boxes
    expect(text).toContain('状态存储'); // ungrouped nodes stay themselves
    // edges collapsed onto the group: store->domain and server->domain (skip)
    // plus watch->render all land on ONE box now, deduped where equal
    const { hits } = renderMapWindow(map, { ...MONO, zoom: -4 }, { x: 0, y: 0, width: 0, height: 0 });
    expect(hits.some((h) => h.id === 'ground')).toBe(true); // the group is hoverable
    expect(hits.some((h) => h.id === 'domain')).toBe(false); // members are inside it
    expect(text).toMatchSnapshot();
  });

  it('switches to the glyph constellation only at the far end of the ladder', () => {
    const lines = renderMap(sampleMap(), { ...MONO, zoom: -4 });
    const text = lines.join('\n');
    for (const border of ['┏', '┓', '┃', '╭', '╮', '╎']) expect(text).not.toContain(border);
    expect(text).not.toContain('状态存储'); // labels are gone entirely...
    expect(text).toContain('■'); // ...the status glyphs are the nodes
    expect(text).toContain('·');
    expect(text).toContain('⠋');
    // band bars take over the progress numbers the boxes can no longer show
    expect(text).toContain('原语层 1/2');
    expect(text).toContain('编排层 0/1');
    expect(text).toMatchSnapshot();
  });

  it('unfolds evidence and design notes inside the boxes at detail zoom', () => {
    const text = renderMap(sampleMap(), { ...MONO, zoom: 1 }).join('\n');
    expect(text).toContain('vitest 23 passed');
    // the notes wrap inside the box, so assert per-row fragments
    expect(text).toContain('结构不变量');
    expect(text).toContain('无环是推论');
    expect(text).toMatchSnapshot();
  });

  it('reports hit regions matching each zoom mode geometry', () => {
    const at = (zoom: ZoomStep): readonly { id: string; h: number }[] =>
      renderMapWindow(sampleMap(), { ...MONO, zoom }, { x: 0, y: 0, width: 0, height: 0 }).hits;
    for (const h of at(-4)) expect(h.h).toBe(1); // constellation glyphs
    const detail = at(1);
    expect(detail.find((h) => h.id === 'domain')!.h).toBeGreaterThan(3); // evidence + notes unfolded
    expect(detail.find((h) => h.id === 'watch')!.h).toBe(3); // nothing to unfold
  });

  it('clamps zoom steps and names every rung of the ladder', () => {
    expect(clampZoom(5)).toBe(1);
    expect(clampZoom(-9)).toBe(-4);
    expect(clampZoom(0.4)).toBe(0);
    for (const zoom of [-4, -3, -2, -1, 0, 1] as const) expect(zoomLabel(zoom)).not.toBe('');
    expect(zoomLabel(0)).toBe('100%');
    expect(zoomLabel(-4)).toBe('overview');
    expect(zoomLabel(1)).toBe('detail');
  });

  it('threads skip-level edges between boxes instead of detouring to the margin', () => {
    const lines = renderMap(sampleMap(), MONO);
    // no margin corridor needed: no wiring or box renders wider than the band
    // bars (the legend row is prose, not part of the circuit)
    const barWidth = Math.max(...lines.filter((l) => l.includes('━')).map((l) => displayWidth(l)));
    for (const line of lines.filter((l) => !l.includes('planned'))) {
      expect(displayWidth(line)).toBeLessThanOrEqual(barWidth);
    }
    // the wire passes BETWEEN the contract boxes without corrupting either
    const contractsBody = lines.find((l) => l.includes('状态存储'))!;
    expect(contractsBody).toContain('■ 状态存储');
    expect(contractsBody).toContain('· Watcher');
    // both the straight edge and the threaded skip edge land on the foundation
    const groundBar = lines.findIndex((l) => l.includes('原语层'));
    const domainTop = lines.slice(groundBar).find((l) => l.includes('┏'))!;
    expect([...domainTop].filter((ch) => ch === '┷')).toHaveLength(2);
  });
});

describe('diagram kinds', () => {
  /** A tiny behavior tree: root selector over two actions. */
  function behaviorTree(): MellosMap {
    let map = setTitle(EMPTY_MAP, '巡逻行为树');
    map = setKind(map, 'behavior-tree' as MapKind);
    map = must(declareLayer(map, { id: lid('leaves'), name: '叶子', rank: 0 }));
    map = must(declareLayer(map, { id: lid('root'), name: '根', rank: 1 }));
    map = must(declareNode(map, { id: nid('walk'), label: '走向路点', layer: lid('leaves'), kind: 'action' as NodeKind }));
    map = must(declareNode(map, { id: nid('rest'), label: '原地休息', layer: lid('leaves'), kind: 'action' as NodeKind }));
    map = must(declareNode(map, { id: nid('pick'), label: '选择', layer: lid('root'), kind: 'selector' as NodeKind }));
    map = must(linkNodes(map, nid('pick'), nid('walk')));
    map = must(linkNodes(map, nid('pick'), nid('rest')));
    return map;
  }

  it('neutral kinds drop status skins: solid plain boxes, kind glyph in the slot', () => {
    const text = renderMap(behaviorTree(), MONO).join('\n');
    expect(text).toContain('? 选择'); // selector glyph takes the status slot
    expect(text).toContain('· 走向路点'); // action glyph
    expect(text).not.toContain('╌'); // no ghost dashes on a neutral page
    expect(text).not.toContain('planned'); // no status legend
    expect(text).toContain('behavior-tree'); // kind legend instead
    expect(text).toContain('? selector');
  });

  it('the same nodes on a dev page keep status skins and prefix the kind glyph to the label', () => {
    const { kind: _dropped, ...devMap } = behaviorTree();
    const text = renderMap(devMap, MONO).join('\n');
    expect(text).toContain('· ? 选择'); // planned glyph, then selector glyph in the label
    expect(text).toContain('planned'); // status legend is back
  });

  it('lanes align members under their column across bands and draw headers', () => {
    let map = setTitle(EMPTY_MAP, '登录时序');
    map = setKind(map, 'sequence' as MapKind);
    map = must(declareLayer(map, { id: lid('t0'), name: '第1步', rank: 0 }));
    map = must(declareLayer(map, { id: lid('t1'), name: '第2步', rank: 1 }));
    map = must(declareLane(map, { id: laid('client'), label: '客户端' }));
    map = must(declareLane(map, { id: laid('server'), label: '服务端' }));
    map = must(declareNode(map, { id: nid('req'), label: '发起登录', layer: lid('t0'), lane: laid('client') }));
    map = must(declareNode(map, { id: nid('check'), label: '校验凭证', layer: lid('t1'), lane: laid('server') }));
    map = must(declareNode(map, { id: nid('show'), label: '显示结果', layer: lid('t1'), lane: laid('client') }));
    map = must(linkNodes(map, nid('check'), nid('req'), '用户名+口令'));

    const lines = renderMap(map, MONO);
    const header = lines.find((l) => l.includes('客户端'))!;
    expect(header).toContain('服务端'); // both lane headers on one row
    // same-lane boxes align: the t1 client box starts at the same column as the t0 client box
    const showRow = lines.find((l) => l.includes('显示结果'))!;
    const reqRow = lines.find((l) => l.includes('发起登录'))!;
    expect(showRow.indexOf('│')).toBe(reqRow.indexOf('│'));
    // within the t1 band row, the client-lane box sits left of the server-lane box
    expect(showRow).toContain('校验凭证'); // both t1 boxes share the row
    expect(showRow.indexOf('显示结果')).toBeLessThan(showRow.indexOf('校验凭证'));
    // and the lane headers sit in the same left-to-right order
    expect(header.indexOf('客户端')).toBeLessThan(header.indexOf('服务端'));
  });
});
