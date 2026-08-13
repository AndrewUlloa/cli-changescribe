# Review: TypeScript test-suite migration

> Reviewer: Codex
> Change: `main..refactor/typescript-tests`
> Spec: `specs/typescript-tests/SPEC.md`
> Plan: `specs/typescript-tests/PLAN.md`
> Date: 2026-08-12

## Outcome

Approved for hosted CI. The seven JavaScript test files are now strict
TypeScript compiled before Node executes them. All existing behavioral
assertions remain, and one new contract test proves the test-language boundary.

## Five-axis review

### Correctness

- All 25 pre-existing tests still pass; the new migration contract raises the
  total to 26.
- Compiled tests retain the same root-relative paths and continue to exercise
  `dist/`, public bins, temporary Git repositories, and packed artifacts.
- The publish lifecycle still builds application output after cleaning test
  output, so the package cannot depend on `.test-dist/`.
- Required findings: none.

### Readability and simplicity

- Boundary interfaces describe fixture manifests, pack metadata, fake clients,
  CLI runners, and subprocess inputs without shared abstraction overhead.
- Node's existing runner and TypeScript compiler remain the only test tools.
- Required findings: none.

### Architecture

- `tsconfig.test.json` extends the production contract but isolates source and
  output directories.
- Tests still target compiled/public boundaries rather than importing private
  application source for convenience.
- No runtime dependency, package export, or npm file-list change was added.
- Required findings: none.

### Security

- No secrets or new network inputs were introduced.
- Shell-injection regressions retain real Git/process coverage.
- No `any`, `as any`, or TypeScript suppression directive exists in source or
  tests.
- Required findings: none.

### Performance

- Test compilation adds one small `tsc` pass and no production startup or
  package-size cost.
- Generated tests are removed before prepack and excluded by the npm allowlist.
- Required findings: none.

## TDD and verification evidence

- RED: the new contract failed because `tsconfig.test.json` did not exist; the
  subsequent strict compile surfaced 39 intended test-boundary type errors.
- GREEN: `npm run typecheck` passes both compiler configurations.
- GREEN: `npm test` reports 26 pass, 0 fail, 0 skip.
- GREEN: `npm publish --dry-run --tag next --json` runs the full lifecycle and
  reports the unchanged 14-file package allowlist.
- GREEN: `npm audit --omit=dev` reports 0 vulnerabilities.
- GREEN: `git diff --check` reports no whitespace errors.

## Review finding resolved

- A shell glob was not portable to Windows, while passing the compiled
  directory directly behaved inconsistently between Node 20 and Node 22. A
  strict TypeScript launcher now enumerates compiled `*.test.js` files and
  passes them to `node --test` as an argument array. The launcher fails closed
  when no tests are found and introduces no dependency or shell parsing.

## Verdict

Approved. Hosted Node 18/20/22 checks remain the merge gate.
