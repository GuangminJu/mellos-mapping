/**
 * Host read seam over the Mellos-map store a session's working directory
 * carries (`.mellos/map.json` plus `.mellos/pages/<slug>.json`, written by
 * the mellos-mapping MCP server bridged into the model plane elsewhere). This package is the
 * presentation half only: it never writes a map, registers no tool, and adds
 * nothing model-visible — it reads validated map values for browser panels
 * and watches each read workspace so a change becomes one `mmap/changed`
 * event a client can refetch on.
 * @module mellos-mapping-dsh
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { realpath, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { canonicalizeWatchPath } from '@deepseek-ai/dsh-home-paths'
import {
  PAGES_DIR_NAME,
  STATE_FILE_RELATIVE_PATH,
  describeStoreError,
  listPageFiles,
  loadMapFile,
  migrateLegacyStore,
  pageFilePath,
  pageIdOfFile,
} from 'mellos-mapping/store'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type { MmapPageView, MmapReadResult } from './types.ts'

export type * from './types.ts'

/** Plugin config: workspace watching behavior. */
export interface Config {
  /** Watch each read workspace's map store and emit `mmap/changed`; defaults to true. */
  watch?: boolean
  /** Watcher write-settle and event-coalescing window in milliseconds; defaults to 150. */
  debounceMs?: number
  /** Most-recently-read workspaces kept under watch; the oldest is released beyond this; defaults to 16. */
  maxWatchedDirs?: number
}

/** Fully resolved watch parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  watch: boolean
  debounceMs: number
  maxWatchedDirs: number
}

/**
 * Resolve the runtime spec from plugin config.
 * @param config - raw plugin config.
 * @returns the resolved watch behavior.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  return {
    watch: config.watch ?? true,
    debounceMs: config.debounceMs ?? 150,
    maxWatchedDirs: config.maxWatchedDirs ?? 16,
  }
}

/** The default page's file name, derived from the library's store contract. */
const DEFAULT_FILE_NAME = basename(STATE_FILE_RELATIVE_PATH)

/**
 * Store-relative paths that belong to the map store, judged from the watched
 * store directory: the default page file, the pages directory itself, and
 * page files directly inside it. Names derive from the mellos-mapping store
 * contract, never restated here — anything else in the directory is another
 * feature's data and must not fire map events.
 * @param relativePath - path relative to the watched store directory.
 * @returns whether a change at this path is a map-store change.
 */
export function isStorePath(relativePath: string): boolean {
  if (relativePath === DEFAULT_FILE_NAME || relativePath === PAGES_DIR_NAME) return true
  const [head, leaf, ...rest] = relativePath.split(sep)
  return head === PAGES_DIR_NAME && rest.length === 0 && leaf !== undefined && leaf.endsWith('.json')
}

/** One watched workspace: its watcher and the pending coalescing timer. */
interface WatchedDir {
  readonly watcher: FSWatcher
  timer: NodeJS.Timeout | undefined
}

/** Remote-only service reading and watching per-workspace Mellos map stores. */
export class MmapGateway extends TypertRemoteService {
  static inject = ['sessions']

  static Config: z<Config> = z.object({
    watch: z.boolean().default(true),
    debounceMs: z.number().min(0).default(150),
    maxWatchedDirs: z.number().min(1).default(16),
  })

  private readonly spec: ResolvedSpec
  /** Canonical cwd → live watcher, in least-recently-read order (Map insertion order). */
  private readonly watched = new Map<string, WatchedDir>()
  /** Set at dispose: refuse new watchers and let in-flight work no-op. */
  private closed = false

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'mmap')
    // Programmatic construction may bypass Schemastery normalization; resolve
    // the same defaults in one explicit step either way.
    this.spec = resolveSpec(config)
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    yield async () => {
      this.closed = true
      const closing = [...this.watched.values()].map(async (entry) => {
        if (entry.timer !== undefined) clearTimeout(entry.timer)
        await entry.watcher.close()
      })
      this.watched.clear()
      await Promise.all(closing)
    }
  }

  /**
   * Read every existing map page of one session's working directory and keep
   * that workspace under watch for `mmap/changed`. A session without a usable
   * cwd — unknown id, no recorded cwd, or a path that no longer resolves to a
   * directory — answers `{ cwd: null, pages: [] }` rather than failing: an
   * empty store and an unusable workspace both render as "no map here".
   * @param sessionId - id of the session whose workspace to read.
   * @returns the canonical workspace and its pages, invalid pages included as errors.
   */
  @Remote('read')
  async read(sessionId: string): Promise<MmapReadResult> {
    const cwd = await this.resolveCwd(sessionId)
    if (cwd === undefined) return { cwd: null, pages: [] }
    const defaultFile = join(cwd, STATE_FILE_RELATIVE_PATH)
    // A workspace last mapped by a pre-0.19 tool may still hold its store
    // under the legacy `.claude` location; the library moves it exactly once.
    migrateLegacyStore(defaultFile)
    const pages: MmapPageView[] = await Promise.all(listPageFiles(defaultFile).map(async (file) => {
      const page = pageIdOfFile(defaultFile, file) ?? null
      const mtimeMs = await stat(file).then(info => info.mtimeMs, () => null)
      const loaded = loadMapFile(file)
      return loaded.ok
        ? { page, map: loaded.value as unknown as JsonValue, error: null, mtimeMs }
        : { page, map: null, error: describeStoreError(loaded.error), mtimeMs }
    }))
    await this.ensureWatch(cwd, defaultFile)
    return { cwd, pages }
  }

  /**
   * The canonical directory a session's header records, or `undefined` when
   * the session is unknown, recorded no cwd, or the path no longer resolves
   * to a directory. A session absent from the live store — one reopened from
   * persistence after a restart and not yet running — resolves through its
   * persisted header instead, so the panel lights before the first turn.
   * Re-validated on every read: the header is immutable but the filesystem
   * underneath it is not.
   */
  private async resolveCwd(sessionId: string): Promise<string | undefined> {
    const header = this.ctx.sessions.list().find(session => session.header.id === sessionId)?.header
      ?? await this.coldHeader(sessionId)
    if (header?.cwd === undefined) return undefined
    try {
      const canonical = await realpath(header.cwd)
      return (await stat(canonical)).isDirectory() ? canonical : undefined
    } catch {
      // ENOENT, permission, or a dangling link all mean the same thing here:
      // no workspace to read a map from.
      return undefined
    }
  }

  /** The persisted header of a cold session; a composition without persistence answers none. */
  private async coldHeader(sessionId: string): Promise<{ readonly cwd?: string } | undefined> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) return undefined
    try {
      return (await persistence.list()).find(header => header.id === sessionId)
    } catch (error) {
      this.ctx.logger.warn('mmap-host: persisted session listing failed while resolving %s', sessionId)
      this.ctx.logger.warn(error)
      return undefined
    }
  }

  /**
   * Watch one workspace's `.mellos` directory for map-store changes, bounded
   * to the most recently read workspaces. Re-reading an already-watched
   * workspace refreshes its recency; exceeding the bound releases the least
   * recently read watcher. Events outside the store paths are ignored, and
   * store events coalesce into one `mmap/changed` per debounce window.
   */
  private async ensureWatch(cwd: string, defaultFile: string): Promise<void> {
    if (!this.spec.watch || this.closed) return
    const existing = this.watched.get(cwd)
    if (existing !== undefined) {
      // Refresh recency: Map iteration order is insertion order.
      this.watched.delete(cwd)
      this.watched.set(cwd, existing)
      return
    }
    while (this.watched.size >= this.spec.maxWatchedDirs) {
      const [oldestCwd, oldest] = this.watched.entries().next().value as [string, WatchedDir]
      this.watched.delete(oldestCwd)
      if (oldest.timer !== undefined) clearTimeout(oldest.timer)
      await oldest.watcher.close()
    }
    // The `.mellos` directory (or the whole store) may not exist yet; the
    // canonicalized path lets chokidar observe its later creation, the same
    // discipline the credentials file watcher uses.
    const storeDir = await canonicalizeWatchPath(join(defaultFile, '..'))
    const watcher = chokidarWatch(storeDir, {
      ignoreInitial: true,
      depth: 2,
      awaitWriteFinish: {
        stabilityThreshold: this.spec.debounceMs,
        pollInterval: Math.max(1, Math.min(this.spec.debounceMs, 10)),
      },
    })
    const entry: WatchedDir = { watcher, timer: undefined }
    watcher.on('all', (_event, path) => {
      if (this.closed || !isStorePath(relative(storeDir, path))) return
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        entry.timer = undefined
        if (this.closed) return
        this.ctx.emit('mmap/changed', cwd)
      }, this.spec.debounceMs)
    })
    watcher.on('ready', () => {
      // The triggering read raced the watcher's own setup: a store write
      // between that read and the watcher becoming active never fires an
      // event. One change signal at ready closes the gap — consumers re-read,
      // which is a no-op when nothing actually moved.
      if (this.closed) return
      this.ctx.emit('mmap/changed', cwd)
    })
    watcher.on('error', (error) => {
      this.ctx.logger.warn('mmap-host: watcher error on %s', storeDir)
      this.ctx.logger.warn(error)
    })
    this.watched.set(cwd, entry)
  }
}

// The default page's file location is part of this seam's read contract;
// re-exported so a test or a host composition can point at the same store
// without restating the mellos-mapping constant.
export { STATE_FILE_RELATIVE_PATH, pageFilePath }

export default MmapGateway
