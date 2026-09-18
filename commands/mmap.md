---
description: Open the live Mellos map in a terminal split pane beside this session
argument-hint: "[setup] [--page <slug>] [--window] [--ascii]"
allowed-tools: Bash(wt *), Bash(node *), Bash(tmux *)
---

If `$ARGUMENTS` contains `setup`, do NOT open the pane. Run the setup
questionnaire instead: call `mmap_setup` (no arguments) to read the current
policy — the reply names the USER-level choice, this project's override if it
has one, and which of them is in effect. Then ask the user which mode they
want — `always` (map every structured task: workflows, designs, architecture,
technical dependencies), `complex` (only medium or complex tasks),
`on-request` (only when explicitly asked) — using AskUserQuestion where
available, mentioning whatever is already set.

Persist with `mmap_setup {policy, scope}`. `scope` defaults to `user`, which
is almost always right: the question is about how this person works, so it is
answered once and applies to every project they open. Use
`scope: "project"` only when they say they want THIS project to differ from
that — ask which they mean if `$ARGUMENTS` does not make it obvious. Confirm
what was saved, at which scope, and where. Then stop.

Otherwise: open the live Mellos map watcher for this project in a separate terminal pane.

The `mmap_open` tool does exactly this and is the shorter route — pass the page
this conversation is working on (`mmap_open {page: "<slug>"}`, or `window: true`
for the dedicated window). It resolves the runtime's own absolute paths and
reports back whether a pane actually came up, which is also why it is the one
route that needs no placeholder expanded: this command's text is plain text, and
`${CLAUDE_PLUGIN_ROOT}` inside it is substituted by Claude Code, NOT by omp
(omp expands that placeholder inside a plugin's MCP config, not in command
bodies) nor by a bare MCP client.
Use the platform routes below when the mmap tools are not available in this
session, or when the tool reports it could not open one. (You do not need this
command to keep the map visible day to day: every write answers with a `pane:`
line, and a `pane: CLOSED` is the assistant's cue to call `mmap_open` itself.)
The watcher is at `${CLAUDE_PLUGIN_ROOT}/dist/watch.mjs`. The store is
MULTI-PAGE: the default page lives at `.mellos/map.json` and named
pages at `.mellos/pages/<slug>.json` — the watcher takes the
default path as its base, polls ALL of these files, and redraws on change.
The default file is optional; a project whose work lives on named pages has
no `.mellos/map.json` at all. So never probe that single file to
decide whether a map exists — call `mmap_view`, which reads the real store
and ends every response with a `pages:` line naming the pages that exist
(marking the default page absent when it is) and the one it just rendered.

Follow the platform-appropriate route:

1. **Windows with Windows Terminal** (`wt` available — the usual case, in
   Claude Code and in omp alike; omp's plugin also ships this same launcher): run

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/open-pane.mjs" "<PROJECT_DIR>" --page <PAGE_SLUG>
   ```

   replacing `<PROJECT_DIR>` with the absolute project directory and
   `<PAGE_SLUG>` with the page THIS conversation's effort lives on — the same
   slug you pass to the mmap tools. Care about what the pane actually shows:
   without `--page` it opens on the most recently written page, which after a
   gap or in a multi-effort project may not be the one under discussion. Omit
   `--page` only when no particular page is the subject (the user just wants
   the map open), or for the default page. The
   launcher identifies the Windows Terminal window hosting THIS session
   (console-title nonce probe), brings it to the foreground, and splits it
   vertically, then returns keyboard focus to the conversation. If the session
   window cannot be identified or focused, report that failure and ask the user
   to activate this conversation's PowerShell tab before retrying. Do not open
   a separate window unless the user explicitly asks for one.

   Flags: `--page <slug>` names the page to show first. Once open, the pane
   AUTO-FOLLOWS the page being written (the map the agent is operating on),
   so it tracks the work by itself; the user can toggle that with the `f`
   key, and `--no-follow` starts it off. When a watcher bound to this console is
   ALREADY running, the launcher does not open another pane — it retargets
   the existing one (output says `refocused=<slug>`, picked up within a
   poll tick); rerun with `--page` when the user asks to see a specific
   page. `--window` skips the split
   and opens the map in the dedicated window on purpose — use it when the
   user prefers the map separate from the chat (second monitor, small
   screens). `--ascii` for fonts without box-drawing characters. `--force`
   opens another pane even though a watcher for this project is already
   running (default is to skip). The remaining watcher flags are forwarded
   verbatim: `--no-color`, `--no-mouse`, `--interval <ms>` (default 250,
   floored at 50). An unknown flag is a usage error, never dropped in
   silence — relay the message rather than retrying blind.

   A page the user is done with they can close from the pane itself: `x`, or
   the `×` on the active tab, asks, and a second press within the window
   deletes that page's file. `mmap_remove {pages: [...]}` does the same from
   a tool call — with the user behind it, never on your own initiative.

   The user also has the pane on a toggle of their own: `mmap` typed in the
   current console opens its pane, and `mmap` again closes that pane. So a pane
   that disappears mid-session is a decision, not a crash — say so rather
   than reopening it uninvited.

2. **Linux/macOS with tmux**: use the same `mmap_open` tool or launcher command
   as route 1. It targets the inherited session/pane, or discovers the single
   attached session even when the tool shell has no `TMUX`. It creates a right
   split without moving input focus; `--window` requests a new tmux window.
   Repeated opens reuse and retarget this session's watcher. If several sessions
   are attached, set `MELLOS_MAPPING_TMUX_TARGET` in the MCP server environment
   to a session or pane (for example `work:2.1`). For a custom server socket,
   also set `MELLOS_MAPPING_TMUX_SOCKET` to its absolute path, then restart the
   MCP server. Do not guess a session or open a detached window.

3. **Neither**: print the watcher command and tell the user to run it in any
   second terminal themselves (add `--ascii` if their font lacks box-drawing
   characters). The launcher's own failure message quotes it in full, with
   absolute paths — relay that one verbatim. Written by hand it is
   `node "<plugin root>/dist/watch.mjs" --file "<PROJECT_DIR>/.mellos/map.json" --page <PAGE_SLUG>`,
   where `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}` inside Claude Code and the
   installed runtime's own directory everywhere else (omp and bare MCP
   clients: take the path from the tool's message rather than inventing one).

If launching fails, relay its reason and the complete quoted fallback command.
Do not repeatedly call `mmap_open` on later writes; retry only after the terminal
environment changes or the user asks. `mmap_view` remains available inline. After
the pane is up, confirm briefly; only when neither the default file nor any
page file exists does the pane sit on its standby screen ("waiting for the
first mmap_declare ...", or "waiting for &lt;file&gt; ..." when `--page` named a
page that does not exist yet), until the first `mmap_declare`.

$ARGUMENTS
