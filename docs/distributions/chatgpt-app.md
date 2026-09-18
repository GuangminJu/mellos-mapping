# Mellos Mapping · ChatGPT App (Codex mode)

English | [简体中文](README.zh-CN.md)

A live layered plan beside your current desktop conversation. This edition is
for **Codex mode in the ChatGPT desktop app**, also called Codex App. It uses
local files, a local Node.js MCP server, and a mmap terminal in the app's right browser panel.
The ordinary web chat surface is not an installation target for this package.

## Install once

Install Node.js 18.17+ on the 18.x line, or 20.3+, and a Codex CLI that supports
`codex plugin add` (tested with 0.153.4). Supported platforms are Windows 10+,
macOS 13.0+ and Linux with glibc 2.28+, each on x64 or arm64. The OS must also meet
the selected Node.js version's requirements. Native lock bindings are included;
no local compilation is needed. Make `node` and `codex` available on PATH.
From this clone or extracted release folder, run:

```sh
node install.mjs
```

No `npm install`, build, Python or manual JSON/TOML editing is needed. The command
checks package hashes and the real MCP handshake, copies the runtime into
`~/.mellos/installations/chatgpt-app/`, registers the dedicated marketplace,
installs the skill and registers all eight MCP tools. It preserves other plugins,
project maps and mapping preferences. The clone is no longer needed afterwards.
If a prerequisite is missing, the installer stops with the missing requirement.

Start a **new conversation** in Codex mode after installation. Ask:

> Use Mellos Mapping to plan this task and display the live plan in the current
> conversation's right panel using web-terminal. Update it as implementation is verified.

## Automatic right-side map

The assistant starts a local service and opens its URL in the right browser panel.
The page runs the existing mmap terminal automatically; no pasted command or
Computer Use is needed. Map updates appear live. The terminal and browser assets
ship prebuilt, with no native compiler or extra dependency installation.

| Input | Effect |
| --- | --- |
| Wheel, `+`, `-` | Zoom from overview toward module details |
| Left drag | Pan the map |
| Click a node | Pin details and dependency highlights |
| Double-click a child-map node | Enter its submap |
| `0` | Reset view |
| `q` | Exit the watcher |

The page's font-size selector changes only this terminal. Its Graph link opens
this map in graphical SVG mode. Native desktop terminal and Markdown/SVG file
views remain available on request. Only the optional native mode may need a
pasted command if the host provides no terminal-input tool. See the
[desktop guide](plugins/mellos-mapping/docs/codex.md).

## Update, check, remove

Download the newer release, then run `node install.mjs` again. Start a new
conversation. Ask the AI to stop the old local web service and reopen the map
so it loads the new runtime.
Use `node install.mjs --check` for package, prerequisites and MCP checks without
changing host configuration.

Updates stage and check a complete release before replacing the retained copy.
Failed upgrade checks restore the previous files and recheck host registration.
Installation verifies the files at Codex's reported plugin path and MCP runtime.
Changed content requires a new release version.

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
