/**
 * Spec for the watcher's pure helpers: width fitting/wrapping and the
 * resizable detail panel (node view and map dashboard) with its divider math.
 * (The interactive shell itself is I/O and stays untested by design.)
 */

import { describe, expect, it } from 'vitest';

import { declareGroup, declareLane, declareLayer, declareNode, linkNodes, setKind, updateNode } from '../domain/ops.js';
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
  type SubmapRef,
} from '../domain/types.js';
import type { BoxHit } from '../render/render.js';
import {
  type PageTab,
  anchorOffsets,
  clampPanelRows,
  diveOrigin,
  dividerRow,
  fitWidth,
  mapPanel,
  mostRecentPageFile,
  nearestHit,
  nodePanel,
  parseArgs,
  pageTabRow,
  panelRowsFromDividerY,
  type Ripple,
  WAVE_LEVELS,
  WAVE_NUMBER,
  elapsedLabel,
  liveRipples,
  splashFrame,
  tabScrollFor,
  waitingInfo,
  topLevelFiles,
  usableColumns,
  waveAt,
  waveHash,
  waveLevel,
  wrapWidth,
} from './watch.js';

function must<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}
const lid = (s: string): LayerId => s as LayerId;
const nid = (s: string): NodeId => s as NodeId;
const gid = (s: string): GroupId => s as GroupId;

function sample(): MellosMap {
  let map = EMPTY_MAP;
  map = must(declareLayer(map, { id: lid('base'), name: '原语层', rank: 0 }));
  map = must(declareLayer(map, { id: lid('top'), name: '编排层', rank: 1 }));
  map = must(
    declareNode(map, {
      id: nid('core'),
      label: '核心',
      layer: lid('base'),
      status: 'done',
      detail: '持有全部结构不变量：层全序、节点唯一归属、边严格向下。纯函数，零异常控制流。',
    }),
  );
  map = must(updateNode(map, { id: nid('core'), evidence: 'vitest: 9 passed' }));
  map = must(declareNode(map, { id: nid('shell'), label: '外壳', layer: lid('top') }));
  map = must(declareNode(map, { id: nid('cli'), label: 'CLI', layer: lid('top'), status: 'in-progress' }));
  map = must(linkNodes(map, nid('shell'), nid('core')));
  map = must(linkNodes(map, nid('cli'), nid('core')));
  return map;
}

describe('fitWidth / wrapWidth', () => {
  it('fits CJK text to a display width with an ellipsis', () => {
    expect(fitWidth('状态存储状态存储', 8)).toBe('状态存…');
    expect(fitWidth('short', 8)).toBe('short');
  });

  it('wraps by display width, honoring embedded newlines', () => {
    expect(wrapWidth('一二三四五', 4)).toEqual(['一二', '三四', '五']);
    expect(wrapWidth('ab\ncd', 10)).toEqual(['ab', 'cd']);
    expect(wrapWidth('', 10)).toEqual([]);
  });
});

describe('nodePanel', () => {
  it('is exactly six rows: header, evidence, wires with neighbour glyphs, design notes', () => {
    const panel = nodePanel(sample(), 'core', true, 80, false)!;
    expect(panel).toHaveLength(6);
    expect(panel[0]).toEqual({ text: '■ 核心 [core] · 原语层 · done', sgr: '32;1' });
    expect(panel[1]).toEqual({ text: 'evidence: vitest: 9 passed', sgr: '90' });
    expect(panel[2]!.text).toBe('uses →  —');
    // neighbours carry their own status glyphs: ghost shell, spinning cli
    expect(panel[3]!.text).toBe('used by ←  · 外壳  ⠿ CLI');
    expect(panel[4]!.text).toContain('持有全部结构不变量');
  });

  it('marks a pinned node and falls back for missing design notes', () => {
    const pinned = nodePanel(sample(), 'shell', true, 80, true)!;
    expect(pinned[0]!.text).toContain('⊙ pinned');
    expect(pinned[4]).toEqual({ text: '(no design notes yet)', sgr: '90' });
  });

  it('clips overlong design notes with an ellipsis on the last row', () => {
    const narrow = nodePanel(sample(), 'core', true, 20, false)!;
    expect(narrow).toHaveLength(6);
    expect(narrow[5]!.text.endsWith('…')).toBe(true);
  });

  it('returns undefined for an unknown node', () => {
    expect(nodePanel(sample(), 'ghost', true, 80, false)).toBeUndefined();
  });

  it('shows a group panel — members and aggregated wires — when a group box is focused', () => {
    let map = sample();
    map = must(declareGroup(map, { id: gid('surface'), label: '外表面', layer: lid('top') }));
    map = must(updateNode(map, { id: nid('shell'), group: gid('surface') }));
    map = must(updateNode(map, { id: nid('cli'), group: gid('surface') }));

    const panel = nodePanel(map, 'surface', true, 80, true)!;
    expect(panel).toHaveLength(6);
    expect(panel[0]!.text).toContain('⠿ 外表面 [surface] · 编排层 · in-progress · 2 member(s)  ⊙ pinned');
    expect(panel[0]!.sgr).toBe('33;1');
    expect(panel[1]!.text).toBe('members: · 外壳  ⠿ CLI');
    expect(panel[2]!.text).toBe('uses →  ■ 核心'); // two member edges, deduped to one neighbour
    expect(panel[3]!.text).toBe('used by ←  —');
  });
});

describe('mapPanel (dashboard)', () => {
  it('shows title, totals and per-status counts', () => {
    const panel = mapPanel(sample(), true, 80);
    expect(panel).toHaveLength(6);
    expect(panel[1]!.text).toBe('2 layers · 3 nodes · 2 edges');
    expect(panel[2]!.text).toBe('■ 1 done   ⠿ 1 in-progress   · 1 planned');
  });
});

describe('pageTabRow', () => {
  const tabs: PageTab[] = [
    { title: '开发回放', status: 'done', active: true, fresh: false },
    { title: '多页支持', status: 'in-progress', active: false, fresh: true },
    { title: 'idle', status: 'planned', active: false, fresh: false },
  ];

  it('renders active bold in status color, fresh in status color, idle faint', () => {
    const segments = pageTabRow(tabs, 200, true);
    expect(segments.map((s) => s.text)).toEqual([' ● ■ 开发回放 ', ' ○ ⠿ 多页支持 ', ' ○ · idle ']);
    expect(segments.map((s) => s.sgr)).toEqual(['32;1', '33', '90']);
  });

  it('spans are contiguous 1-based columns matching display width', () => {
    const segments = pageTabRow(tabs, 200, true);
    expect(segments[0]!.lo).toBe(1);
    for (let i = 1; i < segments.length; i++) expect(segments[i]!.lo).toBe(segments[i - 1]!.hi + 1);
    expect(segments[0]!.hi - segments[0]!.lo + 1).toBe(14); // ' ● ■ 开发回放 ' = 6 narrow + 4 CJK
  });

  it('overflow shows a › that browses the strip without switching pages', () => {
    const segments = pageTabRow(tabs, 20, true);
    expect(segments.map((s) => s.text)).toEqual([' ● ■ 开发回放 ', ' › ']);
    expect(segments[0]!.action).toEqual({ kind: 'switch', index: 0 });
    expect(segments[1]!.action).toEqual({ kind: 'scroll', delta: 1 }); // browse, never switch
    expect(segments[1]!.sgr).toBe('90');
    expect(segments[1]!.hi).toBeLessThanOrEqual(20);
  });

  const five: PageTab[] = ['p1', 'p2', 'p3', 'p4', 'p5'].map((title, i) => ({
    title,
    status: 'planned' as const,
    active: i === 2,
    fresh: false,
  }));

  it('a scrolled strip windows from the scroll index with indicators both sides', () => {
    const segments = pageTabRow(five, 30, true, 1);
    expect(segments.map((s) => s.text)).toEqual([' ‹ ', ' ○ · p2 ', ' ● · p3 ', ' ○ · p4 ', ' › ']);
    expect(segments[0]!.action).toEqual({ kind: 'scroll', delta: -1 });
    expect(segments[2]!.action).toEqual({ kind: 'switch', index: 2 });
    expect(segments[4]!.action).toEqual({ kind: 'scroll', delta: 1 });
    for (let i = 1; i < segments.length; i++) expect(segments[i]!.lo).toBe(segments[i - 1]!.hi + 1);
    expect(segments[segments.length - 1]!.hi).toBe(30);
  });

  it('tabScrollFor slides only as far as needed to reveal the active tab', () => {
    expect(tabScrollFor(five, 30, true, 0, 4)).toBe(2); // reveal the far end
    expect(tabScrollFor(five, 30, true, 1, 2)).toBe(1); // already visible — untouched
    expect(tabScrollFor(five, 30, true, 3, 0)).toBe(0); // reveal to the left = jump there
  });
});

describe('diagram kinds in the panel', () => {
  /** A two-step sequence page: client asks, server checks. */
  function sequencePage(): MellosMap {
    let map = setKind(EMPTY_MAP, 'sequence' as MapKind);
    map = must(declareLayer(map, { id: lid('t0'), name: '第1步', rank: 0 }));
    map = must(declareLayer(map, { id: lid('t1'), name: '第2步', rank: 1 }));
    map = must(declareLane(map, { id: 'client' as LaneId, label: '客户端' }));
    map = must(
      declareNode(map, { id: nid('req'), label: '发起登录', layer: lid('t0'), lane: 'client' as LaneId, kind: 'action' as NodeKind }),
    );
    map = must(declareNode(map, { id: nid('check'), label: '校验凭证', layer: lid('t1') }));
    map = must(linkNodes(map, nid('check'), nid('req'), '用户名+口令'));
    return map;
  }

  it('edge labels ride along in the wire lines, worded in time on sequence pages', () => {
    const panel = nodePanel(sequencePage(), 'check', true, 80, false)!;
    expect(panel[2]!.text).toBe('after →  · 发起登录 (用户名+口令)');
    const reqPanel = nodePanel(sequencePage(), 'req', true, 80, false)!;
    expect(reqPanel[3]!.text).toBe('before ←  · 校验凭证 (用户名+口令)');
  });

  it('neutral pages hide the status word and show kind glyph, lane and kind slug', () => {
    const panel = nodePanel(sequencePage(), 'req', true, 80, false)!;
    expect(panel[0]!.text).toBe('· 发起登录 [req] · 第1步 · 客户端 · action');
    expect(panel[0]!.text).not.toContain('planned');
    expect(panel[0]!.sgr).toBe('1'); // bold, no status color
  });

  it('a sub-map link shows in the panel header', () => {
    let map = sample();
    map = must(updateNode(map, { id: nid('core'), submap: 'core-internals' as SubmapRef }));
    const panel = nodePanel(map, 'core', true, 80, false)!;
    expect(panel[0]!.text).toContain('⊞ core-internals');
  });

  it('the dashboard says what kind of diagram this is instead of counting progress', () => {
    const panel = mapPanel(sequencePage(), true, 80);
    expect(panel[1]!.text).toBe('2 layers · 2 nodes · 1 edges · 1 lanes');
    expect(panel[2]!.text).toBe('sequence diagram');
  });

  it('neutral tabs drop the status glyph and go cyan when fresh', () => {
    const tabs: PageTab[] = [
      { title: '登录时序', status: 'planned', active: false, fresh: true, neutral: true },
      { title: '开发页', status: 'done', active: true, fresh: false },
    ];
    const segments = pageTabRow(tabs, 200, true);
    expect(segments[0]!.text).toBe(' ○ 登录时序 '); // no status glyph
    expect(segments[0]!.sgr).toBe('36');
    expect(segments[1]!.text).toBe(' ● ■ 开发页 '); // dev tabs unchanged
    expect(segments[1]!.sgr).toBe('32;1');
  });
});

describe('sub-map hierarchy — interior pages are not sibling tabs', () => {
  const DEFAULT = '/p/.mellos/map.json';
  const child = '/p/.mellos/pages/core-internals.json';
  const effort = '/p/.mellos/pages/new-effort.json';

  function overview(): MellosMap {
    let map = sample();
    map = must(updateNode(map, { id: nid('core'), submap: 'core-internals' as SubmapRef }));
    return map;
  }

  it('hides pages referenced as submaps from the tab bar; the default page never hides', () => {
    const mapOf = new Map<string, MellosMap | undefined>([[DEFAULT, overview()]]);
    expect(topLevelFiles(DEFAULT, [DEFAULT, child, effort], mapOf)).toEqual([DEFAULT, effort]);
    // an unloaded map hides nothing
    expect(topLevelFiles(DEFAULT, [DEFAULT, child], new Map([[DEFAULT, undefined]]))).toEqual([DEFAULT, child]);
  });

  it('derives where a sub-map was dived from: parent file and linking node label', () => {
    const mapOf = new Map<string, MellosMap | undefined>([[DEFAULT, overview()]]);
    expect(diveOrigin(DEFAULT, child, [DEFAULT, child], mapOf)).toEqual({ parent: DEFAULT, label: '核心' });
    expect(diveOrigin(DEFAULT, effort, [DEFAULT, child, effort], mapOf)).toBeUndefined();
    expect(diveOrigin(DEFAULT, DEFAULT, [DEFAULT], mapOf)).toBeUndefined(); // the default page has no parent
  });
});

describe('frame width — the reserved last column', () => {
  it('keeps every frame row one column short of the terminal', () => {
    // A glyph in the terminal's last column arms deferred autowrap and the
    // ERASE_LINE_END after it erases that glyph — the map's rightmost column
    // would be visible on no terminal, and the pan clamp would refuse to
    // scroll past it. One column is reserved instead.
    expect(usableColumns(100)).toBe(99);
    expect(usableColumns(2)).toBe(1);
    expect(usableColumns(1)).toBe(1); // a degenerate pane still gets one column
  });
});

describe('divider drag — resizable detail panel', () => {
  it('converts the dragged divider row into a panel height', () => {
    // 30-row terminal, no tab bar: separator at row 23 leaves 6 panel rows
    expect(panelRowsFromDividerY(23, 30, 0)).toBe(6);
    expect(panelRowsFromDividerY(17, 30, 0)).toBe(12); // pulled up — bigger panel
    expect(panelRowsFromDividerY(27, 30, 0)).toBe(2); // pushed down — clamped to minimum
    expect(panelRowsFromDividerY(2, 30, 0)).toBe(24); // the map keeps its minimum rows
    expect(panelRowsFromDividerY(2, 30, 1)).toBe(23); // a tab bar costs one row
  });

  it('re-clamps a remembered height when the terminal shrinks', () => {
    expect(clampPanelRows(20, 14, 0)).toBe(8);
    expect(clampPanelRows(1, 30, 0)).toBe(2);
  });

  it('grows the design notes into the extra panel rows', () => {
    const six = nodePanel(sample(), 'core', true, 20, false)!;
    expect(six).toHaveLength(6);
    expect(six[5]!.text.endsWith('…')).toBe(true); // cramped: notes cut
    expect(six.map((l) => l.text).join('')).not.toContain('零异常控制流。');

    // Dragging the divider up gives the notes room — the tail is no longer cut.
    const roomy = nodePanel(sample(), 'core', true, 20, false, 12)!;
    expect(roomy).toHaveLength(12);
    expect(roomy.map((l) => l.text).join('')).toContain('零异常控制流。');
  });

  it('shrinks panels below their fixed rows without crashing', () => {
    expect(nodePanel(sample(), 'core', true, 80, false, 2)!).toHaveLength(2);
    expect(mapPanel(sample(), true, 80, 3)).toHaveLength(3);
    expect(mapPanel(sample(), true, 80, 9)).toHaveLength(9);
  });
});

describe('zoom anchoring', () => {
  const hit = (id: string, x: number, y: number, w = 10, h = 3): BoxHit => ({ id, x, y, w, h });

  it('keeps the anchor node at the same screen position across a zoom change', () => {
    // node center moves from x=15 to x=9 when the picture shrinks;
    // the offset must shift by the same -6 so the node does not jump.
    const moved = anchorOffsets(
      { before: hit('a', 10, 8), after: hit('a', 4, 6) },
      { x: 20, y: 5 },
      { w: 100, h: 40 },
      { w: 60, h: 30 },
    );
    expect(moved).toEqual({ x: 14, y: 3 });
  });

  it('scales the pan proportionally when there is no anchor node', () => {
    expect(anchorOffsets(undefined, { x: 50, y: 20 }, { w: 100, h: 40 }, { w: 50, h: 20 })).toEqual({ x: 25, y: 10 });
    expect(anchorOffsets(undefined, { x: 3, y: 7 }, { w: 0, h: 0 }, { w: 50, h: 20 })).toEqual({ x: 0, y: 0 });
  });

  it('finds the hit nearest to a point, and nothing in an empty picture', () => {
    const hits = [hit('far', 50, 20), hit('near', 10, 5)];
    expect(nearestHit(hits, 12, 6)?.id).toBe('near');
    expect(nearestHit([], 12, 6)).toBeUndefined();
  });
});

describe('standby splash', () => {
  const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

  it('formats elapsed time as m:ss below an hour, h:mm:ss beyond', () => {
    expect(elapsedLabel(5_000)).toBe('0:05');
    expect(elapsedLabel(192_000)).toBe('3:12');
    expect(elapsedLabel(3_723_000)).toBe('1:02:03');
    expect(elapsedLabel(-50)).toBe('0:00');
  });

  it('waitingInfo names both watched paths, the poll rate, and the exit condition', () => {
    const info = waitingInfo(
      {
        defaultFile: 'D:\\p\\.claude\\mellos-mapping.json',
        pagesDir: 'D:\\p\\.claude\\mellos-mapping.pages',
        intervalMs: 250,
        elapsedMs: 192_000,
        broken: [],
      },
      120,
    );
    expect(info[0]).toBe('watching  D:\\p\\.claude\\mellos-mapping.json');
    expect(info[1]).toContain('mellos-mapping.pages');
    expect(info[1]).toContain('*.json');
    expect(info[2]).toBe('polling every 250 ms · waiting 3:12');
    expect(info.at(-1)).toBe('the map appears at the first mmap_declare');
  });

  it('waitingInfo drops the clock when elapsedMs is omitted, so a piped run never re-streams', () => {
    const info = waitingInfo({ defaultFile: 'm.json', pagesDir: 'pages', intervalMs: 250, broken: [] }, 80);
    expect(info[2]).toBe('polling every 250 ms');
    expect(info.join('\n')).not.toContain('waiting');
  });

  it('waitingInfo surfaces files that exist but refuse to load, clipped to width', () => {
    const info = waitingInfo(
      { defaultFile: 'm.json', pagesDir: 'pages', intervalMs: 250, elapsedMs: 0, broken: ['map file m.json is not valid JSON: unexpected token'] },
      24,
    );
    expect(info.some((l) => l.startsWith('! map file m.json'))).toBe(true);
    for (const l of info) expect(l.length).toBeLessThanOrEqual(24);
  });

  it('rolls the same corners and jitters on every run', () => {
    expect(waveHash(7)).toBe(waveHash(7));
    expect(waveHash(7)).not.toBe(waveHash(8));
    // over a long run every corner gets used
    const corners = new Set(Array.from({ length: 60 }, (_, n) => waveHash(n) % 4));
    expect([...corners].sort()).toEqual([0, 1, 2, 3]);
  });

  it('keeps a steady population of rings, each expanding and fading', () => {
    expect(liveRipples(0, 40, 11).length).toBeLessThanOrEqual(1); // water starts still
    const rings = liveRipples(200, 40, 11);
    expect(rings.length).toBeGreaterThanOrEqual(2);
    expect(rings.length).toBeLessThanOrEqual(6);
    // oldest first: the widest ring is also the faintest
    expect(rings[0]!.r).toBeGreaterThan(rings.at(-1)!.r);
    expect(rings[0]!.fade).toBeLessThan(rings.at(-1)!.fade);
    for (const r of rings) expect(r.fade).toBeGreaterThanOrEqual(0);
  });

  it('superposes rings: crests reinforce, a crest meets a trough and cancels', () => {
    const ring = (r: number): Ripple => ({ ox: 0, oy: 0, r, fade: 1 });
    const crest = waveAt([ring(10)], 10, 0); // cell sits exactly on the front
    expect(crest).toBeCloseTo(1, 5);
    expect(waveAt([ring(10), ring(10)], 10, 0)).toBeCloseTo(2, 5);
    // a ring whose front trails by half a wavelength arrives in antiphase
    expect(Math.abs(waveAt([ring(10), ring(10 - Math.PI / WAVE_NUMBER)], 10, 0))).toBeLessThan(crest);
  });

  it('keeps the top of the ramp out of reach for a lone ring', () => {
    const ring = (r: number): Ripple => ({ ox: 0, oy: 0, r, fade: 1 });
    const alone = waveLevel(waveAt([ring(10)], 10, 0));
    expect(alone).toBeGreaterThan(0);
    expect(alone).toBeLessThan(WAVE_LEVELS); // only a pile-up reaches the glare
    expect(waveLevel(waveAt([ring(10), ring(10)], 10, 0))).toBe(WAVE_LEVELS);
  });

  it('quantizes surface height into the ramp, clamping the extremes', () => {
    expect(waveLevel(0)).toBe(0);
    expect(waveLevel(5)).toBe(WAVE_LEVELS);
    expect(waveLevel(-5)).toBe(-WAVE_LEVELS);
    expect(waveLevel(-0.5)).toBe(-2);
  });

  const INFO = ['watching  m.json', 'polling every 250 ms'];

  it('gives up on a pane too small for water plus diagnostics', () => {
    expect(splashFrame('waiting', INFO, 0, 20, 40, true, true)).toBeUndefined();
    expect(splashFrame('waiting', INFO, 0, 80, 8, true, true)).toBeUndefined();
  });

  it('centers the notice and the diagnostics under the water', () => {
    const frame = splashFrame('waiting for the first mmap_declare ...', INFO, 0, 60, 30, true, false)!;
    expect(frame.length).toBeLessThanOrEqual(30);
    const text = frame.join('\n');
    expect(text).toContain('waiting for the first mmap_declare');
    expect(text).toContain('watching  m.json');
    expect(text).toContain('polling every 250 ms');
    const noticeRow = frame.find((r) => r.includes('waiting for'))!;
    expect(noticeRow.startsWith(' ')).toBe(true);
  });

  it('animates without color by shading the ink instead', () => {
    const a = splashFrame('waiting', INFO, 40, 60, 30, false, false)!.join('\n');
    const b = splashFrame('waiting', INFO, 90, 60, 30, false, false)!.join('\n');
    expect(a).not.toContain('\x1b[');
    expect(a).not.toBe(b);
    expect(a + b).toMatch(/[#=:.]/);
  });

  it('colors from the one ramp only, still water blank, texture riding the waves', () => {
    const ramp = new Set([17, 18, 19, 61, 24, 25, 31, 37, 44, 45, 51, 87, 123, 159, 195]);
    const a = splashFrame('waiting', INFO, 40, 60, 30, true, true)!.join('\n');
    const b = splashFrame('waiting', INFO, 90, 60, 30, true, true)!.join('\n');
    expect(a).toContain('\x1b[38;5;');
    expect(strip(a)).not.toBe(strip(b)); // shade texture moves with the rings
    for (let f = 0; f < 200; f += 7) {
      const codes = splashFrame('waiting', INFO, f, 60, 30, true, true)!.join('\n').matchAll(/38;5;(\d+)/g);
      for (const m of codes) expect(ramp.has(Number(m[1]))).toBe(true);
    }
  });

  it('reads as a gradient, not confetti: neighbouring water cells stay close on the ramp', () => {
    let widest = 0;
    for (let f = 0; f < 400; f++) {
      const rings = liveRipples(f, 60, 7); // the water field's dimensions
      for (let y = 0; y < 7; y++) {
        for (let x = 1; x < 60; x++) {
          const step = Math.abs(waveLevel(waveAt(rings, x, y)) - waveLevel(waveAt(rings, x - 1, y)));
          widest = Math.max(widest, step);
        }
      }
    }
    expect(widest).toBeLessThanOrEqual(3);
  });
});

describe('page selection', () => {
  it('parseArgs accepts --page with a valid slug and drops invalid ones', () => {
    expect(parseArgs(['--page', 'page-focus'], '/w').page).toBe('page-focus');
    expect(parseArgs(['--page', 'NOT A SLUG'], '/w').page).toBeUndefined();
    expect(parseArgs(['--page'], '/w').page).toBeUndefined();
    expect(parseArgs([], '/w').page).toBeUndefined();
  });

  it('mostRecentPageFile picks the page last written, not the first listed', () => {
    const mtimes = new Map([
      ['default.json', 100],
      ['alpha.json', 900],
      ['zeta.json', 500],
    ]);
    const files = ['default.json', 'alpha.json', 'zeta.json'];
    expect(mostRecentPageFile(files, (f) => mtimes.get(f))).toBe('alpha.json');
  });

  it('falls back to list order when no page has a readable mtime', () => {
    expect(mostRecentPageFile(['default.json', 'alpha.json'], () => undefined)).toBe('default.json');
    // files that never resolved an mtime lose to any file that did
    expect(
      mostRecentPageFile(['default.json', 'alpha.json'], (f) => (f === 'alpha.json' ? 5 : undefined)),
    ).toBe('alpha.json');
  });
});

describe('auto-follow', () => {
  it('parseArgs defaults follow on; --no-follow starts it off', () => {
    expect(parseArgs([], '/w').follow).toBe(true);
    expect(parseArgs(['--no-follow'], '/w').follow).toBe(false);
  });

  it('dividerRow keeps the grip centered and right-aligns the follow tag', () => {
    const on = dividerRow(40, true, true);
    expect(on).toHaveLength(40);
    expect(on).toContain(' ⋯ ');
    expect(on.slice(-11, -1)).toBe(' ⇢ follow ');
    const off = dividerRow(40, true, false);
    expect(off).toHaveLength(40);
    expect(off).not.toContain('follow');
  });

  it('dividerRow drops the tag when it would collide with the grip', () => {
    const narrow = dividerRow(14, true, true);
    expect(narrow).toHaveLength(14);
    expect(narrow).not.toContain('follow');
    expect(dividerRow(4, true, true)).toBe('────'); // too narrow even for the grip
  });

  it('dividerRow has a pure-ASCII face', () => {
    const ascii = dividerRow(40, false, true);
    expect(ascii).toHaveLength(40);
    expect(ascii).toContain(' ~ ');
    expect(ascii.slice(-11, -1)).toBe(' > follow ');
  });
});
