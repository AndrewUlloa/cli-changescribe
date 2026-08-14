# Plan: Guided project initialization

> Derived from: `specs/guided-init/SPEC.md`
> Status: complete
> Last updated: 2026-08-14

## Overview

Build the approved TTY-aware `init` wizard as a sequence of independently
testable slices: preserve the current headless contract first, add terminal and
provider seams, construct a pure redacted setup plan, apply it safely, install
an exact local Diffwright version, install managed agent guardrails, validate
with doctor, then update PR gates and public documentation. The wizard must
never make the stale-global failure possible in newly configured projects.

## Architecture decisions

- **Decision:** Keep a strict discovery → answers → plan → preview → apply
  boundary. **Rationale:** no prompt, cancellation, or validation failure can
  cause a partial write before final consent.
- **Decision:** Use Node built-ins behind an injected `Prompter` interface.
  **Rationale:** preserves Node 18 support and avoids a new runtime dependency
  while making every prompt path deterministic in tests.
- **Decision:** Pin the running package version as a local exact devDependency
  for external projects. **Rationale:** an `npx` execution is ephemeral and
  bare scripts otherwise resolve missing or stale global binaries.
- **Decision:** Treat the Diffwright repository as a validated self-host and
  build before invoking `node ./bin/diffwright.js`. **Rationale:** prevents a
  self-dependency and prevents stale compiled output.
- **Decision:** Derive agent prose from effective generated script names and
  gate chains. **Rationale:** guardrails must not claim enforcement the scripts
  do not provide.
- **Decision:** Preserve exact no-argument non-TTY init behavior. `--yes` is a
  new explicit deterministic consent path; it may install the exact local
  package and apply only choices supplied or safely detected, but never stores
  a new secret, installs agent rules unless named, or performs a live request
  unless `--live` is supplied. **Rationale:** existing ChangeScribe/automation
  callers remain compatible while CI gains a complete flag-driven path.
- **Decision:** Use explicit PR commands with validated base refs rather than
  hidden `feature:pr` alias defaults. **Rationale:** main-only repositories must
  not accidentally target `staging`.
- **Decision:** Refactor PR gate execution to use the detected package manager.
  **Rationale:** advertising pnpm/Yarn/Bun setup while later hard-coding npm is
  an incomplete workflow.

Non-decisions:

- Rejected: always-interactive init. Reason: it would hang or break current
  clean-install tests, ChangeScribe delegation, and automation.
- Rejected: a separate `setup` command. Reason: it misses the approved
  shadcn-style `npx diffwright@latest init` entry point.
- Rejected: storing credentials in package.json or argv. Reason: both are
  observable and unsafe.
- Rejected: dynamic provider model catalogs. Reason: model identifiers change
  quickly and provider APIs are inconsistent.
- Rejected: heuristic rewriting of arbitrary custom scripts or instruction
  prose. Reason: ownership is ambiguous and data loss would be unacceptable.

## Dependency graph

```text
[init argument contract]
          │
          ├──▶ [prompt interface]
          │
          ├──▶ [provider setup metadata]
          │
          └──▶ [project/package-manager discovery]
                         │
                         └──▶ [pure setup plan + safe transforms]
                                      │
                                      ├──▶ [atomic apply + local pin]
                                      │             │
                                      │             └──▶ [doctor/live handoff]
                                      │
                                      └──▶ [managed agent guardrails]

[package-manager discovery] ──▶ [PR gate runner]

[all behavior green] ──▶ [docs + packed install] ──▶ [review] ──▶ [ship note]
```

## Task list

### Phase 1: Public contract and foundations

- [x] **Task 1: Extend the init argument and routing contract**
  - **Description:** Add strict init options, async argument forwarding, and
    accurate command help while preserving no-argument non-TTY behavior.
  - **Acceptance:**
    - [x] Supported boolean/value flags route unchanged to init.
    - [x] Unknown/missing/invalid/conflicting flags fail before the runner.
    - [x] `init --help` documents prompts, writes, install, doctor, and live
      side effects without invoking init.
  - **Verify:** `npm run build && node --test .test-dist/cli-routing.test.js`
  - **Depends on:** None
  - **Files:** `src/arguments.ts`, `src/cli.ts`, `test/cli-routing.test.ts`
  - **Size:** M

- [x] **Task 2: Add a testable terminal prompt adapter**
  - **Description:** Implement input/select/confirm/secret prompts with a
    cancellation error and guaranteed raw-mode restoration.
  - **Acceptance:**
    - [x] Regular questions validate and retry without shell execution.
    - [x] Secret input echoes no characters and restores terminal state on
      success, EOF, error, and Ctrl-C.
    - [x] Non-TTY secret prompting fails before reading a value.
  - **Verify:** targeted prompt tests plus `npm run typecheck`
  - **Depends on:** Task 1
  - **Files:** `src/prompts.ts`, `test/prompts.test.ts`, module inventory tests
  - **Size:** M

- [x] **Task 3: Export safe provider setup metadata**
  - **Description:** Expose immutable, non-secret preset facts needed by init
    and keep runtime provider resolution as the validation authority.
  - **Acceptance:**
    - [x] All eleven providers expose correct credential/default-model needs.
    - [x] No credential value can enter setup metadata.
    - [x] Existing provider resolution tests remain unchanged and green.
  - **Verify:** targeted provider tests plus `npm run typecheck`
  - **Depends on:** None
  - **Files:** `src/provider.ts`, `test/provider.test.ts`
  - **Size:** S

### Checkpoint: Foundation

- [x] Parser/help/prompt/provider tests green.
- [x] Existing non-TTY init tests still green.
- [x] Typecheck and build clean.

### Phase 2: Pure planning and safe mutation

- [x] **Task 4: Discover project topology and executable provenance**
  - **Description:** Detect package manager, package/Git roots, default and
    staging branches, existing gates, config sources, agent files, running
    package version, and validated self-host status using argv-only commands.
  - **Acceptance:**
    - [x] npm/pnpm/Yarn/Bun and main/staging/master/no-Git fixtures resolve.
    - [x] Conflicting package-manager evidence and unsafe targets fail clearly.
    - [x] External projects plan an exact local pin; self-host never self-depends.
  - **Verify:** targeted discovery tests; no network or filesystem writes
  - **Depends on:** Tasks 1 and 3
  - **Files:** `src/package-manager.ts`, `src/project-setup.ts`, focused tests
  - **Size:** M

- [x] **Task 5: Build branch-aware, gate-aware script plans**
  - **Description:** Produce effective namespaced scripts without overwriting
    custom values and embed only validated safe branch names.
  - **Acceptance:**
    - [x] Main-only and staging topologies generate explicit working PR scripts.
    - [x] Commit scripts run selected existing gates before the local/self CLI.
    - [x] Exact managed/ChangeScribe values migrate; custom collisions receive
      deterministic `diffwright:*` fallbacks.
  - **Verify:** pure script-plan tests including malicious ref inputs
  - **Depends on:** Task 4
  - **Files:** `src/project-setup.ts`, `test/project-setup.test.ts`
  - **Size:** S

- [x] **Task 6: Add safe environment and managed-document transforms**
  - **Description:** Implement bounded, line-aware `.env.local` updates,
    effective `.gitignore` protection, and marker-only CLAUDE/AGENTS blocks.
  - **Acceptance:**
    - [x] Unrelated bytes/comments/EOL and custom prose are preserved.
    - [x] Tracked/unignored env files, symlinks/special files/hardlinks, duplicate
      env keys, and malformed/duplicate markers stop before writes.
    - [x] Preview is semantic and redacted; repeated transforms are identical.
  - **Verify:** focused transformation/security fixtures
  - **Depends on:** Task 5
  - **Files:** `src/setup-files.ts`, `test/setup-files.test.ts`
  - **Size:** M

- [x] **Task 7: Apply plans with concurrency and failure safety**
  - **Description:** Recheck source hashes, write same-directory temporary
    regular files with correct modes, rename atomically, and report/rollback
    partial application without clobbering concurrent edits.
  - **Acceptance:**
    - [x] Dry run/cancel writes nothing.
    - [x] New secret files are mode 0600; other modes are preserved.
    - [x] Injected write/rename/concurrent-edit failures leave an idempotent,
      accurately reported state and no temporary files.
  - **Verify:** atomic writer and failure-injection tests
  - **Depends on:** Task 6
  - **Files:** `src/setup-files.ts`, `test/setup-files.test.ts`
  - **Size:** M

### Checkpoint: Planner and mutation safety

- [x] Every setup choice can be rendered as a fully redacted plan.
- [x] All cancellation and injected-failure paths are zero-write or accurately
  recoverable.
- [x] Security fixtures prove no external target or secret disclosure.

### Phase 3: Guided orchestration

- [x] **Task 8: Orchestrate the TTY wizard and deterministic modes**
  - **Description:** Wire discovery, prompts/flags, prospective provider
    validation, preview, consent, local install, plan apply, offline doctor,
    optional live doctor, and completion guidance.
  - **Acceptance:**
    - [x] TTY happy path completes all approved steps in order.
    - [x] No-argument non-TTY path retains exact legacy output and scripts.
    - [x] `--yes`, `--dry-run`, configure-later, cancellation, install failure,
      doctor failure, and live failure produce accurate distinct outcomes.
  - **Verify:** fake-prompter orchestration tests and temporary-project smoke
  - **Depends on:** Tasks 2, 3, 4, 5, 6, and 7
  - **Files:** `src/init.ts`, `test/init-wizard.test.ts`, legacy branding tests
  - **Size:** M

- [x] **Task 9: Make PR gates package-manager-aware**
  - **Description:** Replace hard-coded npm gate execution with fixed argv from
    the shared detected package-manager contract.
  - **Acceptance:**
    - [x] npm/pnpm/Yarn/Bun fixtures invoke correct test/build commands.
    - [x] Child environments remain credential-sanitized and no shell is used.
    - [x] Existing PR behavior and error messages remain compatible.
  - **Verify:** focused PR integration tests plus subprocess security tests
  - **Depends on:** Task 4
  - **Files:** `src/pr-summary.ts`, `src/package-manager.ts`, PR tests
  - **Size:** M

### Checkpoint: End-to-end guided setup

- [x] A temporary external repo completes the fake interactive flow.
- [x] A self-host fixture resolves the local bin, never the global executable.
- [x] Offline doctor performs zero requests; opted-in live doctor performs one.
- [x] Full test suite green.

### Phase 4: Distribution, documentation, and release evidence

- [x] **Task 10: Update user-facing setup documentation**
  - **Description:** Lead README quick start with guided init and fully document
    interactive/headless behavior, files, install, credentials, agent rules,
    cancellation, doctor, and recovery.
  - **Acceptance:**
    - [x] A first-time user can predict every write and network effect.
    - [x] Provider and troubleshooting docs explain masked credential storage,
      shell precedence, local pinning, and retry paths.
    - [x] Documentation contract tests cover the new public promises.
  - **Verify:** npm-page/documentation tests and link review
  - **Depends on:** Tasks 8 and 9
  - **Files:** `README.md`, `documentation/cli-reference.md`,
    `documentation/providers.md`, `documentation/troubleshooting.md`, tests
  - **Size:** M

- [x] **Task 11: Prove packed and compatibility behavior**
  - **Description:** Update module allowlists and exercise packed Diffwright,
    exact local script resolution, and ChangeScribe headless init.
  - **Acceptance:**
    - [x] Packed tarball contains every required compiled module/map and no
      source/tests/specs/secrets.
    - [x] Clean installed wizard scripts resolve the exact local package.
    - [x] ChangeScribe and Node 18/20/22 CI contracts remain green.
  - **Verify:** `npm test`, `npm pack --dry-run`, CI matrix contract test
  - **Depends on:** Tasks 8, 9, and 10
  - **Files:** distribution/branding/migration tests and package allowlists
  - **Size:** M

- [x] **Task 12: Review and prepare launch/rollback evidence**
  - **Description:** Perform the five-axis review, resolve every required
    finding, rerun final gates, and write review and ship notes.
  - **Acceptance:**
    - [x] Correctness, readability, architecture, security, and performance are
      explicitly evaluated with no unresolved required finding.
    - [x] Rollout, rollback, package versioning, and post-publish smoke checks
      are documented without claiming deployment occurred.
    - [x] Spec and plan statuses match final implementation state.
  - **Verify:** all repository gates plus manual TTY smoke in a temp repository
  - **Depends on:** Task 11
  - **Files:** `specs/guided-init/REVIEW.md`, `SHIP.md`, `SPEC.md`, `PLAN.md`
  - **Size:** S

## Parallelization

- **Completed in parallel:** CLI architecture, compatibility/test design, and
  credential/filesystem security investigations before this plan was finalized.
- **Safe to parallelize after contracts exist:** documentation drafting and
  independent five-axis review.
- **Must be sequential:** parser → plan types → safe transforms → orchestration;
  packed-install verification follows the complete implementation.
- **Contract-first:** provider metadata, package-manager argv, setup-plan types,
  and managed marker syntax must stabilize before dependent tests split.

## Risks and mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| `npx` leaves scripts bound to stale global | High | High | Exact local devDependency or validated self-host path plus provenance E2E |
| Secret appears in a preview/error/temp file | Critical | Low | Secret-free plan rendering, immediate redaction registration, 0600 targets, exhaustive negative assertions |
| Install or multi-file apply partially succeeds | High | Medium | Explicit phase reporting, hash rechecks, atomic per-file writes, safe rollback, idempotent rerun |
| Existing scripts/instructions are overwritten | High | Low | Exact ownership allowlist, namespaced fallbacks, marker-only replacement, preservation fixtures |
| Branch ref becomes shell syntax in generated script | High | Low | Restrict generated bases to safe validated ref text and reject metacharacters/control characters |
| Node 18 TTY behavior diverges | Medium | Medium | Built-in APIs only, injected prompter tests, hosted Node matrix |
| pnpm/Yarn/Bun install flags drift | Medium | Medium | Official command contracts, fixed argv tests, actionable install retry command |
| Setup prose drifts from effective scripts | High | Medium | Render prose from the same immutable script plan and assert together |

## Open questions

None blocking. Teammate investigations resolved executable provenance,
gate-enforcement, branch, compatibility, and secret-handling mechanics. The
requester approved the complete shape and authorized autonomous implementation.

## Sign-off

- [x] Every task has acceptance criteria and verification.
- [x] Dependencies are ordered.
- [x] No XL task remains.
- [x] Checkpoints separate foundations, safety, orchestration, and release.
- [x] Human approved the selected shape and requested full implementation.
