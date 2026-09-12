import type { MellosMap } from '../domain/types.js';

/** Transport values only: the browser never receives filesystem capabilities. */
export interface WebPage {
  readonly id: string;
  readonly title: string;
  readonly modified: number;
  readonly map?: MellosMap;
  readonly error?: string;
}
export interface WebSnapshot {
  readonly project: string;
  readonly pages: readonly WebPage[];
}
export interface VersionedSnapshot {
  readonly revision: string;
  readonly value: WebSnapshot;
}
