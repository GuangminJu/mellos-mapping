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
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { STATE_FILE_RELATIVE_PATH, pageFilePath } from 'mellos-mapping/store';
import type { MmapReadResult } from './types.ts';
export type * from './types.ts';
/** Plugin config: workspace watching behavior. */
export interface Config {
    /** Watch each read workspace's map store and emit `mmap/changed`; defaults to true. */
    watch?: boolean;
    /** Watcher write-settle and event-coalescing window in milliseconds; defaults to 150. */
    debounceMs?: number;
    /** Most-recently-read workspaces kept under watch; the oldest is released beyond this; defaults to 16. */
    maxWatchedDirs?: number;
}
/** Fully resolved watch parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
    watch: boolean;
    debounceMs: number;
    maxWatchedDirs: number;
}
/**
 * Resolve the runtime spec from plugin config.
 * @param config - raw plugin config.
 * @returns the resolved watch behavior.
 */
export declare function resolveSpec(config: Config): ResolvedSpec;
/**
 * Store-relative paths that belong to the map store, judged from the watched
 * store directory: the default page file, the pages directory itself, and
 * page files directly inside it. Names derive from the mellos-mapping store
 * contract, never restated here — anything else in the directory is another
 * feature's data and must not fire map events.
 * @param relativePath - path relative to the watched store directory.
 * @returns whether a change at this path is a map-store change.
 */
export declare function isStorePath(relativePath: string): boolean;
/** Remote-only service reading and watching per-workspace Mellos map stores. */
export declare class MmapGateway extends TypertRemoteService {
    config: Config;
    static inject: string[];
    static Config: z<Config>;
    private readonly spec;
    /** Canonical cwd → live watcher, in least-recently-read order (Map insertion order). */
    private readonly watched;
    /** Set at dispose: refuse new watchers and let in-flight work no-op. */
    private closed;
    constructor(ctx: Context, config: Config);
    [Service.init](): AsyncGenerator<() => Promise<void>, void, void>;
    /**
     * Read every existing map page of one session's working directory and keep
     * that workspace under watch for `mmap/changed`. A session without a usable
     * cwd — unknown id, no recorded cwd, or a path that no longer resolves to a
     * directory — answers `{ cwd: null, pages: [] }` rather than failing: an
     * empty store and an unusable workspace both render as "no map here".
     * @param sessionId - id of the session whose workspace to read.
     * @returns the canonical workspace and its pages, invalid pages included as errors.
     */
    read(sessionId: string): Promise<MmapReadResult>;
    /**
     * The canonical directory a session's header records, or `undefined` when
     * the session is unknown, recorded no cwd, or the path no longer resolves
     * to a directory. A session absent from the live store — one reopened from
     * persistence after a restart and not yet running — resolves through its
     * persisted header instead, so the panel lights before the first turn.
     * Re-validated on every read: the header is immutable but the filesystem
     * underneath it is not.
     */
    private resolveCwd;
    /** The persisted header of a cold session; a composition without persistence answers none. */
    private coldHeader;
    /**
     * Watch one workspace's `.mellos` directory for map-store changes, bounded
     * to the most recently read workspaces. Re-reading an already-watched
     * workspace refreshes its recency; exceeding the bound releases the least
     * recently read watcher. Events outside the store paths are ignored, and
     * store events coalesce into one `mmap/changed` per debounce window.
     */
    private ensureWatch;
}
export { STATE_FILE_RELATIVE_PATH, pageFilePath };
export default MmapGateway;
//# sourceMappingURL=index.d.ts.map