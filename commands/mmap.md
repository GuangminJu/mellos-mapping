---
description: Open the live Mellos map in a terminal split pane beside this session
argument-hint: "[--ascii]"
allowed-tools: Bash(wt *), Bash(node *), Bash(tmux *)
---

Open the live Mellos map watcher for this project in a separate terminal pane.
The watcher is at `${CLAUDE_PLUGIN_ROOT}/dist/watch.mjs`; it polls
`.claude/mellos-mapping.json` in the project directory and redraws on change.

Follow the platform-appropriate route:

1. **Windows with Windows Terminal** (`wt` available — the usual case): run

   ```
   wt -w 0 sp -V --size 0.42 --title "mellos map" -d "<PROJECT_DIR>" node "${CLAUDE_PLUGIN_ROOT}/dist/watch.mjs"
   ```

   replacing `<PROJECT_DIR>` with the absolute project directory. This splits
   the CURRENT Windows Terminal window vertically, map on the right.

   Caveat: `wt -w 0` resolves "current" to the MOST RECENTLY USED Windows
   Terminal window, because this shell is not attached to the user's window.
   With several terminal windows open (e.g. two Claude sessions), the pane
   can land in the wrong window. If the user reports that, tell them to
   focus the intended window first and rerun /mmap, or give them the route-3
   command to run in the terminal where they want the map.

2. **tmux session**: run
   `tmux split-window -h -l 42% node "${CLAUDE_PLUGIN_ROOT}/dist/watch.mjs" --file "<PROJECT_DIR>/.claude/mellos-mapping.json"`.

3. **Neither**: print the command
   `node "${CLAUDE_PLUGIN_ROOT}/dist/watch.mjs" --file "<PROJECT_DIR>/.claude/mellos-mapping.json"`
   and tell the user to run it in any second terminal themselves (add
   `--ascii` if their font lacks box-drawing characters).

If launching fails (e.g. no graphical session), fall back to route 3. After
the pane is up, confirm briefly; if no map exists yet the pane shows
"waiting for <file>" until the first `mmap_declare`.

$ARGUMENTS
