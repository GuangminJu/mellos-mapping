import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTerminalSession } from './terminal-session.js';

afterEach(() => vi.useRealTimers());

describe('embedded terminal session', () => {
  it('restores mouse reporting after the startup output is lost, even without a new frame', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const session = openTerminalSession({ interactive: true, mouse: true, write });
    expect(write.mock.calls[0]?.[0]).toContain('\x1b[?1049h');
    // Simulate a remount with a truncated output buffer: discard startup.
    write.mockClear();
    vi.advanceTimersByTime(1000);
    const recovery = write.mock.calls.map(([chunk]) => chunk).join('');
    expect(recovery).toContain('\x1b[?1003h');
    expect(recovery).toContain('\x1b[?1006h');
    expect(recovery).not.toContain('1049'); // re-entering would clear the map
    expect(recovery).not.toContain('\x1b[2J');
    session.close();
  });

  it('hands the original screen back and never re-enables mouse after closing', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const session = openTerminalSession({ interactive: true, mouse: true, write });
    write.mockClear();
    session.close();
    expect(write.mock.calls[0]?.[0]).toContain('\x1b[?1003l');
    expect(write.mock.calls[0]?.[0]).toContain('\x1b[?1049l');
    expect(write.mock.calls[0]?.[0]).toContain('\x1b[?25h');
    vi.advanceTimersByTime(5000);
    session.close();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it.each([
    { interactive: true, mouse: false },
    { interactive: false, mouse: true },
  ])('leaves mouse ownership alone for %o', (options) => {
    vi.useFakeTimers();
    const write = vi.fn();
    const session = openTerminalSession({ ...options, write });
    vi.advanceTimersByTime(5000);
    expect(write).toHaveBeenCalledTimes(1);
    session.close();
    const output = write.mock.calls.map(([chunk]) => chunk).join('');
    expect(output).not.toMatch(/100[36]/);
    if (!options.interactive) expect(output).not.toContain('1049');
  });
});
