import { existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PAGES_DIR_NAME } from './pages.js';
import { configFilePath } from './policy.js';
import { withStoreLock } from './transaction.js';

// ---------------------------------------------------------------------------
// legacy migration — stores written under the old host-coupled location
// ---------------------------------------------------------------------------
//
// Up to 0.19 the store lived in `.claude/mellos-mapping.*`: the map's home
// was coupled to one host brand, which turned absurd the moment another host
// (a harness, Codex) drove the same server. The move is one-time and
// explicit — entry points call it before touching the store; nothing here
// runs as a hidden side effect of ordinary loads.

/** Project-relative location of the pre-0.20 default page file. */
export const LEGACY_STATE_FILE_RELATIVE_PATH = join('.claude', 'mellos-mapping.json');
const LEGACY_PAGES_DIR_NAME = 'mellos-mapping.pages';
const LEGACY_CONFIG_FILE_NAME = 'mellos-mapping.config.json';

/**
 * Move a legacy `.claude` store — map, pages, and mapping-policy config —
 * into the tool-owned `.mellos` location. Never merges: a project whose new
 * store already holds anything keeps it untouched, whatever the legacy
 * directory still contains.
 * @param defaultFile - the NEW default page path (`<root>/.mellos/map.json`);
 *   the legacy store is looked up relative to `<root>`.
 * @returns whether a legacy store was moved.
 */
export function migrateLegacyStore(defaultFile: string): boolean {
  const projectRoot = dirname(dirname(defaultFile));
  const legacyDefault = join(projectRoot, LEGACY_STATE_FILE_RELATIVE_PATH);
  const legacyPages = join(dirname(legacyDefault), LEGACY_PAGES_DIR_NAME);
  const legacyConfig = join(dirname(legacyDefault), LEGACY_CONFIG_FILE_NAME);
  const hasLegacy = (): boolean => existsSync(legacyDefault) || existsSync(legacyPages) || existsSync(legacyConfig);
  const hasCurrent = (): boolean => existsSync(defaultFile)
    || existsSync(join(dirname(defaultFile), PAGES_DIR_NAME))
    || existsSync(configFilePath(defaultFile));
  if (!hasLegacy() || hasCurrent()) return false;
  return withStoreLock(defaultFile, () => {
    // A writer or another startup may have committed after the fast checks.
    // Recheck under the same lock used by all current project mutations;
    // rename is allowed to replace its destination on every supported OS.
    if (!hasLegacy() || hasCurrent()) return false;
    if (existsSync(legacyDefault)) renameSync(legacyDefault, defaultFile);
    if (existsSync(legacyPages)) renameSync(legacyPages, join(dirname(defaultFile), PAGES_DIR_NAME));
    if (existsSync(legacyConfig)) renameSync(legacyConfig, configFilePath(defaultFile));
    return true;
  });
}
