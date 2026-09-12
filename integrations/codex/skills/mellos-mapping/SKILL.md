---
name: mellos-mapping
description: >-
  Display a live layered plan beside the current conversation in ChatGPT desktop
  Codex mode (Codex App), and update it as implementation is verified. Use for
  Mellos maps, /mmap, dependency diagrams, visual plans and development progress.
  For proactive use, respect the user's mmap_setup policy.
---

# Mellos Mapping for ChatGPT desktop · Codex mode

Create a useful layered plan and keep it visible beside this conversation.
The six MCP tools use the `mmap_` prefix; the host may add a server namespace.
Maps belong to the current project: `.mellos/map.json` and named pages under
`.mellos/pages/`. A named page can exist without the default map file.
Use `mmap_view` to discover pages and reuse the page for this effort.

## Plan and progress

Read `mmap_setup {}` once per session. Respect the effective policy: `always`
covers structured work, `complex` covers substantial work across modules, and
`on-request` covers explicit map requests. If unset, ask which policy the user
wants; an explicit request for a map can proceed while that preference is pending.
Never choose or persist a policy on the user's behalf. Existing consent for a map
covers opening its panel; do not ask for the same permission again.

Declare the intended structure with `mmap_declare` before implementation. One
effort gets one stable page slug, supplied to subsequent calls. Nodes represent
buildable responsibilities with short labels and useful `detail`, not individual
files or generic checklist steps. Rank 0 is the foundation; edges point from a
consumer to a strictly lower dependency. Layers describe dependency direction.

Use `planned` for the design, `in-progress` for active work, and `done` only with
actual verification recorded in `evidence`. Revise the map as the design changes.
If a verified dependency breaks, mark it and affected consumers `regressed`;
restore each only with fresh evidence. Independent modules may progress together.
Do not create artificial layers or dependencies to make the picture larger.

Use groups for crowded bands and child pages (`submap`) when a module's internals
need their own diagram. Every group is a strict subset of one band. Overview
zoom aggregates groups; closer zoom shows nodes and details. `architecture`,
`dataflow`, `behavior-tree` and `sequence` are neutral documentation kinds;
use `dev` for progress. Cyclic state machines are unsupported.

## Open the map in this conversation

Preserve a surface the user has chosen. Otherwise prefer the **native right-side
terminal** in the desktop app. Opening and updating the map are separate steps.

1. Call `mmap_open {surface: "codex-terminal", page: "<effort-slug>"}`.
   This returns the actual Node executable, absolute watcher/map paths and
   correctly quoted PowerShell/POSIX commands. `ready-to-start` means prepared.
2. Inspect `read_thread_terminal` if available. Reuse an existing map terminal;
   do not interrupt another program or create duplicate viewers. A manually
   selected page with auto-follow off belongs to the user. Ask before switching
   it unless the current request explicitly asks to show another page.
3. Open the current task's panel with the host `open_in_codex` tool:
   `{"placement":"right","target":{"type":"terminal"}}`.
   Omit `threadId`. Only pass a `sessionId` when a **host terminal tool** returned
   it for this terminal. Numeric `exec_command` session IDs are agent PTYs and
   cannot be attached to the user's terminal by stringifying them.
4. If a supported host tool can execute in that user terminal, use the returned
   executable and args there. Current hosts may expose opening and reading only.
   In that case, give the user the returned command for the terminal's shell to
   paste once. Explain briefly that the host has no terminal-input tool. Continue
   the requested work and map updates; do not repeatedly open panels or ask for
   permission. Do not launch an external Windows Terminal as a substitute.
5. After startup, use `read_thread_terminal` to check the expected map title and
   watcher controls. Report exactly what is known: `queued` is a pending panel
   request; a shell prompt means the map has not started; map output confirms
   execution but alone does not prove panel placement. A `pane:` heartbeat can
   come from another window and is not proof of this conversation's right panel.

Do not call plain `mmap_open {surface: "terminal"}` for the desktop right panel:
that is the external Windows Terminal launcher used by terminal clients.
Do not modify shell profiles, global terminal settings, app internals or clipboard
contents to manufacture automatic startup. If a required tool is unavailable,
state the missing capability and provide the concrete command or selected fallback.

For an older MCP schema without `codex-terminal`, resolve the actual plugin root
from this skill's installed location (two directories above its directory), check
`dist/watch.mjs` exists, and construct the equivalent command with absolute paths:
`node "<plugin root>/dist/watch.mjs" --file "<project>/.mellos/map.json" --page <slug>`.
Quote for the user's shell; never copy a developer's username or cache version.

Once running, map writes refresh the viewer. Do not restart after every update.
Wheel / `+` / `-` changes semantic zoom, drag pans, click pins details, `0` resets,
and `q` exits. After a runtime update the user can press `q`, then rerun the command.

## Other supported surfaces

- **Markdown/SVG:** `mmap_open {surface: "markdown", page}` returns an absolute
  Markdown path. Open it with `open_in_codex`, `placement: "right"`, file target.
  Images are vectors and child pages are document links. Image nodes do not have
  terminal hover or drag controls. Generation enables export after map writes;
  host refresh is not guaranteed. Reopen if stale. `preview: STALE` means the map
  save succeeded; regenerate the export without repeating the mutation.
- **Web:** `mmap_open {surface: "web", page}` returns a local URL. Open it with
  the host's browser target on the right. It supports interactive nodes, pan,
  zoom, filters and child pages. Respect the user's chosen surface and do not
  replace the terminal or document just because another surface exists.
- **Codex CLI:** Without a desktop panel tool, run the watcher in an available
  interactive terminal/split. The Windows Terminal launcher is optional there.
  `mmap_view` is always available as text, but text is not proof of an open viewer.

## Installation and recovery

The release installer installs this skill and registers all six MCP tools for
each session's working directory. Start a new conversation after installing or
updating. If tools are missing, explain that boundary and continue useful work.
Repair host configuration only as part of authorized installation/repair work.
The installation guide is `<plugin root>/docs/codex.md`.

Keep finished pages unless the user requests deletion. Deleting pages is permanent.
