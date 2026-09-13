/** Bounded messages shared by browser, local transport and mmap worker. */
export interface TerminalSize { readonly cols: number; readonly rows: number }
export type TerminalInput =
  | ({ readonly type: 'start' } & TerminalSize)
  | ({ readonly type: 'resize' } & TerminalSize)
  | { readonly type: 'input'; readonly data: string }
  | { readonly type: 'ack' };
export type TerminalOutput =
  | { readonly type: 'data'; readonly data: string }
  | { readonly type: 'view'; readonly page?: string; readonly follow: boolean }
  | { readonly type: 'error'; readonly message: string };

export function parseTerminalInput(raw: string): TerminalInput | undefined {
  if (raw.length > 16384) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const keys = Object.keys(value).sort().join(',');
    if (value.type === 'ack' && keys === 'type') return { type: 'ack' };
    if (value.type === 'input' && keys === 'data,type' && typeof value.data === 'string' && value.data.length <= 4096) return { type: 'input', data: value.data };
    if ((value.type === 'start' || value.type === 'resize') && keys === 'cols,rows,type' &&
        Number.isInteger(value.cols) && Number.isInteger(value.rows) &&
        (value.cols as number) >= 20 && (value.cols as number) <= 500 &&
        (value.rows as number) >= 8 && (value.rows as number) <= 200) {
      return { type: value.type, cols: value.cols as number, rows: value.rows as number };
    }
  } catch { /* Invalid messages do not reach the watcher. */ }
  return undefined;
}
