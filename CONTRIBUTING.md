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

Explain the user-visible outcome, test evidence, security/privacy effect, and
compatibility implications. Keep refactors separate from behavior changes when
possible. CI must pass on Node.js 18, 20, and 22.

Unless you explicitly state otherwise, intentionally submitted contributions
are provided under the Apache License 2.0 used by this repository, without
additional terms or conditions.

The legacy package under `compat/cli-changescribe` retains the separate license
included in that package directory.
