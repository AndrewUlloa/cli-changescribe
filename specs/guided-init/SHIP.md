# Ship: Guided project initialization

> Spec: `specs/guided-init/SPEC.md`
> Status: published
> Prepared: 2026-08-14

## Package-runner follow-up

The 0.4.1 patch presents guided setup consistently for pnpm (`pnpm dlx`), npm
(`npx`), Yarn 2+ (`yarn dlx`), and Bun (`bunx`). The launcher is explicitly
separated from the project manager that Diffwright detects for its exact local
pin, lockfile, and generated scripts. Yarn Classic users launch with `npx` and
still receive Yarn-managed project setup. Published documentation tests require
all four commands so the quick start cannot regress to an npm-only surface.
Diffwright 0.4.1 is published under the npm `latest` tag. Clean public-registry
projects ran `init --dry-run` through all four launchers, detected the matching
project manager, and preserved their manifests byte-for-byte.

Diffwright 0.4.2 is also published under the npm `latest` tag. This follow-up
hardens Diffwright's own PR synthesis after the release PR exposed ungrounded
CLI/behavior claims and a SHA-prefixed generated title. Pass 2 and pass 3 now
require direct evidence for options, behavior, tests, risks, and migrations; the
PR template supplies a distinct `Overall:` branch summary for title derivation.
The workflow transport and captured GitHub arguments have focused regression
coverage, and the public executable reports version 0.4.2.

## Release summary

Diffwright now provides a shadcn-style `npx diffwright@latest init` walkthrough
for provider/model setup, protected credentials, branch and gate discovery,
exact local executable pinning, Claude/Codex workflow guardrails, redacted
preview/confirmation, offline doctor, and separately consented live doctor.

This repository now dogfoods the checked-out Diffwright source for commits and
pull requests through `npm run commit` and `npm run feature:pr`. Root
`CLAUDE.md` prohibits raw Git/GitHub mutation for work intended to ship.

## Rollout

1. Published `diffwright@0.4.0` to npm with the `latest` tag after its full
   release gates and dry run passed.
2. Published `cli-changescribe@0.2.4` with its widened compatible Diffwright
   range after the main package was live.
3. Installed both public packages in a clean npm project and verified the
   bridge deduplicated to `diffwright@0.4.0`.
4. Ran the public executable version checks and a zero-write guided-init dry
   run with a keyless Ollama profile.
5. Smoke one credentialed hosted provider with offline doctor first and one
   explicitly approved live doctor request.
6. Continue monitoring the ChangeScribe bridge and legacy non-TTY init path.

Registry publication and the clean-install smoke are complete. A hosted
provider live request remains an operational follow-up because no provider
credential was available in the release shell.

## Rollback

- Stop or deprecate the affected npm version and restore the previous release
  tag if a package-level regression appears.
- Revert the guided-init source/docs/tests while preserving the legacy
  no-argument non-TTY path.
- Existing initialized projects remain recoverable: remove only the
  marker-delimited Diffwright block, restore the prior managed script values,
  and remove the exact devDependency if the project no longer wants
  Diffwright. Never remove unrelated `.env.local`, `.gitignore`, script, or
  instruction content.
- Rotate a provider credential only if the credential itself was exposed;
  current tests found no disclosure path.

## Release evidence and caveats

- All gates listed in `REVIEW.md` pass on the final implementation snapshot.
- The CI contract covers Node 18, 20, and 22; the local final run used the
  workspace's current Node runtime.
- The release candidate is versioned as `diffwright@0.4.0`. Its first publish
  dry run caught and prevented a stale ChangeScribe bridge resolution; the
  bridge is now versioned as `cli-changescribe@0.2.4` with a compatible
  pre-1.0 Diffwright range.
- Final publication reran the complete 175-test suite successfully. Registry
  checks confirmed `latest` points to Diffwright 0.4.0 and the compatibility
  bridge cleanly resolves that exact public version.
- Package-manager installs intentionally disable lifecycle scripts. Generated
  npm/pnpm/Bun workflows use an explicit local file path; Yarn uses a
  delimiter-safe local resolver.

## Post-release signals

- Watch install failures by package manager and Node version.
- Watch reports of init hangs, terminal mode not restoring, or secret output.
- Watch doctor failures split by offline configuration vs live transport.
- Watch custom-script collisions, malformed managed blocks, and monorepo root
  discovery; these fail closed and should produce actionable messages.
- Verify newly created PRs target the selected feature base and that release
  scripts appear only for a selected staging topology.
