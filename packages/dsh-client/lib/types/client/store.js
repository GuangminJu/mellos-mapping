/**
 * Per-conversation map viewpoint. The workspace's map STORE is shared by
 * every conversation in that workspace — what belongs to one conversation is
 * its point of view: which page it looks at, whether it follows the writer,
 * its divider height, and each page's parked zoom/pin/scroll. The aux slot
 * is session-scoped, so the framework keeps one instance per session and
 * suffixes the persist key with the session id — switching back to a
 * conversation (or reloading) restores ITS viewpoint, which is what keeps
 * conversations from all rendering one identical picture.
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client';
/** Divider-drag range of the resident detail panel, px. */
export const PANEL_DEFAULT_H = 168;
const PANEL_MIN_H = 64;
const PANEL_MAX_H = 480;
/**
 * Create the per-session viewpoint store handle.
 * @returns the store handle; the framework instantiates one per session.
 */
export function createMmapViewStore() {
    return defineStore({
        init: () => ({ chosenKey: undefined, follow: true, panelH: PANEL_DEFAULT_H, views: {} }),
        persist: 'dsh.mmap.view',
        actions: {
            choosePage: (d, key) => { d.chosenKey = key; },
            setFollow: (d, on) => { d.follow = on; },
            setPanelH: (d, px) => { d.panelH = Math.min(PANEL_MAX_H, Math.max(PANEL_MIN_H, px)); },
            parkView: (d, key, view) => { d.views[key] = view; },
        },
    });
}
//# sourceMappingURL=store.js.map