import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameOutput, frameDifference, type TerminalFrame } from './frame-output.js';

const frame = (...rows: string[]): TerminalFrame => ({ columns: 80, rows });
afterEach(() => vi.useRealTimers());

describe('terminal frame output', () => {
  it('rewrites a changed row with complete Unicode/style sequences and erases shortened tails', () => {
    const before = frame('unchanged', '\x1b[32m地图🗺️ long\x1b[0m', 'gone');
    const after = frame('unchanged', '\x1b[33m图\x1b[0m');
    const diff = frameDifference(before, after);
    expect(diff).not.toContain('unchanged');
    expect(diff).toContain('\x1b[2;1H\x1b[33m图\x1b[0m\x1b[0m\x1b[K');
    expect(diff).toContain('\x1b[3;1H\x1b[0m\x1b[K');
    expect(frameDifference(after, after)).toBe('');
    expect(frameDifference(after, { ...after, columns: 60 })).toContain('unchanged');
  });

  it('drops superseded pictures under backpressure, retaining the final state', () => {
    vi.useFakeTimers();
    const write = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    let drain: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const output = createFrameOutput({ write, onDrain: (cb) => { drain = cb; return unsubscribe; } });
    output.present(frame('first'));
    output.present(frame('intermediate'));
    output.present(frame('final'));
    expect(write).toHaveBeenCalledTimes(1);
    drain?.();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[0]).toContain('final');
    expect(write.mock.calls.flat().join('')).not.toContain('intermediate');
    expect(unsubscribe).toHaveBeenCalledOnce();
    output.close();
  });

  it('periodically restores the entire idle picture and stops all output after closing', () => {
    vi.useFakeTimers();
    const write = vi.fn().mockReturnValue(true);
    const output = createFrameOutput({ write, onDrain: () => () => {} });
    output.present(frame('map', 'details'));
    write.mockClear();
    vi.advanceTimersByTime(1000);
    expect(write.mock.calls[0]?.[0]).toContain('map');
    expect(write.mock.calls[0]?.[0]).toContain('details');
    output.close();
    vi.advanceTimersByTime(2000);
    output.present(frame('too late'));
    expect(write).toHaveBeenCalledOnce();
  });

  it('recovers after a resize or truncated replay even while output is blocked', () => {
    vi.useFakeTimers();
    const write = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    let drain: (() => void) | undefined;
    const output = createFrameOutput({ write, onDrain: (cb) => { drain = cb; return () => {}; } });
    output.present(frame('map', 'details'));
    vi.advanceTimersByTime(1000);
    output.present(frame('map', 'new details'));
    expect(write).toHaveBeenCalledTimes(1);
    drain?.();
    expect(write.mock.calls[1]?.[0]).toContain('map');
    expect(write.mock.calls[1]?.[0]).toContain('new details');
    output.close();
  });
});
