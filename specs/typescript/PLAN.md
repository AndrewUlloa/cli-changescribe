# Plan: TypeScript migration

> Derived from: `specs/typescript/SPEC.md`
> Status: approved and in progress
> Last updated: 2026-08-12

## Architecture decisions

- Preserve a tiny executable CommonJS shim at `bin/diffwright.js` and compile
  all implementation into `dist/`. This keeps the npm and ChangeScribe paths
  stable while making TypeScript purely a development concern.
- Keep tests on Node's built-in runner and execute compiled output. A TypeScript
  test runtime would add overhead without improving the public-package proof.
- Do not emit declarations or define `main`/`exports`; Diffwright has no public
  library contract today.
- Publish a behavior-preserving patch release before adding BYOK.

## Dependency graph

```text
[characterization + RED contract tests]
                  │
                  ▼
       [toolchain + init/provider]
                  │
                  ▼
        [commit + PR workflows]
                  │
                  ▼
       [CLI shim + package switch]
                  │
                  ▼
      [pack/install/bridge E2E + CI]
                  │
                  ▼
          [review + release]
```

## Task list

### Phase 1: Contract and RED

- [ ] **Task 1: Characterize public CLI behavior**
  - Acceptance: help, unknown command, init behavior, aliases, executable path,
    and bridge path are covered without relying on source imports.
  - Verify: `npm test` remains green before migration assertions are enabled.
  - Files: `test/branding.test.js`, `test/compatibility-bridge.test.js`
  - Size: S

- [ ] **Task 2: Add the failing TypeScript/package contract**
  - Acceptance: tests demand strict tsconfig, `.ts` source, build/typecheck
    scripts, compiled package contents, and stable shim behavior.
  - Verify: targeted test fails against the current JavaScript package for the
    expected missing TypeScript contract—not syntax or fixture errors.
  - Files: `test/typescript-migration.test.js`
  - Depends on: Task 1
  - Size: S

### Checkpoint: RED

- [ ] Existing characterization tests green.
- [ ] New migration test observed red with intended assertions.

### Phase 2: GREEN compilation slices

- [ ] **Task 3: Add strict compiler and package plumbing**
  - Acceptance: TypeScript/Node types are direct dev dependencies; build,
    typecheck, test, and prepack scripts exist; output is CommonJS in `dist/`.
  - Verify: `npm run typecheck`; `npm run build`.
  - Files: `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`
  - Depends on: Task 2
  - Size: M

- [ ] **Task 4: Migrate leaf modules**
  - Acceptance: provider and init are strict TypeScript; init behavior remains
    black-box compatible.
  - Verify: `npm run build`; targeted init/provider tests.
  - Files: `src/provider.ts`, `src/init.ts`, related tests
  - Depends on: Task 3
  - Size: M

- [ ] **Task 5: Migrate commit workflow**
  - Acceptance: commit analysis, prompt/response domain values, completion
    parsing, and errors have explicit types without suppression.
  - Verify: `npm run typecheck`; commit characterization tests.
  - Files: `src/commit.ts`, related tests
  - Depends on: Task 4
  - Size: M

- [ ] **Task 6: Migrate PR workflow**
  - Acceptance: arguments, commit records, GitHub JSON, prompt messages, and
    completion results compile strictly with behavior unchanged.
  - Verify: `npm run typecheck`; PR characterization tests.
  - Files: `src/pr-summary.ts`, related tests
  - Depends on: Task 4
  - Size: M

- [ ] **Task 7: Switch command routing and distribution**
  - Acceptance: `src/cli.ts` owns routing; bin shim loads `dist/cli.js`; package
    publishes bin/dist only; migration contract becomes green.
  - Verify: `npm test`; CLI help/unknown/init through the shim.
  - Files: `src/cli.ts`, `bin/diffwright.js`, `package.json`, tests
  - Depends on: Tasks 5 and 6
  - Size: M

### Checkpoint: GREEN

- [ ] Strict build and full suite pass.
- [ ] No `.js` implementation remains in `src/`.
- [ ] No TypeScript suppression directive exists.

### Phase 3: Distribution, review, and release

- [ ] **Task 8: Add CI version matrix**
  - Acceptance: GitHub Actions installs, typechecks, builds, and tests on Node
    18, 20, and 22.
  - Verify: workflow syntax review and green hosted checks after push.
  - Files: `.github/workflows/ci.yml`
  - Depends on: Task 7
  - Size: S

- [ ] **Task 9: Prove clean package and bridge installations**
  - Acceptance: exact tarball allowlist; clean `diffwright` help/unknown/init;
    clean local bridge install and `changescribe --help` delegation.
  - Verify: automated E2E test and manual independent temporary install.
  - Files: `test/distribution.test.js`, bridge fixture as needed
  - Depends on: Task 7
  - Size: M

- [ ] **Task 10: Review and document**
  - Acceptance: five-axis review has no unresolved required finding; README
    describes TypeScript development commands; rollback/launch note is ready.
  - Verify: `npm test`, `npm run typecheck`, `npm pack --dry-run`, audit, diff.
  - Files: `README.md`, `specs/typescript/REVIEW.md`, `specs/typescript/SHIP.md`
  - Depends on: Tasks 8 and 9
  - Size: M

- [ ] **Task 11: Publish and verify**
  - Acceptance: focused PR merged; `diffwright@0.2.2` published; registry clean
    install passes; old ChangeScribe bridge still resolves and delegates.
  - Verify: registry metadata, tarball integrity, public clean-install smoke.
  - Depends on: Task 10
  - Size: M

## Parallelization

- Architecture, test contract, and npm distribution review were parallelized.
- Production edits are sequential because all modules share one compiler and
  package boundary.
- Final review is independent from implementation.

## Rollback

If the release fails public verification, restore npm's `latest` tag to
`diffwright@0.2.1`. Do not unpublish either version. The ChangeScribe range
continues to accept both patch versions, so no bridge release is required.

## Sign-off

- [x] Every task has acceptance and verification.
- [x] Dependencies are ordered.
- [x] No task is XL.
- [x] Requester approved autonomous completion.

