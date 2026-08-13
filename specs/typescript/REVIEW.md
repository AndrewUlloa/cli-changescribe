# Review: TypeScript migration

> Status: approved for hosted CI
> Reviewed: 2026-08-12

## Outcome

Three independent reviews covered architecture, test design, and npm
distribution. All required findings are closed. The implementation compiles
strictly, preserves the CLI/package contracts, and has no unresolved required
correctness, security, performance, test, or distribution finding.

## TDD evidence

- Characterization suite: 10 tests passed before implementation.
- Migration RED: when the migration contract was run against the original
  JavaScript tree, 5 of 6 checks failed for the intended reasons: missing
  TypeScript lifecycle, tsconfig, TypeScript sources, compiled bin shim, and CI.
- CLI routing RED: failed because `dist/cli.js` did not exist; passed after the
  typed router and stable shim were added.
- Provider seam RED: failed because injected environment/factory inputs were
  ignored; passed after the typed seam was added.
- CI contract RED: failed because the workflow did not exist; passed after the
  Node 18/20/22 matrix was added.
- Security RED: a malicious `--base` created a marker file through shell
  evaluation. It passes after all variable Git inputs moved to argv arrays.
- Current GREEN: strict typecheck and all 25 tests pass with zero skips,
  including packed installs and bridge execution.

## Required findings resolved

1. Nested npm dry-run state leaked into the E2E pack/install test. The test now
   strips both dry-run environment spellings, and CI exercises the complete
   `npm publish --dry-run` lifecycle.
2. The bridge test could have delegated to a nested registry copy. It now
   resolves the bridge dependency, compares its real path to the packed root
   `diffwright@0.2.2`, and proves no nested copy exists.
3. Pre-existing shell interpolation accepted Git refs and filenames as shell
   syntax. All Git commands now use `execFileSync`/`spawnSync` argument arrays.
   Regressions cover malicious base refs and staged `$()` filenames.
4. Commit and PR workflows lacked direct characterization. Real temporary Git
   repositories now cover deterministic commit dry-run and no-API PR dry-run
   behavior, including no commit, push, or output write.

## Local gates

- `npm run typecheck`: pass
- `npm test`: 25 pass, 0 fail, 0 skip
- `npm publish --dry-run --tag next --json`: pass
- `npm audit --omit=dev`: 0 vulnerabilities
- `git diff --check`: pass
- Tarball: 14 allowlisted files; executable shim mode `0755`

Hosted Node 18/20/22 results are a release gate and will be recorded in the PR.
