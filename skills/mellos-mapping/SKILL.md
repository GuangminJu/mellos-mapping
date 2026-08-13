---
name: mellos-mapping
description: >-
  Maintain a live layered dependency map (Mellos map) while doing bottom-up
  development. Use when starting any non-trivial implementation or
  architecture task — multiple modules, layers, or more than roughly an hour
  of work. Declare the design as ghost nodes first, then light nodes up
  bottom-to-top as they are built and verified. Also use when the user asks
  for a mellos map, /mmap, a dependency map, or wants to see development
  progress as a picture.
---

# Mellos Mapping — the map discipline

Four MCP tools (`mmap_declare`, `mmap_update`, `mmap_remove`, `mmap_view`)
maintain a **Mellos map**: a layered dependency map of the system under
construction, persisted in `.claude/mellos-mapping.json` and rendered live in
a terminal split pane beside the conversation.

The map is a **ledger, not a judge**: the tools only refuse structural
corruption; *when* to declare, start, or complete nodes is YOUR discipline,
spelled out here. Report honestly — an unflattering map is doing its job.

## When to open a map

Open a map for work with real structure: several interacting modules, a new
subsystem, layered refactoring. Skip it for trivial edits — a map of one node
is noise. When unsure, ask.

Caught mid-implementation without a map on work that deserves one? Stop and
declare it with honest statuses (written-but-unverified is `in-progress`, not
`done`). If the mmap tools are missing from the session, SAY SO and offer a
restart — never silently skip the map. (Under Codex CLI, missing tools
usually mean the server was never registered: have the user run
`node <plugin root>/scripts/codex-register.mjs`.)

## The working loop

1. **Design first, as ghosts.** Before writing code, decompose bottom-up and
   declare the WHOLE intended design in one `mmap_declare` batch: `title`,
   layer bands (rank 0 = most primitive, at the bottom), every planned node,
   and the edges. Everything starts `planned` — the user can veto the ghost
   design before any code exists.
2. **Offer the pane.** After the first declare, tell the user the map is live.
   In Claude Code `/mellos-mapping:mmap` opens the pane. In other clients on
   Windows run `node <plugin root>/scripts/open-pane.mjs <project dir>` — it
   locates the terminal window hosting THIS session and splits it there, or
   falls back to a dedicated "mellos-mapping" window when the session window
   cannot be identified or focused; pass `--window` to deliberately use the
   dedicated window (some users want the map separate from the chat).
   Elsewhere run `node <plugin root>/dist/watch.mjs` from the project
   directory in a second terminal or split (this skill file lives under
   `<plugin root>/skills/mellos-mapping/`). `mmap_view` shows the map inline
   anywhere.
3. **Work bottom-up, one spinner at a time.** Set a node `in-progress` before
   implementing it. Prefer finishing its lower dependencies first; if you
   deliberately deviate, say why in conversation.
4. **`done` requires evidence.** Mark `done` only when verification actually
   passed, with what passed in `evidence` (e.g. `vitest: 23 passed`). No
   evidence, no done.
5. **Regression spreads upward.** If later work breaks a `done` node, set it
   `regressed` (breakage in `evidence`) BEFORE fixing. Then walk every node
   that uses it, directly or transitively: their `done` was proven against a
   foundation that no longer holds. Default them to `regressed` too; keep one
   green only with a stated reason (its own verification re-ran green, or it
   never touches the broken behavior). After the fix, restore each node only
   as its own verification passes again.
6. **Revise the ghost honestly.** The design is a hypothesis. When a node
   splits, a primitive appears, or a layer was wrong, update the map in the
   same turn you change the plan. A map that no longer matches your intent is
   the one failure mode this system cannot survive.

## Modeling guidance

- **Nodes are units of buildable, verifiable work** (a module, a contract, a
  renderer) — not tasks like "write tests" and not files.
- **Declare groups beyond ~6 nodes** (`groups` in `mmap_declare`, `group` on
  members): labeled subsystems within one band. The zoomed-out view renders
  groups; without them it degrades into anonymous glyphs. Group status is
  derived from members — never invent it.
- **Every node carries `detail`**: one to three sentences on responsibility,
  contract, and the key decision. Update it when the design shifts — a stale
  detail is a small lie on the map.
- **Push state to the top.** Lower layers take values in, give values out;
  mutable state concentrates in the topmost orchestrator, which owns it
  explicitly and hands it down as parameters. Stateless layers are cheap to
  maintain: testable with values alone, rewritable without ceremony. A lower
  node whose `detail` must describe state it keeps between calls is a design
  smell — restructure before building on it.
- **Layers encode dependency direction, nothing else.** If A needs sibling B,
  either B is really lower-layer or A and B are one node — restructure rather
  than force an edge.
- **Edges mean "uses"** — the upper node genuinely calls, composes, or reads
  the lower one. No aspirational edges.
- Ids are stable kebab-case slugs; labels are short display names (CJK fine),
  renameable without breaking edges.
- **One effort = one page.** A genuinely separate effort (parallel session,
  unrelated subsystem) gets its own page via the `page` parameter — don't mix
  efforts or overwrite a finished map.
- **Sub-maps: dive, don't cram.** When a node's internals genuinely deserve
  their own picture, declare a separate page and set `submap: <page-slug>` on
  the node — the pane badges it ⊞; double-click dives in, Backspace climbs
  back. Your judgment: most nodes need no sub-map; create one only when the
  child map would carry a handful of nodes of its own.

## Diagram kinds

The default kind is `dev` — the living progress ledger described above.
`mmap_declare` also accepts documentation kinds, rendered neutrally (no
ghosts, no spinners, no progress counts). Use them when the user asks for a
picture of a system rather than a picture of work; one diagram = one page.

- `architecture` — layered components; also module dependencies, call graphs.
- `dataflow` — pipeline stages as layers, sources at rank 0; label edges
  with the data that flows.
- `behavior-tree` — leaves (actions) at rank 0, root on top; node `kind`
  selector | sequence | parallel | decorator | condition | action renders
  as a glyph. Also fits mind maps and WBS.
- `sequence` — the classic call/return diagram. rank = time step, rank 0 =
  earliest; the pane draws sequence pages TOP-DOWN (earliest step on top,
  under the participant headers). Declare participants as `lanes`; every
  call AND every return is its own event node in the ACTING participant's
  lane, so a round trip zigzags into the callee's lane and back out. Label
  each edge with the message.
- State machines are out of scope: transitions cycle, and edges here only
  point downward. Say so rather than forcing one in.

Edge labels and node kinds work on `dev` maps too.

## Standing state

At any moment the pane should answer at a glance: what is designed, what is
built and verified, what is in progress RIGHT NOW, and whether any foundation
is cracked. If a glance would mislead on any of these, fix the map first.
