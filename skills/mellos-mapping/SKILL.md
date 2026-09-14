---
name: mellos-mapping
description: >-
  Maintain a live layered dependency map (Mellos map) while doing bottom-up
  development. Use when starting any non-trivial implementation or
  architecture task — multiple modules, layers, or more than roughly an hour
  of work. Resume existing maps first; declare missing design, then light nodes up
  bottom-to-top as they are built and verified. Also use when the user asks
  for a mellos map, /mmap, a dependency map, or wants to see development
  progress as a picture. The user's mmap_setup policy decides how eager
  mapping is — always / complex tasks only / on-request.
---

# Mellos Mapping — the map discipline

Eight MCP tools (`mmap_declare`, `mmap_update`, `mmap_remove`, `mmap_view`,
`mmap_setup`, `mmap_open`, `mmap_read`, `mmap_batch`)
maintain a **Mellos map**: a layered dependency map of the system under
construction, persisted in `.mellos/map.json` (default page) plus
`.mellos/pages/<slug>.json` (named pages) and rendered live in
a terminal split pane, a desktop Markdown file panel, or an interactive local web viewer beside the conversation. To learn whether a map already
exists — and under which page slugs — call `mmap_view`: every response ends
with a `pages:` line naming the pages this project has and which one you are
looking at. Never probe the default file to decide: it is absent whenever all
work lives on named pages.

With current servers, prefer mmap_read {resource: "pages"}: it returns page
summaries, saved context and revisions. A new conversation or compaction is not
a new effort. Resume the matching page, read relevant nodes by ID/filter and
request detail/evidence only when needed. Use the IDs returned by mmap_read,
not display labels. Declare only missing structure. Keep context.summary and
context.next current so another conversation can continue without rebuilding.
Pass expectedRevision on writes; reread on CONFLICT. mmap_batch applies mixed
changes atomically to one page. mmap_read changes checks linked source hashes;
record sources[].sha256 only after verification. Older servers can fall back
to mmap_view discovery and the saved JSON for precise IDs.

The map is a **ledger, not a judge**: the tools only refuse structural
corruption; *when* to declare, start, or complete nodes is YOUR discipline,
spelled out here. Report honestly — an unflattering map is doing its job.

## When to open a map

The USER chooses how eager mapping is — once, for themselves, not once per
project. In Claude Code the answer is already in this session's context: a
`SessionStart` hook reads it and states it before the conversation begins, so
there is nothing to probe. In hosts without hooks (Codex CLI, a bare MCP
client) call `mmap_setup` with no arguments before the first map decision of
the session; the reply names both scopes and which one governs.

- `always` — map every structured task: workflows, designs, architecture,
  technical dependencies. Small effort, small map — but a map.
- `complex` — map only medium or complex tasks: several interacting modules,
  a new subsystem, layered refactoring — roughly an hour of work or more.
  Skip trivial edits; a map of one node is noise. When unsure, ask.
- `on-request` — open a map only when the user explicitly asks.

Under `always` and `complex`, the recorded policy is STANDING CONSENT: on a
task it covers, declare the ghost design and open the pane yourself, without
asking first. Re-asking for permission the user has already given is the
failure mode this policy exists to remove.

If the policy is not set anywhere, ask the USER to choose — present the three
options, never pick for them — then persist the answer with
`mmap_setup {policy, scope: "user"}`. That is asked ONCE EVER: the choice is
saved in the user's own `.mellos/config.json` and applies to every project.
A project that genuinely needs to differ takes
`mmap_setup {policy, scope: "project"}`, which overrides the user choice
there; `/mmap setup` reruns the question for either scope. Until they answer,
act as `complex`. Two things always outrank the policy: an explicit user
request for a map wins under any policy, and a map that is already open keeps
getting honest updates whatever the policy says.

Caught mid-implementation without a map on work that deserves one? Stop and
declare it with honest statuses (written-but-unverified is `in-progress`, not
`done`). If the mmap tools are missing from the session, explain that mapping
is unavailable and continue the user's implementation. In Codex, look for
tools by their `mmap_*` suffix: a host may add a server namespace. Installing
or repairing the plugin includes running
`node <plugin root>/scripts/codex-register.mjs`, then starting a new
conversation. Existing installation authorization covers this registration;
ordinary implementation work alone does not authorize changing host config.
The plugin root is two directories above this skill's directory. See
`<plugin root>/docs/codex.md` for Codex packaging and installation details.

## Automatic desktop terminal in a browser

In ChatGPT desktop Codex mode, prefer `mmap_open {surface: "web-terminal", page}`
when no other surface was chosen. Pass its `hostOpen` object to `open_in_codex`
in the current conversation: right placement, browser target, returned URL.
The page starts the existing mmap terminal automatically, with independent font
size. No manual paste or Computer Use is needed. An older schema can use
`node "<plugin root>/dist/web.mjs" "<project>" --terminal --page <slug>`.
Respect manually pinned pages and report queued opening honestly. Native Claude
Code terminal placement remains the default for terminal hosts.

## Desktop document panel

When the current host exposes a file side panel (for example Codex desktop's
`open_in_codex`) and the user requests a document or no browser panel is available, use the Markdown
surface. This replaces the terminal-placement instructions in step 2 below.

1. Call `mmap_open {surface: "markdown", page: "<effort-slug>"}`. This generates
   local Markdown with a colored SVG map and enables automatic preview updates
   after successful map mutations in this project. It starts no terminal or web
   server. Keep the JSON maps as the source; generated documents are not inputs.
2. Pass the returned absolute `markdown:` path to the host's file-opening tool,
   in the current conversation's right panel. With `open_in_codex`, use
   `placement: "right"` and `target: {type: "file", path: "<returned path>"}`.
   Do not set another conversation id unless the user asked for that placement.
3. A generated file is not evidence that the user sees it. Report `queued`
   opening as queued, and do not claim a live viewer or automatic UI refresh.
   If the preview stays stale, regenerate with `mmap_open` and reopen the same
   file. Avoid reopening after every write when the viewer already refreshes.
4. `preview: STALE` means the map mutation succeeded but export failed. Fix
   the export problem and regenerate; do not repeat the map mutation. A terminal
   `pane:` report does not describe the desktop file panel.

If this conversation still has the previous MCP schema after a local upgrade,
use `node "<plugin root>/dist/preview.mjs" "<project directory>" --page <slug>`
to generate the same files. Until a new conversation loads the updated server,
rerun this command after map writes. Use the actual installed runtime path from
`docs/codex.md` when the skill cache differs from the runtime install.

The document contains a static vector image, module details, evidence and
links to existing child pages. Image nodes do not support dragging, hover
details, animated spinners or double-click navigation. Desktop rendering and
refresh behavior belong to the host, not the plugin.

## Optional interactive web panel

Keep the user's chosen surface. Markdown/SVG remains available with its existing
workflow; adding the web viewer never disables or replaces it. When the user
asks for a web map or live interaction, call `mmap_open {surface: "web", page:
"<effort-slug>"}`. Pass the returned `web:` URL to the host's browser-opening
tool. In Codex use `open_in_codex` with `placement: "right"` and
`target: {type: "browser", url: "<returned URL>"}` in the current conversation.
Report queued opening honestly; a running local service does not prove visibility.

The viewer reads the same project maps and refreshes automatically, including
writes from older MCP clients. It supports zoom/pan, hover and pinned details,
dependency highlighting, search/status filters, page selection, child-map
navigation, groups, lanes, light/dark themes and confirmed page deletion.
Manual page selection disables auto-follow; do not override a pinned page.
Web page deletion also refreshes enabled Markdown previews.

If this conversation has an older schema, run
`node "<plugin root>/dist/web.mjs" "<project directory>" --page <slug>` and open
the JSON response's `url`. It reuses a local service for that project; no public
hosting or dependency download is required. Close an unused service with the
same command plus `--stop` instead of `--page <slug>`. It also exits after five
minutes without browser requests. Reopen with the tool/CLI after that, or after
a plugin update. A `web: configured` report describes a runtime record, not a
confirmed open desktop panel. See `docs/codex.md` for transport and lifecycle details.

## The working loop

1. **Resume first, then fill gaps.** Read existing pages and the matching effort's
   records. For a new effort, declare its intended design with `mmap_declare`: `title`,
   layer bands (rank 0 = most primitive, at the bottom), every planned node,
   and the edges. Everything starts `planned` — the user can veto the ghost
   design before any code exists.
2. **Put the map on screen — that is YOUR job, not the user's.** Use the
   desktop document flow above when applicable. For terminal hosts, at the first
   map decision in a session, ensure the requested placement with `mmap_open`
   even if a project viewer is already reported. Use no page for this initial
   placement check so an existing pane pinned by the user keeps its view;
   subsequent opens name the effort's page as usual. A project-wide viewer
   report alone does not prove this session has its right split. Every
   declare, update, remove and view answers with a `pane:` line telling you
   who is actually looking. Read it and act on it:
   - `pane: CLOSED` — nobody is. Call `mmap_open {page: "<slug>"}` at once,
     without asking first: a recorded mapping policy IS the user's standing
     consent to see the map. Confirm it is live only after the tool succeeds.
     If automatic opening already failed, relay the reason and copyable command
     once; retry only after the environment changes or the user asks.
   - `pane: open on this page` — they are watching this land. Carry on.
   - `pane: open on <other>, auto-follow on` — the pane follows the page
     last written, so your next write brings the audience along by itself.
   - `pane: open on <other>, auto-follow OFF` — the user pinned that page by
     hand. Your changes are real and NOT on their screen: say so, and
     retarget with `mmap_open {page}` only if they want it moved. A pane
     with follow off is a deliberate choice — don't fight it.
   Default open means a right split beside THIS conversation. A live viewer in
   another window is not proof of that placement. If opening reports that the
   source tab is inactive or Windows refused focus, relay it and ask the user
   to activate this conversation's terminal tab before retrying. Do not retry
   with `window: true` unless the user chose a separate window.
   Always pass the page your effort lives on. Without it a fresh pane opens
   on whichever page was written last, which after a gap is rarely the one
   under discussion — and declaring on a named page makes YOU responsible
   for the audience, rather than telling the user which tab to click.
   `mmap_open {window: true}` puts the map in its own window instead of
   splitting the conversation's, for users who want it separate. It never
   CLOSES a pane: that is the user's (the `q` key, or `mmap` in any terminal
   of the project, which toggles) — so a pane that vanishes is them, not a
   fault.
   On Linux/macOS, the same tool automatically opens tmux, using the inherited
   session/pane or the single attached session when `TMUX` is missing. Multiple
   attached sessions require `MELLOS_MAPPING_TMUX_TARGET`; custom sockets use
   `MELLOS_MAPPING_TMUX_SOCKET` in the MCP server environment. `window: true`
   requests a new tmux window. Do not guess between attached sessions.
   Where the tool cannot help — a client without it, or a machine without
   Windows Terminal or an attached tmux session — relay the launcher's complete
   quoted watcher command for a visible terminal, or use:
   `node <plugin root>/dist/watch.mjs --file <project>/.mellos/map.json
   --page <slug>` in a second terminal or tmux split (this skill file lives
   under `<plugin root>/skills/mellos-mapping/`). `mmap_view` shows the map
   inline anywhere.
3. **Work bottom-up.** Set a node `in-progress` before implementing it, and
   prefer finishing its lower dependencies first. Independent same-band
   siblings need no artificial queue — building them together (several
   spinners at once) is honest reporting, not a violation. If you
   deliberately build above an unfinished dependency, say why in
   conversation.
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
6. **Revise the ghost honestly.** The design is a hypothesis, and everything
   it declared can be revised. When a node splits, a primitive appears, or a
   band was wrong, fix the map in the same turn you change the plan:
   `mmap_update` moves a node to another band (`layer`), renames or re-ranks
   a band, relabels a group or a lane, and clears any optional field with
   `null` (never an empty string); it also edits title, kind and edge labels.
   `mmap_declare` grows the map; `mmap_remove` drops edges, nodes, groups, lanes
   and bands you have emptied. A map that no longer matches your intent is
   the one failure mode this system cannot survive.
7. **Clean up a finished effort.** Pages accumulate — one effort, one page —
   so when an effort is over and its map has served its purpose, offer to
   remove it: `mmap_remove {pages: ["slug"]}` deletes those page files for
   good. Only with the user behind it, never on your own initiative, and
   never a page someone might still be reading. (In the pane the user can do
   it themselves: `x` twice, or the `×` on the active tab.)

## Modeling guidance

- **Nodes are units of buildable, verifiable work** (a module, a contract, a
  renderer) — not tasks like "write tests" and not files.
- **Declare groups when one band grows crowded** (`groups` in
  `mmap_declare`, `group` on members): labeled subsystems within that band,
  worth declaring once a single band holds roughly five or more nodes — the
  far zoom renders groups, and a crowded band without them degrades into
  anonymous glyphs. A group must be a strict subset of its band: a group
  holding the whole band merely renames it. A map spread thin across many
  bands needs no groups at all. Group status is derived from members —
  never invent it.
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
