import type { ReactNode } from 'react';
import type { MellosMap } from 'mellos-mapping/domain/types';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
/** Owner props of the resident detail panel below the map. */
export interface DetailPanelProps {
    readonly map: MellosMap;
    /** Focused node/group id (hover wins over pin), `null` for the dashboard. */
    readonly focus: string | null;
    /** Whether the focus is the pinned selection (vs a transient hover). */
    readonly pinned: boolean;
    readonly t: TranslateNS<'mmap'>;
}
/**
 * The resident three-state panel the terminal pane keeps below the map:
 * a focused node (status header, evidence, both wire directions, notes), a
 * focused group (members plus outside-the-group wires), or — with nothing
 * focused — the map dashboard. Never floats over the map.
 */
export declare function DetailPanel({ map, focus, pinned, t }: DetailPanelProps): ReactNode;
//# sourceMappingURL=DetailPanel.d.ts.map