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

Optional environment variables for PR summaries:

- `PR_SUMMARY_BASE` (default: `main`)
- `PR_SUMMARY_OUT` (default: `.pr-summaries/PR_SUMMARY.md`)
- `PR_SUMMARY_LIMIT` (default: `400`)
- `PR_SUMMARY_ISSUE` (default: empty)
- `GROQ_PR_MODEL` (default: `openai/gpt-oss-120b`)
- `GROQ_MODEL` (fallback)

## Usage

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
```

## Notes

- `changescribe commit` stages changes if nothing is staged and commits/pushes by default.
- `changescribe pr` can create or update a GitHub PR when `--create-pr` is passed (requires `gh`).
- The CLI must be run inside a git repo.
