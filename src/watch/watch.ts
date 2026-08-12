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
 *                       [--no-color] [--no-mouse]
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type MellosMap, type NodeStatus } from '../domain/types.js';
import {
  type BoxHit,
  type ZoomStep,
  ZOOM_DEFAULT,
  clampZoom,
  fitWidth,
  renderMapWindow,
  wrapWidth,
  zoomLabel,
} from '../render/render.js';
import { STATE_FILE_RELATIVE_PATH, describeStoreError, loadMapFile } from '../store/store.js';
import { parseInput } from './input.js';

// Width helpers live with the renderer now; re-exported for panel tests.
export { fitWidth, wrapWidth };

interface WatchConfig {
  readonly file: string;
  readonly intervalMs: number;
  readonly unicode: boolean;
  readonly color: boolean;
  readonly mouse: boolean;
}

export function parseArgs(argv: readonly string[], cwd: string): WatchConfig {
  let file = join(cwd, STATE_FILE_RELATIVE_PATH);
  let intervalMs = 250;
  let unicode = true;
  let color = true;
  let mouse = true;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--file':
        file = argv[++i] ?? file;
        break;
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
  return { file, intervalMs, unicode, color, mouse };
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

/** separator + 6 content rows; the hint row comes on top of these. */
const PANEL_CONTENT_ROWS = 6;
const PANEL_ROWS = 1 + PANEL_CONTENT_ROWS;

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
 * The detail panel for a focused node: header, evidence, both wire
 * directions with each neighbour's status glyph, wrapped design notes.
 * Always exactly PANEL_CONTENT_ROWS lines (padded with blanks).
 */
export function nodePanel(
  map: MellosMap,
  focusId: string,
  unicode: boolean,
  width: number,
  pinned: boolean,
): PanelLine[] | undefined {
  const node = map.nodes.find((n) => (n.id as string) === focusId);
  if (!node) return undefined;
  const g = (s: NodeStatus): string => STATUS_GLYPH[s][unicode ? 0 : 1];
  const layerName = map.layers.find((l) => l.id === node.layer)?.name ?? (node.layer as string);
  const [right, left] = unicode ? ['→', '←'] : ['->', '<-'];
  const withGlyph = (id: string): string => {
    const n = map.nodes.find((x) => (x.id as string) === id);
    return n ? `${g(n.status)} ${n.label}` : id;
  };
  const uses = map.edges.filter((e) => e.from === node.id).map((e) => withGlyph(e.to as string));
  const usedBy = map.edges.filter((e) => e.to === node.id).map((e) => withGlyph(e.from as string));

  const pin = pinned ? (unicode ? '  ⊙ pinned' : '  * pinned') : '';
  const lines: PanelLine[] = [
    {
      text: fitWidth(`${g(node.status)} ${node.label} [${node.id}] · ${layerName} · ${node.status}${pin}`, width),
      sgr: `${STATUS_SGR[node.status]};1`,
    },
    { text: fitWidth(`evidence: ${node.evidence ?? '—'}`, width), sgr: '90' },
    { text: fitWidth(`uses ${right}  ${uses.join('  ') || '—'}`, width), sgr: '' },
    { text: fitWidth(`used by ${left}  ${usedBy.join('  ') || '—'}`, width), sgr: '' },
  ];
  const notes = node.detail !== undefined ? wrapWidth(node.detail, width) : ['(no design notes yet)'];
  const room = PANEL_CONTENT_ROWS - lines.length;
  for (let i = 0; i < room; i++) {
    const last = i === room - 1 && notes.length > room;
    lines.push({
      text: last ? fitWidth(notes[i]! + '…', width) : (notes[i] ?? ''),
      sgr: node.detail !== undefined ? '' : '90',
    });
  }
  return lines;
}

/** The dashboard shown when nothing is focused. Exactly PANEL_CONTENT_ROWS lines. */
export function mapPanel(map: MellosMap, unicode: boolean, width: number): PanelLine[] {
  const g = (s: NodeStatus): string => STATUS_GLYPH[s][unicode ? 0 : 1];
  const count = (s: NodeStatus): number => map.nodes.filter((n) => n.status === s).length;
  const statuses: NodeStatus[] = ['done', 'in-progress', 'planned', 'regressed'];
  const counts = statuses
    .filter((s) => count(s) > 0)
    .map((s) => `${g(s)} ${count(s)} ${s}`)
    .join('   ');
  return [
    { text: fitWidth(map.title ?? 'mellos map', width), sgr: '1' },
    {
      text: fitWidth(`${map.layers.length} layers · ${map.nodes.length} nodes · ${map.edges.length} edges`, width),
      sgr: '90',
    },
    { text: fitWidth(counts, width), sgr: '' },
    { text: '', sgr: '' },
    { text: 'hover a node to inspect · click to pin', sgr: '90' },
    { text: '', sgr: '' },
  ];
}

function main(): void {
  const cfg = parseArgs(process.argv.slice(2), process.cwd());
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const mouseActive = interactive && cfg.mouse;

  let lastMtimeMs = -1;
  let lastFrame = '';
  let spinnerFrame = 0;
  let map: MellosMap | undefined;
  let notice = `waiting for ${cfg.file} ...`;

  // viewport pan/zoom + interaction state
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

  const viewHeight = (): number => Math.max(1, (process.stdout.rows ?? 30) - PANEL_ROWS - 1);

  /** Terminal cell (1-based) -> node under it, honoring the current pan. */
  const hitTest = (termX: number, termY: number): string | undefined => {
    const sx = termX - 1;
    const sy = termY - 1;
    if (sy >= viewHeight()) return undefined; // inside the detail panel, not the map
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
    const viewH = viewHeight();
    const focus = hoverId ?? selectedId;

    let body: string[];
    let panned = '';
    let pannable = false;
    if (map !== undefined) {
      const windowed = renderMapWindow(
        map,
        { color: cfg.color, unicode: cfg.unicode, spinnerFrame, focus, zoom },
        { x: offsetX, y: offsetY, width: cols, height: viewH },
      );
      // clamp AFTER measuring so a shrinking map pulls the view back in
      const maxX = Math.max(0, windowed.contentWidth - cols);
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
      body = [notice];
    }
    if (notice !== '' && map !== undefined) body[body.length - 1] = `  ${notice}`;

    // -- detail panel --
    const panelWidth = Math.max(10, cols - 2);
    let panel: PanelLine[];
    if (map === undefined) {
      panel = Array.from({ length: PANEL_CONTENT_ROWS }, () => ({ text: '', sgr: '' }));
    } else if (focus !== undefined) {
      panel =
        nodePanel(map, focus, cfg.unicode, panelWidth, selectedId === focus) ?? mapPanel(map, cfg.unicode, panelWidth);
    } else {
      panel = mapPanel(map, cfg.unicode, panelWidth);
    }
    const separator = (cfg.unicode ? '─' : '-').repeat(cols);
    const panelRows = [
      cfg.color ? `\x1b[90m${separator}${RESET}` : separator,
      ...panel.map((l) =>
        cfg.color && l.sgr !== '' && l.text !== '' ? ` \x1b[${l.sgr}m${l.text}${RESET}` : ` ${l.text}`,
      ),
    ];

    const zoomTag = `${cfg.unicode ? '⊕' : 'zoom'} ${zoomLabel(zoom)}`;
    const hint = !interactive
      ? cfg.file
      : `${zoomTag} · wheel zoom · ` + (pannable ? 'drag pan · ' : '') + 'hover/click · 0 reset · q quit';
    const footer = cfg.color ? `\x1b[90m ${hint}${panned}${RESET}` : ` ${hint}${panned}`;

    let frame = HOME;
    for (let i = 0; i < viewH; i++) frame += (body[i] ?? '') + ERASE_LINE_END + '\n';
    for (const row of panelRows) frame += row + ERASE_LINE_END + '\n';
    frame += footer + ERASE_LINE_END;
    if (frame !== lastFrame) {
      process.stdout.write(frame);
      lastFrame = frame;
    }
  };

  const tick = (): void => {
    let mtimeMs: number | undefined;
    try {
      mtimeMs = statSync(cfg.file).mtimeMs;
    } catch {
      mtimeMs = undefined; // file absent — keep waiting
    }

    if (mtimeMs !== undefined && mtimeMs !== lastMtimeMs) {
      const loaded = loadMapFile(cfg.file);
      if (loaded.ok) {
        map = loaded.value;
        notice = '';
        lastMtimeMs = mtimeMs;
      } else if (loaded.error.kind === 'malformed-json') {
        // plausible torn read from a foreign writer — retry next tick, keep the picture
      } else {
        notice = describeStoreError(loaded.error);
        lastMtimeMs = mtimeMs;
      }
    }

    if (map?.nodes.some((n) => n.status === 'in-progress')) spinnerFrame++;
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
            selectedId = undefined;
            dirty = true;
            break;
          case 'pan':
            offsetX += event.dx;
            offsetY += event.dy;
            dirty = true;
            break;
          case 'zoom': {
            const next = clampZoom(zoom + event.delta);
            if (next === zoom || map === undefined) break;
            // anchor on the focused node, else whatever sits mid-view
            const cols = process.stdout.columns ?? 100;
            const anchorId =
              hoverId ?? selectedId ?? nearestHit(lastHits, offsetX + cols / 2, offsetY + viewHeight() / 2)?.id;
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
            dragAnchor = { x: event.x, y: event.y, ox: offsetX, oy: offsetY };
            press = { moved: false };
            break;
          case 'mouse-drag':
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
            if (press && !press.moved) {
              // a press that never dragged is a click: pin, or unpin on empty
              selectedId = hitTest(event.x, event.y);
              dirty = true;
            }
            dragAnchor = undefined;
            press = undefined;
            break;
        }
      }
      if (dirty) paint();
    });
    process.stdout.on('resize', paint);
  }

  tick();
  setInterval(tick, cfg.intervalMs);
}

// Run only as an entry point; importing this module (tests) must be inert.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
