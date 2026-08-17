import type { ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Registration-side face of the header toggle. */
export interface MapToggleActionInjected {
    /** Toggle the aux map column. */
    toggle: () => void;
}
/** Full props for the session-header map toggle action. */
export type MapToggleActionProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'mmap'> & InjectFace<MapToggleActionInjected>;
/** One header button toggling the side-by-side map column. */
export declare function MapToggleAction({ toggle, t }: MapToggleActionProps): ReactNode;
//# sourceMappingURL=MapToggleAction.d.ts.map