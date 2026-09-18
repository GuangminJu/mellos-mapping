# Mellos Mapping · omp (Oh My Pi)

A live layered dependency map while the agent plans and builds, for
[omp](https://github.com/can1357/oh-my-pi). omp reads the Claude Code plugin
layout the two other editions already ship — the same marketplace catalog, MCP
config, skill and slash command — so one install serves both hosts.

## Install once

Requires Node.js 18+ and omp on `PATH`. One release serves every host, so the
marketplace is this repository:

```sh
omp plugin marketplace add GuangminJu/mellos-mapping
omp plugin install mellos-mapping@mellos-mapping
```

That follows `main`, where a release is a version bump. For a frozen version,
add a checkout of one instead — the Claude Code edition ZIP attached to the
GitHub Release, the `claude` branch, or any commit at the release tag:

```sh
omp plugin marketplace add "<checkout or extracted release directory>"
omp plugin install mellos-mapping@mellos-mapping
```

Add `--scope project` to the install to keep it to the current project instead
of every one. Restart omp (a new session) afterwards: skills, slash commands and
MCP servers are discovered at session start.

What omp discovers from the plugin root, and what each piece does:

| Plugin content | What omp does with it |
| --- | --- |
| `.mcp.json` | the eight `mmap_*` tools, as `mcp__<server>_<tool>`; `${CLAUDE_PLUGIN_ROOT}` is expanded in `command`, `args`, `env` and `cwd` |
| `package.json#omp.extensions` | `dist/omp-extension.mjs` — the session adapter below |
| `skills/mellos-mapping/SKILL.md` | the map discipline, read on demand and reachable as `skill://mellos-mapping` |
| `commands/mmap.md` | the `/mellos-mapping:mmap` slash command |
| `hooks/hooks.json` | nothing — omp never reads it (see below) |

The first session asks **one** question — how eager mapping should be — through
the `mmap_setup` tool, and records the answer for every project you will ever
open. See [Setup: choose when maps open](../../README.md#setup-choose-when-maps-open).

## The session adapter

omp has no `hooks/hooks.json`: its hook capability reads `hooks/pre|post/` as
TOOL hooks (`pre:<tool>`), and session lifecycle belongs to extension modules.
So the paragraph that tells a session which mapping policy is in force is
delivered by `dist/omp-extension.mjs`, an omp extension declared in
`package.json#omp.extensions`. It calls the same `sessionStartContext()` the
Claude Code hook prints, reads the same store, and injects the paragraph once at
the first prompt of a session — and again after a compaction, which is exactly
where a standing instruction gets lost. On Windows it also owns the `mmap`
PATH shim, the same one the Claude hook installs: whichever host opens the
session installs it, never both.

Nothing else about the plugin changes between the two hosts. Maps live in
`.mellos/`, and every surface that reads them — pane, Markdown, web — reads the
same JSON.

## The pane

omp draws its own TUI and has no split pane, so the map lives where it does for
Claude Code on the same machine: a terminal split beside the session.

- Windows: `mmap_open` splits the **Windows Terminal** window hosting the omp
  session (the launcher identifies it by probing the console, not by guessing
  the most recently used window), then returns keyboard focus to the
  conversation.
- Linux/macOS: the same call opens a tmux split, or a new tmux window with
  `window: true`.
- Neither available: the tool reports the failure and quotes the complete
  watcher command to run in any second terminal.

`mmap` is the same toggle typed by hand, and it does not go through omp at all:
the session adapter installs it on Windows (see the README section on the
command). Where the user PATH cannot be edited — a long PATH makes `setx`
refuse — a second copy lands in `%LOCALAPPDATA%\Microsoft\WindowsApps`, which
PATH already names, so `mmap` runs in a new terminal with no PATH change.
`mmap <slug>` opens a specific page; `mmap` again closes the pane.

`mmap` typed in any terminal toggles that pane open and closed;
the session's own `/mellos-mapping:mmap` does the same from inside a
conversation. Every map write answers with a `pane:` line saying whether anyone
is actually looking, and the assistant opens or retargets the pane when nobody
is.

For a browser instead of a terminal, `mmap_open {surface: "web"}` starts the
project-local viewer and returns its URL; open that URL with the session's
browser tool. `surface: "markdown"` still generates the MD + SVG documents, but
omp has no file side panel to display them in — the terminal pane and the web
viewer are the two surfaces that mean something here.

## Developer notes

Source development uses Node.js 22.12+; the shipped bundles need no build step.
`npm ci && npm run verify` runs the source, release and host checks.

Neither `omp plugin link <this directory>` nor `omp plugin install
mellos-mapping` (the npm package) installs this plugin, and the reason is the
same for both: omp's **extension-package** MCP reader (npm/link plugins) passes
`args` and `env` through verbatim — only `command` and `cwd` are resolved
against the plugin root — so the `${CLAUDE_PLUGIN_ROOT}` in `.mcp.json` reaches
`node` unexpanded and the server dies at startup (`MCP subprocess closed stdout
before responding`). What survives is the session adapter with no tools behind
it, which is worse than not installing.

The obvious repair — a relative `args` plus `"cwd": "."`, which both omp
readers resolve against the plugin root — is closed by the other host: Claude
Code's stdio MCP schema is `{type, command, args, env, timeout, alwaysLoad,
role}` with **no `cwd`** (verified against `claude.exe` 2.1.272), so the same
file cannot carry both forms. `${CLAUDE_PLUGIN_ROOT}` stays, and the marketplace
is the only route that expands it. The npm package remains what it always was:
the MCP server, for clients that bring their own prompting.

Working *inside* this repository brings one quirk of the plugin layout with it:
the repo-root `.mcp.json` is also a project-scope MCP file, and a project-scope
reader does not expand `${CLAUDE_PLUGIN_ROOT}` — any host, omp included, will
try to start a second, broken `mellos-mapping` server there and log
`MCP subprocess closed stdout before responding`. The plugin's own entry
(`mellos-mapping:mellos-mapping`) is unaffected. To silence the project-scope
one while developing here, put the plain name in the user denylist
(`~/.omp/agent/mcp.json`):

```json
{ "disabledServers": ["mellos-mapping"] }
```

The marketplace-installed copy is untouched by that entry's name, because
marketplace servers carry the `<plugin>:<server>` prefix.

## Update and uninstall

```sh
omp plugin marketplace update mellos-mapping
omp plugin upgrade mellos-mapping@mellos-mapping
```

**Close the pane first** (`q` in it, or `mmap` typed in the console). The
watcher runs from the cached plugin copy, and on Windows an open file cannot be
renamed away: `upgrade` stages the new copy, deletes the old directory and then
renames — with a pane still running, that rename fails with `EPERM` and leaves
the plugin cache empty (old copy gone, new one not in place). The repair is the
install itself:

```sh
omp plugin install mellos-mapping@mellos-mapping --force
```

So the order is: close the pane, upgrade, restart omp, open the pane again. The
web viewer has the same requirement — stop it (`--stop`) before upgrading.

`upgrade` reinstalls from the refreshed catalog.
omp refreshes a catalog entry it has not updated for 24 hours at startup, best
effort, unless `marketplace.autoUpdate` is `off`; with the default `notify` mode
that refresh happens but the availability line goes only to the debug log, so
the `marketplace update` step is what makes an update both immediate and
visible.

`upgrade` does **not** compare versions: it force-reinstalls whatever the
catalog now names, same version number or not (omp's own background check is the
part that compares, and only for newer ones). A version bump is therefore how a
release is *identified* — in the catalog, in `omp plugin list`, and in what the
background check reports — not what gates delivery: run `marketplace update`
first whenever the question is "does main have something newer than what I
have".

One marketplace name can only point at one place at a time, so a machine that
develops this plugin and installs its release carries one of them: switching
between the working clone and this repository means `omp plugin marketplace
remove mellos-mapping` first (the installed copy stays put until the next
upgrade).

```sh
omp plugin uninstall mellos-mapping@mellos-mapping
omp plugin marketplace remove mellos-mapping
```

Project maps, previews and the recorded mapping preference stay on disk.
