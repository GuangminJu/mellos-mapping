/** Initial split sizing shared by the CLIs and terminal adapters. */
export const DEFAULT_WIDTH_PERCENT = 42;
export const MIN_LEFT_COLS = 60;
export const MIN_MAP_COLS = 30;

/** Refuse coercion, fractions and out-of-range values before touching a terminal. */
export function parseWidthPercent(value) {
  const percent = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof percent === 'number' && Number.isInteger(percent) && percent >= 25 && percent <= 60
    ? { ok: true, value: percent }
    : { ok: false, error: 'width percent must be an integer from 25 to 60' };
}

export function configuredWidthPercent(value) {
  return parseWidthPercent(value === undefined ? DEFAULT_WIDTH_PERCENT : value);
}

/** tmux divides the selected source pane, with one column reserved for its divider. */
export function tmuxSplitSize(sourceCols, widthPercent) {
  const width = configuredWidthPercent(widthPercent);
  if (!width.ok) return width;
  if (!Number.isSafeInteger(sourceCols) || sourceCols <= 0) {
    return { ok: false, error: 'tmux returned an invalid source pane width; no pane was opened.' };
  }
  const minimum = MIN_LEFT_COLS + MIN_MAP_COLS + 1;
  if (sourceCols < minimum) {
    return { ok: false, error: `The source tmux pane is ${sourceCols} columns wide; a new split needs at least ${minimum} columns (${MIN_LEFT_COLS} for the conversation, ${MIN_MAP_COLS} for the map, and one divider). Widen the source pane before retrying; no separate window was opened.` };
  }
  const requestedCols = Math.floor(sourceCols * width.value / 100);
  return { ok: true, value: {
    widthPercent: width.value,
    sourceCols,
    requestedCols,
    cols: Math.max(MIN_MAP_COLS, Math.min(sourceCols - MIN_LEFT_COLS - 1, requestedCols)),
  } };
}
