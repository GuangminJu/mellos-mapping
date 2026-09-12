/** Windows Terminal adapter. No project paths, reuse policy or persistent state. */
import { spawnSync } from 'node:child_process';

const NATIVE = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class MmapSession {
  public delegate bool Callback(IntPtr hwnd, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetConsoleProcessList(uint[] list, uint size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool SetConsoleTitle(string title);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetConsoleTitle(StringBuilder text, uint size);
}
"@
`;

/** A temporary title identifies the active session without guessing from titles or MRU order. */
export function sessionProbeScript(nonce) {
  return NATIVE + String.raw`
$processes = @{}
Get-CimInstance Win32_Process | ForEach-Object { $processes[[uint32]$_.ProcessId] = $_ }
$cursor = [uint32]$PID
$seen = @{}
$hwnd = [IntPtr]::Zero
for ($depth = 0; $depth -lt 16 -and $processes.ContainsKey($cursor); $depth++) {
  [void][MmapSession]::FreeConsole()
  if ([MmapSession]::AttachConsole($cursor)) {
    $members = New-Object uint32[] 4096
    $count = [MmapSession]::GetConsoleProcessList($members, $members.Length)
    if ($count -gt 0 -and $count -le $members.Length) {
      $root = $members[0..($count - 1)] | ForEach-Object { $processes[$_] } |
        Where-Object { $_ -and $_.CreationDate } | Sort-Object CreationDate | Select-Object -First 1
      if ($root) {
        $owner = "split-$($root.ProcessId)-$($root.CreationDate.ToUniversalTime().Ticks)"
        if (-not $seen.ContainsKey($owner)) {
          $seen[$owner] = $true
          Write-Output "CONSOLE=$owner"
          $text = New-Object System.Text.StringBuilder 1024
          [void][MmapSession]::GetConsoleTitle($text, 1024)
          $original = $text.ToString()
          try {
            for ($attempt = 0; $attempt -lt 6 -and $hwnd -eq [IntPtr]::Zero; $attempt++) {
              [void][MmapSession]::SetConsoleTitle('__NONCE__')
              Start-Sleep -Milliseconds 60
              $matches = New-Object System.Collections.ArrayList
              $callback = {
                param($window, $unused)
                if ([MmapSession]::IsWindowVisible($window)) {
                  $class = New-Object System.Text.StringBuilder 256
                  [void][MmapSession]::GetClassName($window, $class, 256)
                  if ($class.ToString() -eq 'CASCADIA_HOSTING_WINDOW_CLASS') {
                    $title = New-Object System.Text.StringBuilder 1024
                    [void][MmapSession]::GetWindowText($window, $title, 1024)
                    if ($title.ToString().Contains('__NONCE__')) { [void]$matches.Add($window) }
                  }
                }
                return $true
              }
              [void][MmapSession]::EnumWindows($callback, [IntPtr]::Zero)
              if ($matches.Count -eq 1) { $hwnd = $matches[0] }
            }
          } finally {
            [void][MmapSession]::SetConsoleTitle($original)
            [void][MmapSession]::FreeConsole()
          }
          if ($hwnd -ne [IntPtr]::Zero) {
            Write-Output "OWNER=$owner"
            break
          }
        }
      }
    }
  }
  $cursor = [uint32]$processes[$cursor].ParentProcessId
}
[void][MmapSession]::FreeConsole()
Write-Output "IDENT=$($hwnd.ToInt64())"
`.replaceAll('__NONCE__', nonce);
}

function powershell(script, timeout = 30_000) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', windowsHide: true, timeout });
  return result.status === 0
    ? { ok: true, value: result.stdout }
    : { ok: false, error: `Terminal session probe failed (${result.error?.message ?? `exit ${result.status}`}).` };
}

export function parseSessionProbe(output) {
  const owners = [...output.matchAll(/^CONSOLE=(split-\d+-\d+)\r?$/gm)].map((m) => m[1]);
  const hwnd = /^IDENT=([1-9]\d*)\r?$/m.exec(output)?.[1];
  const owner = /^OWNER=(split-\d+-\d+)\r?$/m.exec(output)?.[1];
  return { owners, ...(hwnd && owner && owners.includes(owner) ? { hwnd, owner } : {}) };
}

export function inspectSession() {
  const result = powershell(sessionProbeScript(`MMAP-SESSION-${process.pid}-${Date.now()}`));
  return result.ok ? { ok: true, value: parseSessionProbe(result.value) } : result;
}

/** WT's -w 0 is MRU-based, so it is only usable after verifying the exact foreground HWND. */
export function focusSession(hwnd) {
  if (!/^[1-9]\d*$/.test(hwnd)) return { ok: false, error: 'Invalid terminal window handle.' };
  const result = powershell(NATIVE + `
$window = [IntPtr]${hwnd}
if ([MmapSession]::GetForegroundWindow() -ne $window) {
  [void][MmapSession]::SetForegroundWindow($window)
  Start-Sleep -Milliseconds 150
}
Write-Output "FOCUS=$([MmapSession]::GetForegroundWindow() -eq $window)"
`, 5_000);
  if (!result.ok) return result;
  return /^FOCUS=True\r?$/m.test(result.value)
    ? { ok: true, value: undefined }
    : { ok: false, error: 'The session window was identified, but Windows refused to focus it. Activate the PowerShell tab for this conversation and retry; no separate window was opened.' };
}

export function openWt(args, what) {
  // This is the requested interactive application. SW_HIDE also hides new WT windows.
  const result = spawnSync('wt', args, { stdio: 'ignore', timeout: 15_000, windowsHide: false });
  return result.status === 0
    ? { ok: true, value: undefined }
    : { ok: false, error: `wt failed to ${what} (${result.error?.message ?? `exit ${result.status}`}).` };
}
