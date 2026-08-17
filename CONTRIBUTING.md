# Contributing to Diffwright

Thanks for improving Diffwright. Small, focused pull requests with observable
tests are easiest to review.

## Before coding

- Search existing issues and pull requests.
- Open an issue before a large feature, new dependency, provider transport, or
  behavior change.
- For security findings, do not open an issue. Use
  [private GitHub security advisories](https://github.com/AndrewUlloa/diffwright/security/advisories/new).

## Setup

```bash
git clone https://github.com/AndrewUlloa/diffwright.git
cd diffwright
npm ci
```

Diffwright supports Node.js 18, 20, and 22. Source is strict TypeScript under
`src/`; tests are TypeScript under `test/` and use Node's built-in test runner.

## Development flow

1. Add a failing test for a bug or behavioral change.
2. Implement the smallest coherent fix.
3. Keep provider credentials out of fixtures and output.
4. Update command help and documentation when behavior changes.
5. Run the repository gates:

```bash
npm run typecheck
npm test
npm pack --dry-run
npm audit --omit=dev
git diff --check
```

Do not commit `dist/`, `.test-dist/`, `.env.local`, tarballs, provider keys, or
unrelated workspace files. The package build runs during publishing.

## Pull requests

Use Conventional Commit types for both checkpoint commits and the pull-request
title. `feat` adds a user-visible capability; `fix` corrects faulty behavior;
`docs`, `test`, `ci`, and `build` are for changes confined to those domains;
`refactor` preserves supported behavior; and `perf` requires performance
evidence. Use one of the repository's configured scopes only when that one
subsystem clearly dominates. Broad changes remain unscoped.

Explain the reviewer-relevant outcome and account for every substantive area in
the final net diff. List only validation that actually ran, including known
limitations. Link an issue or provide explicit context for behavioral or
substantial work so rationale and risk claims have evidence. Keep refactors
separate from behavior changes when possible. CI must pass on Node.js 18, 20,
and 22.

Small coherent checkpoint commits are welcome on a feature branch. After review
and green checks, maintainers use `npm run pr:merge` to revalidate the live PR
and create one squash commit whose subject is the reviewed Conventional Commit
PR title. Start each feature branch from an up-to-date `main`. Use
`npm run commit` for every shipping commit and push, and use
`npm run feature:pr` to create or update the pull request. Do not bypass these
paths with raw Git mutation, raw PR creation or editing, or `gh pr merge`.

Unless you explicitly state otherwise, intentionally submitted contributions
are provided under the Apache License 2.0 used by this repository, without
additional terms or conditions.

The legacy package under `compat/cli-changescribe` retains the separate license
included in that package directory.
