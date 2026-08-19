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
already have it). No build step: `dist/` is committed, so a clone runs as-is —
`dist/server.mjs` (the MCP server), `dist/watch.mjs` (the pane) and
`dist/store-paths.mjs` (the store's path vocabulary, which the plain-node pane
launcher imports instead of restating filenames).

## Update

```
claude plugin marketplace update mellos-mapping && claude plugin update mellos-mapping@mellos-mapping
```

Two steps because `plugin update` compares against the locally cached
marketplace clone — the first command is what actually pulls this repo.
Restart Claude Code to apply. Releases are version bumps on `master`.
(In-app, `/plugin` opens the same management UI.)

### Upgrading from 0.19

0.20 moved the store out of `.claude/` — the map belongs to this tool, not to
one client — into `.mellos/`. The server and the watcher each perform the move
once at startup, and print exactly one line on stderr when they do
(`mellos-mapping: moved the legacy .claude map store to .mellos/ — commit the
move.`):

| 0.19 and earlier | 0.20 and later |
| --- | --- |
| `.claude/mellos-mapping.json` | `.mellos/map.json` |
| `.claude/mellos-mapping.pages/` | `.mellos/pages/` |
| `.claude/mellos-mapping.config.json` | `.mellos/config.json` |

Nothing is merged and nothing is overwritten: a project that already has a
`.mellos/` store (map, pages or config) is left untouched, whatever the legacy
directory still holds. If you keep your maps in git, commit the move —
`git add -A .claude .mellos` records it as renames rather than as a pile of
deletions plus untracked files.

That one move is the only time either process touches `.claude/`. Afterwards
the tools write nowhere but `.mellos/`, and never outside the project
directory they resolved at startup.

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
"mellos-mapping" window; `--window` picks that on purpose). Add
`--page <slug>` to open on a particular page — and with a pane already open,
rerunning with `--page` retargets it instead of opening another. The pane
auto-follows the page being written — the map the agent is operating on
right now; press `f` to toggle that (a manual page switch also turns it
off), or start with `--no-follow`. Elsewhere run
`node <plugin root>/dist/watch.mjs` from the project directory in a second
terminal (or any terminal split). Both take the same flags — see
[Pane flags](#pane-flags).

## Any MCP client

The server ships on npm, so any MCP client (Cursor, Windsurf, Zed,
Gemini CLI, …) can run it with a standard stdio entry:

```
npx -y mellos-mapping
```

The map file lands in the client session's working directory
(`.mellos/map.json`). Open the live pane from the same project:

```
npx -y -p mellos-mapping mellos-mapping-watch
```

The server picks its project directory in this order: `MELLOS_MAPPING_CWD`
(an explicit override, for clients that spawn servers from a fixed
directory), then `CLAUDE_PROJECT_DIR` (what Claude Code sets for plugin MCP
servers), then the server process's own working directory. Set
`MELLOS_MAPPING_CWD` when your client would otherwise start the server
somewhere other than the project you are working in.

The skill/discipline layer is Claude Code + Codex specific; other clients
get the five `mmap_*` tools and the pane, and bring their own prompting.

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
| wheel tilt (horizontal) | pan sideways |
| `hjkl` / arrows | nudge the view |
| `Tab` / `Shift+Tab` / `1-9` / click a tab | switch pages (parallel maps) |
| wheel on the tab row / click `‹` `›` | browse an overflowing tab strip without switching pages |
| `f` | toggle auto-follow (see [Pages](#pages)) |
| double-click a `⊞` node | dive into its sub-map (a child page) |
| `Backspace` / `Esc` | climb back out of the last dive |
| drag the `⋯` divider | resize the detail panel — pull it up to read long design notes in full |
| `0` | reset pan and zoom |
| `q` / `Ctrl+C` | quit the pane |

Every other key is inert, on purpose: an escape sequence the pane does not
know (F-keys, Home/End, PgUp/PgDn, Insert/Delete, modified arrows) is
consumed whole and does nothing, rather than having its payload bytes read
as hotkeys.

Zooming scales the picture first and switches display mode only at the ends
of the ladder, so every level still shows meaningful data:

```
detail+ ← detail ← 100% ← 85% ← 70% ← 55% ← overview
```

- **zoom in past 100%** — `detail` unfolds evidence and the first three lines
  of the design notes inside the boxes; `detail+` widens them into reading
  cards (up to twelve note rows);
- **85–55%** — whitespace tightens and labels truncate proportionally, boxes
  stay boxes;
- **below 55%** — labels would stop meaning anything, so the map AGGREGATES:
  each declared group (a labeled subsystem within a band) becomes one box
  named `foundation subsystem 1/2` with its status derived from the members, edges
  collapse onto the groups, ungrouped nodes stay themselves. Like a real
  map, zooming out shows province names — not anonymous dots. (A map with
  no groups falls back to a pure glyph constellation with per-band counts.)
  The footer always names the level.

Below the map, between it and the hint line, sits a fixed-height detail
panel: a separator you can drag, a status-colored header, the focused node's
evidence, both wire directions (`uses → … · used by ← …`, each neighbour
carrying its own status glyph) and its design notes, word-wrapped. With
nothing focused it shows the map's dashboard instead. Fixed height — details
never float over the map and the layout never jumps.

### Glyphs

One status, one glyph, everywhere a map is drawn — the pane's boxes, its tab
strip and detail panel, and any other client reading the same store:

| Unicode | ASCII | Meaning |
| --- | --- | --- |
| `·` | `.` | planned — declared, not started |
| `⠿` | `*` | in-progress, at rest — a box that can animate spins through the braille frames (`⠋⠙⠹…`) instead, or a four-bar cycle in ASCII |
| `■` | `#` | done, with evidence |
| `□` | `o` | done, with **no** evidence recorded — same claim, nothing behind it |
| `✗` | `X` | regressed: was done, now broken |
| `⊞` | `+` | badge: the node links a sub-map; double-click dives in |

The legend under the picture names the four statuses; `□ done, no evidence`
joins it only on a map that actually contains one — the four are the
vocabulary, that one is a rule being broken here and now. Documentation
diagram kinds replace the status legend with their node-kind glyphs.

### Pane flags

Both the pane launcher (`scripts/open-pane.mjs <project dir>`) and the
watcher (`dist/watch.mjs`) take the same watcher flags; the launcher forwards
them verbatim and rejects anything it does not know rather than dropping it.

| Flag | Effect |
| --- | --- |
| `--page <slug>` | open on this page; with a pane already running, retarget that pane instead of opening another |
| `--ascii` | pure-ASCII repertoire, for fonts without box-drawing glyphs |
| `--no-color` | no ANSI color |
| `--no-mouse` | no mouse reporting, if your terminal multiplexer wants the mouse for itself |
| `--no-follow` | start with auto-follow off |
| `--interval <ms>` | poll interval; default 250, floored at 50 |

Launcher-only: `--window` opens the dedicated "mellos-mapping" window instead
of splitting the session's window, and `--force` opens another pane even
though one is already running for this project. Watcher-only: `--file <path>`
names the default page's state file (the launcher derives it from the project
directory).

### Pages

A project can keep several maps side by side — **one effort = one page**.
Claude targets a page by passing `page` to any `mmap_*` tool; the pane grows
a tab bar as soon as a second page exists. The active tab is bold in its
map's aggregate status color. Each page remembers its own pan, zoom and
pinned node.

By default the pane **follows the page being written** — the map the agent is
operating on right now — so declares and updates bring the audience along by
themselves. `f` toggles that, a manual page switch turns it off, and
`--no-follow` starts it off; with follow off, a background page's change
lights its tab in status color instead of stealing your view. An explicit
`--page` outranks follow, and a page requested before it exists is shown the
moment it appears.

State lives in the tool-owned `.mellos/` directory at the project root:

| Path | What it is |
| --- | --- |
| `.mellos/map.json` | the default page — optional; a project whose work lives on named pages has none |
| `.mellos/pages/<slug>.json` | one file per named page |
| `.mellos/config.json` | the project's mapping policy (see [Setup](#setup-choose-when-maps-open)) |
| `.mellos/focus` | one-shot "show this page" request from a launcher to a running pane; the pane consumes it and deletes it within a poll tick |
| `<any of the above>.<pid>.<random>.tmp` | a save in flight; it is renamed over its target or removed. A leftover means a write failed (and was reported) and even its cleanup could not run |

The map files are plain JSON, safe to commit if you want the maps' history in
git.

**Concurrency, stated plainly.** Every save is atomic — written to a private
sibling temp file and renamed over the target — so a reader polling the store
sees the previous complete map or the new one, never a torn write. There is
no lost-update protection: two writers saving the *same* page race, and the
last rename wins, silently discarding what the other computed from an older
read. Pages are the isolation unit — two sessions that must not clobber each
other belong on two pages, which is also the answer to running several Claude
sessions in one project.

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

Sub-maps are interior detail, not siblings: a page some *other* page dives
into never occupies a tab. Two refinements keep the tab strip from erasing
itself — a page whose own node names itself hides nobody, and a link cycle
keeps its tabs unless a page outside the cycle dives in, because a cycle has
no outside to climb back to. Inside a dive the tab row becomes a breadcrumb —
`⌫ parent map ▸ node` — and clicking it (or `Backspace`) climbs back out.
When a hidden sub-map changes in the background, the footer says so.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `mmap_declare` | Grow the map: title (`null` removes it), diagram kind, layer bands, lanes, groups (subsystems), nodes — with `status`, `evidence`, `detail`, `kind`, `group`, `lane`, `submap` — and edges, optionally labeled (all-or-nothing batch) |
| `mmap_update` | Record progress **and revise**: status (`planned → in-progress → done` +evidence, `regressed`), relabel a node, move it to another band (`layer`), join/leave a group or lane, set a node kind or a `submap`; rename and re-rank bands (`layers`), relabel groups (`groups`) and lanes (`lanes`); `null` clears any clearable field |
| `mmap_remove` | Revise: drop edges, nodes, groups, lanes, empty bands |
| `mmap_view` | Render the current map as text inline (optional `zoom`, `-4`…`2`), ending with a `pages:` line naming every page the project has and which one you are looking at |
| `mmap_setup` | Get/set the project's mapping policy — when maps open |

A batch applies bands → groups → lanes → node updates, and within one node
update `layer` moves the node before its other fields, so a node can move and
join a group on its new band in one item.

What the boundary refuses, so the ledger never records something it did not
mean:

- **an unknown key**, naming it — a misspelled `evidance` is an error, not a
  silently dropped field, at every nesting depth;
- **control characters** in text fields — an ESC sequence stored in a label
  would let a map repaint the terminal of everyone who opens it. `detail` is
  the exception: newlines and tabs are how a note is written, everything else
  (ESC, BEL, lone CR) is still refused;
- **an empty string** where a field is optional — `null` is how a field is
  cleared, never a blank that renders as a box nobody can tell from a real
  one;
- **a node whose `submap` names the page the call itself targets** — a link
  with no bottom, not a parent link.

A write that does not land answers `save failed, nothing changed (retry)`:
the previous file is intact and calling again is the whole recovery.

### Setup: choose when maps open

Each project chooses how eager mapping is, once, via `/mmap setup` (or the
first time the assistant declares a map — the reply nudges it to ask you):

- `always` — map every structured task: workflows, designs, architecture,
  technical dependencies.
- `complex` — map only medium or complex tasks (the default until configured).
- `on-request` — map only when you explicitly ask.

The choice is stored in `.mellos/config.json` and guides the
assistant; it never blocks the tools, and asking for a map explicitly always
works under any policy.

Structural invariants enforced by the tools: layers form a total order by
rank (an integer in 0..99, 0 = bottom, unique per map); every node lives in
exactly one layer; edges point **strictly downward** — which makes the graph
acyclic by construction; nodes may not depend on same-layer siblings (if A
needs sibling B, either B is really a lower concept or A and B are one node);
a group clusters nodes within one band; and node ids and group ids share
**one namespace** — an id names a node or a group, never both, because both
render as boxes and one id must mean one box.

## Development

```
npm install
npm run verify
```

`verify` is five steps, in this order: `typecheck` (the repo's own sources),
`typecheck:packages` (the dsh plugin packages' framework-free modules, with
`mellos-mapping/*` pointed at these sources), `test`, `build` (bundles
`dist/`, emits `lib/` with declarations, cleaning both first), and
`check:package` — which packs the tarball through the real `prepack`
lifecycle and fails if any `exports` or `bin` target is missing from it.

The repo is itself layered bottom-up, and each layer has its spec:

| Layer | Code | Spec | Owns |
| --- | --- | --- | --- |
| 0 domain | `src/domain/` | `ops.test.ts` | the map value, structural invariants, pure ops |
| 1 format | `src/store/format.ts` | `store.test.ts` | the state-file format: replay-validated parse, serialize — I/O-free |
| 1 store | `src/store/store.ts` | `store.test.ts`, `atomic-save.test.ts` | atomic state-file persistence on Node |
| 1 semantics | `src/semantics/` | `semantics.test.ts` | medium-neutral view semantics: zoom ladder, group aggregation, page-set rules, sequence flip, the shared glyph vocabulary |
| 2 apply | `src/server/apply.ts` | `apply.test.ts` | tool inputs → transactional op sequences |
| 3 server | `src/server/server.ts` | `server.test.ts`, `save-failure.test.ts` | the five MCP tools over stdio |
| 4 render | `src/render/` | `render.test.ts`, `routing.test.ts` | the ASCII renderer and its wire routing |
| 4 pane | `src/watch/` | `watch.test.ts`, `pane-state.test.ts`, `input.test.ts` | the polling pane: page set, input parsing, panel and chrome |
| — launchers | `scripts/` | `open-pane.test.mjs`, `codex-register.test.mjs` | plain-node entry points |
| — packaging | `package.json`, `packages/` | `tests/lockfile.test.ts`, `tests/packages.test.ts`, `browser-safe.test.ts` | what ships, and to whom |

`dist/` is committed deliberately: plugin installation clones this repo and
runs nothing, so entry points ship bundled. CI diffs the committed `dist/`
against a fresh build, so a source change that forgets the rebuild fails.

### The dsh packages

`packages/dsh` and `packages/dsh-client` are the DeepSeek Harness surface: a
host plugin that reads and watches a workspace's `.mellos/` store, and the
browser map panel that draws it with these same semantics. They are
*developed* inside a dsh workspace checkout (its toolchain builds them) and
*published* from here — sources, specs and `lib/` committed, refreshed by
`node scripts/sync-dsh-plugin.mjs <path-to-deepseek-harness>`, which rewrites
the dsh-internal package names to the published ones. This repo cannot build
them, so it proves what it can: `typecheck:packages` and the framework-free
specs run in CI, and `tests/packages.test.ts` guards the src↔lib structure,
the shared version line, and the MCP row's spawn form. Specs that need the
`@deepseek-ai` framework or a DOM are named, with their reason, in
`vitest.config.ts`. See [`packages/dsh/README.md`](packages/dsh/README.md).

### Library

The lower layers are also a library (`npm run build` emits `lib/` with type
declarations; npm packs it). Subpath exports mirror the source:

| Subpath | Contents | Browser-safe |
| --- | --- | --- |
| `mellos-mapping/domain/types` | the map value, ids, ranks, statuses, errors | yes |
| `mellos-mapping/domain/ops` | pure operations over a map | yes |
| `mellos-mapping/format` | state-file parse / serialize, page ids | yes |
| `mellos-mapping/semantics` | zoom ladder, group aggregation, focus and page-set rules, the shared glyph vocabulary | yes |
| `mellos-mapping/render` | the terminal renderer | gated the same way (it is pure), but its output is character cells — for terminal hosts |
| `mellos-mapping/store` | filesystem persistence, atomic saves, focus file, policy | Node only |
| `mellos-mapping/server` | the bundled MCP server entry — a spawn target, not a module to import | Node only |

**Browser-safe** means no Node builtins anywhere in the import closure, gated
by a test, so a graphical client (a web panel, an editor view) can parse state
files and reuse the exact aggregation, zoom and glyph semantics the terminal
pane draws with. `packages/dsh-client` is that client.

## License

MIT
