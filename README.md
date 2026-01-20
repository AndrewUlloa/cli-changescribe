# changescribe

CLI to generate Conventional Commit messages and PR summaries using Groq.

## Install

```bash
npm install -g cli-changescribe
```

## Setup

Create a `.env.local` file in the repo where you run the CLI:

```bash
GROQ_API_KEY="your-key-here"
```

### Setup process (recommended)

1. Install `cli-changescribe` (global or per repo).
2. Add `.env.local` with `GROQ_API_KEY`.
3. Run `npx changescribe init` to add npm scripts.
4. If you plan to use `--create-pr`, install and auth GitHub CLI: `gh auth login`.
5. Run a dry run to validate:
   - `changescribe commit --dry-run`
   - `changescribe pr --dry-run`

Optional environment variables for PR summaries:

- `PR_SUMMARY_BASE` (default: `main`)
- `PR_SUMMARY_OUT` (default: `.pr-summaries/PR_SUMMARY.md`)
- `PR_SUMMARY_LIMIT` (default: `400`)
- `PR_SUMMARY_ISSUE` (default: empty)
- `GROQ_PR_MODEL` (default: `openai/gpt-oss-120b`)
- `GROQ_MODEL` (fallback)

## Usage

### Init scripts in a repo

```bash
npx changescribe init
```

### Commit message

```bash
changescribe commit --dry-run
changescribe commit
```

### PR summary

```bash
changescribe pr --base main --mode release
changescribe pr --base main --create-pr --mode release
changescribe pr --dry-run
changescribe pr --create-pr --skip-format
```

### Npm script parity aliases

These match the npm scripts in your repo:

```bash
changescribe pr:summary
changescribe feature:pr
changescribe staging:pr
```

## Notes

- `changescribe commit` stages changes if nothing is staged and commits/pushes by default.
- `changescribe pr` can create or update a GitHub PR when `--create-pr` is passed (requires `gh`).
- `feature:pr` and `staging:pr` aliases accept overrides (e.g., `--base main`).
- `--skip-format` (or `--no-format`) skips the format step during `--create-pr`.
- The CLI must be run inside a git repo.

## Branching and CI/CD recommendation

We recommend a simple main/staging/feature flow:

- `feature/*` branches merge into `staging` via PRs (`changescribe feature:pr`).
- `staging` merges into `main` for releases (`changescribe staging:pr`).
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
