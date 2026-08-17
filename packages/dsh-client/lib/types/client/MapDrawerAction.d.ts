import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
import type { MmapReadResult } from 'mellos-mapping-dsh/types';
import type { createMmapViewStore } from './store.ts';
/** Registration-side face of the drawer-hosted map (hosts without an aux column). */
export interface MapDrawerActionInjected {
    /** Read the whole map store of this session's workspace. */
    read: () => Promise<MmapReadResult>;
    /** Reactive sources bound to `use<Name>` selector hooks by the renderer. */
    hooks: {
        /** Monotonic revision bumped on every `mmap/changed`, reset, and poll. */
        mmapRevision: ObservableSnapshot<number>;
    };
}
/** Full props of the header action that owns the drawer. */
export type MapDrawerActionProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'mmap'> & InjectFace<MapDrawerActionInjected> & PropsStore<ReturnType<typeof createMmapViewStore>>;
/**
 * The map surface for hosts whose web frame has no aux column: the same
 * header button, but toggling a right-edge drawer this component portals to
 * the document body. The drawer stays mounted while closed (slid offscreen),
 * mirroring the aux column's width-0 behavior, so live mapping activity can
 * auto-open it through the view's ordinary autoOpen callback.
 */
export declare function MapDrawerAction(props: MapDrawerActionProps): ReactNode;
//# sourceMappingURL=MapDrawerAction.d.ts.map