# Contributing

A small project with a few hard constraints. All of them are mechanical, and
CI enforces every one — so the fastest way to know your change is acceptable
is to run the same command CI runs.

## Setup

```
npm ci
npm run verify
```

Use Node.js 22.12+ for development. `verify` runs `typecheck`, `test`, `build`,
`check:reuse`, `check:package`, `check:codex`, and `check:release`, in that order. CI runs
the same command on Linux, macOS and Windows against Node 22.

For model-driven map reuse acceptance, first build the release editions with
`npm run check:release`, then run `node scripts/check-codex-dialogue.mjs cli`.
An absolute Codex engine path and an optional result label can replace `cli`.
Append `proactive` after the label to test an ordinary repair request that does
not mention maps or progress, with the fixture's mapping policy set to `always`.
This opt-in check uses the current signed-in account and configured model, so it
consumes model usage and is not part of CI. It installs the candidate into a
temporary profile, verifies the host's effective MCP configuration and eight
tools, and tests fresh conversations, real context compaction, and a new process
starting in a subdirectory. It waits for task-specific completion events.
Results and tool traces go to `artifacts/audit/codex-reuse/dialogue/`; temporary
credentials, host sessions and fixtures are removed afterward. The user's
installed plugin and configuration are not replaced.

## The constraint that surprises people

**`dist/` is committed.** Claude Code installs a plugin by cloning this repo
and running no build step, so the bundled server, watcher and pane have to be
in the tree. A source change is therefore not finished until `npm run build`
has run and the rebuilt `dist/` is part of the same commit. CI diffs the
committed `dist/` against a fresh build (`git diff --exit-code -- dist`) and
fails when they disagree.

`lib/` is the opposite: gitignored, built on demand, shipped only inside the
npm tarball.

## Branches and pull requests

- Start from current `main` and work on `codex/<name>` (or a descriptive
  `feature/`, `fix/`, `refactor/` branch). Open the PR against `main`.
- `claude` and `chatgpt-app` contain generated releases. Source changes belong
  on `main`; use [release candidates](docs/releasing.md) to update editions.
- Keep parallel worktrees beside the repository, outside `artifacts/`.
  Archive completed work before pruning branches; see the
  [project and Git guide](docs/project-maintenance.md).
- One PR, one change. A refactor and a fix in the same diff can be neither
  reviewed nor reverted independently.
- `npm run verify` green before you open it.
- Commit subjects say what is now true, not what you did: *"A refused edge
  says how to fix it"*, not *"improve error message"*. `git log --oneline`
  is the register to match.

## Where code goes

The repo is layered bottom-up and every layer has its spec — the table under
[Development](README.md#development) maps each layer to its code, its test
file, and what it owns. New code belongs in the lowest layer that can own it,
and its tests belong beside that layer's existing spec.

Dependencies point downward only. If a module needs a sibling, either the
sibling really belongs a layer lower, or the two are one module. (This is the
same rule the map itself enforces on edges, and for the same reason.)

## Tests

Tests document intent, not implementation. A test name should read as a claim
about the system — the existing ones do: `answers isError and leaves the
previous map byte-for-byte intact`. Untested behaviour is not guaranteed
behaviour, and review will ask for the test.

## Releases

Maintainer-only, and deliberately not automated end to end:

```
node scripts/release.mjs <semver>
```

That bumps the version in the six places it lives — both plugin manifests,
`package.json`, `server.json` (twice), and the server banner — resyncs the
lockfile against the public registry, then runs the full verify. Commit,
merge, tag, `npm publish` and the MCP-registry workflow stay manual on
purpose; the comment at the top of the script explains why publishing cannot
move into CI as things stand.

## Reporting bugs

Open an issue — the form asks for host, terminal and version, which is what
the diagnosis usually turns on. Anything exploitable goes through
[SECURITY.md](SECURITY.md) instead, never a public issue.
