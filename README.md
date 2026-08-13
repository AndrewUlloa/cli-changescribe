<div align="center">

<h1>Diffwright</h1>

<p><strong>Turn Git diffs into Conventional Commit messages and PR summaries—with your own AI.</strong></p>

<p>Bring OpenAI, Anthropic, Gemini, xAI, DeepSeek, OpenRouter, Vercel AI<br>
Gateway, Cerebras, Groq, Ollama, or any compatible endpoint.</p>

<a href="https://www.npmjs.com/package/diffwright"><img alt="npm version" src="https://shieldcn.dev/npm/diffwright.svg?variant=outline"></a>
<a href="https://www.npmjs.com/package/diffwright"><img alt="npm downloads" src="https://shieldcn.dev/npm/dw/diffwright.svg?variant=outline"></a>
<a href="https://github.com/AndrewUlloa/diffwright"><img alt="GitHub stars" src="https://shieldcn.dev/github/stars/AndrewUlloa/diffwright.svg?variant=outline"></a>
<a href="https://github.com/AndrewUlloa/diffwright/blob/main/LICENSE"><img alt="MIT license" src="https://shieldcn.dev/npm/license/diffwright.svg?variant=outline"></a>

</div>

[Quick start](#quick-start) · [Commands](#commands) · [Providers](#providers) · [Security](#security-and-privacy) · [GitHub](https://github.com/AndrewUlloa/diffwright)

```bash
npm install -g diffwright
```

## Choose your workflow

| You want to… | Preview first | Ship it |
|---|---|---|
| Write a Conventional Commit | `diffwright commit --dry-run` | `diffwright commit` |
| Summarize a branch for a PR | `diffwright pr --dry-run` | `diffwright pr` |
| Create or update the GitHub PR | — | `diffwright pr --create-pr` |
| Check provider configuration | `diffwright doctor` | `diffwright doctor --live` |

> Start with the preview commands. `commit` commits and pushes by default;
> `--dry-run` prevents the commit and push but may stage working-tree changes
> when the index is empty.

## Quick start

### 1. Install

```bash
npm install -g diffwright
```

For a project-local install, use `npm install --save-dev diffwright` and run
commands with `npx diffwright`.

### 2. Bring a provider

Create `.env.local` in the repository where you run Diffwright:

```bash
DIFFWRIGHT_PROVIDER="openrouter"
DIFFWRIGHT_MODEL="anthropic/claude-sonnet-4"
OPENROUTER_API_KEY="your-key-here"
```

### 3. Check before sending a diff

```bash
diffwright doctor
```

Offline doctor validates the resolved provider, model, endpoint, and credential
source without making a network request. Add `--live` when you want one minimal
provider request.

### 4. Preview your first result

```bash
git add src test
diffwright commit --dry-run

# or preview a branch summary without calling the model
diffwright pr --base main --dry-run
```

When the preview looks right:

```bash
diffwright commit
diffwright pr --base main
```

### 5. Add project scripts (optional)

```bash
npx diffwright init
```

This adds Diffwright commands to the current `package.json` without replacing
custom scripts.

## From diff to ship-ready text

```text
$ diffwright doctor
Provider: openrouter
Model: anthropic/claude-sonnet-4
Endpoint: openrouter.ai
Transport: openai-chat-completions
Configuration check: OK (offline)

$ diffwright commit --dry-run
🔍 Analyzing all code changes...
🤖 Generating commit message with AI (openrouter)...

feat: add provider-neutral routing

- change: resolve one explicit provider profile per invocation
- why: let developers bring their preferred model or gateway
- risk: provider-specific compatibility varies by model
```

## Why Diffwright

| Capability | What it gives you |
|---|---|
| Commit and PR workflows | One CLI turns staged changes into commit text and branch history into review-ready summaries. |
| Bring your own AI | Use a direct provider, a gateway, or a local OpenAI-compatible server. |
| Deterministic routing | One invocation resolves one provider and never silently fails over to another. |
| Local-first configuration | Keys stay in process memory and requests go directly to the resolved endpoint. |
| Dry-run and doctor modes | Inspect Git behavior and provider resolution before creating commits or PRs. |
| Legacy compatibility | Existing Cerebras, Groq, and ChangeScribe setups continue to work. |

## Commands

| Command | Behavior |
|---|---|
| `diffwright doctor` | Validate configuration offline; no provider request. |
| `diffwright doctor --live` | Make one minimal request through the production transport. |
| `diffwright commit --dry-run` | Generate and print a commit preview; no commit or push. It stages changes if nothing is staged. |
| `diffwright commit` | Generate a validated Conventional Commit, commit it, and push the current branch. |
| `diffwright pr --dry-run` | Inspect the base, branch, commit count, output, provider, and model without a model call or output write. May fetch the base ref. |
| `diffwright pr` | Generate full and slim PR summaries under `.pr-summaries/` by default. |
| `diffwright pr --create-pr` | Run available format/test/build gates, push the branch, and create or update the GitHub PR with `gh`. |
| `diffwright init` | Add Diffwright npm scripts to the current project. |

Aliases for the generated project scripts:

```bash
diffwright pr:summary
diffwright feature:pr
diffwright staging:pr
```

Use `diffwright --help` for the complete command list.

## Providers

Set `DIFFWRIGHT_PROVIDER`, the provider credential, and the exact
`DIFFWRIGHT_MODEL`. Cerebras and Groq retain their legacy default models.

| Provider | ID | Credential | Status |
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

`docs-verified` means Diffwright's adapter matches the provider's documented
OpenAI Chat Completions contract. It does not mean every model was live-tested.
Anthropic calls its compatibility API suitable for testing and comparison
rather than a long-term native integration, so Diffwright marks it
`experimental`.

### Direct provider example

```bash
DIFFWRIGHT_PROVIDER="openai"
DIFFWRIGHT_MODEL="your-exact-model-id"
OPENAI_API_KEY="your-key-here"
```

### Vercel AI Gateway

```bash
DIFFWRIGHT_PROVIDER="vercel"
DIFFWRIGHT_MODEL="provider/model"
AI_GATEWAY_API_KEY="your-gateway-key"
```

Gateway authentication is required even when downstream provider BYOK is
configured in Vercel. `AI_GATEWAY_API_KEY` wins over `VERCEL_OIDC_TOKEN`;
OIDC is considered only when Vercel is explicitly selected.

Diffwright sends one request and does not reroute it. Vercel may independently
route, retry, or use system-credit fallback after receiving that request. Use
Vercel's BYOK key test and provider-attempt observability to confirm which
downstream credential was used.

### Ollama

```bash
DIFFWRIGHT_PROVIDER="ollama"
DIFFWRIGHT_MODEL="qwen3:8b"
```

The Ollama preset uses `http://localhost:11434/v1` and supplies the fixed dummy
key required by the OpenAI SDK.

### Custom endpoint

```bash
DIFFWRIGHT_PROVIDER="custom"
DIFFWRIGHT_BASE_URL="https://provider.example/v1"
DIFFWRIGHT_API_KEY="your-key-here"
DIFFWRIGHT_MODEL="provider-model-id"
```

Remote custom endpoints require HTTPS and a key. A key may be omitted only for
HTTP loopback endpoints on `localhost`, `127.0.0.1`, or `[::1]`.

### Existing Cerebras and Groq configuration

This remains valid without `DIFFWRIGHT_PROVIDER`:

```bash
CEREBRAS_API_KEY="your-key-here"
# or
GROQ_API_KEY="your-key-here"
```

When both exist, Cerebras wins. Existing `CHANGESCRIBE_MODEL`, `GROQ_MODEL`,
and `GROQ_PR_MODEL` overrides remain supported.

## Security and privacy

Diffwright sends credentials and diff content directly from your machine to
the resolved endpoint. It does not operate a proxy or credential vault.

- One invocation resolves one provider; provider errors never cause
  Diffwright to silently call another provider.
- SDK retries are disabled and cross-origin HTTP redirects are rejected.
- Provider credentials are removed from environments inherited by Git hooks,
  GitHub CLI, npm, tests, builds, and formatters.
- Exact configured provider-key values are redacted from prompts, responses,
  diagnostics, console output, and generated files.
- Custom remote endpoints require HTTPS; keyless endpoints are loopback-only.
- Base branches are validated as Git branch names before Git or GitHub use.

**Important:** Diffwright does not scan diffs for arbitrary secrets. Review
what is staged before calling a remote provider. A database password, private
key, cloud token, or other credential that is not one of the configured AI
provider keys can still be included in the diff sent to that provider.

Add `.env.local` to the target repository's ignore rules, use least-privilege
provider keys, and review the retention, billing, fallback, and privacy policy
of every provider or gateway you select.

## PR summaries and GitHub automation

Common options:

```bash
diffwright pr --base main
diffwright pr --base main --mode release
diffwright pr --base main --out .pr-summaries/feature.md
diffwright pr --base main --create-pr
diffwright pr --base main --create-pr --skip-format
```

Environment defaults:

| Variable | Default |
|---|---|
| `PR_SUMMARY_BASE` | `main` |
| `PR_SUMMARY_OUT` | `.pr-summaries/PR_SUMMARY.md` |
| `PR_SUMMARY_LIMIT` | `400` |
| `PR_SUMMARY_ISSUE` | empty |

`--create-pr` requires the authenticated [GitHub CLI](https://cli.github.com/).
If the current project has a `format` script, Diffwright runs it before the
project's test and build gates. Use `--skip-format` or `--no-format` to opt out.

## Migrating from ChangeScribe

The `cli-changescribe` compatibility package delegates existing commands to
Diffwright. Migrate when convenient:

```bash
npm uninstall -g cli-changescribe
npm install -g diffwright
```

## Development

Diffwright is strict TypeScript compiled to CommonJS for Node.js 18 and newer.
The npm package ships compiled JavaScript and source maps, so consumers do not
need a TypeScript runtime.

```bash
git clone https://github.com/AndrewUlloa/diffwright.git
cd diffwright
npm ci
npm run typecheck
npm test
npm run build
```

The application lives in `src/`; the stable npm executable remains
`bin/diffwright.js` for package and ChangeScribe compatibility.

## Project

- [Source code](https://github.com/AndrewUlloa/diffwright)
- [Issue tracker](https://github.com/AndrewUlloa/diffwright/issues)
- [npm package](https://www.npmjs.com/package/diffwright)
- [MIT license](https://github.com/AndrewUlloa/diffwright/blob/main/LICENSE)
