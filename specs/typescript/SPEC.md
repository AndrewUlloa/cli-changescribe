# Spec: TypeScript migration

> Filed by: Codex orchestration session
> Status: implemented; release verification in progress
> Last updated: 2026-08-12

## One-line summary

Refactor Diffwright's implementation from untyped CommonJS JavaScript to
strict, compiled TypeScript while preserving the CLI and npm contracts exactly.

## Objective

Diffwright is becoming a multi-provider CLI with configuration, transport, and
credential boundaries that benefit materially from static types. Migrate its
implementation to TypeScript without changing command behavior, requiring a
new runtime, or exposing a new library API.

The requester explicitly approved this refactor and asked for autonomous
completion using red-green TDD on 2026-08-12.

## Assumptions

- Node.js remains the runtime and the minimum supported version remains 18.
- `diffwright` is a CLI-only package; its internal modules are not public APIs.
- The stable executable path `bin/diffwright.js` must remain available because
  `cli-changescribe` requires it directly.
- This refactor preserves behavior. Provider-neutral BYOK follows as a typed
  feature and is not mixed into the migration diff.
- A patch release (`diffwright@0.2.2`) is appropriate because the public CLI
  contract is unchanged and the deprecated bridge already accepts `^0.2.1`.

## Success criteria

1. All application implementation files under `src/` are `.ts` and compile
   with `strict: true`, `noEmitOnError: true`, and no suppression directives.
2. Published execution uses generated CommonJS files under `dist/`; consumers
   do not need TypeScript, `tsx`, `ts-node`, or a build step.
3. `bin/diffwright.js`, its executable mode, command names, aliases, help,
   arguments, output, exit behavior, and Node 18 minimum remain compatible.
4. The npm tarball contains only the stable bin shim, compiled JavaScript,
   source maps, README, LICENSE, and manifest; it excludes TypeScript sources,
   tests, specs, and unrelated worktree content.
5. `npm test`, strict typecheck, build, audit, and diff checks pass with no
   skipped tests.
6. Clean tarball installs prove `diffwright --help`, unknown-command failure,
   and `diffwright init` through `node_modules/.bin`.
7. A clean local bridge package installation resolves the packed Diffwright
   release and proves `changescribe --help` delegates successfully.
8. CI verifies build and tests on Node 18, 20, and 22.
9. Red-green evidence is recorded: migration-contract tests fail against the
   JavaScript package for the intended reason, then pass after implementation.

## Non-goals

- Rewriting Diffwright in Rust or adding native binaries.
- Changing prompt content, provider selection, error messages, or command
  semantics. One security correction replaces shell-parsed Git commands with
  argument arrays while preserving valid-input behavior.
- Adding package `main`, `exports`, declarations, or a supported library API.
- Optimizing startup or lazy-loading command implementations in this change.
- Modifying unrelated untracked `docs/` or `signal/` content.

## Technical contract

- Language: TypeScript 5.x, compiled before publication.
- Runtime: Node.js 18 or newer.
- Module format: CommonJS (`type: commonjs`, TypeScript Node16 resolution).
- Source: `src/*.ts`.
- Output: `dist/*.js` and `dist/*.js.map` with embedded sources.
- Executable: the existing `bin/diffwright.js` shebang shim requires
  `../dist/cli.js`; it must execute both when invoked and when required by the
  ChangeScribe bridge.
- Tests: Node's built-in test runner in JavaScript, aimed at public CLI and
  compiled output rather than TypeScript runtime loaders.
- Tooling: direct development dependencies on TypeScript and Node 18 types.

## Commands

```bash
npm run build
npm run typecheck
npm test
npm pack --dry-run --cache <isolated-cache>
npm audit --omit=dev
git diff --check
```

## Testing strategy

- Characterization tests establish existing CLI behavior before migration.
- A migration-contract test is introduced first and must be observed red.
- Each implementation slice runs build, targeted tests, and the full suite.
- Distribution tests inspect the packed manifest and tarball, then use clean
  temporary installs for public binary behavior.
- The compatibility bridge is tested against the packed artifact rather than
  the repository's source tree.

## Boundaries

**Always:** keep the tree buildable after each slice, retain executable mode,
use strict types at external boundaries, test compiled output, isolate npm
caches used for verification, and preserve unrelated user files.

**Ask first:** change public CLI behavior, require Node newer than 18, expose a
library API, or introduce a runtime dependency.

**Never:** publish TypeScript source as the executable, use `any` or
`@ts-ignore`/`@ts-nocheck` to make the compiler green, commit generated secrets,
or claim Node-version compatibility without CI evidence.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Bin or bridge path breaks | Preserve `bin/diffwright.js` and test both clean binaries |
| npm ships stale/missing output | Build on prepack and assert exact tarball contents |
| Strict conversion changes runtime behavior | Characterization tests plus mechanical, slice-by-slice migration |
| OpenAI SDK types do not expose provider-specific reasoning | Add a narrow local response type, never global `any` |
| Unknown caught values are mishandled | Centralize safe `unknown` message extraction where behavior permits |
| Local Node 20 hides Node 18 issues | Add a Node 18/20/22 GitHub Actions matrix |
| npm cache ownership breaks checks | Use task-specific caches under the temporary directory |

## Open questions

None. Performance optimization and provider-neutral BYOK are separately scoped.

## Sign-off

- [x] Requester approved the refactor and autonomous execution.
- [x] Success criteria are measurable.
- [x] Boundaries are explicit.
- [x] No blocking questions remain.
