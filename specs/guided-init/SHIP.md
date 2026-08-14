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

Diffwright 0.4.2 was also published under the npm `latest` tag. This follow-up
hardens Diffwright's own PR synthesis after the release PR exposed ungrounded
CLI/behavior claims and a SHA-prefixed generated title. Pass 2 and pass 3 now
require direct evidence for options, behavior, tests, risks, and migrations; the
PR template supplies a distinct `Overall:` branch summary for title derivation.
The workflow transport and captured GitHub arguments have focused regression
coverage, and the public executable reports version 0.4.2. The final 0.4.3
patch adds a defense-in-depth staging-topology guard and complete preview-command
coverage for every documented launcher. Diffwright 0.4.3 is published under the
npm `latest` tag after all 177 tests passed.

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
4. Published 0.4.1 and ran zero-write guided-init dry runs through pnpm, npm,
   Yarn, and Bun launchers in matching clean projects.
5. Published 0.4.2, verified the public executable, and exercised the hosted
   Groq provider through Diffwright's enforced commit and PR workflows.
6. Published 0.4.3 after the final review fixes; repeat the public executable
   check against the registry.
7. Continue monitoring the ChangeScribe bridge and legacy non-TTY init path.

Registry publication, clean-install smoke, and a hosted provider workflow are
complete. A separately consented `doctor --live` request remains optional and
is not required for package publication.

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
- The release lineage began at `diffwright@0.4.0`. Its first publish dry run
  caught and prevented a stale ChangeScribe bridge resolution; the bridge is
  versioned as `cli-changescribe@0.2.4` with a compatible pre-1.0 Diffwright
  range.
- The 0.4.3 publication reran the complete 177-test suite successfully.
  Registry and public-executable checks confirm the npm `latest` tag and CLI
  version for each final release candidate.
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
