# Mellos Mapping · Claude Code

English | [简体中文](README.zh-CN.md)

A live layered dependency map while Claude plans and builds. Designed work is
drawn as ghost nodes; active work spins; verified work turns green with evidence.

## Install once

Requires Node.js 18.17+ on the 18.x line, or 20.3+, and Claude Code on PATH.
Supported platforms are Windows 10+, macOS 13.0+ and Linux with glibc 2.28+,
each on x64 or arm64. The OS must also meet the selected Node.js version's
requirements. Native lock bindings are included; no local compilation is needed.
From this clone or extracted release:

```sh
node install.mjs
```

The prebuilt package needs no npm dependencies or build. The installer verifies
its hashes and eight-tool MCP handshake, retains a copy in
`~/.mellos/installations/claude/`, and installs through Claude's plugin CLI.
Start a new Claude Code conversation, then use `/mellos-mapping:mmap` or ask
Claude to display a layered plan. On first use, choose when maps should open.

Windows Terminal and attached tmux sessions on Linux/macOS support an automatic
split beside Claude's terminal. Explicit opens reuse and reveal the existing
tmux watcher. On other terminals, run the bundled `dist/watch.mjs` in an interactive split/terminal with
`--file <project>/.mellos/map.json` and `--page <slug>`. The Claude skill, slash
command and SessionStart hook are included. This edition does not install a
ChatGPT App skill or modify Codex configuration.

## Controls and updates

Wheel / `+` / `-` zoom, drag pans, click pins node details, double-click opens a
submap, `0` resets and `q` quits. Map updates redraw automatically. Markdown/SVG
and web views remain available through `mmap_open` when your host can display them.

Run `node install.mjs` from the newer release to update; start a new conversation
and restart existing watchers. `node install.mjs --check` verifies the release
and prerequisites without changing host configuration.

Updates stage and check a complete release before replacing the retained copy.
Failed upgrade checks restore the previous files and recheck host registration.
Installation also verifies Claude's actual cache files. Changed content requires
a new version; a repeated version number cannot prove the cache was refreshed.

If a marketplace named `mellos-mapping` already points elsewhere, the installer
stops instead of replacing it silently. Update through that original marketplace,
or remove it with Claude's plugin manager before switching to this clone.

To uninstall: `claude plugin uninstall mellos-mapping@mellos-mapping`.
Project maps and mapping preferences remain on disk.

`main` holds the shared source; `claude` is this prebuilt edition;
`chatgpt-app` is for ChatGPT desktop Codex mode. Changes are maintained on `main`
and used to generate both editions.
