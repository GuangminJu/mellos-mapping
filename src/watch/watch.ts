/**
 * Layer 4b — the split-pane watcher.
 *
 * A deliberately tiny terminal program: poll the state file's mtime,
 * re-render on change, keep the spinner turning while any node is in
 * progress. The state file is the only channel between the MCP server and
 * this process — no sockets, no IPC, one direction of flow.
 *
 * Interaction (real TTY only; piped/CI runs stay pure output):
 *   hover a node   spotlight its wires, preview it in the detail panel
 *   click a node   pin it — the panel stays after the mouse leaves
 *   click empty / Esc   unpin
 *   wheel / + / -  zoom the picture (scale first, mode switch at the ends),
 *                  anchored on the focused node or the view center
 *   left-drag      pan when the map is larger than the pane
 *   shift+wheel, hjkl / arrows, 0   scroll / nudge / reset pan+zoom
 *   Tab / Shift+Tab / 1-9 / click a tab   switch pages (parallel maps);
 *                  each page keeps its own pan/zoom/pin, background page
 *                  changes light their tab up instead of stealing the view
 *   wheel on the tab row / click ‹ ›   browse an overflowing tab strip
 *                  without switching pages
 *   q              quit
 *
 * The bottom of the pane is a fixed-height detail panel: a separator, a
 * status-colored header, evidence, both wire directions (each neighbour
 * carrying its own status glyph), and the node's design notes word-wrapped.
 * With nothing focused it shows the map dashboard instead. Fixed height —
 * details never float over the map and the layout never jumps.
 *
 * Resilience contract: a torn or half-written file (only possible with
 * foreign writers; our own saves are atomic) must never crash the pane —
 * the last good picture stays up and the next poll retries.
 *
 * Usage: node watch.mjs [--file <path>] [--interval <ms>] [--ascii]
 *                       [--no-color] [--no-mouse] [--page <slug>]
 */

import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { groupStatus, mapStatus } from '../domain/ops.js';
import { type MellosMap, type NodeStatus } from '../domain/types.js';
import {
  type BoxHit,
  type ZoomStep,
  ZOOM_DEFAULT,
  clampZoom,
  displayWidth,
  fitWidth,
  isNeutralKind,
  kindGlyph,
  renderMapWindow,
  wrapWidth,
  zoomLabel,
} from '../render/render.js';
import {
  type PageId,
  STATE_FILE_RELATIVE_PATH,
  describeStoreError,
  listPageFiles,
  loadMapFile,
  makePageId,
  pageFilePath,
  pageIdOfFile,
  takeFocusRequest,
} from '../store/store.js';
import { parseInput } from './input.js';

// Width helpers live with the renderer now; re-exported for panel tests.
export { fitWidth, wrapWidth };

interface WatchConfig {
  readonly file: string;
  readonly intervalMs: number;
  readonly unicode: boolean;
  readonly color: boolean;
  readonly mouse: boolean;
  /** Page to open on (undefined = pick a default); may not exist yet. */
  readonly page: PageId | undefined;
}

export function parseArgs(argv: readonly string[], cwd: string): WatchConfig {
  let file = join(cwd, STATE_FILE_RELATIVE_PATH);
  let intervalMs = 250;
  let unicode = true;
  let color = true;
  let mouse = true;
  let page: PageId | undefined;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--file':
        file = argv[++i] ?? file;
        break;
      case '--page': {
        const parsed = makePageId(argv[++i] ?? '');
        if (parsed.ok) page = parsed.value; // invalid slugs are ignored — the pane must come up
        break;
      }
      case '--interval':
        intervalMs = Math.max(50, Number(argv[++i]) || intervalMs);
        break;
      case '--ascii':
        unicode = false;
        break;
      case '--no-color':
        color = false;
        break;
      case '--no-mouse':
        mouse = false;
        break;
      default:
        break; // unknown flags are ignored; the pane must come up regardless
    }
  }
  return { file, intervalMs, unicode, color, mouse, page };
}

/**
 * The page a pane shows when nobody asked for one: the most recently WRITTEN
 * page — the ledger last touched is almost always the effort under way. Files
 * without a readable mtime lose; an empty store falls back to list order
 * (default page first, then slug order).
 */
export function mostRecentPageFile(
  files: readonly string[],
  mtimeOf: (file: string) => number | undefined,
): string | undefined {
  let best: string | undefined;
  let bestMtime = -Infinity;
  for (const file of files) {
    const mtime = mtimeOf(file);
    if (mtime !== undefined && mtime > bestMtime) {
      best = file;
      bestMtime = mtime;
    }
  }
  return best ?? files[0];
}

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_ALL = '\x1b[H\x1b[2J';
const HOME = '\x1b[H';
const ERASE_LINE_END = '\x1b[K';
/** any-event tracking (hover) + SGR extended coordinates */
const MOUSE_ON = '\x1b[?1003h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1003l\x1b[?1006l';
const RESET = '\x1b[0m';

/** Default detail-panel height; the divider drag adjusts it at runtime. */
const PANEL_CONTENT_ROWS = 6;
export const PANEL_ROWS_MIN = 2;
/** The map keeps at least this many body rows however far the divider is pulled. */
const MAP_ROWS_MIN = 4;

/**
 * Usable frame width: one column narrower than the terminal. A glyph written
 * into the terminal's LAST column arms deferred autowrap; the ERASE_LINE_END
 * that follows it then erases that very glyph (xterm / Windows Terminal), or
 * the wrap fires immediately and shears the whole frame (legacy conhost).
 * Every frame row — map body, tab bar, separator, footer — must stay inside
 * this budget, and the pan clamp must use it too, otherwise the map's
 * rightmost column(s) can never be brought into view.
 */
export function usableColumns(cols: number): number {
  return Math.max(1, cols - 1);
}

/** Clamp a wanted panel height to what the terminal can spare. */
export function clampPanelRows(wanted: number, totalRows: number, tabRows: number): number {
  const largest = totalRows - tabRows - MAP_ROWS_MIN - 2; // separator + footer stay
  return Math.max(PANEL_ROWS_MIN, Math.min(wanted, largest));
}

/** Panel height implied by dragging the divider to terminal row `termY` (1-based). */
export function panelRowsFromDividerY(termY: number, totalRows: number, tabRows: number): number {
  return clampPanelRows(totalRows - termY - 1, totalRows, tabRows);
}

const STATUS_GLYPH: Readonly<Record<NodeStatus, [unicode: string, ascii: string]>> = {
  planned: ['·', '.'],
  'in-progress': ['⠿', '*'],
  done: ['■', '#'],
  regressed: ['✗', 'X'],
};

const STATUS_SGR: Readonly<Record<NodeStatus, string>> = {
  planned: '2',
  'in-progress': '33',
  done: '32',
  regressed: '31',
};

/**
 * Keep a zoom change visually anchored. With an anchor node (same id hit
 * before and after), shift the pan so the node stays at the same screen
 * position; without one, scale the pan proportionally to the content size.
 * Clamping to the content bounds is paint()'s job, as always.
 */
export function anchorOffsets(
  anchor: { readonly before: BoxHit; readonly after: BoxHit } | undefined,
  offset: { readonly x: number; readonly y: number },
  before: { readonly w: number; readonly h: number },
  after: { readonly w: number; readonly h: number },
): { x: number; y: number } {
  if (anchor) {
    return {
      x: Math.round(offset.x + anchor.after.x + anchor.after.w / 2 - (anchor.before.x + anchor.before.w / 2)),
      y: Math.round(offset.y + anchor.after.y + anchor.after.h / 2 - (anchor.before.y + anchor.before.h / 2)),
    };
  }
  return {
    x: before.w > 0 ? Math.round((offset.x * after.w) / before.w) : 0,
    y: before.h > 0 ? Math.round((offset.y * after.h) / before.h) : 0,
  };
}

export interface PageTab {
  readonly title: string;
  readonly status: NodeStatus;
  readonly active: boolean;
  /** The page's file changed while it was not the active page. */
  readonly fresh: boolean;
  /** Documentation kinds show no status glyph and use neutral colors. */
  readonly neutral?: boolean;
}

/** What clicking a tab-row segment does. Scrolling browses the strip only. */
export type TabAction =
  | { readonly kind: 'switch'; readonly index: number }
  | { readonly kind: 'scroll'; readonly delta: -1 | 1 }
  /** The breadcrumb inside a sub-map: the whole row climbs back out. */
  | { readonly kind: 'back' };

export interface TabSegment {
  readonly text: string;
  readonly sgr: string; // '' = default color
  /** 1-based inclusive terminal column span, for click hit-testing. */
  readonly lo: number;
  readonly hi: number;
  readonly action: TabAction;
}

/** Column width of one ‹ / › strip-scroll indicator in the tab row. */
const TAB_INDICATOR_W = 3;

/**
 * Render the page tab bar as ANSI-free segments with column spans. The
 * active tab is bold in its map's aggregate status color; inactive tabs
 * are faint — unless fresh (changed since last viewed), which keep their
 * status color so background progress catches the eye without stealing
 * the view.
 *
 * When the tabs overflow the width, the row becomes a window starting at
 * `scroll` (a tab index, clamped), with a ‹ / › indicator on each side
 * that still hides tabs. Indicators SCROLL the strip — browsing never
 * switches the page; the caller owns the scroll state and clicks a tab to
 * actually switch. Keeping the ACTIVE tab visible when the page changes
 * is also the caller's move: see tabScrollFor.
 */
export function pageTabRow(tabs: readonly PageTab[], width: number, unicode: boolean, scroll = 0): TabSegment[] {
  const texts = tabs.map((tab) => {
    const marker = tab.active ? (unicode ? '●' : '*') : unicode ? '○' : 'o';
    const glyph = STATUS_GLYPH[tab.status][unicode ? 0 : 1];
    // Neutral (documentation) pages carry no status: no glyph, activity in cyan.
    return tab.neutral === true ? ` ${marker} ${tab.title} ` : ` ${marker} ${glyph} ${tab.title} `;
  });
  const sgrOf = (tab: PageTab): string =>
    tab.neutral === true
      ? tab.active
        ? '1'
        : tab.fresh
          ? '36'
          : '90'
      : tab.active
        ? `${STATUS_SGR[tab.status]};1`
        : tab.fresh
          ? STATUS_SGR[tab.status]
          : '90';
  const widths = texts.map(displayWidth);
  const count = tabs.length;

  // -- window selection: everything, or as much as fits from `scroll` on --
  let lo = 0;
  let hi = count - 1;
  if (widths.reduce((a, b) => a + b, 0) > width) {
    lo = Math.max(0, Math.min(scroll, count - 1));
    hi = lo;
    // total cost of a candidate window, indicators included when a side hides tabs
    const cost = (l: number, h: number): number =>
      widths.slice(l, h + 1).reduce((a, b) => a + b, 0) +
      (l > 0 ? TAB_INDICATOR_W : 0) +
      (h < count - 1 ? TAB_INDICATOR_W : 0);
    while (hi + 1 < count && cost(lo, hi + 1) <= width) hi++;
  }

  // -- emit --
  const segments: TabSegment[] = [];
  let col = 1;
  const push = (text: string, sgr: string, action: TabAction): void => {
    const w = displayWidth(text);
    segments.push({ text, sgr, lo: col, hi: col + w - 1, action });
    col += w;
  };
  if (lo > 0) push(unicode ? ' ‹ ' : ' < ', '90', { kind: 'scroll', delta: -1 });
  const tail = hi < count - 1 ? TAB_INDICATOR_W : 0;
  for (let i = lo; i <= hi; i++) {
    // the window is chosen to fit; only a lone leading tab can still overflow
    push(fitWidth(texts[i]!, Math.max(1, width - (col - 1) - tail)), sgrOf(tabs[i]!), { kind: 'switch', index: i });
  }
  if (hi < count - 1) push(unicode ? ' › ' : ' > ', '90', { kind: 'scroll', delta: 1 });
  return segments;
}

/**
 * The smallest scroll adjustment that brings tab `index` fully into the
 * strip window. Called when the ACTIVE page changes (keys, dive, climb),
 * so cycling never lands on an off-strip tab; manual ‹ › / wheel browsing
 * keeps its own scroll and is never snapped back.
 */
export function tabScrollFor(
  tabs: readonly PageTab[],
  width: number,
  unicode: boolean,
  scroll: number,
  index: number,
): number {
  if (index <= scroll) return Math.max(0, index);
  const visibleAt = (s: number): boolean =>
    pageTabRow(tabs, width, unicode, s).some((seg) => seg.action.kind === 'switch' && seg.action.index === index);
  let s = Math.max(0, Math.min(scroll, tabs.length - 1));
  while (s < index && !visibleAt(s)) s++;
  return s;
}

/**
 * Pages that deserve a tab: those NO node of any page dives into. A page
 * referenced as some node's submap is interior detail — it is reached by
 * double-clicking that node, never by sitting beside its parent as a
 * sibling. The default page is never hidden.
 */
export function topLevelFiles(
  defaultFile: string,
  files: readonly string[],
  mapOf: ReadonlyMap<string, MellosMap | undefined>,
): string[] {
  const refs = new Set<string>();
  for (const m of mapOf.values()) {
    for (const n of m?.nodes ?? []) if (n.submap !== undefined) refs.add(n.submap as string);
  }
  return files.filter((f) => {
    const id = pageIdOfFile(defaultFile, f);
    return id === undefined || !refs.has(id as string);
  });
}

/**
 * Where a sub-map page was dived into from: the parent page and the label
 * of the node that links it. Derived by scan, so the breadcrumb survives a
 * watcher restart with an empty dive stack.
 */
export function diveOrigin(
  defaultFile: string,
  file: string,
  files: readonly string[],
  mapOf: ReadonlyMap<string, MellosMap | undefined>,
): { parent: string; label: string } | undefined {
  const id = pageIdOfFile(defaultFile, file);
  if (id === undefined) return undefined;
  for (const f of files) {
    if (f === file) continue;
    const node = mapOf.get(f)?.nodes.find((n) => (n.submap as string | undefined) === (id as string));
    if (node !== undefined) return { parent: f, label: node.label };
  }
  return undefined;
}

/** The hit whose center is nearest to (cx, cy) by Manhattan distance. */
export function nearestHit(hits: readonly BoxHit[], cx: number, cy: number): BoxHit | undefined {
  let best: BoxHit | undefined;
  let bestDistance = Infinity;
  for (const h of hits) {
    const d = Math.abs(h.x + h.w / 2 - cx) + Math.abs(h.y + h.h / 2 - cy);
    if (d < bestDistance) {
      bestDistance = d;
      best = h;
    }
  }
  return best;
}

export interface PanelLine {
  readonly text: string;
  readonly sgr: string; // '' = default color
}

/**
 * The detail panel for a focused node OR group (the far zoom's boxes are
 * groups): header, evidence/members, both wire directions with each
 * neighbour's status glyph, wrapped design notes.
 * Always exactly PANEL_CONTENT_ROWS lines (padded with blanks).
 */
export function nodePanel(
  map: MellosMap,
  focusId: string,
  unicode: boolean,
  width: number,
  pinned: boolean,
  rows: number = PANEL_CONTENT_ROWS,
): PanelLine[] | undefined {
  const g = (s: NodeStatus): string => STATUS_GLYPH[s][unicode ? 0 : 1];
  const pinMark = pinned ? (unicode ? '  ⊙ pinned' : '  * pinned') : '';

  const group = map.groups.find((gr) => (gr.id as string) === focusId);
  if (group) {
    const members = map.nodes.filter((n) => n.group === group.id);
    const memberIds = new Set(members.map((n) => n.id as string));
    const status = groupStatus(map, group.id);
    const layerName = map.layers.find((l) => l.id === group.layer)?.name ?? (group.layer as string);
    const [right, left] = unicode ? ['→', '←'] : ['->', '<-'];
    // A neighbour is shown as its own group when it has one, else as itself.
    const repLabel = (id: string): string => {
      const n = map.nodes.find((x) => (x.id as string) === id)!;
      const owner = n.group !== undefined ? map.groups.find((gr) => gr.id === n.group) : undefined;
      return owner !== undefined ? `${g(groupStatus(map, owner.id))} ${owner.label}` : `${g(n.status)} ${n.label}`;
    };
    const uses = [
      ...new Set(
        map.edges
          .filter((e) => memberIds.has(e.from as string) && !memberIds.has(e.to as string))
          .map((e) => repLabel(e.to as string)),
      ),
    ];
    const usedBy = [
      ...new Set(
        map.edges
          .filter((e) => memberIds.has(e.to as string) && !memberIds.has(e.from as string))
          .map((e) => repLabel(e.from as string)),
      ),
    ];
    const lines: PanelLine[] = [
      {
        text: fitWidth(
          `${g(status)} ${group.label} [${group.id}] · ${layerName} · ${status} · ${members.length} member(s)${pinMark}`,
          width,
        ),
        sgr: `${STATUS_SGR[status]};1`,
      },
      {
        text: fitWidth(`members: ${members.map((n) => `${g(n.status)} ${n.label}`).join('  ') || '—'}`, width),
        sgr: '',
      },
      { text: fitWidth(`uses ${right}  ${uses.join('  ') || '—'}`, width), sgr: '' },
      { text: fitWidth(`used by ${left}  ${usedBy.join('  ') || '—'}`, width), sgr: '' },
    ];
    while (lines.length < rows) lines.push({ text: '', sgr: '' });
    return lines.slice(0, rows);
  }

  const node = map.nodes.find((n) => (n.id as string) === focusId);
  if (!node) return undefined;
  const neutral = isNeutralKind(map);
  const layerName = map.layers.find((l) => l.id === node.layer)?.name ?? (node.layer as string);
  const [right, left] = unicode ? ['→', '←'] : ['->', '<-'];
  const withGlyph = (id: string): string => {
    const n = map.nodes.find((x) => (x.id as string) === id);
    return n ? `${g(n.status)} ${n.label}` : id;
  };
  // An edge label rides along in parentheses: what flows between the nodes.
  const withEdgeLabel = (base: string, label: string | undefined): string =>
    label !== undefined ? `${base} (${label})` : base;
  const uses = map.edges.filter((e) => e.from === node.id).map((e) => withEdgeLabel(withGlyph(e.to as string), e.label));
  const usedBy = map.edges.filter((e) => e.to === node.id).map((e) => withEdgeLabel(withGlyph(e.from as string), e.label));

  const pin = pinned ? (unicode ? '  ⊙ pinned' : '  * pinned') : '';
  // Documentation kinds hide the status vocabulary: kind glyph (or bullet)
  // instead of the status glyph, no status word, no status color.
  const headGlyph = neutral
    ? (node.kind !== undefined ? kindGlyph(node.kind as string, unicode) : undefined) ?? (unicode ? '·' : '.')
    : g(node.status);
  const laneLabel = node.lane !== undefined ? map.lanes.find((l) => l.id === node.lane)?.label : undefined;
  const headParts = [
    `${headGlyph} ${node.label} [${node.id}]`,
    layerName,
    ...(laneLabel !== undefined ? [laneLabel] : []),
    ...(node.kind !== undefined ? [node.kind as string] : []),
    ...(neutral ? [] : [node.status]),
    ...(node.submap !== undefined ? [`${unicode ? '⊞' : '+'} ${node.submap}`] : []),
  ];
  // On sequence pages an edge is a moment in time, not a dependency:
  // "after" = the earlier events this one follows, "before" = the later ones.
  const [usesWord, usedByWord] = map.kind === 'sequence' ? ['after', 'before'] : ['uses', 'used by'];
  const lines: PanelLine[] = [
    {
      text: fitWidth(`${headParts.join(' · ')}${pin}`, width),
      sgr: neutral ? '1' : `${STATUS_SGR[node.status]};1`,
    },
    { text: fitWidth(`evidence: ${node.evidence ?? '—'}`, width), sgr: '90' },
    { text: fitWidth(`${usesWord} ${right}  ${uses.join('  ') || '—'}`, width), sgr: '' },
    { text: fitWidth(`${usedByWord} ${left}  ${usedBy.join('  ') || '—'}`, width), sgr: '' },
  ];
  const notes = node.detail !== undefined ? wrapWidth(node.detail, width) : ['(no design notes yet)'];
  const room = Math.max(0, rows - lines.length);
  for (let i = 0; i < room; i++) {
    const last = i === room - 1 && notes.length > room;
    lines.push({
      text: last ? fitWidth(notes[i]! + '…', width) : (notes[i] ?? ''),
      sgr: node.detail !== undefined ? '' : '90',
    });
  }
  return lines.slice(0, rows);
}

/**
 * The standby splash — what the pane shows before any map exists.
 *
 * A 5-row block font, two stacked words, lit by ripples. Waves are born at
 * a randomized corner every WAVE_INTERVAL frames and expand as damped rings;
 * the ink of a cell is the SUM of every live ring over it, so overlapping
 * waves interfere for real — crests reinforce, a crest meeting a trough
 * cancels back to still water. Surface height drives one continuous
 * indigo→cyan→white ramp, and the gain is set so the top of that ramp is
 * out of reach for a lone ring: the near-white glare only happens where
 * waves actually pile up. Without color the same field shades the ink
 * instead, so a --no-color --ascii pane still ripples.
 *
 * Everything here is a pure function of `frame` — no Math.random, so the
 * animation is reproducible and testable.
 */
const SPLASH_FONT: Readonly<Record<string, readonly string[]>> = {
  M: ['#   #', '## ##', '# # #', '#   #', '#   #'],
  E: ['####', '#', '###', '#', '####'],
  L: ['#', '#', '#', '#', '####'],
  O: [' ###', '#   #', '#   #', '#   #', ' ###'],
  S: [' ####', '#', ' ###', '    #', '####'],
  A: [' ###', '#   #', '#####', '#   #', '#   #'],
  P: ['####', '#   #', '####', '#', '#'],
  I: ['###', ' #', ' #', ' #', '###'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
  G: [' ####', '#', '#  ##', '#   #', ' ###'],
};
const SPLASH_ROWS = 5;

/** Ink shades by |level| 0..WAVE_LEVELS for the no-color path. */
const SPLASH_SHADES: Readonly<Record<'unicode' | 'ascii', readonly string[]>> = {
  unicode: ['░', '░', '▒', '▒', '▓', '▓', '█', '█'],
  ascii: ['.', '.', ':', ':', '=', '=', '#', '#'],
};
/**
 * One continuous xterm-256 ramp, deep trough to high crest, indexed by
 * WAVE_LEVELS + level. Monotonic in lightness and confined to indigo→cyan→white
 * so neighbouring cells are always neighbouring colors: the ripple reads as a
 * gradient over the letters instead of confetti. Still water sits mid-ramp.
 */
const WAVE_RAMP: readonly number[] = [17, 18, 19, 61, 24, 25, 31, 37, 44, 45, 51, 87, 123, 159, 195];
const SPINNER_FRAMES: Readonly<Record<'unicode' | 'ascii', readonly string[]>> = {
  unicode: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  ascii: ['|', '/', '-', '\\'],
};

/** One word in the block font: SPLASH_ROWS lines of '#' ink on spaces. */
export function wordArt(word: string): string[] {
  const glyphs = [...word.toUpperCase()]
    .map((ch) => SPLASH_FONT[ch])
    .filter((g): g is readonly string[] => g !== undefined);
  const widths = glyphs.map((g) => Math.max(...g.map((r) => r.length)));
  const rows: string[] = [];
  for (let r = 0; r < SPLASH_ROWS; r++) {
    rows.push(glyphs.map((g, i) => (g[r] ?? '').padEnd(widths[i]!, ' ')).join(' '));
  }
  return rows;
}

/** Both words stacked and mutually centered, blank line between. */
export function splashArt(): string[] {
  const words = [wordArt('MELLOS'), wordArt('MAPPING')];
  const width = Math.max(...words.flat().map((r) => r.length));
  const centered = words.map((rows) => {
    const own = Math.max(...rows.map((r) => r.length));
    return rows.map((r) => ' '.repeat(Math.floor((width - own) / 2)) + r);
  });
  return [...centered[0]!, '', ...centered[1]!];
}

/**
 * frames between births · frames a ring survives · art columns per frame.
 * Tuned so three or four rings share the water: enough for collisions to
 * happen often, few enough that the picture still reads as waves.
 */
const WAVE_INTERVAL = 18;
const WAVE_LIFETIME = 64;
const WAVE_SPEED = 0.9;
/** Ring half-width in cells, and the angular wavenumber of its lobes. */
const WAVE_ENVELOPE = 10;
export const WAVE_NUMBER = 0.42;
/**
 * Levels either side of still water, and the surface-height-to-level gain.
 * The gain is deliberately short of the top: one ring alone peaks around
 * level 5, so the last two rungs of the ramp — the near-white glare — can
 * only be reached where rings actually pile onto each other.
 */
export const WAVE_LEVELS = 7;
const WAVE_GAIN = 4.5;

/**
 * Deterministic scramble standing in for a die roll — wave `n` always picks
 * the same corner and the same birth jitter, on every machine and every run.
 */
export function waveHash(n: number): number {
  let h = Math.imul(n + 1, 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/** Corner origins as (x, y) fractions of the art block: TL, TR, BL, BR. */
const WAVE_CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

export interface Ripple {
  readonly ox: number;
  readonly oy: number;
  /** current radius of the ring front */
  readonly r: number;
  /** 1 at birth, 0 at the end of life */
  readonly fade: number;
}

/** Every ring alive at `frame`, oldest first. */
export function liveRipples(frame: number, width: number, height: number): Ripple[] {
  const out: Ripple[] = [];
  // a birth jitters up to WAVE_INTERVAL-1 frames late, so scan one slot wider
  const first = Math.floor((frame - WAVE_LIFETIME - WAVE_INTERVAL) / WAVE_INTERVAL);
  const last = Math.floor(frame / WAVE_INTERVAL);
  for (let n = Math.max(0, first); n <= last; n++) {
    const h = waveHash(n);
    const age = frame - (n * WAVE_INTERVAL + (h % WAVE_INTERVAL));
    if (age < 0 || age > WAVE_LIFETIME) continue;
    const [fx, fy] = WAVE_CORNERS[h % WAVE_CORNERS.length]!;
    out.push({
      ox: fx * (width - 1),
      oy: fy * (height - 1),
      r: age * WAVE_SPEED,
      fade: 1 - age / WAVE_LIFETIME,
    });
  }
  return out;
}

/**
 * Superpose the rings over one cell into a signed surface height: + crest,
 * - trough, ~0 still water or two rings cancelling. Rows are half the height
 * of columns in a terminal cell, so y is doubled to keep the rings round.
 */
export function waveAt(ripples: readonly Ripple[], x: number, y: number): number {
  let value = 0;
  for (const w of ripples) {
    const front = Math.hypot(x - w.ox, (y - w.oy) * 2) - w.r;
    value += Math.cos(front * WAVE_NUMBER) * Math.exp(-(front * front) / (2 * WAVE_ENVELOPE ** 2)) * w.fade;
  }
  return value;
}

/** Quantize surface height to a ramp index in [-WAVE_LEVELS, WAVE_LEVELS]. */
export function waveLevel(value: number): number {
  return Math.max(-WAVE_LEVELS, Math.min(WAVE_LEVELS, Math.round(value * WAVE_GAIN)));
}

/**
 * The full standby frame, centered in a `width` x `height` viewport, ANSI
 * already applied. Returns undefined when the pane is too small for the art —
 * the caller then falls back to the plain one-line notice.
 */
export function splashFrame(
  notice: string,
  frame: number,
  width: number,
  height: number,
  unicode: boolean,
  color: boolean,
): string[] | undefined {
  const art = splashArt();
  const artWidth = Math.max(...art.map((r) => r.length));
  if (width < artWidth + 2 || height < art.length + 2) return undefined;

  const mode = unicode ? 'unicode' : 'ascii';
  const shades = SPLASH_SHADES[mode];
  const solid = shades[shades.length - 1]!;
  const indent = ' '.repeat(Math.floor((width - artWidth) / 2));
  const ripples = liveRipples(frame, artWidth, art.length);

  /** The paint of one ink cell: a 256-color code, or a shade char without color. */
  const inkOf = (x: number, y: number): string => {
    const level = waveLevel(waveAt(ripples, x, y));
    return color ? `38;5;${WAVE_RAMP[WAVE_LEVELS + level]!}` : shades[Math.abs(level)]!;
  };

  const paintRow = (row: string, y: number): string => {
    const cells = [...row].map((ch, x) => (ch === '#' ? inkOf(x, y) : undefined));
    let out = '';
    for (let i = 0; i < cells.length; ) {
      const cell = cells[i];
      let j = i;
      while (j < cells.length && cells[j] === cell) j++;
      if (cell === undefined) out += ' '.repeat(j - i);
      else out += color ? `\x1b[${cell}m${solid.repeat(j - i)}${RESET}` : cell.repeat(j - i);
      i = j;
    }
    return out;
  };

  const spinner = SPINNER_FRAMES[mode];
  const status = fitWidth(`${spinner[frame % spinner.length]!} ${notice}`, Math.max(1, width - 2));
  const statusIndent = ' '.repeat(Math.max(0, Math.floor((width - displayWidth(status)) / 2)));
  const block = [
    ...art.map((row, y) => (row.trim() === '' ? '' : indent + paintRow(row, y))),
    '',
    statusIndent + (color ? `\x1b[90m${status}${RESET}` : status),
  ];
  return [...Array.from({ length: Math.max(0, Math.floor((height - block.length) / 2)) }, () => ''), ...block];
}

/** The dashboard shown when nothing is focused. Exactly `rows` lines. */
export function mapPanel(
  map: MellosMap,
  unicode: boolean,
  width: number,
  rows: number = PANEL_CONTENT_ROWS,
): PanelLine[] {
  const g = (s: NodeStatus): string => STATUS_GLYPH[s][unicode ? 0 : 1];
  const count = (s: NodeStatus): number => map.nodes.filter((n) => n.status === s).length;
  const statuses: NodeStatus[] = ['done', 'in-progress', 'planned', 'regressed'];
  const counts = statuses
    .filter((s) => count(s) > 0)
    .map((s) => `${g(s)} ${count(s)} ${s}`)
    .join('   ');
  const parts = [`${map.layers.length} layers`, `${map.nodes.length} nodes`, `${map.edges.length} edges`];
  if (map.lanes.length > 0) parts.push(`${map.lanes.length} lanes`);
  const lines: PanelLine[] = [
    { text: fitWidth(map.title ?? 'mellos map', width), sgr: '1' },
    { text: fitWidth(parts.join(' · '), width), sgr: '90' },
    // documentation kinds document structure, not progress
    { text: fitWidth(isNeutralKind(map) ? `${map.kind} diagram` : counts, width), sgr: isNeutralKind(map) ? '90' : '' },
    { text: '', sgr: '' },
    { text: 'hover a node to inspect · click to pin', sgr: '90' },
  ];
  while (lines.length < rows) lines.push({ text: '', sgr: '' });
  return lines.slice(0, rows);
}

function main(): void {
  const cfg = parseArgs(process.argv.slice(2), process.cwd());
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const mouseActive = interactive && cfg.mouse;

  let lastFrame = '';
  let spinnerFrame = 0;
  let splashTick = 0;
  let map: MellosMap | undefined;
  let notice = `waiting for ${cfg.file} ...`;
  let lastCols = process.stdout.columns ?? 0;
  let lastRows = process.stdout.rows ?? 0;

  // pages — one map file each; the active page owns the mutable view below
  interface PageEntry {
    map: MellosMap | undefined;
    mtimeMs: number;
    fresh: boolean;
  }
  interface PageView {
    offsetX: number;
    offsetY: number;
    zoom: ZoomStep;
    selectedId: string | undefined;
  }
  let pageFiles: string[] = [cfg.file];
  const pageData = new Map<string, PageEntry>();
  const pageViews = new Map<string, PageView>();
  let activeFile: string | undefined;
  let firstScan = true;
  /** A requested page whose file may not exist yet — shown the moment it appears. */
  let pendingFocusFile: string | undefined = cfg.page === undefined ? undefined : pageFilePath(cfg.file, cfg.page);
  let lastTabSegments: readonly TabSegment[] = [];
  /** Leftmost visible tab of the strip window; browsing moves it, switching reveals. */
  let tabScroll = 0;

  // viewport pan/zoom + interaction state (of the ACTIVE page)
  let offsetX = 0;
  let offsetY = 0;
  let zoom: ZoomStep = ZOOM_DEFAULT;
  let dragAnchor: { x: number; y: number; ox: number; oy: number } | undefined;
  let press: { moved: boolean } | undefined;
  let hoverId: string | undefined;
  let selectedId: string | undefined;
  let lastHits: readonly BoxHit[] = [];
  let lastContent = { w: 0, h: 0 };
  let pendingInput = '';
  let panelContentRows = PANEL_CONTENT_ROWS;
  let dividerDrag = false;
  // sub-map navigation: double-click dives, Backspace climbs back out
  let lastClick: { id: string; at: number } | undefined;
  const diveStack: string[] = [];
  let flash: { text: string; until: number } | undefined;
  /** Tab-bar files as painted (top-level pages only), for click hit-testing. */
  let lastTabFiles: string[] = [];

  const maps = (): ReadonlyMap<string, MellosMap | undefined> =>
    new Map([...pageData].map(([f, e]) => [f, e.map]));
  const topFiles = (): string[] => topLevelFiles(cfg.file, pageFiles, maps());
  /** Inside a sub-map the tab row becomes the breadcrumb instead. */
  const inSubmap = (): boolean => activeFile !== undefined && !topFiles().includes(activeFile);
  const tabRows = (): number => (topFiles().length > 1 || inSubmap() ? 1 : 0);
  /** Climb out of the last dive; with no stack, derive the parent by scan. */
  const climbBack = (): boolean => {
    let parent = diveStack.pop();
    while (parent !== undefined && !pageFiles.includes(parent)) parent = diveStack.pop();
    if (parent === undefined && activeFile !== undefined) {
      parent = diveOrigin(cfg.file, activeFile, pageFiles, maps())?.parent;
    }
    if (parent !== undefined && parent !== activeFile) {
      handSwitch(parent);
      return true;
    }
    return false;
  };
  const viewWidth = (): number => usableColumns(process.stdout.columns ?? 100);
  const viewHeight = (): number =>
    Math.max(1, (process.stdout.rows ?? 30) - (1 + panelContentRows) - 1 - tabRows());
  /** Terminal row (1-based) of the map/panel separator — the draggable divider. */
  const dividerY = (): number => tabRows() + viewHeight() + 1;

  /** The tab strip's view models for `files`, in tab order. */
  const pageTabsOf = (files: readonly string[]): PageTab[] =>
    files.map((f) => {
      const m = pageData.get(f)?.map;
      return {
        title: m?.title ?? ((pageIdOfFile(cfg.file, f) as string | undefined) ?? 'main'),
        status: m !== undefined ? mapStatus(m) : 'planned',
        active: f === activeFile,
        fresh: pageData.get(f)?.fresh ?? false,
        neutral: m !== undefined && isNeutralKind(m),
      };
    });

  /** Park the current view, activate `file`, restore its view (or defaults). */
  const switchPage = (file: string): void => {
    if (activeFile !== undefined) pageViews.set(activeFile, { offsetX, offsetY, zoom, selectedId });
    activeFile = file;
    const view = pageViews.get(file);
    offsetX = view?.offsetX ?? 0;
    offsetY = view?.offsetY ?? 0;
    zoom = view?.zoom ?? ZOOM_DEFAULT;
    selectedId = view?.selectedId;
    hoverId = undefined;
    const entry = pageData.get(file);
    if (entry !== undefined && entry.fresh) pageData.set(file, { ...entry, fresh: false });
    map = entry?.map;
    notice = map === undefined ? `waiting for ${file} ...` : '';
    // the strip follows the switch — the active tab must never sit off-screen
    const top = topFiles();
    const tabIndex = top.indexOf(file);
    if (tabIndex >= 0) tabScroll = tabScrollFor(pageTabsOf(top), viewWidth(), cfg.unicode, tabScroll, tabIndex);
  };

  /** A page switch the USER made — it also withdraws any pending focus request. */
  const handSwitch = (file: string): void => {
    pendingFocusFile = undefined;
    switchPage(file);
  };

  /** Terminal cell (1-based) -> node under it, honoring tab row and pan. */
  const hitTest = (termX: number, termY: number): string | undefined => {
    const sx = termX - 1;
    const sy = termY - 1 - tabRows();
    if (sx < 0 || sx >= viewWidth()) return undefined; // the reserved last column shows nothing
    if (sy < 0 || sy >= viewHeight()) return undefined; // tab bar or detail panel, not the map
    const cx = sx + offsetX;
    const cy = sy + offsetY;
    return lastHits.find((h) => cx >= h.x && cx < h.x + h.w && cy >= h.y && cy < h.y + h.h)?.id;
  };

  process.stdout.write(HIDE_CURSOR + CLEAR_ALL + (mouseActive ? MOUSE_ON : ''));
  const restore = (): void => {
    process.stdout.write((mouseActive ? MOUSE_OFF : '') + SHOW_CURSOR + '\n');
    process.exit(0);
  };
  process.on('SIGINT', restore);
  process.on('SIGTERM', restore);

  const paint = (): void => {
    const cols = process.stdout.columns ?? 100;
    const viewW = viewWidth();
    // a shrunken terminal may no longer afford the dragged panel height
    panelContentRows = clampPanelRows(panelContentRows, process.stdout.rows ?? 30, tabRows());
    const viewH = viewHeight();
    const focus = hoverId ?? selectedId;

    let body: string[];
    let panned = '';
    let pannable = false;
    if (map !== undefined) {
      const windowed = renderMapWindow(
        map,
        { color: cfg.color, unicode: cfg.unicode, spinnerFrame, focus, zoom },
        { x: offsetX, y: offsetY, width: viewW, height: viewH },
      );
      // clamp AFTER measuring so a shrinking map pulls the view back in
      const maxX = Math.max(0, windowed.contentWidth - viewW);
      const maxY = Math.max(0, windowed.contentHeight - viewH);
      if (offsetX > maxX || offsetY > maxY || offsetX < 0 || offsetY < 0) {
        offsetX = Math.min(Math.max(0, offsetX), maxX);
        offsetY = Math.min(Math.max(0, offsetY), maxY);
        paint();
        return;
      }
      pannable = maxX > 0 || maxY > 0;
      body = windowed.lines;
      lastHits = windowed.hits;
      lastContent = { w: windowed.contentWidth, h: windowed.contentHeight };
      if (offsetX !== 0 || offsetY !== 0) panned = `  (+${offsetX},+${offsetY})`;
    } else {
      // No map yet: the standby splash, but only on a real TTY — a piped run
      // must not stream an animation, so it keeps the one-line notice.
      body =
        (interactive ? splashFrame(notice, splashTick, viewW, viewH, cfg.unicode, cfg.color) : undefined) ??
        [fitWidth(notice, viewW)];
    }
    if (notice !== '' && map !== undefined) {
      body[body.length - 1] = fitWidth(`  ${notice}`, viewW);
    }

    // -- detail panel --
    const panelWidth = Math.max(10, cols - 2);
    let panel: PanelLine[];
    if (map === undefined) {
      panel = Array.from({ length: panelContentRows }, () => ({ text: '', sgr: '' }));
    } else if (focus !== undefined) {
      panel =
        nodePanel(map, focus, cfg.unicode, panelWidth, selectedId === focus, panelContentRows) ??
        mapPanel(map, cfg.unicode, panelWidth, panelContentRows);
    } else {
      panel = mapPanel(map, cfg.unicode, panelWidth, panelContentRows);
    }
    // the separator doubles as the drag handle — mark its grip in the middle
    const grip = cfg.unicode ? ' ⋯ ' : ' ~ ';
    const bar = (cfg.unicode ? '─' : '-').repeat(viewW);
    const gripAt = Math.max(0, Math.floor((viewW - grip.length) / 2));
    const separator = viewW > grip.length + 2 ? bar.slice(0, gripAt) + grip + bar.slice(gripAt + grip.length) : bar;
    const panelRows = [
      cfg.color ? `\x1b[90m${separator}${RESET}` : separator,
      ...panel.map((l) =>
        cfg.color && l.sgr !== '' && l.text !== '' ? ` \x1b[${l.sgr}m${l.text}${RESET}` : ` ${l.text}`,
      ),
    ];

    // -- top row: tab bar over top-level pages, or the breadcrumb of a dive --
    let tabLine: string | undefined;
    lastTabFiles = topFiles();
    if (inSubmap() && activeFile !== undefined) {
      // ⌫ parent title ▸ node label — the whole row is one "back" target.
      // The stack knows where we dived from; the scan supplies the linking
      // node's label and survives a restart with an empty stack.
      const stackParent = [...diveStack].reverse().find((f) => pageFiles.includes(f));
      const scanned = diveOrigin(cfg.file, activeFile, pageFiles, maps());
      const parentFile = stackParent ?? scanned?.parent;
      const parentTitle =
        parentFile !== undefined
          ? (pageData.get(parentFile)?.map?.title ??
            ((pageIdOfFile(cfg.file, parentFile) as string | undefined) ?? 'main'))
          : 'main';
      const nodeLabel = scanned?.label ?? map?.title ?? '';
      const crumbHead = ` ${cfg.unicode ? '⌫' : '<'} ${parentTitle} ${cfg.unicode ? '▸' : '>'} `;
      const head: TabSegment = { text: crumbHead, sgr: '90', lo: 1, hi: displayWidth(crumbHead), action: { kind: 'back' } };
      const tailText = fitWidth(`${nodeLabel} `, Math.max(1, viewW - displayWidth(crumbHead)));
      const tail: TabSegment = {
        text: tailText,
        sgr: '1',
        lo: head.hi + 1,
        hi: head.hi + displayWidth(tailText),
        action: { kind: 'back' },
      };
      lastTabSegments = [head, tail];
      tabLine = lastTabSegments
        .map((s) => (cfg.color && s.sgr !== '' ? `\x1b[${s.sgr}m${s.text}${RESET}` : s.text))
        .join('');
    } else if (tabRows() > 0) {
      const segments = pageTabRow(pageTabsOf(lastTabFiles), viewW, cfg.unicode, tabScroll);
      lastTabSegments = segments;
      tabLine = segments
        .map((s) => (cfg.color && s.sgr !== '' ? `\x1b[${s.sgr}m${s.text}${RESET}` : s.text))
        .join('');
    } else {
      lastTabSegments = [];
    }

    const zoomTag = `${cfg.unicode ? '⊕' : 'zoom'} ${zoomLabel(zoom)}`;
    const hint = !interactive
      ? cfg.file
      : (flash !== undefined ? `${flash.text} · ` : '') +
        `${zoomTag} · wheel zoom · ` +
        (pannable ? 'drag pan · ' : '') +
        'hover/click · 0 reset · q quit';
    // A footer wider than the pane would wrap and shear the whole frame.
    const footerText = fitWidth(` ${hint}${panned}`, viewW);
    const footer = cfg.color ? `\x1b[90m${footerText}${RESET}` : footerText;

    let frame = HOME;
    if (tabLine !== undefined) frame += tabLine + ERASE_LINE_END + '\n';
    for (let i = 0; i < viewH; i++) frame += (body[i] ?? '') + ERASE_LINE_END + '\n';
    for (const row of panelRows) frame += row + ERASE_LINE_END + '\n';
    frame += footer + ERASE_LINE_END;
    if (frame !== lastFrame) {
      process.stdout.write(frame);
      lastFrame = frame;
    }
  };

  /**
   * A size change needs more than a repaint: ConPTY (Windows) rewraps the
   * old screen content on resize, leaving artifacts a HOME+erase-per-line
   * frame never touches — so clear everything and force a full redraw.
   * Called from the 'resize' event AND from the poll below, because the
   * event is not reliably delivered on every Windows terminal host.
   */
  const handleResize = (): void => {
    lastCols = process.stdout.columns ?? lastCols;
    lastRows = process.stdout.rows ?? lastRows;
    lastFrame = '';
    process.stdout.write(CLEAR_ALL);
    paint();
  };

  const tick = (): void => {
    if ((process.stdout.columns ?? lastCols) !== lastCols || (process.stdout.rows ?? lastRows) !== lastRows) {
      handleResize();
    }

    // discover pages; a project without page files still watches the default
    const discovered = listPageFiles(cfg.file);
    pageFiles = discovered.length > 0 ? discovered : [cfg.file];
    for (const known of [...pageData.keys()]) {
      if (!pageFiles.includes(known)) {
        pageData.delete(known);
        pageViews.delete(known);
      }
    }

    for (const file of pageFiles) {
      let mtimeMs: number | undefined;
      try {
        mtimeMs = statSync(file).mtimeMs;
      } catch {
        continue; // file absent — keep waiting
      }
      const entry = pageData.get(file);
      if (mtimeMs === entry?.mtimeMs) continue;
      const loaded = loadMapFile(file);
      if (loaded.ok) {
        // background pages light their tab up; the startup scan is not news
        const becameFresh = !firstScan && file !== activeFile;
        pageData.set(file, { map: loaded.value, mtimeMs, fresh: becameFresh });
        if (file === activeFile) {
          map = loaded.value;
          notice = '';
        } else if (becameFresh && !topFiles().includes(file)) {
          // a hidden sub-map changed — it has no tab to light, so surface it here
          const title = loaded.value.title ?? ((pageIdOfFile(cfg.file, file) as string | undefined) ?? '?');
          flash = { text: `${cfg.unicode ? '⊞ ' : ''}${title} updated`, until: Date.now() + 4000 };
        }
      } else if (loaded.error.kind === 'malformed-json') {
        // plausible torn read from a foreign writer — retry next tick, keep the picture
      } else {
        pageData.set(file, { map: entry?.map, mtimeMs, fresh: entry?.fresh ?? false });
        if (file === activeFile) notice = describeStoreError(loaded.error);
      }
    }
    // An explicit focus request (--page, or the one-shot focus file) outranks
    // every default. On the spawn tick the --page argument is the newest
    // intent — a leftover focus file from a dead watcher merely gets swept;
    // afterwards the file channel is how a running pane is retargeted.
    const request = takeFocusRequest(cfg.file);
    if (request !== undefined && !(firstScan && pendingFocusFile !== undefined)) {
      pendingFocusFile = pageFilePath(cfg.file, request.page);
    }
    if (pendingFocusFile !== undefined && pageFiles.includes(pendingFocusFile)) {
      if (pendingFocusFile !== activeFile) switchPage(pendingFocusFile);
      pendingFocusFile = undefined;
    }
    firstScan = false;

    // nobody asked for a page: the most recently written one is the effort
    // under way — never just "first in the list"
    if (activeFile === undefined || !pageFiles.includes(activeFile)) {
      switchPage(mostRecentPageFile(pageFiles, (f) => pageData.get(f)?.mtimeMs)!);
    }

    // any page spinning keeps the animation alive
    if ([...pageData.values()].some((p) => p.map?.nodes.some((n) => n.status === 'in-progress'))) spinnerFrame++;
    if (flash !== undefined && Date.now() > flash.until) flash = undefined; // footer message expires
    paint();
  };

  if (interactive) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      const parsed = parseInput(pendingInput + chunk);
      pendingInput = parsed.rest;
      let dirty = false;
      for (const event of parsed.events) {
        switch (event.kind) {
          case 'quit':
            restore();
            return;
          case 'reset':
            offsetX = 0;
            offsetY = 0;
            zoom = ZOOM_DEFAULT;
            dirty = true;
            break;
          case 'clear':
            // Esc peels one layer: a pinned node first, then the dive itself
            if (selectedId !== undefined) selectedId = undefined;
            else climbBack();
            dirty = true;
            break;
          case 'pan':
            offsetX += event.dx;
            offsetY += event.dy;
            dirty = true;
            break;
          case 'zoom': {
            // a wheel over the tab strip browses the strip, not the zoom ladder
            if (event.at !== undefined && event.at.y === 1 && tabRows() > 0 && !inSubmap()) {
              tabScroll = Math.max(0, Math.min(tabScroll + (event.delta === 1 ? -1 : 1), topFiles().length - 1));
              dirty = true;
              break;
            }
            const next = clampZoom(zoom + event.delta);
            if (next === zoom || map === undefined) break;
            // anchor on the focused node, else whatever sits mid-view
            const anchorId =
              hoverId ?? selectedId ?? nearestHit(lastHits, offsetX + viewWidth() / 2, offsetY + viewHeight() / 2)?.id;
            const before = lastHits.find((h) => h.id === anchorId);
            zoom = next;
            const sized = renderMapWindow(
              map,
              { color: false, unicode: cfg.unicode, spinnerFrame: 0, zoom },
              { x: 0, y: 0, width: 0, height: 0 },
            );
            const after = before === undefined ? undefined : sized.hits.find((h) => h.id === before.id);
            const moved = anchorOffsets(
              before !== undefined && after !== undefined ? { before, after } : undefined,
              { x: offsetX, y: offsetY },
              lastContent,
              { w: sized.contentWidth, h: sized.contentHeight },
            );
            offsetX = moved.x;
            offsetY = moved.y;
            dirty = true;
            break;
          }
          case 'mouse-move': {
            const over = hitTest(event.x, event.y);
            if (over !== hoverId) {
              hoverId = over;
              dirty = true;
            }
            break;
          }
          case 'mouse-down':
            if (event.y === dividerY()) {
              dividerDrag = true; // grabbing the divider, not the map
              break;
            }
            dragAnchor = { x: event.x, y: event.y, ox: offsetX, oy: offsetY };
            press = { moved: false };
            break;
          case 'mouse-drag':
            if (dividerDrag) {
              const next = panelRowsFromDividerY(event.y, process.stdout.rows ?? 30, tabRows());
              if (next !== panelContentRows) {
                panelContentRows = next;
                dirty = true;
              }
              break;
            }
            if (dragAnchor) {
              // the content follows the mouse: drag right reveals the left
              const nx = dragAnchor.ox - (event.x - dragAnchor.x);
              const ny = dragAnchor.oy - (event.y - dragAnchor.y);
              if (nx !== offsetX || ny !== offsetY) {
                offsetX = nx;
                offsetY = ny;
                if (press) press.moved = true;
                dirty = true;
              }
            }
            break;
          case 'mouse-up':
            if (dividerDrag) {
              dividerDrag = false; // releasing the divider is not a click
              break;
            }
            if (press && !press.moved) {
              const tabHit =
                tabRows() > 0 && event.y === 1
                  ? lastTabSegments.find((s) => event.x >= s.lo && event.x <= s.hi)
                  : undefined;
              if (tabHit !== undefined) {
                // top row: the breadcrumb climbs back, ‹ › browse the strip, a tab switches
                if (tabHit.action.kind === 'back') {
                  climbBack();
                } else if (tabHit.action.kind === 'scroll') {
                  tabScroll = Math.max(0, Math.min(tabScroll + tabHit.action.delta, lastTabFiles.length - 1));
                } else {
                  const target = lastTabFiles[tabHit.action.index];
                  if (target !== undefined && target !== activeFile) handSwitch(target);
                }
              } else {
                // a press that never dragged is a click: pin, or unpin on empty.
                // A second click on the same node within the window is a
                // double-click — dive into its sub-map when it links one.
                const id = hitTest(event.x, event.y);
                const now = Date.now();
                if (id !== undefined && lastClick?.id === id && now - lastClick.at <= 450) {
                  const submap = map?.nodes.find((n) => (n.id as string) === id)?.submap;
                  if (submap !== undefined && activeFile !== undefined) {
                    const target = pageFilePath(cfg.file, submap as unknown as PageId);
                    if (pageFiles.includes(target) && target !== activeFile) {
                      diveStack.push(activeFile);
                      handSwitch(target);
                    } else if (!pageFiles.includes(target)) {
                      flash = { text: `submap "${submap as string}" has no page yet`, until: now + 2500 };
                    }
                  }
                  lastClick = undefined;
                } else {
                  lastClick = id !== undefined ? { id, at: now } : undefined;
                }
                selectedId = id;
              }
              dirty = true;
            }
            dragAnchor = undefined;
            press = undefined;
            break;
          case 'next-page':
          case 'prev-page': {
            // pages cycle over the TOP-LEVEL tabs; sub-maps are reached by diving
            const top = topFiles();
            if (top.length > 0 && activeFile !== undefined) {
              const current = top.indexOf(activeFile); // -1 inside a sub-map — steps to an end tab
              const step = event.kind === 'next-page' ? 1 : -1;
              const target = top[(current + step + top.length) % top.length]!;
              if (target !== activeFile) {
                handSwitch(target);
                dirty = true;
              }
            }
            break;
          }
          case 'page': {
            const target = topFiles()[event.index];
            if (target !== undefined && target !== activeFile) {
              handSwitch(target);
              dirty = true;
            }
            break;
          }
          case 'back':
            if (climbBack()) dirty = true;
            break;
        }
      }
      if (dirty) paint();
    });
    process.stdout.on('resize', handleResize);
  }

  tick();
  setInterval(tick, cfg.intervalMs);
  // The splash sweep runs faster than the file poll — its own timer, idle
  // (one comparison) the moment a map exists.
  if (interactive) {
    setInterval(() => {
      if (map !== undefined) return;
      splashTick++;
      paint();
    }, 80);
  }
}

/**
 * Run only as an entry point; importing this module (tests) must be inert.
 * npm bin shims launch through a symlink and shells may pass relative paths,
 * so argv[1] is compared by real path, with URL equality as the fallback
 * when either path cannot be resolved.
 */
export function launchedAsEntry(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return pathToFileURL(argv1).href === moduleUrl;
  }
}

if (launchedAsEntry(process.argv[1], import.meta.url)) {
  main();
}
