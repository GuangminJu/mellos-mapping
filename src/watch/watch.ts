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
 *                  each page keeps its own pan/zoom/pin
 *   f              toggle auto-follow: on (default) the pane switches to the
 *                  page last WRITTEN — the map the agent is operating on
 *                  right now. A manual page switch turns follow off (the
 *                  footer says so); with follow off, background page changes
 *                  light their tab up instead of stealing the view
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
 * WHICH page is shown, and what is known about the others, is not decided
 * here: ./pane-state.js folds one look at the store into the next page set,
 * and this file is the shell around it — stdin, stdout, timers, the
 * filesystem, and the view (pan, zoom, pin) of whatever page that fold
 * chose. Every promise about pages — a request beats follow, the startup
 * scan is not news, a torn file never costs the last good picture — is
 * specified over there.
 *
 * Resilience contract: NOTHING a file or a picture does may take the pane
 * down. A torn or half-written file (only possible with foreign writers; our
 * own saves are atomic) leaves the last good picture up and the next poll
 * retries; a page that cannot be read at all, and a map the renderer refuses
 * to draw, become a visible error line on an otherwise live pane. The
 * terminal is handed back — mouse reporting off, cursor shown — however this
 * process ends, including a fault nobody foresaw: a pane that dies owing the
 * shell its mouse mode leaves the user with a terminal that reports every
 * mouse move as garbage until they reset it by hand.
 *
 * Usage: node watch.mjs [--file <path>] [--interval <ms>] [--ascii]
 *                       [--no-color] [--no-mouse] [--page <slug>] [--no-follow]
 */

import { realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mapStatus } from '../domain/ops.js';
import { type MellosMap, type NodeStatus, type Result, err, ok } from '../domain/types.js';
import {
  type NeighborRef,
  SPINNER_FRAMES,
  diveParent,
  focusInfo,
  interiorPages,
  statusGlyph,
} from '../semantics/semantics.js';
import {
  type BoxHit,
  type RenderOptions,
  type Viewport,
  type WindowedRender,
  type ZoomStep,
  ZOOM_DEFAULT,
  clampZoom,
  displayWidth,
  fitWidth,
  isNeutralKind,
  kindGlyph,
  renderMapWindow,
  statusSgr,
  wrapWidth,
  zoomLabel,
} from '../render/render.js';
import {
  PAGES_DIR_NAME,
  type PageId,
  STATE_FILE_RELATIVE_PATH,
  listPageFiles,
  loadMapFile,
  makePageId,
  migrateLegacyStore,
  pageFilePath,
  pageIdOfFile,
  takeFocusRequest,
} from '../store/store.js';
import { parseInput } from './input.js';
import {
  type PageFault,
  type PaneState,
  describePageFault,
  entryOf,
  filesOf,
  initialPaneState,
  mapOf,
  mapsOf,
  popDive,
  pushDive,
  scan,
  toggleFollow,
  userSwitch,
} from './pane-state.js';

// The page-set rules and their fault vocabulary live in ./pane-state.js;
// re-exported here so the pane has one import site, as it always had.
export { type PageFault, type PageEntry, type PaneState, describePageFault } from './pane-state.js';

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
  /** Start with auto-follow on (the pane switches to the page last written). */
  readonly follow: boolean;
}

/** Every way a command line can be refused, as data. */
export type ArgsError =
  | { readonly kind: 'unknown-flag'; readonly flag: string }
  | { readonly kind: 'missing-value'; readonly flag: string }
  | { readonly kind: 'invalid-value'; readonly flag: string; readonly raw: string; readonly rule: string };

export function describeArgsError(e: ArgsError): string {
  switch (e.kind) {
    case 'unknown-flag':
      return `unknown flag "${e.flag}"`;
    case 'missing-value':
      return `${e.flag} needs a value`;
    case 'invalid-value':
      return `${e.flag} got "${e.raw}" (expected: ${e.rule})`;
  }
}

export const USAGE =
  'usage: mellos-mapping-watch [--file <map.json>] [--page <slug>] [--interval <ms>] ' +
  '[--ascii] [--no-color] [--no-mouse] [--no-follow]';

/**
 * Parse the watcher's command line. A bad command line is REFUSED, never
 * silently patched over: a typo'd flag, a misspelled page slug or a
 * non-numeric interval used to be ignored ("the pane must come up"), which
 * meant the pane came up showing the WRONG thing with no hint why. The
 * launcher (scripts/open-pane.mjs) rejects unknown flags; both entry points
 * now hold the same line.
 */
export function parseArgs(argv: readonly string[], cwd: string): Result<WatchConfig, ArgsError> {
  let file = join(cwd, STATE_FILE_RELATIVE_PATH);
  let intervalMs = POLL_INTERVAL_DEFAULT_MS;
  let unicode = true;
  let color = true;
  let mouse = true;
  let page: PageId | undefined;
  let follow = true;
  // A value that looks like a flag is a missing value: `--file --ascii` is a
  // forgotten path, not a file named "--ascii".
  const valueOf = (flag: string, raw: string | undefined): Result<string, ArgsError> =>
    raw === undefined || raw.startsWith('--') ? err({ kind: 'missing-value', flag }) : ok(raw);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    switch (flag) {
      case '--file': {
        const value = valueOf(flag, argv[++i]);
        if (!value.ok) return value;
        file = value.value;
        break;
      }
      case '--page': {
        const value = valueOf(flag, argv[++i]);
        if (!value.ok) return value;
        const parsed = makePageId(value.value);
        if (!parsed.ok) return err({ kind: 'invalid-value', flag, raw: value.value, rule: parsed.error.rule });
        page = parsed.value;
        break;
      }
      case '--interval': {
        const value = valueOf(flag, argv[++i]);
        if (!value.ok) return value;
        const ms = Number(value.value);
        if (!Number.isFinite(ms) || ms <= 0) {
          return err({ kind: 'invalid-value', flag, raw: value.value, rule: 'a positive number of milliseconds' });
        }
        intervalMs = Math.max(POLL_INTERVAL_MIN_MS, ms);
        break;
      }
      case '--ascii':
        unicode = false;
        break;
      case '--no-color':
        color = false;
        break;
      case '--no-mouse':
        mouse = false;
        break;
      case '--no-follow':
        follow = false;
        break;
      default:
        return err({ kind: 'unknown-flag', flag });
    }
  }
  return ok({ file, intervalMs, unicode, color, mouse, page, follow });
}

// ---------------------------------------------------------------------------
// fault boundaries — the two places a live pane can be handed something it
// cannot process: a file it cannot read, and a map it cannot draw
// ---------------------------------------------------------------------------

/**
 * Read a page file, turning EVERY fault into a value.
 *
 * loadMapFile answers the expected faults (missing file, malformed JSON,
 * broken invariants) with a Result and rethrows the rest — a page path that
 * is a DIRECTORY (`pages/x.json/`, EISDIR), one the user may not read
 * (EACCES), a name the filesystem refuses. Inside the poll timer such an
 * exception has nowhere to go: it killed the pane and left the terminal in
 * mouse-reporting mode. A page the watcher cannot read is news to show, not
 * a reason to stop showing anything.
 */
export function readPage(file: string): Result<MellosMap, PageFault> {
  try {
    return loadMapFile(file);
  } catch (e) {
    return err({ kind: 'unreadable', path: file, detail: (e as NodeJS.ErrnoException).code ?? (e as Error).message });
  }
}

/**
 * renderMapWindow, with a renderer fault turned into a value.
 *
 * The picture is pure and total for every map the store admits, but it is
 * also the longest computation in this process; a fault in it must cost the
 * frame, not the pane. The caller shows the message where the map would be.
 */
export function renderWindow(map: MellosMap, opts: RenderOptions, viewport: Viewport): Result<WindowedRender, string> {
  try {
    return ok(renderMapWindow(map, opts, viewport));
  } catch (e) {
    return err(`this map could not be drawn: ${(e as Error).message}`);
  }
}

/**
 * The map/panel separator row: a full-width bar with the drag grip in the
 * middle and — while auto-follow is on — a right-aligned follow tag, so the
 * pane always shows whether it will jump to the next written page. Every
 * glyph involved is single-column, so slicing by characters is slicing by
 * columns. Colors belong to the caller.
 */
export function dividerRow(width: number, unicode: boolean, follow: boolean): string {
  const grip = unicode ? ' ⋯ ' : ' ~ ';
  let bar = (unicode ? '─' : '-').repeat(width);
  const gripAt = Math.max(0, Math.floor((width - grip.length) / 2));
  if (width > grip.length + 2) bar = bar.slice(0, gripAt) + grip + bar.slice(gripAt + grip.length);
  if (follow) {
    const tag = unicode ? ' ⇢ follow ' : ' > follow ';
    const at = width - tag.length - 1;
    if (at > gripAt + grip.length) bar = bar.slice(0, at) + tag + bar.slice(at + tag.length);
  }
  return bar;
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

/**
 * The escape sequences that hand the terminal back exactly as it was found:
 * mouse reporting off (only if this pane turned it on), cursor visible,
 * attributes reset. Written on every exit path there is — a pane that dies
 * without them leaves the shell reporting every mouse move as garbage.
 */
export function terminalRestoreSequence(mouseActive: boolean): string {
  return (mouseActive ? MOUSE_OFF : '') + SHOW_CURSOR + RESET + '\n';
}

/** Default detail-panel height; the divider drag adjusts it at runtime. */
const PANEL_CONTENT_ROWS = 6;
export const PANEL_ROWS_MIN = 2;
/** The map keeps at least this many body rows however far the divider is pulled. */
const MAP_ROWS_MIN = 4;

// ---------------------------------------------------------------------------
// the pane's clock and its fallbacks — every number a reader would ask about
// ---------------------------------------------------------------------------

/**
 * How often the store is polled, in ms. A quarter second reads as
 * "immediately" beside a conversation, and a stat per page at that rate costs
 * nothing.
 */
const POLL_INTERVAL_DEFAULT_MS = 250;
/**
 * Floor for `--interval`. Below this the poll costs more than the picture is
 * worth, and a hand-typed `--interval 0` would spin a core.
 */
const POLL_INTERVAL_MIN_MS = 50;

/**
 * How often the standby screen repaints while no map exists (~12fps). The
 * water animation is the only moving thing there, and it is decoration.
 */
const SPLASH_FRAME_MS = 80;

/**
 * How long a footer message stays up, in three tiers by how much the reader
 * has to do about it: a state change they just caused is an acknowledgement;
 * a state change with a consequence, or a request that could not be served,
 * needs a beat longer; news from a page they cannot see has to survive a
 * glance elsewhere.
 */
const FLASH_ACK_MS = 2500;
const FLASH_NOTICE_MS = 3000;
const FLASH_BACKGROUND_NEWS_MS = 4000;

/**
 * Two clicks on one node within this window are a double-click (dive). Just
 * under the ~500ms platform default, because the second click must also land
 * on the same box, which already rules out most accidents.
 */
const DOUBLE_CLICK_MS = 450;

/**
 * Terminal size to assume when stdout reports none — a pipe, a CI log, a
 * terminal that answers late. Roughly a classic 100x30 window: wide enough
 * that the picture is not shredded, small enough that a real terminal will
 * not clip it later.
 */
const FALLBACK_COLUMNS = 100;
const FALLBACK_ROWS = 30;

/**
 * What a tab or a breadcrumb calls the DEFAULT page when its map carries no
 * title. The default page has no slug to fall back on — it is the one page a
 * node's `submap` cannot name — so it needs a word of its own.
 */
const DEFAULT_PAGE_TAB_LABEL = 'main';

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
    const glyph = statusGlyph(tab.status, unicode);
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
        ? `${statusSgr(tab.status)};1`
        : tab.fresh
          ? statusSgr(tab.status)
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
 * Pages that deserve a tab: everything not INTERIOR. A page some other page
 * dives into is interior detail — reached by double-clicking that node, never
 * by sitting beside its parent as a sibling. The default page is never
 * hidden.
 *
 * The rule needs each page's own slug, not just its map: a page that links
 * ITSELF, or two pages that link each other, are loops with no outside, and
 * "hide everything anyone dives into" erased their tabs — in the mutual case,
 * the whole strip. interiorPages (../semantics) owns that judgement.
 */
export function topLevelFiles(
  defaultFile: string,
  files: readonly string[],
  mapOf: ReadonlyMap<string, MellosMap | undefined>,
): string[] {
  const interior = interiorPages(files.map((f) => [pageIdOfFile(defaultFile, f), mapOf.get(f)] as const));
  return files.filter((f) => {
    const id = pageIdOfFile(defaultFile, f);
    return id === undefined || !interior.has(id as string);
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
  const entries = files.filter((f) => f !== file).map((f) => [f, mapOf.get(f)] as const);
  return diveParent(entries, id as string);
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
  const g = (s: NodeStatus): string => statusGlyph(s, unicode);
  const pinMark = pinned ? (unicode ? '  ⊙ pinned' : '  * pinned') : '';
  const focus = focusInfo(map, focusId);
  if (focus === undefined) return undefined;
  const refText = (r: NeighborRef): string =>
    `${g(r.status)} ${r.label}${r.edgeLabel !== undefined ? ` (${r.edgeLabel})` : ''}`;

  if (focus.kind === 'group') {
    const { group, status, layerName, members } = focus;
    const [right, left] = unicode ? ['→', '←'] : ['->', '<-'];
    const uses = focus.uses.map(refText);
    const usedBy = focus.usedBy.map(refText);
    const lines: PanelLine[] = [
      {
        text: fitWidth(
          `${g(status)} ${group.label} [${group.id}] · ${layerName} · ${status} · ${members.length} member(s)${pinMark}`,
          width,
        ),
        sgr: `${statusSgr(status)};1`,
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

  const { node, layerName, laneLabel } = focus;
  const neutral = isNeutralKind(map);
  const [right, left] = unicode ? ['→', '←'] : ['->', '<-'];
  // An edge label rides along in parentheses: what flows between the nodes.
  const uses = focus.uses.map(refText);
  const usedBy = focus.usedBy.map(refText);

  const pin = pinMark;
  // Documentation kinds hide the status vocabulary: kind glyph (or bullet)
  // instead of the status glyph, no status word, no status color.
  const headGlyph = neutral
    ? (node.kind !== undefined ? kindGlyph(node.kind as string, unicode) : undefined) ?? (unicode ? '·' : '.')
    : g(node.status);
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
      sgr: neutral ? '1' : `${statusSgr(node.status)};1`,
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
 * The standby state — open water and diagnostics.
 *
 * Before any map exists the pane used to spell the plugin name in a block
 * font; field feedback preferred information over decoration, so the letters
 * are gone. The ripple engine (community PR#1) now paints bare water: rings
 * born at a randomized corner every WAVE_INTERVAL frames expand as damped
 * fronts, the ink of a cell is the SUM of every live ring over it — crests
 * reinforce, a crest meeting a trough cancels — and STILL water stays blank,
 * so only the moving interference pattern shows. Surface height drives one
 * continuous indigo→cyan→white ramp; without color the same field shades the
 * ink instead, so a --no-color --ascii pane still ripples. Below the water:
 * the spinner line and the waiting diagnostics (what is being watched, for
 * how long, and any file that exists but refuses to load).
 *
 * Everything here is a pure function of `frame` — no Math.random, so the
 * animation is reproducible and testable.
 */
const WATER_ROWS = 7;
const WATER_COLS_MAX = 60;

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

/** m:ss below an hour, h:mm:ss beyond — how long the pane has been waiting. */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** Everything the waiting screen can truthfully report. */
export interface WaitingStatus {
  readonly defaultFile: string;
  readonly pagesDir: string;
  readonly intervalMs: number;
  /**
   * Time on the standby clock — omitted by non-TTY consumers: a ticking
   * clock would turn a piped run into a frame-per-second stream.
   */
  readonly elapsedMs?: number | undefined;
  /** Store errors of map files that exist but do not load (path included). */
  readonly broken: readonly string[];
}

/**
 * The waiting diagnostics: which paths are polled, at what rate, for how
 * long, which files were found but refuse to load, and what ends the wait.
 * Plain lines clipped to `width`; the caller owns placement and color.
 */
export function waitingInfo(s: WaitingStatus, width: number): string[] {
  const w = Math.max(1, width);
  const clock = s.elapsedMs !== undefined ? ` · waiting ${elapsedLabel(s.elapsedMs)}` : '';
  const lines = [
    `watching  ${s.defaultFile}`,
    `      and ${join(s.pagesDir, '*.json')}`,
    `polling every ${s.intervalMs} ms${clock}`,
  ];
  for (const b of s.broken) lines.push(`! ${b}`);
  lines.push('the map appears at the first mmap_declare');
  return lines.map((l) => fitWidth(l, w));
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
 * The full standby frame — water, spinner line, diagnostics — centered in a
 * `width` x `height` viewport, ANSI already applied. Returns undefined when
 * the pane is too small for it all; the caller then falls back to plain
 * text lines.
 */
export function splashFrame(
  notice: string,
  info: readonly string[],
  frame: number,
  width: number,
  height: number,
  unicode: boolean,
  color: boolean,
): string[] | undefined {
  const fieldW = Math.min(width - 4, WATER_COLS_MAX);
  if (fieldW < 24 || height < WATER_ROWS + info.length + 3) return undefined;

  const mode = unicode ? 'unicode' : 'ascii';
  const shades = SPLASH_SHADES[mode];
  const indent = ' '.repeat(Math.max(0, Math.floor((width - fieldW) / 2)));
  const ripples = liveRipples(frame, fieldW, WATER_ROWS);

  // Open water: still cells stay blank; only where rings pass does ink appear,
  // shade by |level| so the crest-trough texture survives even in color mode.
  const paintRow = (y: number): string => {
    const levels = Array.from({ length: fieldW }, (_, x) => waveLevel(waveAt(ripples, x, y)));
    let out = '';
    for (let i = 0; i < fieldW; ) {
      const level = levels[i]!;
      let j = i;
      while (j < fieldW && levels[j] === level) j++;
      if (level === 0) out += ' '.repeat(j - i);
      else {
        const ink = shades[Math.abs(level)]!.repeat(j - i);
        out += color ? `\x1b[38;5;${WAVE_RAMP[WAVE_LEVELS + level]!}m${ink}${RESET}` : ink;
      }
      i = j;
    }
    return out;
  };

  const dim = (s: string): string => (color ? `\x1b[90m${s}${RESET}` : s);
  const spinner = SPINNER_FRAMES[mode];
  const status = fitWidth(`${spinner[frame % spinner.length]!} ${notice}`, Math.max(1, width - 2));
  const statusIndent = ' '.repeat(Math.max(0, Math.floor((width - displayWidth(status)) / 2)));
  const infoWidth = Math.max(0, ...info.map((l) => displayWidth(l)));
  const infoIndent = ' '.repeat(Math.max(0, Math.floor((width - infoWidth) / 2)));
  const block = [
    ...Array.from({ length: WATER_ROWS }, (_, y) => indent + paintRow(y)),
    '',
    statusIndent + dim(status),
    '',
    ...info.map((l) => infoIndent + dim(l)),
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
  const g = (s: NodeStatus): string => statusGlyph(s, unicode);
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

/**
 * VIOLATION: single-responsibility, state-control - main() is one ~600-line
 * closure holding the pane's whole VIEW state (pan, zoom, pin, hover, drag
 * anchors, panel height, flash, tab scroll, last click) as mutable locals,
 * with paint() reading all of them and writing to stdout.
 *
 * Half of what used to live here is already out: WHICH page is shown and what
 * is known about the others is a fold over a value (./pane-state.ts), input
 * is a pure parse (./input.ts), and the picture is pure (../render/). What is
 * left is genuinely the shell — stdin, stdout, timers, the filesystem — plus
 * the view, and the view is the half that has not moved yet.
 *
 * Why it stays for now: every remaining local is read by paint(), so
 * extracting them means designing the view VALUE (one per page, parked on
 * switch, clamped on resize) and a reducer over the same InputEvent stream
 * pane-state already folds — a change the size of the page-set extraction,
 * with every interaction of the pane as its blast radius. Landing both in one
 * pass would have left neither reviewable.
 *
 * Follow-up: a PaneView value + reducer beside PaneState, leaving main() with
 * the I/O and the two folds. Until then this function is specified from the
 * outside: every pure helper it calls has its own spec, and watch.test.ts
 * covers the panel, the tab strip, the divider and the standby screen.
 */
function main(): void {
  const parsed = parseArgs(process.argv.slice(2), process.cwd());
  if (!parsed.ok) {
    console.error(`mellos-mapping-watch: ${describeArgsError(parsed.error)}\n${USAGE}`);
    process.exit(1);
  }
  const cfg = parsed.value;
  // One-time move of a pre-0.20 `.claude` store into `.mellos` (store.ts).
  // Announce it on stderr before the alternate screen opens, so the move is
  // not something the user only discovers from `git status`.
  if (migrateLegacyStore(cfg.file)) console.error('mellos-mapping: moved the legacy .claude map store to .mellos/ — commit the move.');
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const mouseActive = interactive && cfg.mouse;

  let lastFrame = '';
  let spinnerFrame = 0;
  let splashTick = 0;
  const startedAt = Date.now();
  const standbyNotice = 'waiting for the first mmap_declare ...';
  let map: MellosMap | undefined;
  let notice = standbyNotice;
  let lastCols = process.stdout.columns ?? 0;
  let lastRows = process.stdout.rows ?? 0;

  // Pages — one map file each. Which page is shown and what is known about
  // the others is a value the reducer folds (./pane-state.js); this shell
  // owns only the I/O around it and the VIEW of the page on screen.
  interface PageView {
    offsetX: number;
    offsetY: number;
    zoom: ZoomStep;
    selectedId: string | undefined;
  }
  let pane: PaneState = initialPaneState(
    cfg.follow,
    cfg.page === undefined ? undefined : pageFilePath(cfg.file, cfg.page),
  );
  const pageViews = new Map<string, PageView>();
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
  let flash: { text: string; until: number } | undefined;
  /** Tab-bar files as painted (top-level pages only), for click hit-testing. */
  let lastTabFiles: string[] = [];

  const topFiles = (): string[] => topLevelFiles(cfg.file, filesOf(pane), mapsOf(pane));
  /** Inside a sub-map the tab row becomes the breadcrumb instead. */
  const inSubmap = (): boolean => pane.activeFile !== undefined && !topFiles().includes(pane.activeFile);
  const tabRows = (): number => (topFiles().length > 1 || inSubmap() ? 1 : 0);
  /** Climb out of the last dive; with no stack, derive the parent by scan. */
  const climbBack = (): boolean => {
    const climbed = popDive(pane);
    pane = climbed.state;
    const parent =
      climbed.parent ??
      (pane.activeFile !== undefined
        ? diveOrigin(cfg.file, pane.activeFile, filesOf(pane), mapsOf(pane))?.parent
        : undefined);
    if (parent !== undefined && parent !== pane.activeFile) {
      handSwitch(parent);
      return true;
    }
    return false;
  };
  const viewWidth = (): number => usableColumns(process.stdout.columns ?? FALLBACK_COLUMNS);
  const viewHeight = (): number =>
    Math.max(1, (process.stdout.rows ?? FALLBACK_ROWS) - (1 + panelContentRows) - 1 - tabRows());
  /** Terminal row (1-based) of the map/panel separator — the draggable divider. */
  const dividerY = (): number => tabRows() + viewHeight() + 1;

  /** The tab strip's view models for `files`, in tab order. */
  const pageTabsOf = (files: readonly string[]): PageTab[] =>
    files.map((f) => {
      const entry = entryOf(pane, f);
      const m = mapOf(entry);
      return {
        title: m?.title ?? ((pageIdOfFile(cfg.file, f) as string | undefined) ?? DEFAULT_PAGE_TAB_LABEL),
        status: m !== undefined ? mapStatus(m) : 'planned',
        active: f === pane.activeFile,
        fresh: entry?.fresh ?? false,
        neutral: m !== undefined && isNeutralKind(m),
      };
    });

  /**
   * What the pane says when it cannot show a map: a fault outranks
   * everything, a missing DEFAULT file is the virgin-project standby (the
   * diagnostics block already names the watched paths), and a missing PAGE
   * file is transient until the next scan. A fault with a last good map
   * behind it is worth saying too — unless it is a torn read, which the next
   * tick will most likely undo.
   */
  const noticeFor = (file: string | undefined): string => {
    const entry = entryOf(pane, file);
    if (entry === undefined || entry.state.kind === 'absent') {
      return file === undefined || file === cfg.file ? standbyNotice : `waiting for ${file} ...`;
    }
    if (entry.state.kind === 'loaded') return '';
    return entry.state.transient && entry.state.lastGood !== undefined ? '' : describePageFault(entry.state.fault);
  };

  /** Adopt what the pane state now says: the active page's map and message. */
  const adoptPage = (): void => {
    map = mapOf(entryOf(pane, pane.activeFile));
    notice = noticeFor(pane.activeFile);
  };

  /**
   * Follow a page change: park the view of the page being left, restore the
   * one being entered (or defaults), and keep the active tab on screen.
   */
  const adoptView = (previous: string | undefined): void => {
    const file = pane.activeFile;
    if (file === undefined || file === previous) return;
    if (previous !== undefined) pageViews.set(previous, { offsetX, offsetY, zoom, selectedId });
    const view = pageViews.get(file);
    offsetX = view?.offsetX ?? 0;
    offsetY = view?.offsetY ?? 0;
    zoom = view?.zoom ?? ZOOM_DEFAULT;
    selectedId = view?.selectedId;
    hoverId = undefined;
    // the strip follows the switch — the active tab must never sit off-screen
    const top = topFiles();
    const tabIndex = top.indexOf(file);
    if (tabIndex >= 0) tabScroll = tabScrollFor(pageTabsOf(top), viewWidth(), cfg.unicode, tabScroll, tabIndex);
  };

  /**
   * A page switch the USER made — the reducer withdraws any pending focus
   * request and turns auto-follow off: a pane that yanks the view back while
   * its user is deliberately looking elsewhere would make follow its enemy.
   */
  const handSwitch = (file: string): void => {
    const previous = pane.activeFile;
    const switched = userSwitch(pane, file);
    pane = switched.state;
    if (switched.followTurnedOff) {
      flash = { text: 'auto-follow off — press f to re-enable', until: Date.now() + FLASH_NOTICE_MS };
    }
    adoptView(previous);
    adoptPage();
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
  // ONE cleanup, on the one event every exit path passes through: signals,
  // the q key, a timer callback that threw, a bug nobody predicted. Handlers
  // that each restored the terminal themselves covered only the exits their
  // author thought of, and the pane has more of them than that.
  process.on('exit', () => process.stdout.write(terminalRestoreSequence(mouseActive)));
  const quit = (): void => process.exit(0);
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  process.on('uncaughtException', (e: unknown) => {
    // Nothing here is recoverable — but the terminal is the user's, not ours,
    // so it goes back before the report does. exit() runs the hook above.
    process.stderr.write(`\nthe map pane stopped: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(1);
  });

  const paint = (): void => {
    const cols = process.stdout.columns ?? FALLBACK_COLUMNS;
    const viewW = viewWidth();
    // a shrunken terminal may no longer afford the dragged panel height
    panelContentRows = clampPanelRows(panelContentRows, process.stdout.rows ?? FALLBACK_ROWS, tabRows());
    const viewH = viewHeight();
    const focus = hoverId ?? selectedId;

    let body: string[];
    let panned = '';
    let pannable = false;
    if (map !== undefined) {
      const rendered = renderWindow(
        map,
        { color: cfg.color, unicode: cfg.unicode, spinnerFrame, focus, zoom },
        { x: offsetX, y: offsetY, width: viewW, height: viewH },
      );
      if (!rendered.ok) {
        // A picture this pane cannot draw is a visible line, never a dead
        // pane: the tabs, the panel and the keys all keep working.
        body = ['', fitWidth(`  ! ${rendered.error}`, viewW), ''];
        lastHits = [];
      } else {
        const windowed = rendered.value;
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
      }
    } else {
      // No map yet: waiting diagnostics, with the water animation only on a
      // real TTY — a piped run must not stream an animation.
      const info = waitingInfo(
        {
          defaultFile: cfg.file,
          pagesDir: join(dirname(cfg.file), PAGES_DIR_NAME),
          intervalMs: cfg.intervalMs,
          elapsedMs: interactive ? Date.now() - startedAt : undefined,
          broken: pane.pages.flatMap((p) =>
            p.state.kind === 'faulted' && p.state.lastGood === undefined ? [describePageFault(p.state.fault)] : [],
          ),
        },
        Math.max(1, viewW - 2),
      );
      body =
        (interactive ? splashFrame(notice, info, splashTick, viewW, viewH, cfg.unicode, cfg.color) : undefined) ??
        [fitWidth(notice, viewW), '', ...info.map((l) => fitWidth(` ${l}`, viewW))];
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
    // the separator doubles as the drag handle and carries the follow tag
    const separator = dividerRow(viewW, cfg.unicode, pane.follow);
    const panelRows = [
      cfg.color ? `\x1b[90m${separator}${RESET}` : separator,
      ...panel.map((l) =>
        cfg.color && l.sgr !== '' && l.text !== '' ? ` \x1b[${l.sgr}m${l.text}${RESET}` : ` ${l.text}`,
      ),
    ];

    // -- top row: tab bar over top-level pages, or the breadcrumb of a dive --
    let tabLine: string | undefined;
    lastTabFiles = topFiles();
    if (inSubmap() && pane.activeFile !== undefined) {
      // ⌫ parent title ▸ node label — the whole row is one "back" target.
      // The stack knows where we dived from; the scan supplies the linking
      // node's label and survives a restart with an empty stack.
      const stackParent = pane.diveStack[pane.diveStack.length - 1];
      const origin = diveOrigin(cfg.file, pane.activeFile, filesOf(pane), mapsOf(pane));
      const parentFile = stackParent ?? origin?.parent;
      const parentTitle =
        parentFile !== undefined
          ? (mapOf(entryOf(pane, parentFile))?.title ??
            ((pageIdOfFile(cfg.file, parentFile) as string | undefined) ?? DEFAULT_PAGE_TAB_LABEL))
          : DEFAULT_PAGE_TAB_LABEL;
      const nodeLabel = origin?.label ?? map?.title ?? '';
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
    const files = discovered.length > 0 ? discovered : [cfg.file];
    const request = takeFocusRequest(cfg.file);
    const previous = pane.activeFile;
    const scanned = scan(pane, {
      files,
      mtimeAt: (file) => {
        try {
          return statSync(file).mtimeMs;
        } catch {
          return undefined; // file absent — keep waiting
        }
      },
      load: readPage,
      focusRequest: request === undefined ? undefined : pageFilePath(cfg.file, request.page),
      // a drag in progress holds auto-follow off: the user is engaged with
      // THIS page, and a missed switch is re-triggered by the next save
      engaged: dragAnchor !== undefined,
    });
    pane = scanned.state;
    for (const known of [...pageViews.keys()]) {
      if (!files.includes(known)) pageViews.delete(known); // the page is gone; so is its view
    }
    adoptView(previous);
    adoptPage();

    // a hidden sub-map changed — it has no tab to light, so surface it here
    const top = topFiles();
    for (const file of scanned.freshened) {
      if (top.includes(file)) continue;
      const title = mapOf(entryOf(pane, file))?.title ?? ((pageIdOfFile(cfg.file, file) as string | undefined) ?? '?');
      flash = { text: `${cfg.unicode ? '⊞ ' : ''}${title} updated`, until: Date.now() + FLASH_BACKGROUND_NEWS_MS };
    }

    // any page spinning keeps the animation alive
    if (pane.pages.some((p) => mapOf(p)?.nodes.some((n) => n.status === 'in-progress'))) spinnerFrame++;
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
            quit();
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
            const measured = renderWindow(
              map,
              { color: false, unicode: cfg.unicode, spinnerFrame: 0, zoom },
              { x: 0, y: 0, width: 0, height: 0 },
            );
            if (!measured.ok) {
              dirty = true; // the new zoom stands; paint() reports why it is blank
              break;
            }
            const sized = measured.value;
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
              const next = panelRowsFromDividerY(event.y, process.stdout.rows ?? FALLBACK_ROWS, tabRows());
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
                  if (target !== undefined && target !== pane.activeFile) handSwitch(target);
                }
              } else {
                // a press that never dragged is a click: pin, or unpin on empty.
                // A second click on the same node within the window is a
                // double-click — dive into its sub-map when it links one.
                const id = hitTest(event.x, event.y);
                const now = Date.now();
                if (id !== undefined && lastClick?.id === id && now - lastClick.at <= DOUBLE_CLICK_MS) {
                  const submap = map?.nodes.find((n) => (n.id as string) === id)?.submap;
                  if (submap !== undefined && pane.activeFile !== undefined) {
                    // VIOLATION: no-primitive-obsession - SubmapRef and PageId
                    // are two brands over ONE grammar (ID_RULE), and this is
                    // the seam where a map's reference becomes a store
                    // identity. Neither layer may own the other's brand —
                    // Layer 0 would then name a persistence concept, and the
                    // store would name a map field — so the crossing is a
                    // cast wherever it happens; here it is one line, checked
                    // against the real page set on the very next statement (a
                    // slug naming no file only flashes a notice).
                    const target = pageFilePath(cfg.file, submap as unknown as PageId);
                    const files = filesOf(pane);
                    if (files.includes(target) && target !== pane.activeFile) {
                      pane = pushDive(pane, pane.activeFile);
                      handSwitch(target);
                    } else if (!files.includes(target)) {
                      flash = { text: `submap "${submap as string}" has no page yet`, until: now + FLASH_ACK_MS };
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
            if (top.length > 0 && pane.activeFile !== undefined) {
              const current = top.indexOf(pane.activeFile); // -1 inside a sub-map — steps to an end tab
              const step = event.kind === 'next-page' ? 1 : -1;
              const target = top[(current + step + top.length) % top.length]!;
              if (target !== pane.activeFile) {
                handSwitch(target);
                dirty = true;
              }
            }
            break;
          }
          case 'page': {
            const target = topFiles()[event.index];
            if (target !== undefined && target !== pane.activeFile) {
              handSwitch(target);
              dirty = true;
            }
            break;
          }
          case 'back':
            if (climbBack()) dirty = true;
            break;
          case 'follow-toggle':
            pane = toggleFollow(pane);
            flash = { text: pane.follow ? 'auto-follow on' : 'auto-follow off', until: Date.now() + FLASH_ACK_MS };
            dirty = true;
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
    }, SPLASH_FRAME_MS);
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
