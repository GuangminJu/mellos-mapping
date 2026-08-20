#!/usr/bin/env node

// scripts/mmap.mjs
import { existsSync as existsSync2 } from "node:fs";
import { dirname as dirname2, join as join2, resolve } from "node:path";

// scripts/pane-core.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
var WATCHER_BOOLEAN_FLAGS = ["--ascii", "--no-color", "--no-mouse", "--no-follow"];
var WATCHER_VALUE_FLAGS = ["--interval"];
var PANE_MODE = { split: "split", window: "window" };
function takeWatcherFlag(argv, i) {
  const flag = argv[i];
  if (WATCHER_BOOLEAN_FLAGS.includes(flag)) return { kind: "taken", next: i, flags: [flag] };
  if (!WATCHER_VALUE_FLAGS.includes(flag)) return { kind: "other" };
  const value = argv[i + 1];
  if (value === void 0 || !Number.isFinite(Number(value))) return { kind: "bad-value", message: `${flag} needs a number` };
  return { kind: "taken", next: i + 1, flags: [flag, value] };
}
function pluginRootOf(moduleUrl) {
  return dirname(dirname(fileURLToPath(moduleUrl)));
}
async function loadPluginPaths(pluginRoot) {
  const pathsModule = join(pluginRoot, "dist", "store-paths.mjs");
  const watchPath = join(pluginRoot, "dist", "watch.mjs");
  const missing = !existsSync(pathsModule) ? pathsModule : !existsSync(watchPath) ? watchPath : void 0;
  if (missing !== void 0) {
    return { ok: false, error: `the plugin is not built \u2014 run "npm run build" (missing ${missing})` };
  }
  return { ok: true, value: { store: await import(pathToFileURL(pathsModule).href), watchPath } };
}
function launchedAsEntry(argv1, moduleUrl) {
  if (argv1 === void 0) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
var ORPHANED_FOCUS_FILE_NAME = "mellos-mapping.focus";
function writeRequest(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(body));
  renameSync(`${path}.tmp`, path);
}
function writeFocusRequest(focusFile, pageSlug) {
  writeRequest(focusFile, { page: pageSlug });
  try {
    rmSync(join(dirname(focusFile), ORPHANED_FOCUS_FILE_NAME), { force: true });
  } catch {
  }
}
function writeQuitRequest(quitFile) {
  writeRequest(quitFile, {});
}
function paneCommand(cfg, watchPath, mapFile) {
  const cmd = ["--title", "mellos map", "-d", cfg.projectDir, "node", watchPath, "--file", mapFile, ...cfg.watcherFlags];
  if (cfg.pageSlug !== void 0) cmd.push("--page", cfg.pageSlug);
  return cmd;
}
function powerShellQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
function watcherProbeScript(mapFile) {
  return `$ErrorActionPreference = 'SilentlyContinue'
$needle = ${powerShellQuote(mapFile)}
$w = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -and
  $_.CommandLine.IndexOf('watch.mjs', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
  $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0
})
Write-Output "WATCHERS=$($w.Count)"`;
}
var IDENTIFY_AND_FOCUS = String.raw`
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
var PROBE_TIMEOUT_MS = 3e4;
var WT_TIMEOUT_MS = 15e3;
var SPLIT_SIZE = "0.42";
var DEDICATED_WINDOW_NAME = "mellos-mapping";
function runPowerShell(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, windowsHide: true }
  );
  return r.stdout ?? "";
}
function watcherAlreadyRunning(mapFile) {
  const m = runPowerShell(watcherProbeScript(mapFile)).match(/WATCHERS=(\d+)/);
  return m !== null && Number(m[1]) > 0;
}
function openWt(args, what) {
  const r = spawnSync("wt", args, { stdio: "ignore", timeout: WT_TIMEOUT_MS, windowsHide: true });
  return r.status === 0 ? { ok: true, value: void 0 } : { ok: false, error: `wt failed to ${what} (exit ${r.status ?? "timeout"}) \u2014 is Windows Terminal installed?` };
}
function placePane(cfg, watchPath, mapFile) {
  const dedicated = (reason) => {
    const opened = openWt(["-w", DEDICATED_WINDOW_NAME, "nt", ...paneCommand(cfg, watchPath, mapFile)], "open the dedicated window");
    return opened.ok ? { ok: true, value: { mode: PANE_MODE.window, reason } } : opened;
  };
  if (cfg.mode === PANE_MODE.window) return dedicated("requested");
  const nonce = `MMAP-NONCE-${process.pid}`;
  const out = runPowerShell(IDENTIFY_AND_FOCUS.replaceAll("__NONCE__", nonce));
  const ident = out.match(/IDENT=(\d+)/)?.[1] ?? "0";
  if (ident === "0") return dedicated("session-window-not-identified");
  if (!/FOCUS=1/.test(out)) return dedicated("session-window-focus-denied");
  const split = openWt(
    ["-w", "0", "sp", "-V", "--size", SPLIT_SIZE, ...paneCommand(cfg, watchPath, mapFile)],
    "split the session window"
  );
  return split.ok ? { ok: true, value: { mode: PANE_MODE.split, hwnd: ident } } : split;
}

// scripts/mmap.mjs
var USAGE = "usage: mmap [<page-slug>] [--window] [--force] [--ascii] [--no-color] [--no-mouse] [--no-follow] [--interval <ms>]\n       bare `mmap` toggles: it opens the map pane for this project, or closes the open one.";
function parseMmapArgs(argv, idRule) {
  const positional = [];
  const watcherFlags = [];
  let mode = PANE_MODE.split;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const watcher = takeWatcherFlag(argv, i);
    if (watcher.kind === "bad-value") return { ok: false, error: `${watcher.message}
${USAGE}` };
    if (watcher.kind === "taken") {
      watcherFlags.push(...watcher.flags);
      i = watcher.next;
    } else if (a === "--window") {
      mode = PANE_MODE.window;
    } else if (a === "--force") {
      force = true;
    } else if (a === "--page") {
      return { ok: false, error: `mmap takes the page slug as its argument, not --page
${USAGE}` };
    } else if (a.startsWith("--")) {
      return { ok: false, error: `unknown flag "${a}"
${USAGE}` };
    } else {
      positional.push(a);
    }
  }
  if (positional.length > 1) return { ok: false, error: `mmap takes at most one page slug
${USAGE}` };
  const pageSlug = positional[0];
  if (pageSlug !== void 0 && !idRule.test(pageSlug)) {
    return { ok: false, error: `a page is a kebab-case slug (got "${pageSlug}")
${USAGE}` };
  }
  return { ok: true, value: { pageSlug, mode, force, watcherFlags } };
}
function storeSearchPath(startDir) {
  const dirs = [];
  let dir = resolve(startDir);
  for (; ; ) {
    dirs.push(dir);
    const parent = dirname2(dir);
    if (parent === dir) return dirs;
    dir = parent;
  }
}
function storeMarkerOf(storeRelativePath) {
  return storeRelativePath.split(/[\\/]/)[0];
}
function nearestProject(candidates, holdsStore) {
  const at = holdsStore.indexOf(true);
  return at >= 0 ? { root: candidates[at], found: true } : { root: candidates[0], found: false };
}
function toggleAction(running, pageSlug, force = false) {
  if (!running || force) return { kind: "open" };
  return pageSlug === void 0 ? { kind: "quit" } : { kind: "focus", page: pageSlug };
}
async function main() {
  const loaded = await loadPluginPaths(pluginRootOf(import.meta.url));
  if (!loaded.ok) {
    console.error(loaded.error);
    process.exit(1);
  }
  const { store, watchPath } = loaded.value;
  const parsed = parseMmapArgs(process.argv.slice(2), store.ID_RULE);
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }
  if (process.platform !== "win32") {
    console.error("mmap opens the pane through Windows Terminal \u2014 on other platforms run the watcher yourself:");
    console.error(`  node "${watchPath}" --file "<project>/${store.STATE_FILE_RELATIVE_PATH}"`);
    process.exit(1);
  }
  const candidates = storeSearchPath(process.cwd());
  const marker = storeMarkerOf(store.STATE_FILE_RELATIVE_PATH);
  const project = nearestProject(candidates, candidates.map((dir) => existsSync2(join2(dir, marker))));
  const cfg = { ...parsed.value, projectDir: project.root };
  const mapFile = join2(project.root, store.STATE_FILE_RELATIVE_PATH);
  const action = toggleAction(watcherAlreadyRunning(mapFile), cfg.pageSlug, cfg.force);
  if (action.kind === "quit") {
    writeQuitRequest(store.quitFilePath(mapFile));
    console.log(`Closing the map pane for ${project.root}.`);
    return;
  }
  if (action.kind === "focus") {
    writeFocusRequest(store.focusFilePath(mapFile), action.page);
    console.log(`The map pane for ${project.root} is already open \u2014 showing page "${action.page}".`);
    return;
  }
  const placed = placePane(cfg, watchPath, mapFile);
  if (!placed.ok) {
    console.error(placed.error);
    process.exit(1);
  }
  const where = placed.value.mode === PANE_MODE.window ? `in the dedicated "${DEDICATED_WINDOW_NAME}" window (${placed.value.reason})` : "beside this terminal (vertical split)";
  console.log(`Map opened for ${project.root} ${where}.`);
  if (!project.found) {
    console.log(
      "This project has no map yet, so the pane will sit on its standby screen until the assistant declares one."
    );
  }
}
if (launchedAsEntry(process.argv[1], import.meta.url)) await main();
export {
  USAGE,
  nearestProject,
  parseMmapArgs,
  storeMarkerOf,
  storeSearchPath,
  toggleAction
};
