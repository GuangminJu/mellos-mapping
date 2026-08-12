/**
 * Layer 4b — the split-pane watcher.
 *
 * A deliberately tiny terminal program: poll the state file's mtime,
 * re-render on change, keep the spinner turning while any node is in
 * progress. The state file is the only channel between the MCP server and
 * this process — no sockets, no IPC, one direction of flow.
 *
 * Interaction (real TTY only; piped/CI runs stay pure output):
 *   hover a node   spotlight its wires, preview its details below the map
 *   click a node   pin it — details stay after the mouse leaves
 *   click empty / Esc   unpin
 *   left-drag      pan when the map is larger than the pane
 *   wheel / shift+wheel, hjkl / arrows, 0   pan / nudge / reset
 *   q              quit
 * The bottom of the pane is stable: two resident detail rows plus one hint
 * row — details never float over the map and the layout never jumps.
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
import { type BoxHit, displayWidth, renderMapWindow } from '../render/render.js';
import { STATE_FILE_RELATIVE_PATH, describeStoreError, loadMapFile } from '../store/store.js';
import { parseInput } from './input.js';

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

const DETAIL_ROWS = 2;

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

/** Truncate to a display width, ANSI-free input, appending … when cut. */
function fitWidth(s: string, width: number): string {
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

/** The two resident detail rows for the focused node (plain text, no ANSI). */
export function nodeDetails(map: MellosMap, focusId: string, unicode: boolean): [string, string] | undefined {
  const node = map.nodes.find((n) => (n.id as string) === focusId);
  if (!node) return undefined;
  const layerName = map.layers.find((l) => l.id === node.layer)?.name ?? (node.layer as string);
  const glyph = STATUS_GLYPH[node.status][unicode ? 0 : 1];
  const evidence = node.evidence !== undefined ? ` — ${node.evidence}` : '';
  const labelOf = (id: string): string => map.nodes.find((n) => (n.id as string) === id)?.label ?? id;
  const uses = map.edges.filter((e) => e.from === node.id).map((e) => labelOf(e.to as string));
  const usedBy = map.edges.filter((e) => e.to === node.id).map((e) => labelOf(e.from as string));
  const arrow = unicode ? ['→', '←'] : ['->', '<-'];
  return [
    `${glyph} ${node.label} [${node.id}] · ${layerName} · ${node.status}${evidence}`,
    `uses ${arrow[0]} ${uses.join(', ') || '—'}   used by ${arrow[1]} ${usedBy.join(', ') || '—'}`,
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

  // viewport pan + interaction state
  let offsetX = 0;
  let offsetY = 0;
  let dragAnchor: { x: number; y: number; ox: number; oy: number } | undefined;
  let press: { moved: boolean } | undefined;
  let hoverId: string | undefined;
  let selectedId: string | undefined;
  let lastHits: readonly BoxHit[] = [];
  let pendingInput = '';

  const viewHeight = (): number => Math.max(1, (process.stdout.rows ?? 30) - DETAIL_ROWS - 1);

  /** Terminal cell (1-based) -> node under it, honoring the current pan. */
  const hitTest = (termX: number, termY: number): string | undefined => {
    const sx = termX - 1;
    const sy = termY - 1;
    if (sy >= viewHeight()) return undefined; // below the map area
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
        { color: cfg.color, unicode: cfg.unicode, spinnerFrame, focus },
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
      if (offsetX !== 0 || offsetY !== 0) panned = `  (+${offsetX},+${offsetY})`;
    } else {
      body = [notice];
    }
    if (notice !== '' && map !== undefined) body[body.length - 1] = `  ${notice}`;

    // -- resident detail rows --
    let detail1 = '';
    let detail2 = '';
    if (map !== undefined && focus !== undefined) {
      const details = nodeDetails(map, focus, cfg.unicode);
      if (details) {
        const pin = selectedId === focus && hoverId === undefined ? (cfg.unicode ? ' ⊙' : ' *') : '';
        const status = map.nodes.find((n) => (n.id as string) === focus)!.status;
        const line1 = fitWidth(details[0] + pin, cols - 2);
        const line2 = fitWidth(details[1], cols - 2);
        detail1 = cfg.color ? ` \x1b[${STATUS_SGR[status]};1m${line1}${RESET}` : ` ${line1}`;
        detail2 = cfg.color ? ` \x1b[90m${line2}${RESET}` : ` ${line2}`;
      }
    } else if (interactive) {
      detail1 = cfg.color ? ' \x1b[90mhover a node to inspect · click to pin\x1b[0m' : '';
    }

    const hint = !interactive
      ? cfg.file
      : (pannable ? 'drag/wheel pan · ' : 'map fits pane · ') + 'hjkl/arrows · 0 reset · Esc unpin · q quit';
    const footer = cfg.color ? `\x1b[90m ${hint}${panned}${RESET}` : ` ${hint}${panned}`;

    let frame = HOME;
    for (let i = 0; i < viewH; i++) frame += (body[i] ?? '') + ERASE_LINE_END + '\n';
    frame += detail1 + ERASE_LINE_END + '\n' + detail2 + ERASE_LINE_END + '\n' + footer + ERASE_LINE_END;
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
