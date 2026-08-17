import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type { MmapReadResult } from 'mellos-mapping-dsh/types';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
import { createMmapViewStore } from './store.ts';
/** Registration-side face: the per-session read plus the change-revision hook source. */
export interface MmapViewInjected {
    /** Read the whole map store of this session's workspace. */
    read: () => Promise<MmapReadResult>;
    /** Open the aux column (no-op when open); called once when a map page first MOVES during this mount. */
    autoOpen: () => void;
    /** Reactive sources bound to `use<Name>` selector hooks by the renderer. */
    hooks: {
        /** Monotonic revision bumped on every `mmap/changed` and connection reset. */
        mmapRevision: ObservableSnapshot<number>;
    };
}
/** Full component props assembled by the aux column slot renderer. */
export type MmapViewProps = PropsRuntime<'aux'> & PropsLocale<'mmap'> & InjectFace<MmapViewInjected> & PropsStore<ReturnType<typeof createMmapViewStore>>;
/** Render the live Mellos map of this session's workspace. */
export declare function MmapView(props: MmapViewProps): ReactNode;
//# sourceMappingURL=MmapView.d.ts.map