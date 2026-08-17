/**
 * Client-safe type surface of the Mellos-map read seam: the wire views of the
 * `mmap.read` Remote method and the seam's Cordis event declaration. Types
 * only — no runtime code, and nothing here reaches a Host-only symbol, so a
 * Client compilation face reads exactly the signature the Host emits.
 *
 * @module mellos-mapping-dsh/types
 */
import type { JsonValue } from '@deepseek-ai/dsh-session/types';
/**
 * One map page of a workspace, as stored by the mellos-mapping MCP server.
 * Exactly one of `map` and `error` is non-null: a page file either parses
 * under the mellos-mapping state-file format (structural invariants included)
 * or reports why it does not — an unreadable page must stay visible rather
 * than silently vanish from the panel.
 */
export interface MmapPageView {
    /** Page slug, or `null` for the default page (`map.json`). */
    readonly page: string | null;
    /** The validated map value, JSON-shaped as persisted (version field stripped). */
    readonly map: JsonValue | null;
    /** Human-readable load failure when the page file cannot be trusted. */
    readonly error: string | null;
    /**
     * Last-written Unix epoch milliseconds of the page file, or `null` when it
     * could not be read. Clients derive two page-set behaviors from it: the
     * default page (most recently written) and background-change tab lighting.
     */
    readonly mtimeMs: number | null;
}
/** Whole-workspace read: every existing page of one session's working directory. */
export interface MmapReadResult {
    /**
     * Canonical (realpath) working directory the pages were read from, or
     * `null` when the session has no usable cwd — no header, no `cwd` recorded,
     * or a recorded path that no longer resolves to a directory. `mmap/changed`
     * events carry this same canonical form, so an equality check against it is
     * the client's refetch filter.
     */
    readonly cwd: string | null;
    /** Existing pages in store order: the default page first, then named pages by slug. */
    readonly pages: readonly MmapPageView[];
}
declare module '@deepseek-ai/cordis' {
    interface Events {
        /**
         * Observed change to a watched workspace's Mellos map store: the default
         * page file, the pages directory, or a page file inside it was added,
         * changed, or removed. Coalesced per workspace over the configured
         * debounce window; carries no page detail on purpose — the store is
         * multi-file and a rename touches two paths, so consumers re-read through
         * `mmap.read` instead of patching from event payloads.
         * @param cwd - canonical (realpath) working directory whose store changed.
         * @mode emit
         */
        'mmap/changed'(cwd: string): void;
    }
}
//# sourceMappingURL=types.d.ts.map