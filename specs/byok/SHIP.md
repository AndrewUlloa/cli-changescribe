# Ship plan: Provider-neutral BYOK

> Status: release candidate
> Target: `diffwright@0.3.0` and `cli-changescribe@0.2.3`

## Release order

1. Merge the focused feature PR after the Node 18, 20, and 22 CI matrix and
   publish-lifecycle dry run pass.
2. Publish `diffwright@0.3.0`.
3. Install `diffwright@0.3.0` into a clean temporary project and run help,
   offline doctor, and a local wire-backed live doctor.
4. Publish `cli-changescribe@0.2.3`, whose dependency is
   `diffwright@^0.3.0`.
5. Install the bridge into a clean temporary project and prove Node resolves
   its `diffwright/bin/diffwright.js` to the installed 0.3.x package.

## Required gates

- [x] `npm run typecheck`
- [x] `npm test` (73/73, including packed-install bridge E2E)
- [x] `npm pack --dry-run` (24-file `diffwright@0.3.0` artifact)
- [x] `npm audit --omit=dev` (zero vulnerabilities)
- [x] `git diff --check`
- [x] Focused Diffwright dry-run dogfood with an explicit keyless loopback profile
- [x] Hosted CI on Node 18, 20, and 22 (PR #8)
- [x] Local clean packed/install execution for Diffwright and the ChangeScribe bridge
- [ ] Post-publish clean registry install verification

Live provider smoke tests run only for credentials actually available. No
credential is currently available, so no integration will be promoted to
`live-verified` for this release.

## Rollback

The provider-neutral path is opt-in and legacy Cerebras/Groq resolution is
preserved, so no runtime feature flag is required. If a release issue appears:

1. Move npm's `latest` dist-tag for `diffwright` back to `0.2.2`.
2. Move the bridge's `latest` dist-tag back to `0.2.2` if `0.2.3` has shipped.
3. Revert the merge on `main` and publish a corrected patch; published npm
   versions are immutable.
4. Document whether users should pin `diffwright@0.2.2` while the patch is
   prepared.

## Monitoring

Diffwright has no server-side telemetry or hosted request path. Post-release
monitoring therefore consists of:

- npm package metadata and clean-install verification;
- GitHub Actions on the release commit;
- GitHub issue reports grouped by provider, model, status code, and doctor
  category without collecting credentials or diffs;
- provider documentation drift, especially token fields and compatibility
  layers.

## Post-release checks

- `npm view diffwright@0.3.0 version dist-tags --json`
- `npm view cli-changescribe@0.2.3 version dependencies --json`
- Fresh global-style execution of `diffwright --help` and
  `changescribe --help`
- Confirm the GitHub release branch and npm `latest` tag agree
