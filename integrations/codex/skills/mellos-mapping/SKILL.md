---
name: mellos-mapping
description: >-
  Create and resume persistent layered maps in Codex CLI and Codex App,
  and update them as implementation is verified. Use for
  Mellos maps, /mmap, dependency diagrams, visual plans and development progress.
  For proactive use, respect the user's mmap_setup policy.
---

# Mellos Mapping for ChatGPT desktop · Codex mode

Create a useful layered plan and keep it visible beside this conversation.
The eight MCP tools use the `mmap_` prefix; the host may add a server namespace.
Maps belong to the current project: `.mellos/map.json` and named pages under
`.mellos/pages/`. A named page can exist without the default map file.
Use `mmap_read {resource: "pages"}` to discover saved pages and their summaries.
A new conversation or context compaction is not a new effort. Match the current
work to an existing page, read its context and relevant nodes, and keep that slug.
Use `mmap_view` for the picture; use `mmap_read` for editable IDs and revisions.
For older servers without mmap_read, use mmap_view's page list and read that
page's JSON when precise IDs are needed. Never infer IDs from display labels.

## Plan and progress

Read `mmap_setup {}` once per session. Respect the effective policy: `always`
covers structured work, `complex` covers substantial work across modules, and
`on-request` covers explicit map requests. If unset, ask which policy the user
wants; an explicit request for a map can proceed while that preference is pending.
Never choose or persist a policy on the user's behalf. Existing consent for a map
covers opening its panel; do not ask for the same permission again.

Declare missing structure with `mmap_declare` after checking existing pages. One
effort gets one stable page slug, supplied to subsequent calls. Nodes represent
buildable responsibilities with short labels and useful `detail`, not individual
files or generic checklist steps. Rank 0 is the foundation; edges point from a
consumer to a strictly lower dependency. Layers describe dependency direction.

Read relevant resources using ID/status/layer filters, fields and cursors;
detail and evidence are opt-in node fields. Pass the returned revision as
expectedRevision when writing. On CONFLICT, read the changed records and revise
the edit; on BUSY, retry after the other write completes. Use mmap_batch for
one-page create/update/remove changes that must succeed together.
Store the effort's summary and next actions in map context with mmap_update.
When source files are linked, mmap_read changes checks only those files. Record
their currentSha256 as sources[].sha256 only after relevant verification; unknown
or changed sources require inspection, not an automatic status reset or full rebuild.

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

Preserve a surface the user explicitly chose. When a desktop browser panel tool
is available, default to **web-terminal**: the mmap terminal inside a local web
page, opened in the app's right browser panel. It starts without a pasted command.
In Codex CLI without a desktop panel, use the terminal route below directly.

1. Declare or reuse the page for this effort, then call
   `mmap_open {surface: "web-terminal", page: "<effort-slug>"}`.
2. Pass the returned `hostOpen` object to the host's `open_in_codex` tool:
   `{"placement":"right","target":{"type":"browser","url":"<returned URL>"}}`.
   Omit `threadId` so it opens beside this conversation. Do not replace the
   browser target with a terminal target: the local service runs mmap for it.
3. The URL opens the live terminal immediately. No Computer Use, clipboard,
   shell profile, app-internal modification or manual paste is needed. A
   queued host result is still queued; a running service alone does not prove
   the panel is visible. If Browser inspection tools are available, verify
   the page shows the expected map and connected status.
4. Keep updating the same page with MCP tools. The viewer reads saved maps
   automatically, including writes from older clients. Do not reopen after
   each write. Preserve a page the user manually pinned; retarget only when
   the user asks to see another page. After network loss the page retries;
   if the service stopped, call mmap_open again and open its new URL.

For an older MCP schema without `web-terminal`, resolve the installed plugin root
(two directories above this skill's directory), verify `dist/web.mjs` exists, run
`node "<plugin root>/dist/web.mjs" "<project directory>" --terminal --page <slug>`,
and open the JSON response's `url` with the same browser target. Use absolute
paths and quote for the shell. Never copy a developer username or cache version.

Wheel / `+` / `-` changes semantic zoom from overview to modules and details;
drag pans, click pins details, double-click enters a submap, Backspace returns,
Tab switches pages, `f` toggles follow, `0` resets and `q` closes the map.
The page's font-size selector changes only this web terminal. Its Graph link
opens the same page in SVG mode. A closed map can be restarted with Reconnect.
After a runtime upgrade, stop the old service with the web CLI's `--stop`,
then reopen. A service without web-terminal support is upgraded on next open.

## Other supported surfaces

- **Native desktop terminal:** Only when the user asks for the app's own terminal,
  call `mmap_open {surface: "codex-terminal", page}`. This prepares correctly
  quoted commands and `hostOpen` with a terminal target; it does not run mmap.
  Reuse an existing map terminal after checking `read_thread_terminal`, and
  do not interrupt another program. If a supported host tool executes in that
  user terminal, use it. Otherwise explain the missing terminal-input tool
  and give the exact command to paste once. Do not claim a numeric agent
  `exec_command` session ID can attach to this terminal. Never use Computer Use
  or shell-profile tricks to simulate this missing capability. Font settings
  for this native mode belong to the host. See `docs/codex.md` for manual use.
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
  interactive terminal/split. `mmap_open {surface: "terminal", page}` supports
  Windows Terminal and Linux/macOS tmux, including discovery of a single attached
  session when `TMUX` is missing. If it fails, relay the reason and copyable
  command; retry only after the environment changes or the user asks.
  `mmap_view` is always available as text, but text is not proof of an open viewer.

## Installation and recovery

The release installer installs this skill and registers all eight MCP tools for
each session's working directory. Start a new conversation after installing or
updating. If tools are missing, explain that boundary and continue useful work.
Repair host configuration only as part of authorized installation/repair work.
The installation guide is `<plugin root>/docs/codex.md`.

Keep finished pages unless the user requests deletion. Deleting pages is permanent.
