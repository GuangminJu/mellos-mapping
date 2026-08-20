/**
 * What every way of opening (or closing) the map pane has in common.
 *
 * Two entry points sit on top of this module and they are deliberately not
 * one script:
 *
 *   scripts/open-pane.mjs — the AGENT's launcher. Takes the project directory
 *     as a positional argument, prints machine-readable `MMAP_PANE …` lines,
 *     and never closes anything: an assistant asking for the map must not be
 *     able to take a pane away from the user.
 *   scripts/mmap.mjs — the HUMAN's toggle. Takes no project directory (it
 *     discovers one by walking up from the cwd), prints sentences, and closes
 *     a pane that is already open.
 *
 * Folding them into one script with two personalities would mean branching on
 * how it was invoked — the hidden control flow this repo refuses everywhere
 * else. Sharing this module instead means the window probe, the
 * already-running check and the `wt` payload have exactly one definition, and
 * the two command lines stay honestly different.
 *
 * Everything here runs on plain node: these scripts ship in the plugin, which
 * Claude Code installs by cloning the repo with no build and no npm install,
 * so nothing here may import the TypeScript sources. The store's own
 * vocabulary — where the map lives, what the focus and quit channels are
 * called, what a page slug may look like — is read at runtime from the
 * generated dist/store-paths.mjs (see loadPluginPaths). A second copy of a
 * filename is how the focus request came to be written to a name no watcher
 * ever read.
 *
 * Pure helpers are exported for the spec; nothing here runs on import.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// the flag vocabulary, shared so the two entry points cannot drift
// ---------------------------------------------------------------------------

/**
 * Watcher flags forwarded verbatim to dist/watch.mjs — the full boolean set
 * parseArgs (src/watch/watch.ts) understands, minus the two the launchers own
 * themselves (--file, --page). Forwarding the whole set is one rule the caller
 * can hold in their head; a curated subset silently ate --no-follow.
 */
export const WATCHER_BOOLEAN_FLAGS = ['--ascii', '--no-color', '--no-mouse', '--no-follow'];
/** Watcher flags that consume the next argument as their value. */
export const WATCHER_VALUE_FLAGS = ['--interval'];
/** Flags a launcher consumes itself; they never reach the watcher. */
export const PANE_FLAGS = ['--window', '--force'];

/** How the pane is placed: beside the conversation, or in its own window. */
export const PANE_MODE = { split: 'split', window: 'window' };

/**
 * Read argv[i] as a WATCHER flag.
 *
 * @param argv - the whole argument list.
 * @param i - index of the token to read.
 * @returns `other` when the token belongs to the caller's own vocabulary,
 *   `taken` with the index of the LAST token consumed and the flags to
 *   forward, or `bad-value` with a message the caller wraps in its own usage.
 *   A Result-shaped value rather than a throw: a hand-typed command line
 *   getting a flag wrong is expected, not exceptional.
 */
export function takeWatcherFlag(argv, i) {
  const flag = argv[i];
  if (WATCHER_BOOLEAN_FLAGS.includes(flag)) return { kind: 'taken', next: i, flags: [flag] };
  if (!WATCHER_VALUE_FLAGS.includes(flag)) return { kind: 'other' };
  const value = argv[i + 1];
  if (value === undefined || !Number.isFinite(Number(value))) return { kind: 'bad-value', message: `${flag} needs a number` };
  return { kind: 'taken', next: i + 1, flags: [flag, value] };
}

// ---------------------------------------------------------------------------
// where the plugin keeps the things these scripts run
// ---------------------------------------------------------------------------

/**
 * The plugin root, given an entry point's `import.meta.url`.
 *
 * Both entry points live exactly one directory below the root — `scripts/` in
 * a plugin checkout, `dist/` for the bundled `mmap` binary — so one rule
 * serves both. It takes the url rather than reading its own, because this
 * module is BUNDLED into dist/mmap.mjs: `import.meta.url` in here would then
 * be the bundle's, and every caller would silently get the bundle's answer.
 */
export function pluginRootOf(moduleUrl) {
  return dirname(dirname(fileURLToPath(moduleUrl)));
}

/**
 * Load the built artifacts an entry point needs: the store's path vocabulary
 * and the watcher itself.
 *
 * @returns ok with `{ store, watchPath }`, or err with a message naming the
 *   missing file — an unbuilt checkout is a state to report, not a crash.
 */
export async function loadPluginPaths(pluginRoot) {
  const pathsModule = join(pluginRoot, 'dist', 'store-paths.mjs');
  const watchPath = join(pluginRoot, 'dist', 'watch.mjs');
  const missing = !existsSync(pathsModule) ? pathsModule : !existsSync(watchPath) ? watchPath : undefined;
  if (missing !== undefined) {
    return { ok: false, error: `the plugin is not built — run "npm run build" (missing ${missing})` };
  }
  return { ok: true, value: { store: await import(pathToFileURL(pathsModule).href), watchPath } };
}

/**
 * Was this script RUN, or merely imported? A spec importing an entry point
 * must not launch a terminal.
 *
 * Compared by real path: npm bin shims launch through a symlink and shells may
 * pass relative paths, so the two strings rarely match as written.
 * @param argv1 - process.argv[1].
 * @param moduleUrl - the script's own `import.meta.url`.
 */
export function launchedAsEntry(argv1, moduleUrl) {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// the one-shot channels a running pane listens on
// ---------------------------------------------------------------------------

/**
 * Name written by 0.20.0/0.20.1 launchers for the focus channel. No watcher
 * ever read it, so every steered pane left one behind in the user's project;
 * writing a request now sweeps the orphan away.
 */
const ORPHANED_FOCUS_FILE_NAME = 'mellos-mapping.focus';

/**
 * Write a one-shot request into the store's message channel.
 *
 * @param path - the store's OWN path for the channel, never assembled here,
 *   so the writer and the reader can only ever agree.
 * @param body - the request's JSON payload.
 * Temp + rename because the watcher polls: a torn read would be swept as
 * junk, silently losing the request.
 */
function writeRequest(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(body));
  renameSync(`${path}.tmp`, path);
}

/**
 * Write the one-shot focus request a RUNNING watcher consumes (see
 * takeFocusRequest in src/store/store.ts).
 * @param focusFile - the store's own focus path for this map file.
 */
export function writeFocusRequest(focusFile, pageSlug) {
  writeRequest(focusFile, { page: pageSlug });
  try {
    rmSync(join(dirname(focusFile), ORPHANED_FOCUS_FILE_NAME), { force: true });
  } catch {
    // sweeping a dead file is a courtesy; the request itself already landed
  }
}

/**
 * Write the one-shot quit request a RUNNING watcher consumes (see
 * takeQuitRequest in src/store/store.ts) — the toggle's OFF half.
 *
 * The payload is an empty object on purpose: the store accepts any JSON
 * object and reads nothing out of it, so the request says only that it was
 * made. The empty object is what tells a stray file of the same name apart
 * from a message.
 * @param quitFile - the store's own quit path for this map file.
 */
export function writeQuitRequest(quitFile) {
  writeRequest(quitFile, {});
}

// ---------------------------------------------------------------------------
// finding, focusing and splitting the right Windows Terminal window
// ---------------------------------------------------------------------------

/** The `wt` payload that runs the watcher: the pane's title, cwd and command. */
export function paneCommand(cfg, watchPath, mapFile) {
  const cmd = ['--title', 'mellos map', '-d', cfg.projectDir, 'node', watchPath, '--file', mapFile, ...cfg.watcherFlags];
  if (cfg.pageSlug !== undefined) cmd.push('--page', cfg.pageSlug);
  return cmd;
}

/** Quote one value into a PowerShell single-quoted string literal. */
export function powerShellQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Script that counts running watchers of `mapFile`.
 *
 * String.IndexOf, not `-like`: a wildcard match treats `[`, `]`, `?` and `*`
 * in the path as pattern syntax, so a project under `C:\work\[wip]\app` never
 * matched its own watcher and every /mmap opened another pane. Ordinal
 * case-insensitive keeps the old matching behavior for Windows paths that
 * differ only in case.
 */
export function watcherProbeScript(mapFile) {
  return (
    `$ErrorActionPreference = 'SilentlyContinue'\n` +
    `$needle = ${powerShellQuote(mapFile)}\n` +
    `$w = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {\n` +
    `  $_.CommandLine -and\n` +
    `  $_.CommandLine.IndexOf('watch.mjs', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and\n` +
    `  $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0\n` +
    `})\n` +
    `Write-Output "WATCHERS=$($w.Count)"`
  );
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

/** How long the window probe may take before it is abandoned, in ms. */
const PROBE_TIMEOUT_MS = 30_000;
/** How long `wt` may take to open a pane before it is abandoned, in ms. */
const WT_TIMEOUT_MS = 15_000;
/** Fraction of the session window the split pane takes. */
const SPLIT_SIZE = '0.42';
/** Name of the window the pane falls back to — deterministic, never a random one. */
export const DEDICATED_WINDOW_NAME = 'mellos-mapping';

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, windowsHide: true },
  );
  return r.stdout ?? '';
}

/**
 * Is a watcher of `mapFile` already running?
 *
 * One watcher per map file is enough — watch.mjs redraws on change for every
 * viewer of the same file, and piling up panes on repeated /mmap is noise.
 * Matches only watchers started from this plugin (they carry `--file
 * <mapFile>` on their command line).
 */
export function watcherAlreadyRunning(mapFile) {
  const m = runPowerShell(watcherProbeScript(mapFile)).match(/WATCHERS=(\d+)/);
  return m !== null && Number(m[1]) > 0;
}

function openWt(args, what) {
  const r = spawnSync('wt', args, { stdio: 'ignore', timeout: WT_TIMEOUT_MS, windowsHide: true });
  return r.status === 0
    ? { ok: true, value: undefined }
    : { ok: false, error: `wt failed to ${what} (exit ${r.status ?? 'timeout'}) — is Windows Terminal installed?` };
}

/**
 * Open the pane, wherever it can honestly be put.
 *
 * `--window` (cfg.mode === PANE_MODE.window) goes straight to the dedicated
 * window. Otherwise the session's own Windows Terminal window is identified
 * by a console-title nonce and brought to the foreground; only once it is
 * provably the foreground window does `wt -w 0 sp` split it, because
 * "most recently used" is the only thing `wt` can be told to target. Either
 * step failing falls back to the dedicated window — deterministic, never a
 * random one.
 *
 * @returns ok with how it was placed (the caller words the news for its own
 *   audience), or err with a message when `wt` itself refused.
 */
export function placePane(cfg, watchPath, mapFile) {
  const dedicated = (reason) => {
    const opened = openWt(['-w', DEDICATED_WINDOW_NAME, 'nt', ...paneCommand(cfg, watchPath, mapFile)], 'open the dedicated window');
    return opened.ok ? { ok: true, value: { mode: PANE_MODE.window, reason } } : opened;
  };
  if (cfg.mode === PANE_MODE.window) return dedicated('requested');

  const nonce = `MMAP-NONCE-${process.pid}`;
  const out = runPowerShell(IDENTIFY_AND_FOCUS.replaceAll('__NONCE__', nonce));
  const ident = out.match(/IDENT=(\d+)/)?.[1] ?? '0';
  if (ident === '0') return dedicated('session-window-not-identified');
  if (!/FOCUS=1/.test(out)) return dedicated('session-window-focus-denied');

  // The identified window is foreground right now, so "most recently used" is
  // deterministically it. Known race, accepted: a user who focuses a DIFFERENT
  // terminal window in the ~1s before wt reads its MRU state can still get the
  // split there — a window they are at least actively in.
  const split = openWt(
    ['-w', '0', 'sp', '-V', '--size', SPLIT_SIZE, ...paneCommand(cfg, watchPath, mapFile)],
    'split the session window',
  );
  return split.ok ? { ok: true, value: { mode: PANE_MODE.split, hwnd: ident } } : split;
}
