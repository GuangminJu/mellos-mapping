/**
 * Layer 4b — the split-pane watcher.
 *
 * A deliberately tiny terminal program: poll the state file's mtime, re-render
 * on change, and keep the spinner turning while any node is in progress. The
 * state file is the only channel between the MCP server and this process —
 * no sockets, no IPC, one direction of flow.
 *
 * Resilience contract: a torn or half-written file (only possible with
 * foreign writers; our own saves are atomic) must never crash the pane —
 * the last good picture stays up and the next poll retries.
 *
 * Usage: node watch.mjs --file <path> [--interval <ms>] [--ascii] [--no-color]
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type MellosMap } from '../domain/types.js';
import { STATE_FILE_RELATIVE_PATH, describeStoreError, loadMapFile } from '../store/store.js';
import { renderMap } from '../render/render.js';

interface WatchConfig {
  readonly file: string;
  readonly intervalMs: number;
  readonly unicode: boolean;
  readonly color: boolean;
}

export function parseArgs(argv: readonly string[], cwd: string): WatchConfig {
  let file = join(cwd, STATE_FILE_RELATIVE_PATH);
  let intervalMs = 250;
  let unicode = true;
  let color = true;
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
      default:
        break; // unknown flags are ignored; the pane must come up regardless
    }
  }
  return { file, intervalMs, unicode, color };
}

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const HOME_AND_CLEAR = '\x1b[H\x1b[2J';
const HOME = '\x1b[H\x1b[0J';

function main(): void {
  const cfg = parseArgs(process.argv.slice(2), process.cwd());

  let lastMtimeMs = -1;
  let lastPicture = '';
  let spinnerFrame = 0;
  let map: MellosMap | undefined;
  let notice = `waiting for ${cfg.file} ...`;

  process.stdout.write(HIDE_CURSOR + HOME_AND_CLEAR);
  const restore = (): void => {
    process.stdout.write(SHOW_CURSOR + '\n');
    process.exit(0);
  };
  process.on('SIGINT', restore);
  process.on('SIGTERM', restore);

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

    const spinning = map?.nodes.some((n) => n.status === 'in-progress') ?? false;
    if (spinning) spinnerFrame++;

    const lines =
      map !== undefined
        ? renderMap(map, { color: cfg.color, unicode: cfg.unicode, spinnerFrame })
        : [notice];
    const picture = lines.join('\n') + (notice && map !== undefined ? `\n\n  ${notice}` : '');
    if (picture !== lastPicture) {
      process.stdout.write(HOME + picture + '\n');
      lastPicture = picture;
    }
  };

  tick();
  setInterval(tick, cfg.intervalMs);
}

// Run only as an entry point; importing this module (tests) must be inert.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
