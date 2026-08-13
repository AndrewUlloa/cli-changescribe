# Plan: CLI safety and documentation hardening

> Derived from: `specs/cli-safety-docs/SPEC.md`
> Status: complete
> Last updated: 2026-08-13

## Overview

Build the release in small red-to-green slices: close unsafe parsing first,
repair issue linking and subcommand help next, then make the README and
reference/community documentation match the tested behavior, and finally ship
the patch through the existing package and CI lifecycle.

## Architecture decisions

- **Validate at the CLI boundary.** `runCli` rejects unknown command options
  before invoking command runners; command modules retain typed parsers for
  direct testability and aliases.
- **Use GitHub-supported closing syntax.** An issue reference is content in the
  PR body, not an invented GitHub CLI flag.
- **Separate task and reference content.** README remains the onboarding and
  safety surface; exhaustive facts live in `documentation/` and command help.
- **No parser dependency.** The current option set is small enough for explicit
  TypeScript parsing and tests.

## Dependency graph

```text
[approved contract]
        ├─▶ [strict parsing tests] ─▶ [strict parsers]
        ├─▶ [issue-link tests] ─────▶ [supported PR body behavior]
        └─▶ [help tests] ───────────▶ [command-specific help]
                         │
                         └─▶ [README/reference/community docs]
                                      │
                                      └─▶ [0.3.2 release gates]
```

## Task list

### Phase 1: Fail-closed command boundary

- [x] **Task 1: Reject unsafe commit and PR arguments**
  - **Acceptance:** Unknown options and missing/invalid values exit nonzero
    before Git or provider side effects; valid invocations retain behavior.
  - **Verify:** Focused CLI/security tests; strict typecheck.
  - **Depends on:** None
  - **Files:** `test/cli-routing.test.ts`, `test/security.test.ts`,
    `src/cli.ts`, `src/commit.ts`, `src/pr-summary.ts`
  - **Size:** M

- [x] **Task 2: Make issue linking compatible with GitHub CLI**
  - **Acceptance:** `123` and `#123` normalize; invalid values fail; create and
    update bodies contain `Closes #123`; no `gh` argv contains `--issue`.
  - **Verify:** Focused PR integration tests with a fake `gh` boundary.
  - **Depends on:** Task 1
  - **Files:** `src/pr-summary.ts`, `test/workflows.test.ts`
  - **Size:** S

### Checkpoint: Command safety

- [x] Focused regression tests pass
- [x] Full suite and typecheck pass
- [x] One focused commit per completed slice

### Phase 2: Discoverable, accurate operation

- [x] **Task 3: Add command-specific help**
  - **Acceptance:** Every primary command and alias documents supported syntax,
    critical side effects, and the documentation URL; unknown options remain
    errors rather than help fallbacks.
  - **Verify:** CLI output contract and packed-binary tests.
  - **Depends on:** Tasks 1–2
  - **Files:** `src/cli.ts`, `test/cli-routing.test.ts`, `test/branding.test.ts`
  - **Size:** M

- [x] **Task 4: Publish task-oriented README and reference docs**
  - **Acceptance:** Requirements, exact dry-run behavior, provider request
    counts, command effects, PR example, troubleshooting, team installs, and
    provider links are present without a GIF or exhaustive flag dump.
  - **Verify:** README/reference link and behavior contract tests.
  - **Depends on:** Task 3
  - **Files:** `README.md`, `documentation/*.md`, `test/npm-page.test.ts`
  - **Size:** M

- [x] **Task 5: Add repository trust paths**
  - **Acceptance:** Root security, support, and contribution files contain live
    reporting/help instructions and are linked from README; GitHub private
    vulnerability reporting is enabled.
  - **Verify:** Community-file tests and GitHub community profile.
  - **Depends on:** None
  - **Files:** `SECURITY.md`, `SUPPORT.md`, `CONTRIBUTING.md`, README test
  - **Size:** S

### Checkpoint: Documentation integrity

- [x] Source behavior, help, README, and reference agree
- [x] All local links and official external links resolve
- [x] Full suite and pack allowlist pass

### Phase 3: Review and ship

- [x] **Task 6: Prepare and verify 0.3.2**
  - **Acceptance:** Metadata is 0.3.2; tarball includes intended community and
    reference files; clean Diffwright and ChangeScribe installs pass.
  - **Verify:** Typecheck, full tests, pack, audits, diff check, clean installs.
  - **Depends on:** Tasks 1–5
  - **Files:** package metadata, distribution tests, review/ship artifacts
  - **Size:** M

- [x] **Task 7: Review, merge, publish, and observe**
  - **Acceptance:** Five-axis review has no blockers; PR CI passes Node
    18/20/22; npm latest is 0.3.2; registry README and clean installs verify.
  - **Verify:** GitHub checks, npm registry metadata, public CLI execution.
  - **Depends on:** Task 6
  - **Files:** `REVIEW.md`, `SHIP.md`
  - **Size:** M

## Parallelization

- Safe after contracts: documentation drafting and community files.
- Sequential: parsing → help → authoritative reference → package release.
- Contract-first: issue normalization and command-effects language.

## Risks and mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Tests accidentally invoke live Git/provider operations | High | Low | Temporary repos, injected boundaries, dummy loopback profiles |
| npm page links omit unshipped files | Medium | Medium | Absolute GitHub links and package allowlist tests |
| User content under `docs/`/`signal/` is staged | High | Low | Explicit-path staging and status audit before every commit |

## Open questions

None blocking.

## Sign-off

- [x] Every task has acceptance and verification
- [x] Tasks are ordered by dependency
- [x] No task is XL
- [x] Checkpoints separate safety, documentation, and release
- [x] Human approved implementation
