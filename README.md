# Diffwright

[![npm version](https://shieldcn.dev/npm/diffwright.svg?variant=outline)](https://www.npmjs.com/package/diffwright)
[![npm downloads](https://shieldcn.dev/npm/dw/diffwright.svg?variant=outline)](https://www.npmjs.com/package/diffwright)
[![GitHub stars](https://shieldcn.dev/github/stars/AndrewUlloa/diffwright.svg?variant=outline)](https://github.com/AndrewUlloa/diffwright)
[![license](https://shieldcn.dev/npm/license/diffwright.svg?variant=outline)](LICENSE)

Turn code changes into the words that ship them. Diffwright generates
Conventional Commit messages and PR summaries using Cerebras or Groq.

## Install

Pick the install command that matches your repo's package manager:

```bash
# npm
npm install -g diffwright
# or in a repo
npm install diffwright
```

```bash
# pnpm
pnpm add -g diffwright
# or in a repo
pnpm add diffwright
```

```bash
# yarn
yarn global add diffwright
# or in a repo
yarn add diffwright
```

## Setup

Create a `.env.local` file in the repo where you run the CLI:

```bash
# Pick one (Cerebras is preferred for higher throughput)
CEREBRAS_API_KEY="your-key-here"
# or
GROQ_API_KEY="your-key-here"
```

Provider priority: if both keys are set, Cerebras is used.

If your repo uses `pnpm` or `yarn`, make sure you install `diffwright`
with the same package manager so the correct lockfile is updated (Vercel uses
`frozen-lockfile` by default).

### Setup process (recommended)

1. Install `diffwright` (global or per repo).
2. Add `.env.local` with `CEREBRAS_API_KEY` or `GROQ_API_KEY`.
3. Run `npx diffwright init` to add npm scripts.
4. If you plan to use `--create-pr`, install and auth GitHub CLI: `gh auth login`.
5. Run a dry run to validate:
   - `diffwright commit --dry-run`
   - `diffwright pr --dry-run`

Optional environment variables for PR summaries:

- `PR_SUMMARY_BASE` (default: `main`)
- `PR_SUMMARY_OUT` (default: `.pr-summaries/PR_SUMMARY.md`)
- `PR_SUMMARY_LIMIT` (default: `400`)
- `PR_SUMMARY_ISSUE` (default: empty)
- `DIFFWRIGHT_MODEL` (override model name for any provider)
- `CHANGESCRIBE_MODEL` (legacy alias for `DIFFWRIGHT_MODEL`)
- `GROQ_PR_MODEL` / `GROQ_MODEL` (legacy overrides, still supported)

## Usage

### Init scripts in a repo

```bash
npx diffwright init
```

### Commit message

```bash
diffwright commit --dry-run
diffwright commit
```

### PR summary

```bash
diffwright pr --base main --mode release
diffwright pr --base main --create-pr --mode release
diffwright pr --dry-run
diffwright pr --create-pr --skip-format
```

### Npm script parity aliases

These match the npm scripts in your repo:

```bash
diffwright pr:summary
diffwright feature:pr
diffwright staging:pr
```

## Notes

- `diffwright commit` stages changes if nothing is staged and commits/pushes by default.
- `diffwright pr` can create or update a GitHub PR when `--create-pr` is passed (requires `gh`).
- `feature:pr` and `staging:pr` aliases accept overrides (e.g., `--base main`).
- `--skip-format` (or `--no-format`) skips the format step during `--create-pr`.
- The CLI must be run inside a git repo.

## Branching and CI/CD recommendation

We recommend a simple main/staging/feature flow:

- `feature/*` branches merge into `staging` via PRs (`diffwright feature:pr`).
- `staging` merges into `main` for releases (`diffwright staging:pr`).
- Use `--base main` or `--base staging` to override if your repo differs.

Recommended CI checks on PRs:
- `feature/*` → `staging`: lint/test/build (or your standard checks).
- `staging` → `main`: lint/test/build + any release verification.

## Formatting recommendation

We use Biome via Ultracite. If your project matches our setup, add a `format` script like:

```bash
ultracite format
```

You can also pair it with a lint check:

```bash
ultracite lint || (ultracite format && ultracite lint)
```

## Development

Diffwright is written in strict TypeScript and compiled to CommonJS for
Node.js 18 and newer. The npm package ships compiled JavaScript and source maps,
so consumers do not need TypeScript or a runtime transpiler.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The executable remains at `bin/diffwright.js` for npm and ChangeScribe
compatibility; application code lives in `src/` and compiles into `dist/`.
