## What is now true

<!-- One sentence in the register of `git log --oneline`: what the system
     does after this change, not what you did to it. -->

## Why

<!-- The problem this solves. If it is a fix, what the root cause was — a
     symptom-only fix needs to say so and say why. -->

## Checks

- [ ] `npm run verify` is green (typecheck, tests, build, package surface)
- [ ] If `src/` changed: `npm run build` was run and the rebuilt `dist/` is in
      this PR — CI diffs it and fails otherwise
- [ ] New or changed behaviour has a test that reads as a claim about the
      system
- [ ] Docs updated if a user-visible surface moved (README and
      README.zh-CN.md stay in step; CHANGELOG for anything user-visible)
