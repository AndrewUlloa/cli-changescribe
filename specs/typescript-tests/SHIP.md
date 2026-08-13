# Ship: TypeScript test-suite migration

> Owner: Andrew Ulloa
> Target: GitHub `main`
> Spec: `specs/typescript-tests/SPEC.md`
> Status: complete

## Launch plan

1. Push the focused branch and open a PR.
2. Require typecheck, all 26 tests, packed-install E2E, and publish dry-run to
   pass on Node 18, 20, and 22.
3. Merge only with a clean, mergeable PR and no required review finding.
4. Confirm GitHub contains no `.js` file under `test/` after merge.
5. Allow GitHub Linguist time to recalculate the language percentages.

No npm release is required: this changes repository development tests, not the
already-published runtime artifact. The next ordinary package release will
carry the updated development scripts and README.

## Rollback

Revert the merge commit if hosted CI exposes a Node-version issue or local test
execution regresses. The current npm `latest` release remains unaffected, so no
registry rollback or dist-tag change is needed.

## Monitoring

- GitHub Actions Node 18/20/22 results
- PR merge state
- Post-merge repository file extensions and language panel

No feature flag, production telemetry, infrastructure change, or user-facing
rollout applies to this development-only migration.

## Post-merge verification

- PR #6 merged as commit `3931ffd`.
- No `.js` file remains under `test/`.
- GitHub reports 90,724 TypeScript bytes and 383 JavaScript bytes: approximately
  99.6% TypeScript and 0.4% JavaScript.
