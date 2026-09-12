#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// scripts/mmap.mjs
import { existsSync as existsSync2 } from "node:fs";
import { dirname as dirname2, join as join2, resolve } from "node:path";

// scripts/terminal-session.mjs
var terminal_session_exports = {};
__export(terminal_session_exports, {
  focusSession: () => focusSession,
  inspectSession: () => inspectSession,
  openWt: () => openWt,
  parseSessionProbe: () => parseSessionProbe,
  sessionProbeScript: () => sessionProbeScript
});
import { spawnSync } from "node:child_process";
var NATIVE = String.raw`
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
function sessionProbeScript(nonce) {
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
`.replaceAll("__NONCE__", nonce);
}
function powershell(script, timeout = 3e4) {
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")
  ], { encoding: "utf8", windowsHide: true, timeout });
  return result.status === 0 ? { ok: true, value: result.stdout } : { ok: false, error: `Terminal session probe failed (${result.error?.message ?? `exit ${result.status}`}).` };
}
function parseSessionProbe(output) {
  const owners = [...output.matchAll(/^CONSOLE=(split-\d+-\d+)\r?$/gm)].map((m) => m[1]);
  const hwnd = /^IDENT=([1-9]\d*)\r?$/m.exec(output)?.[1];
  const owner = /^OWNER=(split-\d+-\d+)\r?$/m.exec(output)?.[1];
  return { owners, ...hwnd && owner && owners.includes(owner) ? { hwnd, owner } : {} };
}
function inspectSession() {
  const result = powershell(sessionProbeScript(`MMAP-SESSION-${process.pid}-${Date.now()}`));
  return result.ok ? { ok: true, value: parseSessionProbe(result.value) } : result;
}
function focusSession(hwnd) {
  if (!/^[1-9]\d*$/.test(hwnd)) return { ok: false, error: "Invalid terminal window handle." };
  const result = powershell(NATIVE + `
$window = [IntPtr]${hwnd}
if ([MmapSession]::GetForegroundWindow() -ne $window) {
  [void][MmapSession]::SetForegroundWindow($window)
  Start-Sleep -Milliseconds 150
}
Write-Output "FOCUS=$([MmapSession]::GetForegroundWindow() -eq $window)"
`, 5e3);
  if (!result.ok) return result;
  return /^FOCUS=True\r?$/m.test(result.value) ? { ok: true, value: void 0 } : { ok: false, error: "The session window was identified, but Windows refused to focus it. Activate the PowerShell tab for this conversation and retry; no separate window was opened." };
}
function openWt(args, what) {
  const result = spawnSync("wt", args, { stdio: "ignore", timeout: 15e3, windowsHide: false });
  return result.status === 0 ? { ok: true, value: void 0 } : { ok: false, error: `wt failed to ${what} (${result.error?.message ?? `exit ${result.status}`}).` };
}

// scripts/pane-core.mjs
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
var DEDICATED_WINDOW_NAME = "mellos-mapping";
var SPLIT_SIZE = "0.42";
function selectPaneViewer(viewers, owners) {
  return viewers.find((viewer) => viewer.owner !== void 0 && owners.includes(viewer.owner));
}
function preparePane(cfg, store, mapFile, io = terminal_session_exports) {
  const inspected = cfg.mode === PANE_MODE.window ? { ok: true, value: { owners: ["window"], owner: "window" } } : io.inspectSession();
  if (!inspected.ok) return inspected;
  const session = inspected.value;
  const viewers = store.readLiveViewers(mapFile, Date.now());
  const viewer = selectPaneViewer(viewers, session.owners);
  if (cfg.mode === PANE_MODE.split && !session.hwnd && (!viewer || cfg.force)) {
    return { ok: false, error: "Could not identify this conversation\u2019s active Windows Terminal pane. Activate its PowerShell tab and retry; no separate window was opened. Use --window only if you want a separate window." };
  }
  return { ok: true, value: {
    target: { mode: cfg.mode, owner: session.owner ?? viewer?.owner, hwnd: session.hwnd },
    viewer,
    previousPids: viewers.map((item) => item.pid)
  } };
}
function placePane(cfg, watchPath, mapFile, target, io = terminal_session_exports) {
  const payload = [...paneCommand(cfg, watchPath, mapFile), "--owner", target.owner];
  if (target.mode === PANE_MODE.window) {
    const opened2 = io.openWt(["-w", DEDICATED_WINDOW_NAME, "nt", ...payload], "open the requested window");
    return opened2.ok ? { ok: true, value: { ...target, reason: "requested" } } : opened2;
  }
  const focused = io.focusSession(target.hwnd);
  if (!focused.ok) return focused;
  const opened = io.openWt([
    "-w",
    "0",
    "sp",
    "-V",
    "--size",
    SPLIT_SIZE,
    ...payload,
    ";",
    "move-focus",
    "previous"
  ], "split the session window");
  return opened.ok ? { ok: true, value: target } : opened;
}
async function awaitNewPane(store, mapFile, context, timeoutMs = 8e3) {
  const deadline = Date.now() + timeoutMs;
  do {
    const viewer = store.readLiveViewers(mapFile, Date.now()).find((item) => item.owner === context.target.owner && !context.previousPids.includes(item.pid));
    if (viewer) return { ok: true, value: viewer };
    await new Promise((resolve2) => setTimeout(resolve2, 100));
  } while (Date.now() < deadline);
  return { ok: false, error: "The requested pane has not reported in. Its placement is unverified; do not assume that another open map is the requested split." };
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
  const prepared = preparePane(cfg, store, mapFile);
  if (!prepared.ok) {
    console.error(prepared.error);
    process.exit(1);
  }
  const context = prepared.value;
  const action = toggleAction(context.viewer !== void 0, cfg.pageSlug, cfg.force);
  if (action.kind === "quit") {
    writeQuitRequest(store.quitFilePath(mapFile, context.viewer.pid));
    console.log(`Closing the map pane for ${project.root}.`);
    return;
  }
  if (action.kind === "focus") {
    writeFocusRequest(store.focusFilePath(mapFile, context.viewer.pid), action.page);
    console.log(`The map pane for ${project.root} is already open \u2014 showing page "${action.page}".`);
    return;
  }
  const placed = placePane(cfg, watchPath, mapFile, context.target);
  if (!placed.ok) {
    console.error(placed.error);
    process.exit(1);
  }
  const reported = await awaitNewPane(store, mapFile, context);
  if (!reported.ok) {
    console.error(reported.error);
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
