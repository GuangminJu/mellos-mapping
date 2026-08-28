# Security policy

## Supported versions

The latest published version is the supported one. Fixes land on `master` and
ship in the next release; there are no backport branches.

| Version | Supported |
| --- | --- |
| 0.20.x | yes |
| < 0.20 | no — upgrade |

## Reporting a vulnerability

Use GitHub's private reporting: **[Report a vulnerability](https://github.com/GuangminJu/mellos-mapping/security/advisories/new)**
(or repo → Security → Advisories → Report a vulnerability). It opens a
channel visible only to you and the maintainer.

Please do not open a public issue for anything exploitable.

Expect a first reply within a week. A confirmed report gets a fix, a release,
and credit in the advisory unless you would rather not be named.

## What this project actually touches

Useful context for judging whether something is a vulnerability:

- **It reads and writes files under `.mellos/` in the project directory** —
  map pages, a one-shot focus channel, a viewers directory, and a config
  file. It writes nowhere else.
- **It has no runtime dependencies and makes no network calls.** The MCP
  server speaks stdio; the pane polls files on disk.
- **It renders to a terminal, so state files are untrusted input.** A map
  file arrives with a checkout and carries whatever its author wrote. Since
  0.20.2, control characters (C0, DEL, C1) are refused in every text field —
  an ESC sequence in a node label would otherwise repaint the terminal of
  everyone who opened that map — and state files are parsed strictly rather
  than coerced.
- **It is driven by an agent, not by a human typing.** Every object in the
  tool surface is closed at every nesting depth: an unknown key is refused,
  not ignored. That is a safety property, not a convenience — a misspelled
  `evidence` field would otherwise record a verified node with nothing
  behind it.

Not vulnerabilities here: a map that renders an ugly picture, a pane that
refuses a malformed page instead of guessing at it, and anything that first
requires write access to a project directory you already control.
