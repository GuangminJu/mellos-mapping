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

### Added

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
  `pages/` and the one-shot `focus` file; the 0.19 → 0.20 move of the whole
  store out of `.claude/` still runs once per project and logs one line on
  stderr.
- `npm run build` cleans `dist/` and `lib/` before emitting, `prepack` builds,
  and `npm run verify` ends with `check:package`, which packs the real tarball
  and fails if any `exports` or `bin` target is missing from it.
- `dist/` gained a third artifact, `dist/store-paths.mjs`: the store's path
  vocabulary for the plain-node pane launcher, which no longer keeps a second
  copy of any filename.
- The package exports `./server` (the MCP server entry, for hosts that spawn
  it by resolution rather than by path).
