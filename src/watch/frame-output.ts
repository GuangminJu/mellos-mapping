/** Completed terminal rows. The renderer owns cell widths and ANSI styles. */
export interface TerminalFrame {
  readonly columns: number;
  readonly rows: readonly string[];
}

/** Row updates avoid splitting ANSI sequences or the halves of wide glyphs. */
export function frameDifference(previous: TerminalFrame | undefined, next: TerminalFrame): string {
  const compatible = previous?.columns === next.columns;
  let output = '';
  for (let row = 0; row < Math.max(next.rows.length, previous?.rows.length ?? 0); row++) {
    const text = next.rows[row] ?? '';
    if (compatible && text === previous?.rows[row]) continue;
    output += `\x1b[${row + 1};1H${text}\x1b[0m\x1b[K`;
  }
  return output;
}

/**
 * A bounded output queue: once a write is buffered, retain only the latest
 * requested picture until drain. Full snapshots keep terminal remount/replay
 * working even when older row updates have left the host's history buffer.
 */
export function createFrameOutput(port: {
  write(text: string): boolean;
  onDrain(ready: () => void): () => void;
}): { present(frame: TerminalFrame): void; invalidate(): void; close(): void } {
  let previous: TerminalFrame | undefined;
  let latest: TerminalFrame | undefined;
  let pending: TerminalFrame | undefined;
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  const flush = (): void => {
    if (closed || unsubscribe !== undefined || pending === undefined) return;
    const frame = pending;
    pending = undefined;
    const output = frameDifference(previous, frame);
    if (output === '') return;
    previous = frame;
    if (!port.write(output)) {
      unsubscribe = port.onDrain(() => {
        unsubscribe?.();
        unsubscribe = undefined;
        flush();
      });
    }
  };
  const refresh = setInterval(() => {
    previous = undefined;
    pending = latest;
    flush();
  }, 1000);
  refresh.unref();
  return {
    present(frame) {
      if (closed) return;
      latest = pending = frame;
      flush();
    },
    invalidate() { previous = undefined; },
    close() {
      closed = true;
      clearInterval(refresh);
      unsubscribe?.();
      unsubscribe = undefined;
      pending = latest = previous = undefined;
    },
  };
}
