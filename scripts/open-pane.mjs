#!/usr/bin/env node
/**
 * Open the live map pane in the RIGHT Windows Terminal window.
 *
 *   node scripts/open-pane.mjs <project-dir> [--page <slug>] [--window] [--ascii] [--force]
 *
 * Why this exists: the agent's shell runs on a hidden console (no WT_SESSION),
 * so a bare `wt -w 0 sp` targets the MOST RECENTLY USED terminal window — with
 * several windows open the map lands wherever the user last clicked, not
 * beside the conversation. Verified on Windows 11 / WT single-process mode:
 * all windows share one WindowsTerminal.exe pid, and the console UI is
 * attached by default-terminal delegation, so neither pid-matching nor the
 * process tree can name the hosting window.
 *
 * What does work — and what this script does, verifying every step:
 *
 *   1. Walk this process's ancestors and AttachConsole to each in turn; write
 *      a nonce into that console's title. The WT window whose title lights up
 *      is the one hosting this session. The nonce only shows when the session
 *      tab is the window's ACTIVE tab — exactly the precondition under which
 *      `sp` would split beside the conversation, so identification doubles as
 *      the go/no-go check.
 *   2. Bring that window to the foreground (plain SetForegroundWindow, then
 *      the Alt-key unlock, then AttachThreadInput — Windows' foreground lock
 *      denies the plain call from background processes), verifying with
 *      GetForegroundWindow after each attempt.
 *   3. Only then `wt -w 0 sp` — "most recently used" is now provably ours.
 *
 * Any step failing falls back to a dedicated window named "mellos-mapping":
 * deterministic, never a random window. `--window` picks that mode outright
 * (explicit choice for users who want the map separate from the chat).
 *
 * Known race, accepted: if the user focuses a DIFFERENT terminal window in
 * the ~1s between our focus-verify and wt reading its MRU state, the split
 * can still land there. The window is at least one the user is actively in.
 *
 * --page <slug> opens the map ON that page (the effort under discussion, not
 * whatever page the store lists first). With a watcher already running it
 * writes the one-shot focus file instead — the existing pane retargets within
 * a poll tick — so re-running with --page is also how you steer an open pane.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node scripts/open-pane.mjs <project-dir> [--page <slug>] [--window] [--ascii] [--force]';

const argv = process.argv.slice(2);
const flags = new Set();
const positional = [];
let pageSlug;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--page') pageSlug = argv[++i];
  else if (a.startsWith('--')) flags.add(a);
  else positional.push(a);
}

if (positional.length !== 1) {
  console.error(USAGE);
  process.exit(1);
}
// Mirrors ID_RULE in src/domain/types.ts — this script runs standalone and
// cannot import the TypeScript sources.
if (pageSlug !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(pageSlug)) {
  console.error(`--page needs a kebab-case slug (got "${pageSlug}")\n${USAGE}`);
  process.exit(1);
}
if (process.platform !== 'win32') {
  console.error('open-pane.mjs is Windows Terminal-only — use the tmux/manual route from the command doc.');
  process.exit(1);
}

const projectDir = resolve(positional[0]);
if (!existsSync(projectDir)) {
  console.error(`project directory does not exist: ${projectDir}`);
  process.exit(1);
}

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const watchPath = join(pluginRoot, 'dist', 'watch.mjs');
if (!existsSync(watchPath)) {
  console.error(`watcher not found (is the plugin built?): ${watchPath}`);
  process.exit(1);
}
const mapFile = join(projectDir, '.mellos', 'map.json');

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { encoding: 'utf8', timeout: 30_000, windowsHide: true },
  );
  return r.stdout ?? '';
}

// One watcher per map file is enough — watch.mjs redraws on change for every
// viewer of the same file, and piling up panes on repeated /mmap is noise.
// Matches only watchers this script started (they carry --file <mapFile> on
// their command line); --force bypasses.
function watcherAlreadyRunning() {
  const token = mapFile.replace(/'/g, "''");
  const out = runPowerShell(
    `$ErrorActionPreference = 'SilentlyContinue'\n` +
    `$w = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*watch.mjs*' -and $_.CommandLine -like '*${token}*' })\n` +
    `Write-Output "WATCHERS=$($w.Count)"`,
  );
  const m = out.match(/WATCHERS=(\d+)/);
  return m !== null && Number(m[1]) > 0;
}

// Prints IDENT=<hwnd|0> and, when identified, FOCUS=<1|0>.
const IDENTIFY_AND_FOCUS = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class MmapWin {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool SetConsoleTitle(string title);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetConsoleTitle(StringBuilder sb, uint size);
}
"@
function Get-WtWindows {
  $wins = New-Object System.Collections.ArrayList
  $cb = {
    param($h, $lp)
    if ([MmapWin]::IsWindowVisible($h)) {
      $cls = New-Object System.Text.StringBuilder 256
      [void][MmapWin]::GetClassName($h, $cls, 256)
      if ($cls.ToString() -eq 'CASCADIA_HOSTING_WINDOW_CLASS') {
        $t = New-Object System.Text.StringBuilder 512
        [void][MmapWin]::GetWindowText($h, $t, 512)
        [void]$wins.Add(@{ hwnd = $h.ToInt64(); title = $t.ToString() })
      }
    }
    return $true
  }
  [void][MmapWin]::EnumWindows($cb, [IntPtr]::Zero)
  return ,$wins
}

$ancestors = @()
$p = $PID
for ($i = 0; $i -lt 12 -and $p; $i++) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
  if (-not $proc) { break }
  if ($i -gt 0) { $ancestors += [uint32]$proc.ProcessId }
  $p = $proc.ParentProcessId
}

# The agent CLI (claude/codex/...) is some ancestor holding the console that a
# WT window renders; hidden-console ancestors just never light a window up.
$nonce = "__NONCE__"
$hwnd = [IntPtr]::Zero
foreach ($apid in $ancestors) {
  [void][MmapWin]::FreeConsole()
  if (-not [MmapWin]::AttachConsole($apid)) { continue }
  $sb = New-Object System.Text.StringBuilder 1024
  [void][MmapWin]::GetConsoleTitle($sb, 1024)
  $orig = $sb.ToString()
  for ($i = 0; $i -lt 6 -and $hwnd -eq [IntPtr]::Zero; $i++) {
    [void][MmapWin]::SetConsoleTitle($nonce)
    Start-Sleep -Milliseconds 60
    foreach ($w in (Get-WtWindows)) {
      if ($w.title -like "*$nonce*") { $hwnd = [IntPtr]$w.hwnd; break }
    }
  }
  Start-Sleep -Milliseconds 100
  [void][MmapWin]::SetConsoleTitle($orig)
  Start-Sleep -Milliseconds 200
  [void][MmapWin]::FreeConsole()
  if ($hwnd -ne [IntPtr]::Zero) { break }
}

if ($hwnd -eq [IntPtr]::Zero) { Write-Output 'IDENT=0'; exit 0 }
Write-Output "IDENT=$($hwnd.ToInt64())"

if ([MmapWin]::IsIconic($hwnd)) { [void][MmapWin]::ShowWindow($hwnd, 9) }
$focused = $false
[void][MmapWin]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 150
if ([MmapWin]::GetForegroundWindow() -eq $hwnd) { $focused = $true }
if (-not $focused) {
  [MmapWin]::keybd_event(0x12, 0, 0, [IntPtr]::Zero)
  [void][MmapWin]::SetForegroundWindow($hwnd)
  [MmapWin]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 150
  if ([MmapWin]::GetForegroundWindow() -eq $hwnd) { $focused = $true }
}
if (-not $focused) {
  $fgpid = 0
  $fgThread = [MmapWin]::GetWindowThreadProcessId([MmapWin]::GetForegroundWindow(), [ref]$fgpid)
  $myThread = [MmapWin]::GetCurrentThreadId()
  [void][MmapWin]::AttachThreadInput($myThread, $fgThread, $true)
  [void][MmapWin]::BringWindowToTop($hwnd)
  [void][MmapWin]::SetForegroundWindow($hwnd)
  [void][MmapWin]::AttachThreadInput($myThread, $fgThread, $false)
  Start-Sleep -Milliseconds 150
  if ([MmapWin]::GetForegroundWindow() -eq $hwnd) { $focused = $true }
}
Write-Output "FOCUS=$(if ($focused) { 1 } else { 0 })"
`;

function paneCommand() {
  const cmd = ['--title', 'mellos map', '-d', projectDir, 'node', watchPath, '--file', mapFile];
  if (flags.has('--ascii')) cmd.push('--ascii');
  if (pageSlug !== undefined) cmd.push('--page', pageSlug);
  return cmd;
}

function openWt(args, what) {
  const r = spawnSync('wt', args, { stdio: 'ignore', timeout: 15_000, windowsHide: true });
  if (r.status !== 0) {
    console.error(`wt failed to ${what} (exit ${r.status ?? 'timeout'}) — is Windows Terminal installed?`);
    process.exit(1);
  }
}

function openDedicatedWindow(reason) {
  openWt(['-w', 'mellos-mapping', 'nt', ...paneCommand()], 'open the dedicated window');
  console.log(`MMAP_PANE mode=window name=mellos-mapping reason=${reason}`);
  console.log('Map opened in the dedicated "mellos-mapping" window.');
}

if (!flags.has('--force') && watcherAlreadyRunning()) {
  if (pageSlug !== undefined) {
    // One-shot focus request (see takeFocusRequest in src/store/store.ts):
    // the running watcher consumes and deletes it within a poll tick. Temp +
    // rename because the watcher polls: a torn read would be swept as junk,
    // silently losing the request.
    mkdirSync(dirname(mapFile), { recursive: true });
    const focusFile = join(dirname(mapFile), 'mellos-mapping.focus');
    writeFileSync(`${focusFile}.tmp`, JSON.stringify({ page: pageSlug }));
    renameSync(`${focusFile}.tmp`, focusFile);
    console.log(`MMAP_PANE already-open refocused=${pageSlug}`);
    console.log(`A watcher for ${mapFile} is already running — asked it to show page "${pageSlug}".`);
  } else {
    console.log('MMAP_PANE already-open');
    console.log(`A watcher for ${mapFile} is already running — not opening another pane (use --force to override).`);
  }
  process.exit(0);
}

if (flags.has('--window')) {
  openDedicatedWindow('requested');
  process.exit(0);
}

const nonce = `MMAP-NONCE-${process.pid}`;
const out = runPowerShell(IDENTIFY_AND_FOCUS.replaceAll('__NONCE__', nonce));
const ident = out.match(/IDENT=(\d+)/)?.[1] ?? '0';
const focused = /FOCUS=1/.test(out);

if (ident === '0') {
  openDedicatedWindow('session-window-not-identified');
} else if (!focused) {
  openDedicatedWindow('session-window-focus-denied');
} else {
  // The identified window is foreground right now, so "most recently used"
  // is deterministically it (see the race note in the header).
  openWt(['-w', '0', 'sp', '-V', '--size', '0.42', ...paneCommand()], 'split the session window');
  console.log(`MMAP_PANE mode=split hwnd=${ident}`);
  console.log('Map opened beside this conversation (vertical split).');
}
