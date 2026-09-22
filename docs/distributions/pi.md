# Mellos Mapping · pi

A live layered dependency map while the agent plans and builds, for
[pi](https://pi.dev). pi is not a host that reads a plugin directory: it loads
EXTENSIONS, and it has no MCP client of its own, by design. So this edition
ships both halves — an extension that speaks MCP to the same server the Claude
Code edition configures, and the session paragraph the Claude Code hook prints.

## Install once

Requires Node.js 18+ and pi on `PATH`. The npm package carries the extension,
the skill and the prompt template:

```sh
pi install npm:mellos-mapping
```

Any pi source works — pick one and stay with it:

```sh
pi install git:github.com/GuangminJu/mellos-mapping@main   # a ref, pinned until you reconcile it
pi install /absolute/path/to/checkout                     # a working clone
```

Add `-l` to install for the current project (`.pi/settings.json`, shareable with
a team) instead of every session. Start a new session afterwards: pi discovers
packages at session start.

What pi finds in the package, and what each piece does:

| Package content | What pi does with it |
| --- | --- |
| `package.json#pi.extensions` | `dist/pi-extension.mjs` — the MCP client and session adapter below |
| `package.json#pi.skills` | `skills/mellos-mapping/SKILL.md` — the map discipline, loaded as a skill |
| `package.json#pi.prompts` | `commands/mmap.md` — the `/mmap` prompt template |
| `.mcp.json` | nothing — pi reads no MCP configuration at all |
| `hooks/hooks.json` | nothing — pi has no `SessionStart` hook |
| `.claude-plugin/`, `.codex-plugin/` | nothing — those install paths belong to other hosts |

The three `pi` fields are declared explicitly for a reason: pi auto-discovers
`skills/` and `prompts/` by convention only for a package with NO `pi` manifest
(`docs/packages.md`, "Convention Directories"), so declaring `extensions` alone
would silently drop the skill, and Claude Code's `commands/` is not pi's
`prompts/` either. Naming all three keeps the two editions one product.

The first session asks **one** question — how eager mapping should be — through
the `mmap_setup` tool, and records the answer for every project you will ever
open. See [Setup: choose when maps open](../../README.md#setup-choose-when-maps-open).

## How the eight tools get there

pi has no MCP, so the extension carries the client side. On `session_start` it
launches the same `dist/server.mjs` the Claude Code edition's `.mcp.json` names
— through the interpreter pi is already running on, with the session's working
directory, which is how the server knows whose map it serves — and registers the
tools the server advertises in `tools/list` as ordinary pi tools. There is no
`mcp__` prefix, because there is no MCP layer between them to name.

Nothing is declared twice: a tool added to the server shows up in pi the next
session, the server's own JSON Schema is handed to pi as that tool's
`parameters`, and a tool the server stops advertising is not registered at all.
The server's error text travels to the model unchanged — it is the reason the
model can fix its own call (`expectedRevision`, a page that does not exist).

The supported distribution is the npm one: the server is started with
`process.execPath`, so it runs on the same Node process pi runs on. A pi installed
as a compiled binary (the `install.sh` path) is refused in one line instead of
being left to fail its handshake later — there `process.execPath` is pi itself,
not an interpreter.

The child process inherits this process's environment, so which terminal
integration the pane launcher detects is the same fact under pi as under Claude
Code, and nothing it prints can reach the terminal (stderr is discarded — an
extension that lets a child write corrupts the TUI it is drawn in). It is closed
at `session_shutdown`, one server per session, so a session never leaves a
process holding the store behind it.

## The session paragraph

pi has no `SessionStart` hook, so the paragraph that tells a session which
mapping policy is in force is delivered from `before_agent_start` — hidden
(`display: false`), once on the first prompt of a session, and again after a
compaction, which is exactly where a standing instruction gets lost. It is built
by the same `sessionStartContext()` the Claude Code hook prints and reads the
same store, so the words are not a second dialect of the policy. A policy that
changes under a long session is told again; an unchanged one is not repeated
every turn. The paragraph is also re-read, never trusted: a store that cannot be
read at that moment costs the session nothing but keeps the arming for the next
turn.

On Windows the adapter also installs the `mmap` PATH shim — the same installer
the Claude hook runs, so whichever host opens the session maintains it, and
never both.

One fault is reported rather than swallowed: if the map server cannot start, the
model is told in one line, in that same injection, that the map tools are
unavailable and the user should be told. A paragraph instructing it to open a
pane that cannot open would be worse than no paragraph.

## The pane

pi draws its own TUI and has no split pane of its own, so the map lives exactly
where it does for Claude Code on the same machine — a terminal split beside the
session — because the launcher belongs to the SERVER, not to the host: the same
`mmap_open` splits the Windows Terminal window hosting the session (identified by
probing the console, not by guessing the most recently used window) or opens the
tmux split, with `window: true` for a new tmux window instead.

Known limitation, shared with the Claude Code edition and tracked as separate
work rather than as part of this port: where that terminal integration cannot be
detected — a session not running inside tmux or Windows Terminal — there is no
split to make, and `mmap_open` answers with the complete watcher command to run
in any second terminal. pi behaves exactly as Claude Code does in the same
terminal, on purpose: the display path is one path, and improving the detection
is a change to it, not to pi.

`mmap` typed in any terminal is the same toggle, and the session's own `/mmap`
does the same from inside the conversation. Every map write answers with a
`pane:` line saying whether anyone is actually looking, and the assistant opens
or retargets the pane when nobody is.

For a browser instead of a terminal, `mmap_open {surface: "web"}` starts the
project-local viewer and returns its URL; open that URL with the session's
browser tool. `surface: "markdown"` still generates the MD + SVG documents, but
pi has no file side panel to display them in — the terminal pane and the web
viewer are the two surfaces that mean something here.

## Developer notes

Source development uses Node.js 22.12+; the shipped bundle needs no build step —
the MCP client is bundled into `dist/pi-extension.mjs`, so pi has no runtime
dependency to resolve at install time. `npm ci && npm run verify` runs the
source, release and host checks.

Working *inside* this repository is quiet under pi, unlike under omp: the
repo-root `.mcp.json` is also a project-scope MCP file for hosts that read MCP
configuration, and pi reads none, so no second, broken server is ever started
from it.

## Update and uninstall

```sh
pi update --extensions          # reconcile git refs, reinstall npm packages
pi update npm:mellos-mapping    # or just this one
pi remove npm:mellos-mapping    # remove it (add -l for the project-scope entry)
```

A versioned spec (`npm:mellos-mapping@0.27.0`) is pinned: both update commands
skip it. A git ref is reconciled to what the settings name, never moved to a
newer one — to follow `main`, that is what the settings should say.

Each session owns the map server it started, so a session that is already
running keeps the copy it began with: restart pi to run the new one, and reopen
a pane still showing the old bundle (`q` in it, then `mmap_open` again).

Project maps, previews and the recorded mapping preference stay on disk.
