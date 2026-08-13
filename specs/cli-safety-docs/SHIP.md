# Ship: Diffwright 0.3.2

> Status: ready for hosted CI
> Prepared: 2026-08-13

## Release contents

- Fail-closed command option validation and bounded PR history limits
- Supported GitHub issue-closing syntax for new and existing PRs
- Command-specific help and accurate npm README
- CLI, provider, and troubleshooting references
- Security, support, and contribution policies
- Private vulnerability reporting enabled

## Compatibility

- Node.js remains `>=18`.
- No dependency changes.
- Existing valid commands and aliases remain.
- ChangeScribe `0.2.3` already depends on `diffwright@^0.3.0`, so it accepts
  `0.3.2` without a bridge release.

## Verified locally

- [x] Strict typecheck
- [x] 93 tests
- [x] Packed Diffwright + ChangeScribe clean-install E2E
- [x] Exact 32-file `0.3.2` tarball
- [x] Production dependency audit: zero vulnerabilities
- [x] Registry signatures: 39 verified
- [x] Diff check
- [x] Independent correctness, documentation, and release reviews
- [x] Unrelated `docs/` and `signal/` content excluded

## Hosted and public verification

- [ ] Push focused branch and open PR
- [ ] Node 18 CI green
- [ ] Node 20 CI green
- [ ] Node 22 CI green
- [ ] Merge to `main`
- [ ] Publish `diffwright@0.3.2` with npm provenance/MFA
- [ ] Verify npm latest metadata and README
- [ ] Install from registry in a clean directory and run help/init
- [ ] Install ChangeScribe with Diffwright and confirm root resolution

## Rollback

If a post-publish issue appears, do not delete the npm version. Deprecate the
affected release with a clear message, prepare a tested patch version, and
update `latest` only after the replacement passes the same gates.
