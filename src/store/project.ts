import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';

/** Nearest existing store or Git root; never cross a nested repository/worktree boundary. */
export function resolveProjectDirectory(cwd: string, stopAt: readonly string[] = [homedir(), tmpdir()]): string {
  let start = resolve(cwd);
  try { start = realpathSync(start); } catch { /* Explicit test/manual paths may not exist yet. */ }
  let dir = start;
  const boundaries = new Set(stopAt.map(path => { try { return realpathSync(path); } catch { return resolve(path); } }));
  while (true) {
    // A user's global .mellos directory is not an ancestor project's store.
    if (dir !== start && boundaries.has(dir)) return start;
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, '.mellos', 'map.json')) || existsSync(join(dir, '.mellos', 'pages'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
