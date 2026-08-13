# Diffwright

[![npm version](https://shieldcn.dev/npm/diffwright.svg?variant=outline)](https://www.npmjs.com/package/diffwright)
[![npm downloads](https://shieldcn.dev/npm/dw/diffwright.svg?variant=outline)](https://www.npmjs.com/package/diffwright)
[![GitHub stars](https://shieldcn.dev/github/stars/AndrewUlloa/diffwright.svg?variant=outline)](https://github.com/AndrewUlloa/diffwright)
[![license](https://shieldcn.dev/npm/license/diffwright.svg?variant=outline)](LICENSE)

Turn code changes into the words that ship them. Diffwright generates
Conventional Commit messages and PR summaries using your own AI provider,
gateway, or local OpenAI-compatible server.

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

Explicitly select a provider and exact model in `.env.local` in the repo where
you run the CLI:

```bash
DIFFWRIGHT_PROVIDER="openrouter"
DIFFWRIGHT_MODEL="anthropic/claude-sonnet-4"
OPENROUTER_API_KEY="your-key-here"
```

Diffwright sends credentials and diffs directly from your machine to the
selected endpoint. It does not operate a proxy, persist keys, silently switch
providers, follow HTTP redirects, or retry a failed request through another
provider.

### Supported provider profiles

| Provider | `DIFFWRIGHT_PROVIDER` | Credential | Status |
|---|---|---|---|
| OpenAI | `openai` | `OPENAI_API_KEY` | `docs-verified` |
| Anthropic compatibility API | `anthropic` | `ANTHROPIC_API_KEY` | `experimental` |
| Google Gemini | `google` | `GEMINI_API_KEY` | `docs-verified` |
| xAI | `xai` | `XAI_API_KEY` | `docs-verified` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | `docs-verified` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `docs-verified` |
| Vercel AI Gateway | `vercel` | `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` | `docs-verified` |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` | `docs-verified` |
| Groq | `groq` | `GROQ_API_KEY` | `docs-verified` |
| Ollama | `ollama` | none | `docs-verified` |
| Compatible endpoint | `custom` | `DIFFWRIGHT_API_KEY` | `user-defined` |

All explicit profiles require `DIFFWRIGHT_MODEL`, except Cerebras and Groq,
which retain their existing GPT-OSS defaults. Anthropic labels its OpenAI SDK
compatibility layer as suitable for testing and comparison rather than a
long-term production integration, so Diffwright marks it `experimental`.

Existing installations remain compatible: with no `DIFFWRIGHT_PROVIDER`, a
`CEREBRAS_API_KEY` still wins over `GROQ_API_KEY` and uses the same default
models. Complete custom or Vercel Gateway configuration has higher priority;
partial configuration fails instead of falling through to another credential.

### Custom and local endpoints

```bash
DIFFWRIGHT_PROVIDER="custom"
DIFFWRIGHT_BASE_URL="https://provider.example/v1"
DIFFWRIGHT_API_KEY="your-key-here"
DIFFWRIGHT_MODEL="provider-model-id"
```

HTTPS is required except for `localhost`, `127.0.0.1`, and `[::1]`. A key may
be omitted only for an HTTP loopback endpoint. Ollama has a convenience preset:

```bash
DIFFWRIGHT_PROVIDER="ollama"
DIFFWRIGHT_MODEL="qwen3:8b"
```

### Vercel AI Gateway

Vercel Gateway always needs Gateway authentication, even when downstream
provider BYOK is configured in Vercel. When both are present,
`AI_GATEWAY_API_KEY` wins over `VERCEL_OIDC_TOKEN`; OIDC is considered only
when `DIFFWRIGHT_PROVIDER=vercel` is explicit.

Diffwright sends one request and does not reroute it, but Vercel may apply its
own routing, retries, or system-credit fallback after receiving that request.
Use Vercel's BYOK key test and provider-attempt observability to confirm that a
downstream provider key was actually used.

If your repo uses `pnpm` or `yarn`, make sure you install `diffwright`
with the same package manager so the correct lockfile is updated (Vercel uses
`frozen-lockfile` by default).

### Setup process (recommended)

1. Install `diffwright` (global or per repo).
2. Add the explicit provider configuration shown above, or retain a legacy
   `CEREBRAS_API_KEY` / `GROQ_API_KEY` setup.
3. Run `diffwright doctor` for an offline configuration check.
4. Optionally run `diffwright doctor --live` to make exactly one minimal model request.
5. Run `npx diffwright init` to add npm scripts.
6. If you plan to use `--create-pr`, install and auth GitHub CLI: `gh auth login`.
7. Run a dry run to validate the Git workflow:
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

### Provider diagnostics

```bash
diffwright doctor
diffwright doctor --live
```

Offline doctor prints only the resolved provider, model, endpoint hostname,
credential variable name, transport, and compatibility status. It never makes
a network request or prints the credential. Live doctor uses the same resolver,
client, request builder, and parser as commit and PR generation.

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
- Provider credentials are stripped from environments inherited by Git hooks,
  GitHub CLI, npm, tests, builds, and formatters.
- Exact configured credential values are redacted from outbound prompts and
  provider responses before Diffwright prints or writes generated text.
- Gateways have their own retention, billing, fallback, and privacy policies;
  review those policies before sending proprietary diffs through a gateway.

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

The test suite is also strict TypeScript. It compiles into the ignored
`.test-dist/` directory before Node's built-in test runner executes it against
the compiled application and packed npm artifact.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The executable remains at `bin/diffwright.js` for npm and ChangeScribe
compatibility; application code lives in `src/` and compiles into `dist/`.
