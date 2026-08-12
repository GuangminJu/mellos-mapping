# Mellos Mapping · 梅勒斯地图

English | [简体中文](README.zh-CN.md)

A live, terminal-native map of bottom-up development for
[Claude Code](https://claude.com/claude-code).

While Claude builds your system, a split pane beside the conversation shows
the system's **layered dependency map**: primitive layers at the bottom,
dependency edges that may only point downward, ghost nodes for what is
designed, a spinner on what is being built right now, and solid green for
what is built *and verified*.

```
  梅勒斯地图 · mellos-mapping 插件

━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 编排层

  ╭╌╌╌╌╌╌╌╌╌╌╌╌╌╌╮
  ╎ · MCP Server ╎
  ╰╌╌╌┬┬╌╌╌╌┬╌╌╌╌╯
      ││    │
      └┼────┼───────────┐
       │    └───┐       │
       │        │       │
━━━━━━━┿━━━━━━━━┿━━━━━━━┿━━━ 契约层
       │        │       │
  ┏━━━━┷━━━━━━━┓│ ╭╌╌╌╌╌┴╌╌╌╌╌╮
  ┃ ■ 状态存储 ┃│ ╎ · Watcher ╎
  ┗━━━━━┯━━━━━━┛│ ╰╌╌╌╌╌╌┬╌╌╌╌╯
        │       │        │
        │ ┌─────┘        │
        │ │              │
━━━━━━━━┿━┿━━━━━━━━━━━━━━┿━━ 原语层
        │ │              │
  ┏━━━━━┷━┷━━━━━━┓  ╭────┴────────╮
  ┃ ■ 图领域模型 ┃  │ ⠋ ASCII渲染 │
  ┗━━━━━━━━━━━━━━┛  ╰─────────────╯

  · planned   ⠋ in-progress   ■ done   ✗ regressed
```

In a real terminal the wiring and band bars render FAINT while node boxes
glow in their status colors with bold labels — a dark circuit board where
the components are the bright things. Skip-level edges thread through gaps
between boxes (watch the line dive between 状态存储 and Watcher above);
non-overlapping wire segments share track rows to keep the bands close.

*(This is the plugin's own map, mid-development. The spinner really spins.)*

## Why

Most progress reporting is a task list — a top-down worldview. A Mellos map
grows the other way: an upper node can only stand on nodes below it, and the
picture makes the discipline visible:

- **The ghost design appears before any code.** Claude declares the whole
  intended structure as dashed ghost nodes first; you can veto a bad design
  while it is still only a picture.
- **The spinner is where Claude's attention is.** One glance answers "what is
  it doing right now, and on top of what?"
- **Done means verified.** A node turns solid green only with evidence (a
  passing test run). If later work cracks a foundation, the node turns red —
  a cracked foundation under a spinning upper floor is the most honest status
  report there is.
- **The map is a ledger, not a judge.** The tools refuse only structural
  corruption (an edge pointing upward, a duplicate rank). Workflow is
  Claude's discipline, defined in the bundled skill; violations are made
  *visible*, never silently blocked.

## Install

Two lines inside any Claude Code conversation:

```
/plugin marketplace add GuangminJu/mellos-mapping
/plugin install mellos-mapping@mellos-mapping
```

Or one line in a terminal:

```
claude plugin marketplace add GuangminJu/mellos-mapping && claude plugin install mellos-mapping@mellos-mapping
```

Requires Node.js 18+ on PATH (Claude Code itself requires Node, so you
already have it). No build step: the MCP server and watcher ship pre-bundled.

## Update

```
claude plugin marketplace update mellos-mapping && claude plugin update mellos-mapping@mellos-mapping
```

Two steps because `plugin update` compares against the locally cached
marketplace clone — the first command is what actually pulls this repo.
Restart Claude Code to apply. Releases are version bumps on `master`.
(In-app, `/plugin` opens the same management UI.)

## Use

1. Ask Claude to build something non-trivial. The bundled skill has Claude
   declare the ghost design and keep the map current as it works.
2. Run `/mellos-mapping:mmap` to open the live pane (Windows Terminal split
   on Windows, tmux split inside tmux, or a printed command to run in any
   second terminal). Prefer `--ascii` if your font lacks box-drawing glyphs.
3. Watch nodes light up from the bottom. Interrupt when the picture worries
   you — that is what it is for.

The pane is mouse-aware (xterm SGR any-event tracking — the same protocol
htop and tmux speak):

| Input | Action |
| --- | --- |
| hover a node | spotlight its wires; preview its details below the map |
| click a node | pin it — details stay resident after the mouse leaves |
| click empty space / `Esc` | unpin |
| left-drag | grab and pan when the map outgrows the pane |
| wheel / shift+wheel | pan vertically / horizontally |
| `hjkl` / arrows | nudge the view |
| `0` | jump back to origin |
| `q` | quit the pane |

The two detail rows live at a fixed spot between map and hint line, showing
the focused node's status, layer, evidence and both wire directions
(`uses → … · used by ← …`) — nothing ever floats over the map.

`--no-mouse` disables mouse reporting if your terminal multiplexer wants the
mouse for itself.

State lives in `.claude/mellos-mapping.json` in your project — plain JSON,
one map per project, safe to commit if you want the map's history in git.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `mmap_declare` | Grow the map: title, layer bands, nodes, edges (all-or-nothing batch) |
| `mmap_update` | Record progress: `planned → in-progress → done` (+evidence), `regressed` |
| `mmap_remove` | Revise: drop edges, nodes, empty bands |
| `mmap_view` | Render the current map as text inline |

Structural invariants enforced by the tools: layers form a total order by
rank; every node lives in exactly one layer; edges point **strictly
downward** — which makes the graph acyclic by construction; nodes may not
depend on same-layer siblings (if A needs sibling B, either B is really a
lower concept or A and B are one node).

## Development

```
npm install
npm run verify   # typecheck + tests + bundle
```

The repo is itself layered bottom-up, and each layer has its spec:

| Layer | Code | Owns |
| --- | --- | --- |
| 0 domain | `src/domain/` | the map value, structural invariants, pure ops |
| 1 store | `src/store/` | atomic state-file persistence, boundary validation |
| 2 apply | `src/server/apply.ts` | tool inputs → transactional op sequences |
| 3 server | `src/server/server.ts` | the four MCP tools over stdio |
| 4 render | `src/render/`, `src/watch/` | ASCII renderer and the polling pane |

`dist/` is committed deliberately: plugin installation clones this repo and
runs nothing, so entry points ship bundled.

## License

MIT
