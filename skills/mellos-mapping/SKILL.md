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

You have four MCP tools (`mmap_declare`, `mmap_update`, `mmap_remove`,
`mmap_view`) that maintain a **Mellos map**: a layered dependency map of the
system under construction, persisted in `.claude/mellos-mapping.json` and
rendered live in a terminal split pane the user keeps beside the conversation.

The map is a **ledger, not a judge**. The tools only refuse structural
corruption (edges that do not point strictly downward, unknown ids, duplicate
ranks). Everything about *when* to declare, start, or complete nodes is YOUR
discipline, spelled out here. The map never blocks you; it makes your process
visible. Report honestly — an unflattering map is doing its job.

## When to open a map

Open a map for work with real structure: several interacting modules, a new
subsystem, layered refactoring. Skip it for trivial edits (a rename, one bug
fix, a config tweak) — a map of one node is noise. When unsure, ask whether
the user wants the map.

Catching yourself mid-implementation without a map on work that deserves
one? Stop, declare the map with honest statuses (written-but-unverified
work is `in-progress`, not `done`), then continue. And if the mmap tools
are missing from the session (plugin installed mid-session, degraded
load), SAY SO and offer a restart — never silently skip the map.

## The working loop

1. **Design first, as ghosts.** Before writing code, decompose the task
   bottom-up and declare the WHOLE intended design in one `mmap_declare`
   batch: a `title`, the layer bands (rank 0 = most primitive, at the bottom),
   every planned node, and the dependency edges. Everything starts `planned` —
   the user sees the full ghost design and can veto it before any code exists.
2. **Offer the pane.** After the first declare, tell the user the map is live
   and they can open the split pane with `/mellos-mapping:mmap` (or show it
   inline anytime via `mmap_view`).
3. **Work bottom-up, one spinner at a time.** Before implementing a node, set
   it `in-progress`. Prefer finishing a node's lower dependencies first; if
   you deliberately deviate, say so in conversation — the picture will show a
   spinner above grey ghosts, and the user deserves the reason.
4. **`done` requires evidence.** Only mark a node `done` when its
   verification actually passed, and put what passed in `evidence`
   (e.g. `vitest: 23 passed`, `manual: pane renders CJK aligned`). No
   evidence, no done.
5. **Regression is map-worthy.** If later work breaks a `done` node's tests,
   set it `regressed` with the breakage in `evidence` BEFORE starting the fix,
   and set it back to `done` only when re-verified.
6. **Revise the ghost honestly.** The initial design is a hypothesis. When
   understanding deepens — a node splits, a missing primitive appears, a layer
   was wrong — update the map with `mmap_declare` / `mmap_remove` in the same
   turn you change the plan. A map that no longer matches your intent is the
   one failure mode this system cannot survive.

## Modeling guidance

- **Nodes are units of buildable, verifiable work** (a module, a contract, a
  renderer) — not tasks like "write tests" and not files. One node ≈ one
  thing that can be independently done.
- **Declare groups for any map beyond ~6 nodes.** A group is a labeled
  subsystem clustering nodes WITHIN one band (`groups` in `mmap_declare`,
  `group` on each member). The zoomed-out view renders groups instead of
  members — a map without groups degrades into anonymous glyphs when the
  user zooms out, which tells them nothing. Group status is derived from
  members automatically; never invent status for a group.
- **Every node carries `detail`** — one to three sentences on its
  responsibility, its contract, and the key design decision. Write it at
  declaration time (the user reads it in the pane's detail panel when they
  hover the node) and update it whenever the design shifts. A node whose
  detail no longer matches its code is a small lie on the map.
- **Layers encode allowed dependency direction, nothing else.** If node A
  needs sibling B on the same layer, either B is really a lower-layer concept
  or A and B are one node — restructure instead of forcing an edge.
- **Edges mean "uses".** Declare an edge when the upper node genuinely calls,
  composes, or reads the lower one. Do not draw aspirational edges.
- Ids are stable kebab-case slugs; labels are short display names (CJK fine)
  and may be renamed freely without breaking edges.
- One map per project at a time. Starting a new effort? Propose replacing the
  map (declare a new title and structure) rather than mixing two efforts.

## Standing state

At any moment the pane should answer, at a glance: what is designed, what is
built and verified, what is being worked on RIGHT NOW (the spinner), and
whether any foundation is cracked (red). If a user glances at the map and it
would mislead them about any of those four questions, fix the map first.
