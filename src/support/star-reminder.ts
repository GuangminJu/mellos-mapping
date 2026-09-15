/** Optional, local-only support notice. Never called by the MCP server. */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { writeAtomic } from '../store/atomic.js';
import { withStoreLock } from '../store/transaction.js';

export const STAR_URL = 'https://github.com/GuangminJu/mellos-mapping';
const DAY_MS = 86_400_000;
interface ReminderState {
  version: 1;
  firstSeen: number;
  lastDay: number;
  days: number;
  notified: boolean;
}
export interface StarReminderOptions {
  readonly entry: string;
  readonly userBase: string;
  readonly env: NodeJS.ProcessEnv;
  readonly now?: () => number;
}

/** Real paths exclude npm-link checkouts; release plugins have no npm manifest. */
export function isNpmInstallation(entry: string): boolean {
  try {
    const root = dirname(dirname(realpathSync(entry)));
    if (basename(dirname(root)).toLowerCase() !== 'node_modules' || existsSync(join(root, '.git')) ||
        existsSync(join(root, '.codex-plugin')) || existsSync(join(root, '.claude-plugin'))) return false;
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown; bin?: { mmap?: unknown } };
    return pkg.name === 'mellos-mapping' && pkg.bin?.mmap === 'dist/mmap.mjs';
  } catch { return false; }
}

export function starReminderFile(userBase: string): string {
  // Separate from mapping policy and project data; one record across installs.
  return join(userBase, '.mellos', 'support', 'star-reminder.json');
}
function enabledFlag(value: string | undefined): boolean {
  return !!value && value !== '0' && value.toLowerCase() !== 'false';
}
function validState(value: unknown): value is ReminderState {
  if (!value || typeof value !== 'object') return false;
  const s = value as ReminderState;
  return s.version === 1 && Number.isFinite(s.firstSeen) && s.firstSeen >= 0 &&
    Number.isSafeInteger(s.lastDay) && s.lastDay >= Math.floor(s.firstSeen / DAY_MS) &&
    Number.isSafeInteger(s.days) && s.days >= 1 && s.days <= 3 && typeof s.notified === 'boolean';
}

export function createStarReminder(options: StarReminderOptions): { visit: () => boolean } {
  const eligible = isNpmInstallation(options.entry) && !enabledFlag(options.env['CI']) &&
    !enabledFlag(options.env['MELLOS_MAPPING_NO_STAR']);
  const file = starReminderFile(options.userBase);
  return {
    visit(): boolean {
      if (!eligible) return false;
      try {
        return withStoreLock(file, () => {
          const now = (options.now ?? Date.now)();
          if (!Number.isFinite(now) || now < 0) return false;
          const day = Math.floor(now / DAY_MS);
          let state: ReminderState;
          try {
            const saved: unknown = JSON.parse(readFileSync(file, 'utf8'));
            // Unknown/corrupt settings suppress the notice instead of resetting consent.
            if (!validState(saved)) return false;
            state = saved;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
            state = { version: 1, firstSeen: now, lastDay: day, days: 1, notified: false };
          }
          if (state.notified || now < state.firstSeen || day < state.lastDay) return false;
          if (day > state.lastDay) { state.days = Math.min(3, state.days + 1); state.lastDay = day; }
          const show = state.days >= 3 && now - state.firstSeen >= 7 * DAY_MS;
          if (show) state.notified = true;
          // Claim before displaying: concurrent projects/tabs may only remind once.
          // No retries for an optional notice; contention/I/O errors stay silent.
          const saved = writeAtomic(file, JSON.stringify(state, null, 2) + '\n', 1);
          return saved.ok && show;
        });
      } catch { return false; }
    },
  };
}
