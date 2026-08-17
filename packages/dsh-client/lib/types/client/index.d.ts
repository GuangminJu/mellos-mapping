/** Live Mellos map column beside the conversation, plus its header toggle. */
import { type ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type MmapLocaleKey } from './locales.ts';
export type { MapToggleActionInjected, MapToggleActionProps } from './MapToggleAction.tsx';
export type { MapDrawerActionInjected, MapDrawerActionProps } from './MapDrawerAction.tsx';
export type { MmapViewInjected, MmapViewProps } from './MmapView.tsx';
export type { MmapLocaleKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Mellos map view copy. */
        mmap: MmapLocaleKey;
    }
}
/** Dictionary namespace owned by this plugin. */
export declare const NS = "mmap";
/** Services required by the registrations, the layout face, and the Remote gateway. */
export declare const inject: string[];
/**
 * Contribute the side-by-side map column and its header toggle, and keep the
 * column live: one shared revision source bumps on every forwarded
 * `mmap/changed` and on connection reset (forwarded events carry no reconnect
 * replay, so a reset must force a fresh pull), and the mounted view re-reads
 * through the Remote seam when it moves. The view stays mounted while the
 * column is closed (width 0), which is what lets live mapping activity —
 * a page actually moving, never mere existence — auto-open the column.
 *
 * The plugin mounts its own `remote.mmap` face unless a host assembly already
 * did, and additionally polls at a slow cadence: a host whose forwarded-event
 * allowlist predates `mmap/changed` (any stock dsh today) never pushes the
 * event, and the poll keeps the map live there — an event-forwarding host
 * merely refreshes faster than the poll.
 * @param ctx - client root context.
 * @returns the Remote unmount when this plugin mounted the face itself.
 */
export declare function apply(ctx: ClientContext): Promise<(() => Promise<void>) | undefined>;
//# sourceMappingURL=index.d.ts.map