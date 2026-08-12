/**
 * Layer 4b — the split-pane watcher.
 *
 * A deliberately tiny terminal program: poll the state file's mtime,
 * re-render on change, keep the spinner turning while any node is in
 * progress. The state file is the only channel between the MCP server and
 * this process — no sockets, no IPC, one direction of flow.
 *
 * When the picture is larger than the pane, the view pans: drag with the
 * left mouse button (xterm SGR mouse tracking), wheel to pan vertically
 * (shift+wheel horizontally), hjkl/arrows to nudge, 0 to reset, q to quit.
 * Input handling only engages on a real TTY; piped/CI runs stay pure output.
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

import { type MellosMap } from '../domain/types.js';
import { renderMapWindow } from '../render/render.js';
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
const MOUSE_ON = '\x1b[?1002h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1002l\x1b[?1006l';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function main(): void {
  const cfg = parseArgs(process.argv.slice(2), process.cwd());
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const mouseActive = interactive && cfg.mouse;

  let lastMtimeMs = -1;
  let lastFrame = '';
  let spinnerFrame = 0;
  let map: MellosMap | undefined;
  let notice = `waiting for ${cfg.file} ...`;

  // viewport pan state
  let offsetX = 0;
  let offsetY = 0;
  let dragAnchor: { x: number; y: number; ox: number; oy: number } | undefined;
  let pendingInput = '';

  process.stdout.write(HIDE_CURSOR + CLEAR_ALL + (mouseActive ? MOUSE_ON : ''));
  const restore = (): void => {
    process.stdout.write((mouseActive ? MOUSE_OFF : '') + SHOW_CURSOR + '\n');
    process.exit(0);
  };
  process.on('SIGINT', restore);
  process.on('SIGTERM', restore);

  const paint = (): void => {
    const cols = process.stdout.columns ?? 100;
    const rows = process.stdout.rows ?? 30;
    const viewH = Math.max(1, rows - 1); // bottom row is the footer

    let body: string[];
    let panned = '';
    let pannable = false;
    if (map !== undefined) {
      const windowed = renderMapWindow(
        map,
        { color: cfg.color, unicode: cfg.unicode, spinnerFrame },
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
      if (offsetX !== 0 || offsetY !== 0) panned = `  (+${offsetX},+${offsetY})`;
    } else {
      body = [notice];
    }
    if (notice !== '' && map !== undefined) body[body.length - 1] = `  ${notice}`;

    // Tell the user WHY dragging does nothing when everything is visible —
    // silent inertness reads as breakage.
    const hint = !interactive
      ? cfg.file
      : pannable
        ? 'drag/wheel pan · hjkl/arrows · 0 reset · q quit'
        : 'map fits pane · q quit';
    const footer = cfg.color ? `${DIM} ${hint}${panned}${RESET}` : ` ${hint}${panned}`;

    let frame = HOME;
    for (let i = 0; i < viewH; i++) frame += (body[i] ?? '') + ERASE_LINE_END + '\n';
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
      for (const event of parsed.events) {
        switch (event.kind) {
          case 'quit':
            restore();
            return;
          case 'reset':
            offsetX = 0;
            offsetY = 0;
            break;
          case 'pan':
            offsetX += event.dx;
            offsetY += event.dy;
            break;
          case 'mouse-down':
            dragAnchor = { x: event.x, y: event.y, ox: offsetX, oy: offsetY };
            break;
          case 'mouse-drag':
            if (dragAnchor) {
              // the content follows the mouse: drag right reveals the left
              offsetX = dragAnchor.ox - (event.x - dragAnchor.x);
              offsetY = dragAnchor.oy - (event.y - dragAnchor.y);
            }
            break;
          case 'mouse-up':
            dragAnchor = undefined;
            break;
        }
      }
      if (parsed.events.length > 0) paint();
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
