# Ship plan: npm package page and 0.3.1 hardening

> Status: release candidate
> Target: `diffwright@0.3.1`

## Release order

1. Push the focused branch and open a PR.
2. Require Node 18, 20, and 22 CI plus the publish-lifecycle dry run to pass.
3. Merge the reviewed PR.
4. Publish `diffwright@0.3.1` with npm MFA approval.
5. Install the registry package in a clean temporary project and run help,
   offline doctor, and PR dry run checks.
6. Verify npm registry metadata contains the new description and README.

The ChangeScribe bridge does not need a new release: its published
`diffwright@^0.3.0` dependency accepts 0.3.1.

## Required gates

- [x] `npm run typecheck`
- [x] `npm test` (77/77, including packed-install bridge E2E)
- [x] `npm pack --dry-run` (24-file `diffwright@0.3.1` artifact)
- [x] `npm audit --omit=dev` (zero vulnerabilities)
- [x] `npm audit signatures` (39 verified packages)
- [x] `git diff --check`
- [x] Focused Diffwright PR dry-run dogfood with no model request
- [x] Hosted CI on Node 18, 20, and 22 (PR #9)
- [ ] Post-publish clean registry install verification
- [ ] Published npm README and description verification

## Rollback

Published npm versions are immutable. If a release issue appears:

1. Move npm's `latest` dist-tag for `diffwright` back to `0.3.0`.
2. Revert the merge on `main`.
3. Publish a corrected patch after the complete gate and review cycle.
4. Tell users to pin `diffwright@0.3.0` until the corrected patch is available.

## Post-release checks

- `npm view diffwright@0.3.1 version description dist-tags --json`
- Compare `npm view diffwright@0.3.1 readme` with the reviewed repository README.
- Install `diffwright@0.3.1` in a clean temporary directory and execute
  `diffwright --help` and offline `diffwright doctor`.
- Install `cli-changescribe@0.2.3` separately and prove its resolved Diffwright
  version is 0.3.1 and `changescribe --help` delegates successfully.
