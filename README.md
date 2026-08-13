# Mellos Mapping

[![CI](https://github.com/GuangminJu/mellos-mapping/actions/workflows/ci.yml/badge.svg)](https://github.com/GuangminJu/mellos-mapping/actions/workflows/ci.yml)

English | [简体中文](README.zh-CN.md)

A live, terminal-native map of bottom-up development for
[Claude Code](https://claude.com/claude-code) and Codex CLI.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/demo-light.svg">
    <img alt="A Mellos map building itself: ghost design first, spinners climbing the layers, a cracked foundation spreading upward, honest recovery" src="docs/demo.svg" width="620">
  </picture>
</p>

While Claude builds your system, a split pane beside the conversation shows
the system's **layered dependency map**: primitive layers at the bottom,
dependency edges that may only point downward, ghost nodes for what is
designed, a spinner on what is being built right now, and solid green for
what is built *and verified*.

```
  Mellos Mapping · the plugin itself

━━━━━━━━━━━━━━━━━━━━━━━━━━ orchestration

  ╭╌╌╌╌╌╌╌╌╌╌╌╌╌╌╮
  ╎ · MCP Server ╎
  ╰╌╌╌╌┬╌┬╌╌┬╌╌╌╌╯
       │ │  │
       └─┼──┼─────────────┐
         │  └──────┐      │
         │         │      │
━━━━━━━━━┿━━━━━━━━━┿━━━━━━┿━━━ contracts
         │         │      │
  ┏━━━━━━┷━━━━━━━━┓│ ╭╌╌╌╌┴╌╌╌╌╌╌╮
  ┃ ■ State Store ┃│ ╎ · Watcher ╎
  ┗━━━━━┯━━━━━━━━━┛│ ╰╌╌╌╌╌┬╌╌╌╌╌╯
        │          │       │
        │ ┌────────┘       │
        │ │                │
━━━━━━━━┿━┿━━━━━━━━━━━━━━━━┿━ primitives
        │ │                │
  ┏━━━━━┷━┷━━━━━━┓  ╭──────┴───────────╮
  ┃ ■ Map Domain ┃  │ ⠋ ASCII Renderer │
  ┗━━━━━━━━━━━━━━┛  ╰──────────────────╯

  · planned   ⠋ in-progress   ■ done   ✗ regressed
```

In a real terminal the wiring and band bars render FAINT while node boxes
glow in their status colors with bold labels — a dark circuit board where
the components are the bright things. Skip-level edges thread through gaps
between boxes (watch the line dive between State Store and Watcher above);
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

## Codex CLI

The same repo doubles as a Codex plugin (codex-cli 0.147+). Three lines:

```
codex plugin marketplace add GuangminJu/mellos-mapping
codex plugin add mellos-mapping@mellos-mapping
node ~/.codex/plugins/cache/mellos-mapping/mellos-mapping/<version>/scripts/codex-register.mjs
```

The first two install the skill (the map discipline) as a Codex plugin. The
third registers the MCP server at user level — needed because Codex spawns
plugin-bundled MCP servers inside the plugin cache with no way to see your
workspace, so a bundled server would write the map into the cache. A
user-level `codex mcp add` entry (which the script writes) inherits each
session's working directory instead: the state file lands in your project,
same as under Claude Code. The registered path is version-specific — re-run
the script after updating the plugin.

To watch the live pane beside a Codex session on Windows, run
`node <plugin root>/scripts/open-pane.mjs <project dir>` — it splits the
terminal window hosting the session (or falls back to a dedicated
"mellos-mapping" window; `--window` picks that on purpose). Elsewhere run
`node <plugin root>/dist/watch.mjs` from the project directory in a second
terminal (or any terminal split).

## Any MCP client

The server ships on npm, so any MCP client (Cursor, Windsurf, Zed,
Gemini CLI, …) can run it with a standard stdio entry:

```
npx -y mellos-mapping
```

The map file lands in the client session's working directory
(`.claude/mellos-mapping.json`). Open the live pane from the same project:

```
npx -y -p mellos-mapping mellos-mapping-watch
```

The skill/discipline layer is Claude Code + Codex specific; other clients
get the four `mmap_*` tools and the pane, and bring their own prompting.

## Use

1. Ask Claude to build something non-trivial. The bundled skill has Claude
   declare the ghost design and keep the map current as it works.
2. Run `/mellos-mapping:mmap` to open the live pane (Windows Terminal split
   on Windows, tmux split inside tmux, or a printed command to run in any
   second terminal). On Windows the pane opens in the terminal window
   hosting YOUR session, even with several windows open; pass `--window` to
   put the map in its own dedicated window instead. Prefer `--ascii` if
   your font lacks box-drawing glyphs.
3. Watch nodes light up from the bottom. Interrupt when the picture worries
   you — that is what it is for.

The pane is mouse-aware (xterm SGR any-event tracking — the same protocol
htop and tmux speak):

| Input | Action |
| --- | --- |
| hover a node | spotlight its wires; preview its details below the map |
| click a node | pin it — details stay resident after the mouse leaves |
| click empty space / `Esc` | unpin; with nothing pinned, `Esc` climbs out of a dive |
| wheel / `+` `-` | zoom, anchored on the focused node (see the ladder below) |
| left-drag | grab and pan when the map outgrows the pane |
| shift+wheel | scroll vertically |
| `hjkl` / arrows | nudge the view |
| `Tab` / `Shift+Tab` / `1-9` / click a tab | switch pages (parallel maps) |
| double-click a `⊞` node | dive into its sub-map (a child page) |
| `Backspace` / `Esc` | climb back out of the last dive |
| drag the `⋯` divider | resize the detail panel — pull it up to read long design notes in full |
| `0` | reset pan and zoom |
| `q` | quit the pane |

Zooming scales the picture first and switches display mode only at the ends
of the ladder, so every level still shows meaningful data:

```
detail ← 100% ← 85% ← 70% ← 55% ← overview
```

- **zoom in past 100%** — evidence and design notes unfold inside the boxes;
- **85–55%** — whitespace tightens and labels truncate proportionally, boxes
  stay boxes;
- **below 55%** — labels would stop meaning anything, so the map AGGREGATES:
  each declared group (a labeled subsystem within a band) becomes one box
  named `foundation subsystem 1/2` with its status derived from the members, edges
  collapse onto the groups, ungrouped nodes stay themselves. Like a real
  map, zooming out shows province names — not anonymous dots. (A map with
  no groups falls back to a pure glyph constellation with per-band counts.)
  The footer always names the level.

The two detail rows live at a fixed spot between map and hint line, showing
the focused node's status, layer, evidence and both wire directions
(`uses → … · used by ← …`) — nothing ever floats over the map.

`--no-mouse` disables mouse reporting if your terminal multiplexer wants the
mouse for itself.

### Pages

A project can keep several maps side by side — **one effort = one page**.
Claude targets a page by passing `page` to any `mmap_*` tool; the pane grows
a tab bar as soon as a second page exists. The active tab is bold in its
map's aggregate status color; when a background page's file changes, its tab
lights up in status color instead of stealing your view. Each page remembers
its own pan, zoom and pinned node. Because every page is its own file, two
Claude sessions writing two pages can never clobber each other — this is
also the answer to running several Claude sessions in one project.

State lives in `.claude/mellos-mapping.json` (the default page) plus
`.claude/mellos-mapping.pages/<page>.json` for named pages — plain JSON,
safe to commit if you want the maps' history in git.

### Diagram kinds

The default kind, `dev`, is the living progress ledger described above. The
same layered-DAG machinery also draws documentation diagrams: pass `kind`
in `mmap_declare` and the page renders neutrally — plain solid boxes, no
ghosts, no spinners, no progress counts.

| Kind | Reading | Extras |
| --- | --- | --- |
| `architecture` | layered components (also module deps, call graphs) | edge labels for protocols |
| `dataflow` | pipeline stages as layers, sources at the bottom | edge labels for the data |
| `behavior-tree` | leaves (actions) at the bottom, root on top (also mind maps, WBS) | node kinds `selector` `sequence` `parallel` `decorator` `condition` `action` render as glyphs |
| `sequence` | classic call/return: time flows top-down, participants as lane headers; every call and every return is an event in the acting participant's lane | `lanes` are participants; edge labels are messages |

Node kinds and edge labels work on `dev` maps too. State machines are out
of scope on purpose: transitions cycle, and edges here only point downward.

### Sub-maps

A node can link a child page with `submap: <page-slug>` — the pane badges it
`⊞`; double-click dives into the child map, `Backspace` climbs back out. A
map of maps, built entirely from pages: no new storage, no new invariants.
Whether a node deserves a sub-map is the AI's judgment call — most don't.

Sub-maps are interior detail, not siblings: a page referenced as a submap
never occupies a tab. Inside a dive the tab row becomes a breadcrumb —
`⌫ parent map ▸ node` — and clicking it (or `Backspace`) climbs back out.
When a hidden sub-map changes in the background, the footer says so.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `mmap_declare` | Grow the map: title, diagram kind, layer bands, lanes, groups (subsystems), nodes, edges — optionally labeled (all-or-nothing batch) |
| `mmap_update` | Record progress: `planned → in-progress → done` (+evidence), `regressed`, group/lane membership, node kind |
| `mmap_remove` | Revise: drop edges, nodes, groups, lanes, empty bands |
| `mmap_view` | Render the current map as text inline (optional `zoom`) |

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
