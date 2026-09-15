import { describe, expect, it } from 'vitest';
import { starBrowserCommand } from './open-star.js';
import { STAR_URL } from './star-reminder.js';

describe('default-browser launch destinations', () => {
  it('uses the Windows association handler with a fixed URL and hidden helper', () => {
    const command = starBrowserCommand('win32', 'D:\\Windows');
    expect(command.file).toBe('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(command.args).toContain('Hidden');
    expect(command.args.at(-1)).toBe(`$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${STAR_URL}'`);
    expect(command.args).not.toContain('-ExecutionPolicy');
  });
  it('uses the OS URL handler on macOS and Linux without choosing a browser', () => {
    expect(starBrowserCommand('darwin')).toEqual({ file: '/usr/bin/open', args: [STAR_URL] });
    expect(starBrowserCommand('linux')).toEqual({ file: 'xdg-open', args: [STAR_URL] });
  });
  it('refuses unsupported platforms', () => {
    expect(() => starBrowserCommand('aix')).toThrow('No supported desktop browser launcher');
  });
});
