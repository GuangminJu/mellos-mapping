# Changelog

Notable, user-visible changes. Releases before 0.20.2 are recorded only in
the git history (`git log --oneline`), which is where this file starts.

## 0.20.2 (unreleased)

### Breaking

- **Unknown keys in a tool call are refused, and the refusal names the key.**
  A misspelled field used to vanish silently — `evidance` on a node meant the
  ledger recorded a `done` with no evidence behind it. Every object in the
  tool surface is now closed, at every nesting depth. A caller that has been
  passing an extra field will start seeing errors; the field was never being
  applied.
- **Control characters are refused in text fields.** A label, title, band
  name, group/lane label, edge label or evidence note may no longer carry C0,
  DEL or C1 characters — an ESC sequence stored in a map would repaint the
  terminal of everyone who opened it. `detail` is the one exception: `\n` and
  `\t` are how a note is written; ESC, BEL and a lone CR are still refused.
- **State files are parsed strictly.** A field of the wrong type is now
  refused instead of being coerced or quietly dropped, and the refusal names
  the key or index (`nodes[3].label is a number, expected a string`). This can
  refuse a file an older version tolerated: a non-array where `layers`,
  `nodes`, `edges`, `lanes` or `groups` is expected (`{"nodes": {}}` used to
  read as "no nodes" — and the next save wrote that erasure back), a
  non-string id/label/name/title/kind, and a `rank` that is not an integer in
  0..99. A UTF-8 BOM is now tolerated, so a file hand-edited in Notepad still
  loads.
- **Node ids and group ids share one namespace (invariant I10).** An id names
  a node or a group, never both — both render as boxes, and one id must mean
  one box. A map that declared a group and a node under the same id is now
  refused where the ids are declared.
- **The browser client draws in-progress as `⠿`.** The dsh map panel had its
  own glyph table; every medium now reads one shared vocabulary, so a status
  cannot look like one thing in the pane and another in the browser.
- **In the pane, a lone `Esc` is the Esc key.** It used to be held back as a
  possible escape-sequence head, which prefixed the next input chunk and made
  every later `Esc` arrive as `ESC ESC` and match nothing — unpinning was
  dead for the life of the pane. Consequently `Esc` now unpins (and climbs
  out of a dive) the first time you press it.
- **A horizontal wheel tilt pans instead of zooming.** A sideways nudge of
  the wheel used to jump the whole map a zoom step.
- **The lockfile points at `registry.npmjs.org`.** `npm ci` from a clone no
  longer depends on whatever registry the lockfile was last written against;
  a spec guards it.
- **`loadMappingPolicy` and `saveMappingPolicy` take the CONFIG file path**
  (`mellos-mapping/store`), not the default page's path. The policy now lives
  in two scopes and one loader serves both, so the argument had to become the
  file itself: pass `configFilePath(defaultFile)` for a project, or
  `userConfigFilePath(home)` for the user. `buildServer` likewise takes the
  user configuration path as a second argument.

### Changed

- **"Is a pane already open?" is answered by the panes, not by the operating
  system.** `mmap` and the launcher used to settle it with a PowerShell process
  scan: Windows-only, a round trip every time, and unable to say WHICH page was
  on screen. They now read the viewers reports — instant, exact, cross-platform
  — and fall back to the process scan only for a watcher started before this
  version, which publishes no report.
- **The standby screen is text only.** The animated water (the ripple engine)
  is gone: on real terminals its shaded cells rendered as blocks of color
  noise rather than waves, and decoration was never the screen's job. While
  no map exists the pane now shows just the spinner line and the waiting
  diagnostics, so the standby fits shorter panes than it used to.

### Added

- **A pane says it is there, so nothing has to guess — and `mmap_open` lets
  the assistant put the map on screen itself.** A map nobody had open looked
  exactly like a map somebody was watching: the assistant declared a design,
  lit nodes up as it built them, and the user saw an empty terminal or nothing
  at all, because opening the pane took a human remembering to. Every pane now
  publishes a report while it runs (`.mellos/viewers/<pid>.json` — the page on
  screen and whether auto-follow is on, refreshed once a second, taken back
  when the pane exits), and every declare, update, remove and view answers
  with a `pane:` line built from those reports: nobody is looking; the pane is
  on this page; it is elsewhere but follows what you write; or the user pinned
  another page by hand and this change is NOT on their screen. `mmap_open` —
  the sixth tool — opens the pane or retargets an open one by running the same
  launcher a human runs, so it can never CLOSE one (that stays the user's, the
  `q` key or `mmap`), and it answers with whether a pane actually reported
  itself in afterwards rather than merely that a command ran. The
  `SessionStart` hook and the skill now say to call it without asking, a
  recorded mapping policy being standing consent. A report nobody refreshes
  stops counting after five seconds and is deleted after a minute, so a killed
  pane cannot go on claiming an audience.
- **`mmap` — one word in any terminal that opens the map pane, and the same
  word that closes it.** Bare `mmap` finds the project the way git finds its
  root (upwards from the cwd to the nearest `.mellos/`), opens the pane if
  nothing is watching that project, and closes the pane if something is. It
  closes through the store, not a signal: a one-shot request beside the map,
  consumed on the pane's next poll, after which the pane exits and hands the
  terminal back — a pane still on its standby screen included. A leftover
  request from a pane that died is swept when the next pane starts, so a stale
  one can never close a fresh one. `mmap <slug>` opens on that page or
  retargets an open pane to it, and never closes. Every watcher flag is
  forwarded verbatim; an unknown one is refused. npm installs provide it as a
  `bin`; a plugin install gets it from the `SessionStart` hook, which — there
  being no install-time hook to do it in — notices a missing or stale shim at
  session start and runs `scripts/install-mmap-command.mjs --json` itself:
  a `.cmd` and a git-bash shim land in `%LOCALAPPDATA%\mellos-mapping\bin`,
  that one directory is appended to the user PATH, and the change is announced
  through the assistant's context — including that the PATH reaches only new
  processes, so Windows Terminal must be closed entirely and reopened (a new
  tab inherits the old environment). The
  steady state costs the hook a single shim read; the PATH edit keeps the
  installer's guarantees — nothing when the entry is already there, refusal
  where `setx` would flatten a `%VARIABLE%` PATH or truncate a long one, with
  the manual entry named instead. The script remains a standalone command for
  `--uninstall` and for re-adding a PATH entry removed by hand.
- **The mapping policy is chosen once, for the user, and injected into every
  session.** It was a per-project setting that something had to remember to
  ask about. It now has a USER scope — `<home>/.mellos/config.json`, the same
  file format — and `mmap_setup` writes there by default; a project can still
  override it with `scope: "project"`, and the read form reports both scopes
  and which one governs. A `SessionStart` hook (registered by the new
  `hooks/hooks.json`, bundled as `dist/hook-session-start.mjs`) then puts the
  answer in front of the assistant at every session start, resume and
  compaction: the one-time question when nobody has chosen, the working loop
  under `always`/`complex` — including opening the pane WITHOUT asking, since
  a recorded policy is standing consent — one quiet line under `on-request` in
  a project that has a map, and nothing at all in one that does not. The hook
  never fails a session: any internal fault exits 0 in silence.
- **A page can be deleted — from the pane and from the tool surface.** Pages
  accumulate (one effort is one page) and nothing could remove one. In the
  pane, `x` — or the `×` the active tab now carries in mouse mode — asks, the
  footer says `press x again to delete <page>`, and a second press within
  three seconds removes that page's file; switching page, `Esc` or waiting
  takes the request back. The resting footer advertises the key —
  `x delete page`, worded as the deletion it is, beside `q quit` — because a
  key nothing names might as well not exist. A page listed while its file
  does not exist — the standby fallback after the last real page is deleted,
  or a `--page` still waiting for its first declare — never arms the
  confirmation: deleting it would "succeed" while changing nothing, forever,
  so the footer says `nothing to delete` instead of pretending. From a tool call, `mmap_remove` gained
  `pages: ["slug", …]`, applied after that call's map edits. It refuses a page
  the same call targets with `page`, and an unknown slug — naming a page the
  project does not have is a typo far more often than a race — with the real
  page list attached. Deleting is permanent: the map files are plain JSON, so
  committing them is the only undo. A `submap` still pointing at a deleted
  page stays legal; it simply has nowhere to dive.
- **`mmap_update` revises everything `mmap_declare` declared.** Move a node to
  another band (`updates[].layer`), rename and re-rank bands (`layers`),
  relabel groups (`groups`) and lanes (`lanes`). A batch applies bands →
  groups → lanes → node updates, and within one node update `layer` moves the
  node before its other fields.
- **`null` clears any clearable field**: `evidence`, `detail`, `group`,
  `kind`, `lane`, `submap` on a node update, and `title` on `mmap_declare`.
  An empty string is refused — a blank is not how a field is cleared.
- **`mmap_declare` accepts `evidence` on a node**, so work that was already
  finished can be mapped with its proof instead of needing a second call.
- **`mmap_view` ends every response with a `pages:` line** naming the pages
  the project has (with `(default: absent)` when the default page has no
  file) and which one you are looking at. Page discovery no longer means
  guessing a slug or probing files.
- **`□` (ASCII `o`) — done with no evidence recorded.** The same shape as
  `■`, hollow: a degree of done, not a fifth status. The legend names it only
  on a map that contains one.
- **Every tool field advertises its own schema.** Sixteen id fields used to be
  published as `$ref` pointers back to `page`, so a model read "node id = the
  page this call targets".
- **The pane's `f` key toggles auto-follow**, and the launcher and watcher
  take `--no-follow`. The launcher now forwards the whole watcher flag set
  (`--ascii --no-color --no-mouse --no-follow --interval <ms>`) and rejects an
  unknown flag instead of dropping it. The watcher itself now holds the same
  line: an unknown flag, a misspelled `--page` slug, a non-numeric
  `--interval` or a missing value is refused with the usage line instead of
  being silently ignored (the pane used to come up showing the wrong thing).

### Fixed

- **A save that does not land is reported, never assumed.** Writes retry a
  rename the OS refuses transiently (a reader holding the file open on
  Windows) and answer `save failed, nothing changed (retry)` when they still
  cannot land. Every write uses a temp file private to that call, so two
  writers can never install each other's half-written content.
- **A node may not set `submap` to the page the call itself targets** — a link
  with no bottom, which used to delete the tab of the page it was drawn on.
- **The pane survives everything a file or a picture can do to it.** A torn or
  unreadable page becomes a visible error line instead of taking the pane
  down, and the terminal is handed back — mouse reporting off, cursor shown —
  however the process ends, including an unforeseen fault.
- **Escape sequences the pane does not know are inert.** F-keys, Home/End,
  PgUp/PgDn, Insert/Delete and modified arrows are consumed whole; their
  payload bytes used to be read as hotkeys (F2 quit the pane, End toggled
  auto-follow, PgUp jumped to page 5).
- **Sub-map tabs cannot erase the tab strip.** A page whose own node names
  itself hides nobody, and a link cycle keeps its tabs unless a page outside
  the cycle dives in.
- **Emoji-aware widths and a reserved right margin for band labels**, so a
  picture measures itself honestly.
- Codex registration reports a missing `codex` CLI instead of failing
  obscurely, and works from a Windows path.
- The dsh bundle spawns the MCP server as `process.execPath` plus its own
  pinned `mellos-mapping/server` entry — no network fetch at startup, and it
  spawns on Windows, where `npx` could not.

### Changed

- `.mellos/` gained `config.json` (the mapping policy) alongside `map.json`,
  `pages/` and the one-shot `focus` file, plus the one-shot `quit` file the
  `mmap` toggle writes; the 0.19 → 0.20 move of the whole store out of
  `.claude/` still runs once per project and logs one line on stderr.
- The declare-time setup nudge fires only while NEITHER scope has a policy, so
  it stops for good after the one user-level answer instead of returning in
  every new project. It is kept for hosts that have no hooks (Codex CLI, bare
  MCP clients), where it is the only path the question has.
- `dist/` gained `dist/mmap.mjs` (the `mmap` toggle) and
  `dist/hook-session-start.mjs` (the `SessionStart` hook); the launcher
  machinery both pane entry points share now lives in
  `scripts/pane-core.mjs`, and `scripts/open-pane.mjs` keeps its command line
  unchanged.
- `npm run build` cleans `dist/` and `lib/` before emitting, `prepack` builds,
  and `npm run verify` ends with `check:package`, which packs the real tarball
  and fails if any `exports` or `bin` target is missing from it.
- `dist/` gained a third artifact, `dist/store-paths.mjs`: the store's path
  vocabulary for the plain-node pane launcher, which no longer keeps a second
  copy of any filename.
- The package exports `./server` (the MCP server entry, for hosts that spawn
  it by resolution rather than by path).
