/**
 * Layer 1b — Node-side persistence for a MellosMap.
 *
 * The state file IS the event bus of the whole plugin: the MCP server writes
 * it, the terminal watcher polls it — and the watcher reports back what it is
 * showing (see viewers below). These are process reports; terminal visibility
 * is checked separately by the host adapter. The file FORMAT (version, page-id
 * grammar, parse/serialize with boundary validation) lives in ./format.ts,
 * pure of I/O so browsers can consume it; this module owns everything that
 * touches the filesystem, and one promise:
 *
 *   P2. Writes are atomic: a reader polling the file either sees the previous
 *       complete map or the new complete map, never a torn write. Achieved by
 *       writing a PRIVATE sibling temp file and renaming it over the target.
 *
 * The concurrency model P2 buys, stated plainly:
 *   - Several writers may target one project at once. Each save is atomic and
 *     lands whole, so a reader never sees half a map — but there is NO
 *     lost-update protection in this low-level save API: two saves race, and the last
 *     rename wins, silently discarding what the other writer computed from an
 *     older read. Pages are the isolation unit (one effort = one page); two
 *     sessions that must not clobber each other belong on two pages.
 *     Current MCP/viewer writers additionally use transaction.ts to lock the
 *     complete read/modify/write operation, with optional revision checks.
 *     Direct library saves and older processes do not acquire that lock.
 *   - The temp file carries the writer's pid and a random suffix, so
 *     concurrent writers never share one and never install each other's
 *     half-written content.
 *   - A rename can transiently fail while a reader holds the target open
 *     (EPERM/EBUSY on Windows), so it is retried with a short backoff before
 *     the save is reported as failed.
 *   - A page can also be DELETED (deletePageFile). Deletion races a writer
 *     the same way a save does, and the WRITER WINS: a save landing after it
 *     recreates the page. Stated at the function, not defended against.
 *
 * Expected failures (missing file, malformed JSON, invariant violations, a
 * write that would not land) are Result values. A failed save changed
 * nothing: the previous file content is intact and the caller may retry.
 * Only truly unexpected I/O faults on the READ path are allowed to propagate
 * as exceptions.
 *
 * Node consumers import everything from here; the format surface is
 * re-exported so persistence has one import site per runtime.
 */

export {
  STATE_FILE_VERSION,
  type PageId,
  makePageId,
  type StoreError,
  describeStoreError,
  parseMap,
  serializeMap,
} from './format.js';

// Stable public facade. Internal modules depend on primitives, never on this barrel.
export { writeFileAtomic } from './atomic.js';
export { STORE_DIR_NAME, STATE_FILE_RELATIVE_PATH, PAGES_DIR_NAME, pageFilePath, pageIdOfFile, listPageFiles, deletePageFile } from './pages.js';
export { FOCUS_FILE_NAME, focusFilePath, type FocusRequest, takeFocusRequest, QUIT_FILE_NAME, quitFilePath, takeQuitRequest, sweepQuitRequest } from './channels.js';
export { VIEWERS_DIR_NAME, VIEWER_FILE_VERSION, VIEWER_HEARTBEAT_MS, VIEWER_STALE_MS, VIEWER_SWEEP_MS, viewersDirPath, viewerFilePath, type ViewerReport, type LiveViewer, publishViewer, retireViewer, readLiveViewers } from './viewers.js';
export { CONFIG_FILE_NAME, CONFIG_FILE_VERSION, configFilePath, userConfigFilePath, MAPPING_POLICIES, type MappingPolicy, type InvalidPolicy, makeMappingPolicy, describeMappingPolicy, loadMappingPolicy, saveMappingPolicy, POLICY_SCOPES, type PolicyScope, type MappingPolicyScopes, effectiveMappingPolicy } from './policy.js';
export { LEGACY_STATE_FILE_RELATIVE_PATH, migrateLegacyStore } from './migration.js';
export { loadMapFile, saveMapFile } from './maps.js';
export { withStoreLock, revisionOf, assertRevision, LedgerError } from './transaction.js';
export { resolveProjectDirectory } from './project.js';
