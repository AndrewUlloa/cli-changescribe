# Plan: TypeScript test-suite migration

> Derived from: `specs/typescript-tests/SPEC.md`
> Status: approved and in progress
> Last updated: 2026-08-12

## Architecture decisions

- Compile tests with `tsc` into `.test-dist/` instead of adding a TypeScript
  runtime loader. This keeps the dependency graph and Node 18 behavior simple.
- Keep tests pointed at compiled `dist/` and public bins; TypeScript is a test
  authoring improvement, not permission to test private source shortcuts.
- Preserve the exact npm allowlist so the release artifact cannot grow.

## Dependency graph

```text
[RED compiler/package contract]
             │
             ▼
 [test tsconfig + scripts]
             │
             ▼
 [unit/routing test conversion]
             │
             ▼
 [Git/package E2E conversion]
             │
             ▼
 [full lifecycle + review + PR]
```

## Task list

- [ ] **Task 1: Add failing TypeScript-test contract**
  - Acceptance: contract requires `.ts` tests, strict test config, compiled
    test command, ignored output, and no JS tests.
  - Verify: targeted contract fails against the current JS suite for intended
    assertions.
  - Files: `test/typescript-migration.test.js`
  - Size: S

- [ ] **Task 2: Add compiler and package plumbing**
  - Acceptance: `tsconfig.test.json`, `build:test`, combined typecheck, clean,
    test execution, and ignore rules satisfy the contract.
  - Verify: compiler reaches test type errors rather than configuration errors.
  - Files: `tsconfig.test.json`, `package.json`, `.gitignore`
  - Depends on: Task 1
  - Size: S

- [ ] **Task 3: Convert unit and routing tests**
  - Acceptance: branding, CLI routing, provider, compatibility, and compiler
    contract tests compile strictly with unchanged assertions.
  - Verify: targeted compiled tests pass.
  - Files: five test files
  - Depends on: Task 2
  - Size: M

- [ ] **Task 4: Convert Git and distribution E2E tests**
  - Acceptance: security and distribution fixtures have explicit types and
    retain all subprocess, package-resolution, and no-shell-evaluation proofs.
  - Verify: targeted compiled tests pass with public-boundary assertions.
  - Files: `test/security.test.ts`, `test/distribution.test.ts`
  - Depends on: Task 2
  - Size: S

- [ ] **Task 5: Verify and review**
  - Acceptance: 25 tests pass, strict app/test typecheck passes, audit clean,
    exact publish dry-run unchanged, and five-axis review has no required issue.
  - Verify: all commands in the spec plus independent diff review.
  - Files: `specs/typescript-tests/REVIEW.md`, `SHIP.md`
  - Depends on: Tasks 3 and 4
  - Size: M

- [ ] **Task 6: Ship through GitHub**
  - Acceptance: focused PR merges after Node 18/20/22 CI passes.
  - Verify: GitHub checks and post-merge repository language/file inspection.
  - Depends on: Task 5
  - Size: S

## Checkpoints

- [ ] RED observed for intended test-language contract.
- [ ] All tests compile strictly.
- [ ] Full local lifecycle is green.
- [ ] Hosted Node matrix is green before merge.

## Rollback

Revert the PR. This change does not alter the already-published runtime package
or require an npm release; CI and local development return to JavaScript tests.

## Sign-off

- [x] Every task has acceptance and verification.
- [x] Dependencies are ordered.
- [x] No task is XL.
- [x] Requester approved autonomous completion.
