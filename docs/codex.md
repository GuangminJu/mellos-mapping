# Mellos Mapping · ChatGPT App (Codex mode)

This package targets Codex mode in the ChatGPT desktop app, also called Codex App.
The two editions share the map model, store and renderers. The desktop edition
has its own skill and includes no Claude SessionStart hook or MCP configuration.

## Install and update

Requires Node.js 18.17+ on the 18.x line, or 20.3+, and a Codex CLI with plugin
commands (tested with 0.153.4). Supported platforms are Windows 10+, macOS 13.0+
and Linux with glibc 2.28+, each on x64 or arm64. The OS must also meet the selected
Node.js version's requirements. Native lock bindings ship with the package.
From the `chatgpt-app` branch run `node install.mjs`; from `main` run
`node install.mjs chatgpt-app`. Committed bundles need no build or npm dependencies.

The installer checks file hashes and a real MCP handshake, copies the runtime to
`~/.mellos/installations/chatgpt-app/`, registers the `mellos-mapping-codex`
marketplace, installs the skill, and registers the eight MCP tools at user scope.
The runtime uses an absolute Node executable and leaves its working directory
unset so each conversation writes to its own project. The clone can be deleted
or moved after installation. Other plugins, maps and mapping policies are preserved.

Start a new conversation after installing or updating. Ask:
“用梅勒斯地图制定计划，并在当前对话右侧终端展示，持续更新验证进度。”
Run the installer again from a newer release to update. In an edition clone,
`node install.mjs --check` checks prerequisites, file integrity and MCP without
changing host configuration. Existing watchers retain old code until restarted.

If migrating from the earlier personal-marketplace version, remove its plugin
with Codex first to avoid two copies of the skill. The registration helper
`scripts/codex-register.mjs` remains available to maintain those existing installs.
It replaces only the named MCP entry; custom transport options may need reapplying.

To uninstall the release edition:

```sh
codex plugin remove mellos-mapping@mellos-mapping-codex
codex mcp remove mellos-mapping
codex plugin marketplace remove mellos-mapping-codex
```

Project maps and mapping preferences remain. GitHub distribution does not itself
publish the package into OpenAI's public plugin directory.

## Automatic web terminal

For saved-map discovery, structured CRUD, checkpoints and concurrent updates,
see [the persistent-map API guide](map-api.md). Start by reading existing pages;
a new conversation does not require a new map. Restart older MCP/native watchers
before writing maps with format-2 context or source references. Reopening a Web
surface replaces services without format-2 support and returns a new URL.

Call `mmap_open {surface: "web-terminal", page: "<slug>"}` and pass the returned
`hostOpen` object to `open_in_codex`. It uses `placement: "right"` and a browser
target in the current conversation. The local service starts mmap when the
browser connects; the user does not paste a startup command. No Computer Use
or desktop keyboard automation is involved. With an older MCP schema:

```sh
node "<plugin root>/dist/web.mjs" "<project>" --terminal --page <slug>
```

Open the printed JSON `url`. The page provides its own font-size selector,
help, reconnection and a link to the same map in graphical SVG mode. Font
changes remeasure terminal cells rather than stretching an image, and do not
change the host's global terminal font. The terminal uses xterm.js cell rendering;
the graphical mode remains native SVG and supports SVG export.

Both modes use the same project maps. Terminal input/output goes over a local
WebSocket to a dedicated mmap worker. Each connected browser owns its own
page/zoom/selection state and renderer; there is no shared shell. Closing the
tab or stopping the service ends its worker. `q` closes the map until Reconnect.
Network interruptions get three retry attempts; reopen via MCP if the service
has exited. A reconnect starts a fresh view on the current page.

All assets and the worker ship prebuilt. No node-pty, native compiler, npm install,
external terminal, remote hosting or account is required. The service accepts
only bounded map input/resize messages from its own origin and secret URL,
limits sessions to eight, and keeps one output chunk in flight until the browser
renders it. Slow clients cannot accumulate unlimited rendered map frames.

An already-running service from before this feature is stopped and restarted
on a web-terminal request. That restart disconnects its existing graphical tabs;
reopen them with the new URL. For later runtime updates, use `--stop` first.

## Optional native desktop terminal

Call `mmap_open {surface: "codex-terminal", page: "<slug>"}`. This prepares the
actual Node executable and absolute watcher/map paths, with PowerShell and POSIX
commands. It starts no program or window. Use the host's `open_in_codex` tool with
`placement: "right"` and `target: {type: "terminal"}` in the current conversation.

If a supported host tool executes commands in this user terminal, use it.
If only opening/reading tools are exposed, paste the returned command once.
That interface cannot provide fully automatic first startup. Agent command PTYs
are separate; stringifying their numeric session IDs cannot attach them to the
user terminal. No shell profile modification or external-window workaround is used.

Check the map title and controls with `read_thread_terminal` after startup.
`queued` means a pending panel request; a shell prompt means the map has not
started. A viewer heartbeat could come from another window. Reuse an existing
viewer and preserve a manually pinned page. Map writes refresh the watcher.

The equivalent manual command, with paths appropriate to the current install:

```sh
node "<plugin root>/dist/watch.mjs" --file "<project>/.mellos/map.json" --page <slug>
```

Wheel / `+` / `-` changes semantic zoom; drag pans; click pins details;
double-click enters a submap; `0` resets and `q` exits. `--no-mouse` leaves
mouse events to the host. Font size follows the app's code/terminal settings.
After an update, press `q` and rerun the command to load the new watcher.

The native watcher uses an alternate screen and reasserts mouse reporting every
second to recover panel remounts. It outputs changed rows, coalesces mouse-motion
paints within 16 ms and keeps only the latest pending frame under backpressure.
A full snapshot every second repairs truncated terminal replay. Viewer-presence
writes yield on locked files; authoritative map saves retain atomic retries.
Hover changes border and dependency colors without toggling font weight.

Plain `mmap_open {surface: "terminal"}` is the external Windows Terminal launcher
for Claude Code and Codex CLI. It does not open the desktop integrated terminal.

## Desktop right-side map

The existing document surface remains available. Call
`mmap_open {surface: "markdown", page: "<slug>"}`, then open the returned absolute
Markdown path with the host's file target and `placement: "right"`.

The runtime generates `.mellos/previews/page-<slug>.md` (or `map.md` for the
default page), `index.md`, and content-hashed SVG images. JSON is authoritative.
The document includes dependencies, status, details, evidence and child-page links.
Vectors stay sharp when enlarged. Image nodes do not support dragging, hovering,
animated spinners or double-clicking. Use the document links to visit child maps.

Opening this surface enables automatic exports after successful MCP map writes,
including after server restart. Direct JSON edits or older clients need regeneration:

```sh
node "<plugin root>/dist/preview.mjs" "<project>" --page <slug>
```

File generation does not prove visibility or automatic host refresh. Regenerate
and reopen if stale. `preview: STALE` means the map was saved but exporting failed;
fix the export without repeating the mutation. Previous SVG images remain for
already-open documents. `.mellos/previews/` is disposable; removing it disables
auto-export until the next open. Remove a stale `.publish-lock` only after its
old exporter has stopped, then regenerate.

## Optional interactive web viewer

Call `mmap_open {surface: "web", page: "<slug>"}` and open the returned local URL
with the host's browser target on the right. Or run:

```sh
node "<plugin root>/dist/web.mjs" "<project>" --page <slug>
```

The viewer supports vector pan/zoom, hover and pinned details, dependency
highlighting, search, status filters, page switching, submaps, breadcrumbs,
semantic group aggregation below 55%, lanes/sequences, SVG export, themes and
confirmed page deletion. Dragging pans the canvas; nodes retain automatic layout.
Narrow panels place details beneath a draggable divider. Map edits use MCP tools.

Cards, labels and connections are native SVG. Zoom changes the SVG `viewBox`.
The local service binds to `127.0.0.1`, uses an unpredictable per-launch URL,
checks Host/Origin and serves bundled assets and project maps only. It polls every
800 ms. Broken pages show errors without hiding other pages; connection failures
label the last available data. Manual page choice pins that page. Existing
Markdown exports and terminal preferences remain available.

The detached service survives its MCP parent and stops after five minutes without
requests. Stop it before reopening after a runtime update:

```sh
node "<plugin root>/dist/web.mjs" "<project>" --stop
```

A queued browser-open result does not prove that the viewer is visible.

## Developer verification

Use Node.js 22.12+ for source development. Run `npm ci` then `npm run verify`.
`npm run package:codex`
produces the flat plugin; `npm run package:release` produces both installable host
editions. Runtime tests use actual stdio in separate temporary projects; installation
checks must use isolated host configuration. No developer path belongs in a release.

The [official plugin documentation](https://developers.openai.com/plugins/build/plugins)
describes local marketplaces and Git distribution. See the
[plugin usage guide](https://learn.chatgpt.com/docs/plugins) for host installation behavior.
