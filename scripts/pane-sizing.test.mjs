import { describe, expect, it } from 'vitest';
import { tmuxSplitSize } from './pane-sizing.mjs';

describe('initial tmux split sizing', () => {
  it('keeps the default at 42 percent and sizes from the source pane, reserving its divider', () => {
    expect(tmuxSplitSize(180).value).toEqual({ widthPercent: 42, sourceCols: 180, requestedCols: 75, cols: 75 });
    expect(tmuxSplitSize(120, 60).value.cols).toBe(59);
    expect(tmuxSplitSize(100, 25).value.cols).toBe(30);
    expect(tmuxSplitSize(91, 60).value.cols).toBe(30);
  });

  it('refuses too-narrow or invalid source geometry rather than taking the conversation away', () => {
    expect(tmuxSplitSize(90).error).toContain('at least 91 columns');
    expect(tmuxSplitSize(60).ok).toBe(false);
    for (const width of [undefined, '', '180', 0, -100, 99.5, NaN, Infinity]) {
      expect(tmuxSplitSize(width).ok).toBe(false);
    }
  });

  it('preserves both minimum widths for every valid percentage and feasible source width', () => {
    for (let sourceCols = 91; sourceCols <= 250; sourceCols++) {
      for (let widthPercent = 25; widthPercent <= 60; widthPercent++) {
        const { cols } = tmuxSplitSize(sourceCols, widthPercent).value;
        expect(cols).toBeGreaterThanOrEqual(30);
        expect(sourceCols - cols - 1).toBeGreaterThanOrEqual(60);
      }
    }
  });
});
