# Spec: TypeScript test-suite migration

> Filed by: Codex orchestration session
> Status: implemented
> Last updated: 2026-08-12

## One-line summary

Migrate Diffwright's entire test suite from JavaScript to strict, compiled
TypeScript without changing the shipped package or supported Node versions.

## Objective

The application implementation is TypeScript, but GitHub still reports 27.1%
JavaScript because all seven test files remain JavaScript. Convert those tests
to TypeScript so application and test code share one strict language contract.

The requester explicitly approved this migration on 2026-08-12.

## Assumptions

- Node 18 remains the minimum supported runtime.
- Tests continue to exercise compiled `dist/` output and public executables.
- Node's built-in test runner remains the test framework.
- The npm artifact remains unchanged; tests and test output are not published.
- The two tiny JavaScript executable shims remain for npm and legacy bridge
  compatibility and may still appear in GitHub's language statistics.

## Success criteria

1. Every file under `test/` is `.ts`; no `.js` test remains.
2. Tests compile with TypeScript `strict: true`, `noEmitOnError: true`, and no
   suppression directives or `any` casts.
3. Test JavaScript is emitted to ignored `.test-dist/` before Node executes it.
4. All existing 25 behaviors remain covered with zero skipped tests.
5. `npm run typecheck` checks both application and test TypeScript.
6. `npm test` builds application and tests, then executes compiled tests.
7. `npm publish --dry-run --tag next --json` retains the exact 14-file package
   allowlist and includes neither TypeScript tests nor `.test-dist/`.
8. Hosted CI passes on Node 18, 20, and 22.

## Non-goals

- Converting `bin/diffwright.js` or the ChangeScribe bridge shim.
- Changing application behavior, public commands, test assertions, or prompts.
- Adding `tsx`, `ts-node`, Jest, Vitest, or another test runtime.
- Publishing test code or compiled test output.
- Editing unrelated `docs/`, `signal/`, or `specs/byok/` content.

## Technical contract

- Add `tsconfig.test.json`, extending the application compiler settings but
  using `test/` as `rootDir` and `.test-dist/` as `outDir`.
- Compile tests as CommonJS ES2022 for Node 18.
- Keep runtime imports aimed at `dist/` so tests prove the consumer artifact.
- Add explicit local types at process, JSON, fixture, and fake-client boundaries.
- `clean` removes both generated output directories.
- `build:test` compiles tests; `typecheck` validates both configurations.
- `.test-dist/` is ignored and excluded from the npm `files` allowlist.

## Commands

```bash
npm run build
npm run build:test
npm run typecheck
npm test
npm publish --dry-run --tag next --json
npm audit --omit=dev
git diff --check
```

## Boundaries

**Always:** preserve assertions and fixtures, compile before execution, test the
published boundary, and keep generated test output out of Git and npm.

**Ask first:** add a dependency, change Node support, change product behavior,
or replace Node's test runner.

**Never:** hide JavaScript using Linguist configuration, weaken strictness, add
`any`/TypeScript suppressions, skip tests, or stage unrelated user files.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Compiled tests resolve paths differently | Preserve root-relative layout and test clean package installs |
| Strict typing encourages behavior changes | Convert mechanically and retain all existing assertions |
| Test output leaks into npm | Keep package allowlist and exact tarball assertion |
| Node 20 masks compatibility issues | Require hosted Node 18/20/22 matrix |

## Open questions

None.

## Sign-off

- [x] Requester approved the migration.
- [x] Success criteria are measurable.
- [x] Boundaries are explicit.
- [x] No blocking questions remain.
