---
description: Open the live Mellos map in a terminal split pane beside this session
argument-hint: "[--window] [--ascii]"
allowed-tools: Bash(wt *), Bash(node *), Bash(tmux *)
---

Open the live Mellos map watcher for this project in a separate terminal pane.
The watcher is at `${CLAUDE_PLUGIN_ROOT}/dist/watch.mjs`. The store is
MULTI-PAGE: the default page lives at `.claude/mellos-mapping.json` and named
pages at `.claude/mellos-mapping.pages/<slug>.json` — the watcher takes the
default path as its base, polls ALL of these files, and redraws on change.
The default file is optional; a project whose work lives on named pages has
no `.claude/mellos-mapping.json` at all. So never probe that single file to
decide whether a map exists — call `mmap_view`, which reads the real store.

Follow the platform-appropriate route:

1. **Windows with Windows Terminal** (`wt` available — the usual case): run

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/open-pane.mjs" "<PROJECT_DIR>"
   ```

   replacing `<PROJECT_DIR>` with the absolute project directory. The
   launcher identifies the Windows Terminal window hosting THIS session
   (console-title nonce probe), brings it to the foreground, and splits it
   vertically — the map lands beside the conversation even with several
   terminal windows open. If the session window cannot be identified or
   focused (session tab inactive, screen locked, not hosted in Windows
   Terminal), it deterministically falls back to a dedicated window named
   "mellos-mapping" — never a random window — and its output says which
   mode it used and why; relay that to the user.

   Flags: `--window` skips the split and opens the map in the dedicated
   window on purpose — use it when the user prefers the map separate from
   the chat (second monitor, small screens). `--ascii` for fonts without
   box-drawing characters. `--force` opens another pane even though a
   watcher for this project is already running (default is to skip).

2. **tmux session**: run
   `tmux split-window -h -l 42% node "${CLAUDE_PLUGIN_ROOT}/dist/watch.mjs" --file "<PROJECT_DIR>/.claude/mellos-mapping.json"`.

3. **Neither**: print the command
   `node "${CLAUDE_PLUGIN_ROOT}/dist/watch.mjs" --file "<PROJECT_DIR>/.claude/mellos-mapping.json"`
   and tell the user to run it in any second terminal themselves (add
   `--ascii` if their font lacks box-drawing characters).

If launching fails (e.g. no graphical session), fall back to route 3. After
the pane is up, confirm briefly; only when neither the default file nor any
page file exists does the pane show "waiting for <file>", until the first
`mmap_declare`.

$ARGUMENTS
