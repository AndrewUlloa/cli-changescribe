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

[Quick start](#quick-start) · [Commands](#commands) · [Providers](#providers) · [Security](#security-and-privacy) · [Documentation](#documentation)

```bash
npx diffwright@latest init
```

## Choose your workflow

| You want to… | Preview or inspect | Run it |
|---|---|---|
| Configure a project | `npx diffwright@latest init --dry-run` | `npx diffwright@latest init` |
| Write a Conventional Commit | `diffwright commit --dry-run` | `diffwright commit` |
| Summarize a branch for a PR | `diffwright pr --dry-run` | `diffwright pr` |
| Create or update the GitHub PR | — | `diffwright pr --create-pr` |
| Check provider configuration | `diffwright doctor` | `diffwright doctor --live` |

`commit` commits and pushes by default. Its dry run prevents those two actions,
but it still calls the provider and stages changes if nothing is staged. PR dry run has a
different contract: it does not call the provider or write summaries, but it may
fetch the base branch. See [Command behavior](#command-behavior) before running
Diffwright in automation.

## Requirements

- Node.js 18 or newer
- Commit and PR workflows require a Git repository with at least one commit.
- Commit, PR, and doctor require an AI provider API key or a local
  Ollama/compatible loopback endpoint.
- GitHub CLI (`gh`) authenticated with `gh auth login` only when using
  `--create-pr`

## Quick start

### 1. Run guided setup

From the project you want to configure:

```bash
npx diffwright@latest init
```

When stdin and stdout are an interactive TTY, `init` walks through the provider,
exact model, credential source, feature-branch base, existing lint/typecheck/test/
build gates, and optional Claude Code or Codex guardrails. It detects npm, pnpm,
Yarn, or Bun and whether the repository uses a `staging` branch.

Before changing anything, the wizard shows one redacted preview and asks for
confirmation. It never prints a credential. Declining or pressing Ctrl-C before
confirmation exits without writes or provider calls.

For an external project, confirmed setup pins the exact running Diffwright
version as a local development dependency and updates the detected lockfile;
install lifecycle scripts are disabled. In Diffwright's own validated checkout,
the self-hosted workflow does not create a self-dependency: generated scripts
build and invoke `node ./bin/diffwright.js` directly.

The wizard can add branch-aware, gate-aware package scripts and one managed block
to selected `CLAUDE.md` and/or `AGENTS.md` files. Text outside those marked
blocks and custom package scripts are preserved.

### 2. Configure your provider

The wizard prefers existing configuration. A shell credential can be reused
without copying it. In an interactive TTY, you may instead enter a credential
with no character echo for storage in `.env.local`; Diffwright protects the file
with `.gitignore` before writing the key. Shell values—including explicitly
empty values—override `.env.local`.

You can also choose **Configure later**. The wizard applies only nonsecret
workflow/configuration files, skips doctor, and clearly reports that setup is
incomplete until you add the credential and pass the offline check.

For manual setup, the equivalent configuration is:

```bash
DIFFWRIGHT_PROVIDER="openrouter"
DIFFWRIGHT_MODEL="anthropic/claude-sonnet-4"
OPENROUTER_API_KEY="your-key-here"
```

Use the exact model ID listed by your provider. The
[provider guide](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/providers.md)
links to official key and model pages for every preset.

### 3. Validate and preview

After setup, `init` runs the offline doctor: it resolves and prints the provider,
model, endpoint hostname, and credential source without making a network
request. A live check is a separate opt-in and makes exactly one provider
request.

The wizard prints commands for the detected package manager. For npm projects:

```bash
npm run commit -- --dry-run
npm run feature:pr -- --dry-run
```

Important: a commit dry-run candidate is not reused. Running `diffwright commit`
afterward calls the provider again, so the final text may differ.

### Headless and automation modes

A no-argument, non-TTY `diffwright init` retains the legacy behavior: it only
adds the four generic Diffwright scripts or migrates exact ChangeScribe values.
It does not prompt, install a package, write credentials or agent rules, or run
doctor.

`--yes` never prompts. It uses supplied choices and safe detected defaults, but
it cannot invent a missing credential and does not install agent rules unless
`--agents` names them. `--live` is never implied by `--yes`.

`--dry-run` computes and prints the same redacted setup plan with no installs,
writes, or live provider request. Provider, model, base, agent, and credential-
source flags select deterministic setup without putting any credential in argv.
See the [CLI reference](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/cli-reference.md)
for every combination.

When launched as `npx diffwright@latest`, npm may first download Diffwright to
its own cache. `--dry-run` prevents a dependency install or file write in the
target project; it cannot prevent `npx` from resolving the command itself.

Global installation remains available for personal use, but project scripts
created by guided setup use the exact local pin instead of a global executable:

```bash
npm install -g diffwright
```

## Example output

Commit preview:

```text
$ diffwright commit --dry-run
🔍 Analyzing all code changes...
🤖 Generating commit message with AI (openrouter)...

feat: add provider-neutral routing

- change: resolve one explicit provider profile per invocation
- why: let developers bring their preferred model or gateway
- risk: provider-specific compatibility varies by model
```

PR-ready output:

```text
What issue is this PR related to?
Related: #123

What change does this PR add?
- Reject unknown CLI options before Git or provider side effects
- Link issue 123 with a supported Closes directive

How did you test your change?
Testing: unit, wire, packed-install, and Node version matrix

Anything you want reviewers to scrutinize?
- Argument validation and GitHub CLI boundaries

Other notes reviewers should know (risks + follow-ups)
- Existing valid commands keep their previous behavior
```

## Why Diffwright

| Capability | What it gives you |
|---|---|
| Commit and PR workflows | One CLI turns staged changes into commit text and branch history into review-ready summaries. |
| Bring your own AI | Use a direct provider, a gateway, or a local OpenAI-compatible server. |
| Deterministic routing | One invocation resolves one provider and never silently fails over to another. |
| Local-first configuration | Keys stay in process memory and requests go directly to the resolved endpoint. |
| Guided project setup | Detect package manager, branches, gates, and agent harnesses, then preview before writing. |
| Fail-closed CLI | Unknown options, missing values, and invalid limit/issue/mode values stop before workflow side effects. |
| Legacy compatibility | Existing Cerebras, Groq, and ChangeScribe setups continue to work. |

## Commands

| Command | Behavior |
|---|---|
| `diffwright doctor` | Validate configuration offline; no provider request. |
| `diffwright doctor --live` | Make one minimal request through the production transport. |
| `diffwright commit --dry-run` | Generate and print a candidate; no commit or push. May stage all changes. |
| `diffwright commit` | Generate a validated Conventional Commit, commit it, and push the current branch. |
| `diffwright pr --dry-run` | Fetch when possible, resolve the commit range, and print the plan; no provider call or output write. |
| `diffwright pr` | Generate detailed and PR-ready summaries. |
| `diffwright pr --create-pr` | Run project gates, then create or update the GitHub PR with `gh`. |
| `diffwright init` | Guide an interactive TTY through project setup; preserve legacy script-only behavior in a no-argument non-TTY. |
| `diffwright --version` | Print the exact installed Diffwright version. |

Run `diffwright <command> --help` for focused help. The
[complete CLI reference](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/cli-reference.md)
documents every flag, default, alias, side effect, and exit behavior.

## Command behavior

| Command | Provider requests | Files/index | Network or repository effects |
|---|---:|---|---|
| `doctor` | 0 | none | none |
| `doctor --live` | 1 | none | calls the resolved endpoint |
| `commit --dry-run` | Usually 1; one repair request is possible | Stages all changes if the index is empty | no commit or push |
| `commit` | Usually 1; one repair request is possible | May stage all changes; creates a commit | pushes the current branch |
| `pr --dry-run` | 0 | no summary files | attempts `git fetch -- origin <base>`; falls back to local refs |
| `pr` | Minimum of three provider requests | overwrites the requested file, a sibling `.final.md`, and a temporary backup | attempts to fetch the base |
| `pr --create-pr` | Same multi-pass generation | may run format, always runs the detected package manager's test/build scripts (`npm test` and `npm run build` for npm), then writes summaries | pushes only when creating a new PR; updating an existing PR does not push local commits |
| `init --dry-run` | 0 | none | previews the redacted setup plan; no install or live request |
| no-argument non-TTY `init` | 0 | edits `package.json` only when generic scripts are added or migrated | none |
| guided or `--yes` `init` | 0 by default; 1 only with explicit live consent | may update `package.json`, a lockfile, `.gitignore`, `.env.local`, `CLAUDE.md`, and `AGENTS.md` after interactive confirmation or deterministic `--yes` planning | may install the exact local package; runs offline doctor; live doctor is separately explicit |

PR synthesis uses one first-pass request, one request per 20,000-character
commit chunk, and one final synthesis request. A release-summary fallback can
add one more request. `--create-pr` uses the detected package manager. It runs
`format` only when that script exists unless you skip it; test and build always
run (`npm test` and `npm run build` in an npm project). Those gates can modify
files and run arbitrary project code before Diffwright performs its dirty-tree
check.

The default PR output is `.pr-summaries/PR_SUMMARY.md`; the slim GitHub body is
`.pr-summaries/PR_SUMMARY.final.md`. A separate temporary backup is also
created. Choose `--out` when you need another path.

PR dry-run still resolves provider configuration so it can show the selected
provider and model; it simply does not send a request.

## Providers

Set `DIFFWRIGHT_PROVIDER`, the provider credential, and the exact
`DIFFWRIGHT_MODEL`. Cerebras and Groq retain legacy defaults.

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

`docs-verified` means the adapter matches the provider's documented OpenAI
Chat Completions contract; it does not mean every model was live-tested.
Anthropic describes its compatibility layer as suitable for testing and
comparison rather than a long-term native integration, so it is marked
`experimental`.

### Direct provider

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
configured in Vercel. `AI_GATEWAY_API_KEY` wins over `VERCEL_OIDC_TOKEN`; OIDC
is eligible only when Vercel is explicitly selected. For each model call,
Diffwright sends one outbound request to Vercel and does not retry or reroute
it itself; a PR workflow makes multiple model calls. Vercel may independently
route, retry, or use system-credit fallback. Use Vercel's BYOK key test and
attempt observability to confirm which downstream credential was used.

### Ollama and compatible endpoints

```bash
DIFFWRIGHT_PROVIDER="ollama"
DIFFWRIGHT_MODEL="qwen3:8b"
```

The preset uses `http://localhost:11434/v1`. Custom remote endpoints require
HTTPS and a key; keyless HTTP is allowed only for loopback hosts.

For precedence, legacy configuration, custom URLs, and official provider setup
links, see the [provider guide](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/providers.md).

## Security and privacy

Diffwright sends credentials and diff content directly from your machine to
the resolved endpoint. It does not operate a proxy or credential vault.

- One invocation resolves one provider; Diffwright never fails over to another.
- SDK retries are disabled and HTTP redirects are rejected.
- Provider credentials are removed from environments inherited by Git hooks,
  GitHub CLI, npm, tests, builds, and formatters.
- Exact configured provider-key values are redacted from prompts, responses,
  diagnostics, console output, and generated files.
- Custom remote endpoints require HTTPS; keyless endpoints are loopback-only.

Diffwright does not scan diffs for arbitrary secrets. Review what is staged
before calling a remote provider: any non-provider secret in a diff can still
be sent. Use least-privilege keys and review each provider or gateway's
retention, billing, fallback, and privacy policies.

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/AndrewUlloa/diffwright/security/advisories/new).
Read the [security policy](https://github.com/AndrewUlloa/diffwright/blob/main/SECURITY.md)
before reporting.

## Troubleshooting

- Run `diffwright doctor` first; it is offline and shows which configuration won.
- Use `diffwright doctor --live` for one request and a categorized failure.
- A provider `404` usually means the endpoint or exact model ID is unavailable.
- `429` is a provider quota or rate-limit response, not automatic failover.
- If PR range fetch fails, Diffwright says so and tries local refs.

The [troubleshooting guide](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/troubleshooting.md)
maps every diagnostic category to likely causes and safe information to include
in a bug report.

## Documentation

- [CLI reference](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/cli-reference.md)
- [Provider setup](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/providers.md)
- [Troubleshooting](https://github.com/AndrewUlloa/diffwright/blob/main/documentation/troubleshooting.md)
- [Contributing](https://github.com/AndrewUlloa/diffwright/blob/main/CONTRIBUTING.md)
- [Support](https://github.com/AndrewUlloa/diffwright/blob/main/SUPPORT.md)
- [Security policy](https://github.com/AndrewUlloa/diffwright/blob/main/SECURITY.md)

## Migrating from ChangeScribe

The `cli-changescribe` compatibility package delegates existing commands to
Diffwright. Migrate when convenient:

```bash
npm uninstall -g cli-changescribe
npm install -g diffwright
```

## Development

Diffwright is strict TypeScript compiled to CommonJS for Node.js 18 and newer.

```bash
git clone https://github.com/AndrewUlloa/diffwright.git
cd diffwright
npm ci
npm run typecheck
npm test
```

The source lives in `src/`; `bin/diffwright.js` remains the stable executable
for npm and ChangeScribe compatibility.

## Project

- [Source](https://github.com/AndrewUlloa/diffwright)
- [Issues](https://github.com/AndrewUlloa/diffwright/issues)
- [npm](https://www.npmjs.com/package/diffwright)
- [MIT license](https://github.com/AndrewUlloa/diffwright/blob/main/LICENSE)
