# Review: Guided project initialization

> Spec: `specs/guided-init/SPEC.md`
> Status: passed with no required findings
> Reviewed: 2026-08-14

## Verdict

The guided-init implementation is ready to ship after the package version is
bumped. Three independent review passes covered architecture/correctness,
compatibility/testing, and security. Every required finding was fixed and
regression-tested; the final reviewers reported no remaining blocker.

## Five-axis review

### Correctness

- Interactive TTY, deterministic flags, dry run, configure-later, legacy
  non-TTY, cancellation, install failure, offline failure, and live failure are
  distinct and tested.
- Main-only, selected-staging, remote-only default branch, self-host, exact
  external install, Yarn Classic, and Yarn PnP paths produce matching scripts
  and agent instructions.
- A second identical run preserves bytes and modification times.
- Packed Diffwright and the ChangeScribe compatibility bridge execute end to
  end; a later generated project script resolves the local package.

### Readability

- Prompting, provider metadata, package-manager commands, project discovery,
  file transforms, and orchestration are separated into focused modules.
- Setup output names provider, model, endpoint, topology, version, provenance,
  files, and validation phases while hiding credentials.
- README, CLI, provider, and troubleshooting references describe the same
  behavior, including `--version` and Configure later.

### Architecture

- The flow follows discovery → answers → redacted preview → confirmation →
  re-plan/hash check → apply → immutable doctor handoff.
- External npm/pnpm/Bun scripts invoke
  `node ./node_modules/diffwright/bin/diffwright.js`; Yarn uses
  `yarn exec -- diffwright`. Neither form can fall through to a global binary.
- Diffwright's own repository builds and invokes `node ./bin/diffwright.js`
  and never adds itself as a dependency.
- Existing custom scripts and prose remain owned by the user; only exact
  managed values and marker blocks are replaceable.

### Security

- Secret input has no echo, restores terminal state, is immediately included
  in redaction, never enters argv, and is stripped from child environments.
- `.env.local` must be untracked and effectively ignored. Tracking/ignore
  checks fail closed, and concurrent wildcard-negation changes are caught.
- Setup targets reject symlinks, hardlinks, special files, oversized content,
  invalid UTF-8, malformed markers, and concurrent hash/mode changes.
- Physical provenance rejects symlinked `node_modules` roots and package-bin
  escapes, then probes the exact generated runtime path. Yarn PnP probes the
  same delimiter-safe local command used by generated scripts.
- Offline and opted-in live doctor reuse the same resolved provider object, so
  consent cannot be redirected by a later file change.

### Performance

- Discovery is offline and does not fetch Git refs or provider catalogs.
- Prompts use Node built-ins; no runtime dependency was added.
- Unchanged transforms skip writes, preserving mtimes and avoiding lockfile or
  instruction-file churn.
- The live doctor remains a single explicit request; offline doctor performs
  none.

## Required findings resolved

- Exact pinning without executable persistence after `npx`.
- Self-host stale-dist/global fallback and accidental self-dependency.
- Commit scripts that claimed gates the CLI itself did not run.
- Yarn Classic install flags and argument stripping of `--dry-run`.
- Yarn PnP false-positive provenance.
- Escaped `.bin`, package-bin, and `node_modules` symlinks.
- Post-preview package, `.gitignore`, and agent-file overwrite races.
- Concurrent wildcard unignore of `.env.local`.
- Shell-over-file preview/validation disagreement.
- Provider-switch model leakage and legacy model migration loss.
- Configure-later URL validation and inaccurate completion state.
- Live-consent endpoint time-of-check/time-of-use drift.
- Staging existence being mistaken for selected staging topology.
- Inaccurate post-install/apply/doctor/live phase reporting.
- Missing agent document titles and stale `--version` documentation.

## Verification evidence

- `npm run typecheck` — passed.
- `npm test` — 175/175 passed.
- `npm pack --dry-run --cache /private/tmp/diffwright-npm-cache-final` —
  passed; 40-file package.
- Packed Diffwright + ChangeScribe install/execution test — passed.
- Real Yarn Classic dry-run forwarding test — passed.
- Real interactive TTY `init --dry-run` walkthrough — passed with zero writes.
- `npm run commit -- --help` — passed all project gates and reached the
  checked-out CLI's focused commit help without committing.
- `npm audit --omit=dev` — 0 vulnerabilities.
- `npm audit signatures` — 39/39 verified.
- `git diff --check` — passed.

## Optional future hardening

- Add hosted install matrices for Yarn Berry, pnpm, Bun, Windows, and workspace
  root/hoisted layouts.
- Add directory `fsync` after atomic rename and descriptor-based reads for a
  narrower same-user power-loss/TOCTOU window.
- Add a dedicated injected nonzero package-manager status test; current
  failure messages and recovery documentation already distinguish that phase.

