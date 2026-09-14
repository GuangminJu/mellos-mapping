#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// scripts/mmap.mjs
import { existsSync as existsSync2 } from "node:fs";
import { dirname as dirname2, join as join2, resolve } from "node:path";

// scripts/watcher-command.mjs
function watcherArgs(cfg, watchPath, mapFile) {
  const args = [watchPath, "--file", mapFile, ...cfg.watcherFlags];
  if (cfg.pageSlug !== void 0) args.push("--page", cfg.pageSlug);
  return args;
}
function manualWatcherCommand(cfg, watchPath, mapFile, nodePath = process.execPath) {
  return [nodePath, ...watcherArgs(cfg, watchPath, mapFile)].map((arg) => "'" + arg.replaceAll("'", `'"'"'`) + "'").join(" ");
}
function paneFailureMessage(error, cfg, watchPath, mapFile, platform = process.platform) {
  return platform === "win32" ? error : `${error}
Automatic opening failed. Do not retry until the terminal environment changes. Run this command in a visible terminal:
${manualWatcherCommand(cfg, watchPath, mapFile)}`;
}

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

// scripts/tmux-session.mjs
import { spawnSync as spawnSync2 } from "node:child_process";
import { createHash } from "node:crypto";
var SESSION_FORMAT = "#{session_id}	#{session_attached}";
var TARGET_FORMAT = "#{socket_path}	#{session_id}	#{session_created}	#{session_attached}	#{pane_id}	#{pane_pid}";
var PANE_FORMAT = "#{pane_id}	#{pane_pid}	#{window_id}	#{window_active}	#{window_zoomed_flag}	#{pane_active}";
function createTmuxAdapter({ env = process.env, spawn = spawnSync2, nodePath = process.execPath } = {}) {
  const inherited = /^(.*),\d+,(\d+)$/.exec(env.TMUX ?? "");
  const socket = env.MELLOS_MAPPING_TMUX_SOCKET || inherited?.[1];
  function run(args, socketPath = socket) {
    const result = spawn("tmux", [...socketPath ? ["-S", socketPath] : [], ...args], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5e3,
      windowsHide: true
    });
    return result.status === 0 ? { ok: true, value: result.stdout.trim() } : { ok: false, error: `tmux ${args[0]} failed: ${result.error?.message || result.stderr?.trim() || `exit ${result.status}`}` };
  }
  function inspectSession2(cfg, viewers = []) {
    const sameServer = !env.MELLOS_MAPPING_TMUX_SOCKET || socket === inherited?.[1];
    let selected = env.MELLOS_MAPPING_TMUX_TARGET || (sameServer && inherited ? /^%\d+$/.test(env.TMUX_PANE ?? "") ? env.TMUX_PANE : `$${inherited[2]}:` : void 0);
    if (!selected) {
      const listed = run(["list-sessions", "-F", SESSION_FORMAT]);
      if (!listed.ok) return listed;
      const attached2 = listed.value.split("\n").map((line) => line.split("	")).filter(([id, count]) => /^\$\d+$/.test(id) && Number(count) > 0).map(([id]) => id);
      if (attached2.length !== 1) return { ok: false, error: attached2.length === 0 ? "No attached tmux session was found. Attach a session before retrying." : `Multiple attached tmux sessions (${attached2.join(", ")}). Set MELLOS_MAPPING_TMUX_TARGET to the intended session or pane in the MCP server environment before retrying.` };
      selected = `${attached2[0]}:`;
    }
    const inspected = run(["display-message", "-p", "-t", selected, TARGET_FORMAT]);
    if (!inspected.ok) return inspected;
    const [socketPath, session, created, attached, pane, panePid] = inspected.value.split("	");
    if (!socketPath || !/^\$\d+$/.test(session) || !/^\d+$/.test(created) || !/^%\d+$/.test(pane)) {
      return { ok: false, error: "tmux returned an invalid session target; no pane was opened." };
    }
    if (!(Number(attached) > 0)) return { ok: false, error: `tmux session ${session} has no attached client. Attach it before retrying.` };
    const identity = [socketPath, session, created, cfg.mode, cfg.mode === "window" ? "" : pane];
    const selectedViewer = cfg.mode === "split" ? viewers.find((viewer) => viewer.pid === Number(panePid) && /^tmux-[a-f0-9]{24}$/.test(viewer.owner ?? "")) : void 0;
    const owner = selectedViewer?.owner ?? `tmux-${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24)}`;
    return { ok: true, value: { backend: "tmux", socket: socketPath, session, pane, owner, owners: [owner] } };
  }
  function revealPane(target, viewer) {
    const listed = run(["list-panes", "-s", "-t", target.session, "-F", PANE_FORMAT], target.socket);
    if (!listed.ok) return listed;
    const pane = listed.value.split("\n").map((line) => line.split("	")).find((fields) => Number(fields[1]) === viewer.pid);
    if (!pane || !/^%\d+$/.test(pane[0]) || !/^@\d+$/.test(pane[2])) {
      return { ok: false, error: "The live watcher could not be located in this tmux session; visibility is unverified." };
    }
    const selected = run(["select-window", "-t", `${target.session}:${pane[2]}`], target.socket);
    if (!selected.ok) return selected;
    if (pane[4] === "1" && pane[5] !== "1") {
      const unzoomed = run(["resize-pane", "-Z", "-t", pane[0]], target.socket);
      if (!unzoomed.ok) return unzoomed;
    }
    const visible = run([
      "display-message",
      "-p",
      "-t",
      `${target.session}:${pane[2]}.${pane[0]}`,
      "#{session_attached}	#{window_active}	#{window_zoomed_flag}	#{pane_active}"
    ], target.socket);
    if (!visible.ok) return visible;
    const [attached, active, zoomed, focused] = visible.value.split("	");
    return Number(attached) > 0 && active === "1" && (zoomed !== "1" || focused === "1") ? { ok: true, value: "visible" } : { ok: false, error: "The watcher is running, but its tmux pane is not visible in the attached session." };
  }
  function openPane(cfg, watchPath, mapFile, target) {
    const placement = target.mode === "window" ? ["new-window", "-n", "mellos-mapping", "-t", `${target.session}:`] : ["split-window", "-h", "-d", "-l", "42%", "-t", target.pane];
    const result = run([
      ...placement,
      "-c",
      cfg.projectDir,
      nodePath,
      ...watcherArgs(cfg, watchPath, mapFile),
      "--owner",
      target.owner
    ], target.socket);
    return result.ok ? { ok: true, value: { ...target, reason: "requested" } } : result;
  }
  return { kind: "tmux", inspectSession: inspectSession2, openPane, revealPane };
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
  return ["--title", "mellos map", "-d", cfg.projectDir, "node", ...watcherArgs(cfg, watchPath, mapFile)];
}
var DEDICATED_WINDOW_NAME = "mellos-mapping";
var SPLIT_SIZE = "0.42";
function selectPaneViewer(viewers, owners) {
  return viewers.find((viewer) => viewer.owner !== void 0 && owners.includes(viewer.owner));
}
var platformTerminal = () => process.platform === "win32" ? terminal_session_exports : createTmuxAdapter();
function preparePane(cfg, store, mapFile, io = platformTerminal()) {
  const viewers = store.readLiveViewers(mapFile, Date.now());
  const inspected = io.kind === "tmux" ? io.inspectSession(cfg, viewers) : cfg.mode === PANE_MODE.window ? { ok: true, value: { owners: ["window"], owner: "window" } } : io.inspectSession();
  if (!inspected.ok) return inspected;
  const session = inspected.value;
  const viewer = selectPaneViewer(viewers, session.owners);
  if (io.kind !== "tmux" && cfg.mode === PANE_MODE.split && !session.hwnd && (!viewer || cfg.force)) {
    return { ok: false, error: "Could not identify this conversation\u2019s active Windows Terminal pane. Activate its PowerShell tab and retry; no separate window was opened. Use --window only if you want a separate window." };
  }
  return { ok: true, value: {
    target: { ...session, mode: cfg.mode, owner: session.owner ?? viewer?.owner },
    viewer,
    previousPids: viewers.map((item) => item.pid)
  } };
}
function placePane(cfg, watchPath, mapFile, target, io = platformTerminal()) {
  if (io.kind === "tmux") return io.openPane(cfg, watchPath, mapFile, target);
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
  const candidates = [store.resolveProjectDirectory(process.cwd())];
  const marker = storeMarkerOf(store.STATE_FILE_RELATIVE_PATH);
  const project = nearestProject(candidates, candidates.map((dir) => existsSync2(join2(dir, marker))));
  const cfg = { ...parsed.value, projectDir: project.root };
  const mapFile = join2(project.root, store.STATE_FILE_RELATIVE_PATH);
  const fail = (error) => {
    console.error(paneFailureMessage(error, cfg, watchPath, mapFile));
    process.exit(1);
  };
  const prepared = preparePane(cfg, store, mapFile);
  if (!prepared.ok) {
    fail(prepared.error);
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
    fail(placed.error);
  }
  const reported = await awaitNewPane(store, mapFile, context);
  if (!reported.ok) {
    fail(reported.error);
  }
  const where = placed.value.backend === "tmux" ? placed.value.mode === PANE_MODE.window ? "in a new tmux window" : "beside this terminal (tmux split)" : placed.value.mode === PANE_MODE.window ? `in the dedicated "${DEDICATED_WINDOW_NAME}" window (${placed.value.reason})` : "beside this terminal (vertical split)";
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
