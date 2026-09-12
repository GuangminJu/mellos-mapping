# Mellos Mapping · ChatGPT App (Codex mode)

English | [简体中文](README.zh-CN.md)

A live layered plan beside your current desktop conversation. This edition is
for **Codex mode in the ChatGPT desktop app**, also called Codex App. It uses
local files, a local Node.js MCP server, and the app's right-side terminal.
The ordinary web chat surface is not an installation target for this package.

## Install once

Install Node.js 18+ and a Codex CLI that supports `codex plugin add` (tested with
0.153.4). Make `node` and `codex` available on PATH. From this clone or extracted
release folder, run:

```sh
node install.mjs
```

No `npm install`, build, Python or manual JSON/TOML editing is needed. The command
checks package hashes and the real MCP handshake, copies the runtime into
`~/.mellos/installations/chatgpt-app/`, registers the dedicated marketplace,
installs the skill and registers all six MCP tools. It preserves other plugins,
project maps and mapping preferences. The clone is no longer needed afterwards.
If a prerequisite is missing, the installer stops with the missing requirement.

Start a **new conversation** in Codex mode after installation. Ask:

> Use Mellos Mapping to plan this task and display the live plan in the current
> conversation's right terminal. Update it as implementation is verified.

## The right-side terminal

The assistant prepares the plan and requests the current conversation's right
terminal. If the app exposes opening/reading but no terminal-input tool, it gives
you one correctly quoted command to paste there. This host limitation prevents a
promise of fully automatic first startup; it does not require another installation.
Once started, the map automatically refreshes as the assistant updates it.

| Input | Effect |
| --- | --- |
| Wheel, `+`, `-` | Zoom from overview toward module details |
| Left drag | Pan the map |
| Click a node | Pin details and dependency highlights |
| Double-click a child-map node | Enter its submap |
| `0` | Reset view |
| `q` | Exit the watcher |

Font size follows the app's code/terminal settings. Hover changes color without
changing font weight. Mouse recovery and bounded redraw buffering are included.
You can also ask for a **Markdown/SVG file** or the **interactive web viewer** on
the right. These share the same maps. See the [desktop guide](plugins/mellos-mapping/docs/codex.md).

## Update, check, remove

Download the newer release, then run `node install.mjs` again. Start a new
conversation and restart any watcher still running the old version (`q`, rerun).
Use `node install.mjs --check` for package, prerequisites and MCP checks without
changing host configuration.

```sh
codex plugin remove mellos-mapping@mellos-mapping-codex
codex mcp remove mellos-mapping
codex plugin marketplace remove mellos-mapping-codex
```

These commands do not delete project maps or your mapping policy. If migrating
from a previous personal-marketplace install, remove that older Mellos plugin
with Codex first so two copies of the skill do not appear.

## Release branches

`main` contains the maintained source and both adapters. `claude` contains the
Claude Code edition. `chatgpt-app` contains this prebuilt edition. Host editions
are generated from the same source version. GitHub distribution is separate
from listing a plugin in OpenAI's public directory.
