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
`check:locks`, `check:reuse`, `check:package`, `check:codex`, and `check:release`, in that order. CI runs
the same command on Linux, macOS and Windows against Node 22.

CI also exercises the built OS lock protocol on those three systems using
Node 18.17, 20.3 and 24. `check:locks` coordinates real processes through
completion messages, including forced termination; it does not poll for locks.

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

That synchronizes both plugin manifests, the Claude marketplace entry,
`package.json`, both version fields in `server.json`, and the server banner.
It also updates the two root version fields in `package-lock.json`, preserving
the resolved dependency graph and optional platform packages, then runs the
full verify. It does not re-resolve dependencies against a registry.

Commit, merge, tag and the two publish workflows remain separate maintainer
steps. npm publishing runs in `.github/workflows/publish-npm.yml` on the
version tag through npm Trusted Publishing: the run authenticates with its
GitHub Actions OIDC identity, needs no token or one-time password, and
attaches a provenance attestation. Follow the [release guide](docs/releasing.md)
to verify the exact npm version can be installed from the official registry
before publishing its MCP Registry entry.

## Reporting bugs

Open an issue — the form asks for host, terminal and version, which is what
the diagnosis usually turns on. Anything exploitable goes through
[SECURITY.md](SECURITY.md) instead, never a public issue.
