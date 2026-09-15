import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { STAR_URL } from './star-reminder.js';

/** Fixed destination only; HTTP callers cannot supply commands or URLs. */
export function starBrowserCommand(platform: NodeJS.Platform, windowsRoot = 'C:\\Windows'): { file: string; args: string[] } {
  if (platform === 'win32') return {
    file: win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${STAR_URL}'`],
  };
  if (platform === 'darwin') return { file: '/usr/bin/open', args: [STAR_URL] };
  if (platform === 'linux') return { file: 'xdg-open', args: [STAR_URL] };
  throw new Error('No supported desktop browser launcher');
}

/** Hand off to the OS without a console window, shell interpolation or browser selection. */
export function openStarInDefaultBrowser(): Promise<void> {
  const command = starBrowserCommand(process.platform, process.env['SystemRoot']);
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { windowsHide: true, stdio: 'ignore' });
    let finished = false;
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true; clearTimeout(deadline); child.unref();
      if (error) reject(error); else resolve();
    };
    // Some desktop launchers stay alive with the browser. Never kill that
    // browser to finish the HTTP request; an early launch failure is reported.
    const deadline = setTimeout(() => finish(), 5000);
    child.once('error', error => finish(error));
    child.once('exit', code => finish(code === 0 ? undefined : new Error('Default browser launch failed')));
  });
}
