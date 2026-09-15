import type { ViewerReport } from '../store/store.js';

/** The watcher needs terminal bytes and dimensions, not an OS pseudo-terminal. */
export interface WatcherIO {
  readonly interactive: boolean;
  readonly input: {
    setRawMode(raw: boolean): void;
    resume(): void;
    setEncoding(encoding: BufferEncoding): void;
    on(event: 'data', listener: (data: string) => void): unknown;
  };
  readonly output: {
    readonly columns?: number;
    readonly rows?: number;
    write(text: string): boolean;
    once(event: 'drain', listener: () => void): unknown;
    off(event: 'drain', listener: () => void): unknown;
    on(event: 'resize', listener: () => void): unknown;
  };
  readonly report?: (view: ViewerReport) => void;
  readonly onMapRendered?: () => void;
}

export const nativeWatcherIO = (): WatcherIO => ({
  interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
  input: process.stdin,
  output: process.stdout,
});
