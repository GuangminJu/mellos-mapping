---
description: Open the live Mellos map in a terminal split pane beside this session
argument-hint: "[setup] [--page <slug>] [--window] [--ascii]"
allowed-tools: Bash(wt *), Bash(node *), Bash(tmux *)
---

If `$ARGUMENTS` contains `setup`, do NOT open the pane. Run the setup
questionnaire instead: call `mmap_setup` (no arguments) to read the current
policy, then ask the user which mode they want — `always` (map every
structured task: workflows, designs, architecture, technical dependencies),
`complex` (only medium or complex tasks), `on-request` (only when explicitly
asked) — using AskUserQuestion where available, mentioning the current
policy if one is set. Persist their choice with `mmap_setup {policy}` and
confirm what was saved and where. Then stop.

Otherwise: open the live Mellos map watcher for this project in a separate terminal pane.
The watcher is at `${CLAUDE_PLUGIN_ROOT}/dist/watch.mjs`. The store is
MULTI-PAGE: the default page lives at `.mellos/map.json` and named
pages at `.mellos/pages/<slug>.json` — the watcher takes the
default path as its base, polls ALL of these files, and redraws on change.
The default file is optional; a project whose work lives on named pages has
no `.mellos/map.json` at all. So never probe that single file to
decide whether a map exists — call `mmap_view`, which reads the real store.

Follow the platform-appropriate route:

1. **Windows with Windows Terminal** (`wt` available — the usual case): run

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
   vertically — the map lands beside the conversation even with several
   terminal windows open. If the session window cannot be identified or
   focused (session tab inactive, screen locked, not hosted in Windows
   Terminal), it deterministically falls back to a dedicated window named
   "mellos-mapping" — never a random window — and its output says which
   mode it used and why; relay that to the user.

   Flags: `--page <slug>` names the page to show first. Once open, the pane
   AUTO-FOLLOWS the page being written (the map the agent is operating on),
   so it tracks the work by itself; the user can toggle that with the `f`
   key, and `--no-follow` starts it off. When a watcher for the project is
   ALREADY running, the launcher does not open another pane — it retargets
   the existing one (output says `refocused=<slug>`, picked up within a
   poll tick); rerun with `--page` when the user asks to see a specific
   page. `--window` skips the split
   and opens the map in the dedicated window on purpose — use it when the
   user prefers the map separate from the chat (second monitor, small
   screens). `--ascii` for fonts without box-drawing characters. `--force`
   opens another pane even though a watcher for this project is already
   running (default is to skip).

2. **tmux session**: run
   `tmux split-window -h -l 42% node "${CLAUDE_PLUGIN_ROOT}/dist/watch.mjs" --file "<PROJECT_DIR>/.mellos/map.json" --page <PAGE_SLUG>`
   (same `--page` judgment as route 1; omit it when no page is the subject).

3. **Neither**: print the command
   `node "${CLAUDE_PLUGIN_ROOT}/dist/watch.mjs" --file "<PROJECT_DIR>/.mellos/map.json" --page <PAGE_SLUG>`
   and tell the user to run it in any second terminal themselves (add
   `--ascii` if their font lacks box-drawing characters).

If launching fails (e.g. no graphical session), fall back to route 3. After
the pane is up, confirm briefly; only when neither the default file nor any
page file exists does the pane show "waiting for <file>", until the first
`mmap_declare`.

$ARGUMENTS
