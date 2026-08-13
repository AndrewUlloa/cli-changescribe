# Spec: Provider-neutral BYOK

> Status: approved for implementation
> Approved: 2026-08-13

## One-line summary

Let Diffwright users select a direct OpenAI-compatible provider, gateway, or
local server with their own credentials, without sending keys or diffs through
a Diffwright service.

## Product contract

Diffwright resolves exactly one provider profile for an invocation and sends
OpenAI Chat Completions requests directly from the local CLI to that profile's
endpoint. It does not host a proxy, persist credentials, silently fail over, or
switch transports based on a model name.

This borrows Cursor's approachable separation of provider, credential, and
model while avoiding failure modes documented in Cursor's current BYOK design:
a global base-URL override, mixed hosted/BYOK routing, opaque attribution, and
Chat Completions/Responses mismatches.

## Scope

### First-class profiles

| Provider ID | Credential | Base URL | Output token field | Verification status |
|---|---|---|---|---|
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` | `max_completion_tokens` | `docs-verified`; model capabilities vary |
| `anthropic` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com/v1` | `max_tokens` | `experimental`; Anthropic does not recommend its compatibility layer for long-term production use |
| `google` | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta/openai/` | omitted initially | `docs-verified` for text chat |
| `xai` | `XAI_API_KEY` | `https://api.x.ai/v1` | `max_tokens` | `docs-verified`; Chat Completions is a legacy xAI surface |
| `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com` | `max_tokens` | `docs-verified` |
| `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` | `max_completion_tokens` | `docs-verified`; downstream model capabilities vary |
| `vercel` | `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` | `https://ai-gateway.vercel.sh/v1` | `max_tokens` | `docs-verified`; Gateway authentication is still required when provider BYOK is configured in Vercel |
| `cerebras` | `CEREBRAS_API_KEY` | `https://api.cerebras.ai/v1` | `max_completion_tokens` | `docs-verified`; legacy default model retained |
| `groq` | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` | `max_completion_tokens` | `docs-verified`; legacy default model retained |
| `ollama` | none | `http://localhost:11434/v1` | `max_tokens` | `docs-verified` locally; Diffwright supplies the SDK's ignored dummy key |
| `custom` | `DIFFWRIGHT_API_KEY` | `DIFFWRIGHT_BASE_URL` | omitted initially | `user-defined`; escape hatch for compatible gateways and local servers |

Mistral is not advertised as a first-class preset in this release. Its API is
OpenAI-shaped, but its official documentation does not promise drop-in OpenAI
SDK compatibility. vLLM, LM Studio, and llama.cpp remain documented custom
endpoint examples until they have their own live contract tests.

## Configuration

### Recommended explicit selection

```bash
DIFFWRIGHT_PROVIDER="openrouter"
DIFFWRIGHT_MODEL="anthropic/claude-sonnet-4"
OPENROUTER_API_KEY="..."
```

`DIFFWRIGHT_PROVIDER` is authoritative. Diffwright validates that profile's
required model and credential before any network request. With the exception
of existing Cerebras and Groq defaults, presets require `DIFFWRIGHT_MODEL` so
Diffwright never guesses a changing model ID. An unknown non-empty provider ID
fails with the supported IDs. Explicit selection ignores credentials belonging
to every other profile.

### Custom endpoint

```bash
DIFFWRIGHT_PROVIDER="custom"
DIFFWRIGHT_BASE_URL="https://provider.example/v1"
DIFFWRIGHT_API_KEY="..."
DIFFWRIGHT_MODEL="provider-model-id"
```

The key may be omitted only for an HTTP loopback endpoint. Diffwright parses
the URL with `new URL`, rejects credentials, query strings, fragments,
unsupported protocols, empty hosts, and non-loopback HTTP. The only normalized
loopback hostnames are `localhost`, `127.0.0.1`, and `::1`. A keyless loopback
profile receives a fixed, non-secret dummy key solely because the OpenAI SDK
requires a non-empty value. Non-loopback endpoints require HTTPS and a key.

### Vercel AI Gateway

```bash
DIFFWRIGHT_PROVIDER="vercel"
DIFFWRIGHT_MODEL="provider/model"
AI_GATEWAY_API_KEY="..."
```

`VERCEL_OIDC_TOKEN` is accepted only when `DIFFWRIGHT_PROVIDER=vercel` is
explicit. An ambient Vercel CLI token must not unexpectedly outrank a direct
Cerebras or Groq configuration. When both supported Vercel credentials exist,
`AI_GATEWAY_API_KEY` wins deterministically over `VERCEL_OIDC_TOKEN`.

Diffwright makes exactly one outbound request to Vercel and never implements
its own retry or fallback. Vercel AI Gateway may independently route, retry,
or fall back from a configured provider BYOK credential to system credentials
under Vercel's current policy. A successful doctor request therefore proves
Gateway authentication and response compatibility, but not that Vercel used
the configured downstream provider key. Users must confirm that with Vercel's
BYOK key test and provider-attempt observability.

### Backward-compatible implicit selection

When `DIFFWRIGHT_PROVIDER` is absent, profile activation and resolution
preserve existing installs:

1. Complete custom config: `DIFFWRIGHT_BASE_URL`, `DIFFWRIGHT_MODEL`, and an
   API key unless the URL is loopback.
2. `AI_GATEWAY_API_KEY` plus `DIFFWRIGHT_MODEL`.
3. `CEREBRAS_API_KEY`.
4. `GROQ_API_KEY`.

The presence of `DIFFWRIGHT_BASE_URL` or `DIFFWRIGHT_API_KEY` activates implicit
custom configuration, and `AI_GATEWAY_API_KEY` activates implicit Vercel
configuration. The highest-priority activated profile is validated even when
incomplete; missing values cause a configuration error and never fall through.
`VERCEL_OIDC_TOKEN` alone does not activate Vercel.

`DIFFWRIGHT_MODEL` alone remains a model override and does not activate custom
mode. For implicitly selected Cerebras and Groq, the exact legacy model order
is preserved:

| Command | Model precedence |
|---|---|
| `commit` | `DIFFWRIGHT_MODEL` → `CHANGESCRIBE_MODEL` → `GROQ_MODEL` → provider default |
| `pr` | `DIFFWRIGHT_MODEL` → `CHANGESCRIBE_MODEL` → `GROQ_PR_MODEL` → `GROQ_MODEL` → provider default |

This legacy order applies even when Cerebras wins provider selection. Explicit
profiles consider only `DIFFWRIGHT_MODEL`, except explicit Cerebras and Groq
may use their retained provider defaults.

## Request behavior

- The only transport in this release is OpenAI Chat Completions.
- Provider profiles own base URL, credential source, output-token field,
  default headers, compatibility status, and optional request extras.
- Resolution returns a frozen public profile separately from a private
  credential object. The public profile contains provider ID, model, base URL,
  credential environment-variable name, transport, compatibility status, and
  request policy. The private object contains credential value and source
  (`shell`, `.env.local`, or `dummy`). Only the client factory receives the
  value; diagnostics and errors receive only a derived public view.
- Shared code owns message/model construction and response parsing.
- `temperature` and `reasoning_effort` are omitted unless a profile and model
  combination is documented to support them. The existing Groq GPT-OSS default
  may retain `reasoning_effort=high`; arbitrary Groq models may not.
- A custom profile starts with the smallest portable payload: `model` and
  `messages`. Diffwright does not guess provider-specific fields.
- A provider error never triggers automatic rerouting or a second billable
  request to another provider.
- The shared OpenAI client uses `maxRetries: 0` and a 120-second timeout. One
  transport invocation therefore makes at most one outbound HTTP attempt from
  Diffwright. Commit-format repair is a separate intentional request, and PR
  synthesis stages remain separately visible requests. Third-party gateways
  may perform their own routing, retries, and fallbacks after receiving that
  request.
- HTTP redirects are rejected so a diff body cannot be forwarded by the local
  client to an origin other than the resolved endpoint.

## Diagnostics

Add `diffwright doctor`:

- Offline by default: resolve and validate configuration, then print provider,
  model, endpoint hostname, credential environment-variable name, transport,
  and compatibility status. Never print the credential value or an
  Authorization header.
- `diffwright doctor --live`: make one minimal Chat Completions request through
  the same resolver, client factory, request builder, and parser used by
  `commit` and `pr`. Its fixed prompt requests exactly `OK`; it applies a small
  output cap only when the selected profile documents a token field.
- Classify DNS/TLS failures, 401/403 authentication, 404 endpoint/model, 429
  quota/rate limiting, incompatible response bodies, and provider 5xx errors.
- Sanitize all errors through one allowlisted formatter and redact known secret
  values and bearer-token patterns.

## Credential handling

- Resolve `.env.local` from the invocation working directory into a private
  runtime configuration object without mutating `process.env`.
- Shell variables, including explicitly empty values, override `.env.local`,
  matching dotenv's current behavior.
- Keep keys in process memory only and send a key only to the resolved endpoint.
- Remove `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`,
  `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`,
  `VERCEL_OIDC_TOKEN`, `CEREBRAS_API_KEY`, `GROQ_API_KEY`, and
  `DIFFWRIGHT_API_KEY` from the environment inherited by child processes.
- Route every `execSync`, `spawnSync`, Git commit/hook, GitHub CLI, npm, test,
  build, and formatter launch through one sanitized environment helper.
- Never persist, upload, print, or include keys in generated files or tests.
- Document that gateways proxy requests and have their own retention, billing,
  fallback, and privacy policies.
- Resolver and transport helpers throw typed errors; only command boundaries
  set exit code 1. Error output allowlists category, status, provider, endpoint
  hostname, request ID, and a bounded provider message. It redacts every known
  credential value and bearer-token pattern from message, cause, and body and
  never serializes request config, arbitrary headers, or the private
  credential object.

## Success criteria

1. Explicit profiles resolve deterministically and never silently reroute.
2. Existing Cerebras-only and Groq-only `.env.local` files keep working with
   the same priority and default models.
3. Cerebras and Groq use their current `max_completion_tokens` field.
4. Commit, PR, and doctor calls share one resolver, request builder, client
   factory, response parser, and safe error path.
5. Wire-level tests use a local HTTP server to assert the resolved base path
   plus `/chat/completions` (for example `/v1/chat/completions`), authorization
   behavior, request body, model, response parsing, and secret redaction.
6. Resolution tests cover every preset, legacy precedence, partial configs,
   ambient OIDC behavior, loopback rules, and model overrides.
7. README and CLI help use the fixed statuses `docs-verified`, `experimental`,
   `live-verified`, and `user-defined`. Only a real provider smoke test can
   promote an integration to `live-verified`; a mock server cannot.
8. `diffwright doctor --live` proves auth, endpoint, model, request shape, and
   response parsing when the user supplies a provider key.

## Non-goals

- A hosted Diffwright proxy, credential vault, billing layer, or provider
  failover service.
- Native Anthropic Messages, OpenAI Responses, Bedrock, or Vertex transports.
- Vercel request-scoped provider credentials via `providerOptions`.
- A universal model catalog, model benchmark, or automatic model selection.
- Claiming a provider is live-verified when only its official contract and a
  local wire simulation have been tested.

## Verification and release gates

- Provider-resolution unit tests with dummy values only.
- Wire-level local-server tests for Chat Completions and redaction.
- Tests for partial Gateway activation, ambient OIDC, unknown and explicit
  provider behavior, legacy commit/PR model precedence, every URL rule,
  keyless loopback auth, one-attempt retry behavior, timeouts, typed errors,
  sanitized `execSync`/`spawnSync` environments, and zero-network offline
  doctor behavior.
- Existing branding and compatibility tests remain green.
- One live smoke test for each credential available to the maintainer, run via
  `diffwright doctor --live`; unavailable providers remain docs-verified.
- A clean compatibility-bridge install resolves the matching Diffwright minor.
- `npm test`
- `npm pack --dry-run`
- `npm audit --omit=dev`
- `git diff --check`

The repository currently defines no additional build/lint script or GitHub
Actions workflow, so those are the complete discovered project gates.

## Approval

The requester approved continuation of the provider-neutral BYOK goal on
2026-08-13. This provider list, explicit `DIFFWRIGHT_PROVIDER` contract,
direct Chat Completions transport, and `doctor --live` behavior are approved
for implementation.

## Primary references

- Cursor API keys: https://cursor.com/help/models-and-usage/api-keys
- OpenAI Chat Completions: https://platform.openai.com/docs/api-reference/chat
- Anthropic OpenAI SDK compatibility: https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk
- Google Gemini OpenAI compatibility: https://ai.google.dev/gemini-api/docs/openai
- xAI inference API: https://docs.x.ai/developers/rest-api-reference/inference
- DeepSeek API: https://api-docs.deepseek.com/
- OpenRouter quickstart: https://openrouter.ai/docs/quickstart
- Vercel AI Gateway SDKs/APIs: https://vercel.com/docs/ai-gateway/sdks-and-apis
- Vercel BYOK: https://vercel.com/docs/ai-gateway/authentication-and-byok/byok
- Cerebras Chat Completions: https://inference-docs.cerebras.ai/api-reference/chat-completions
- Groq OpenAI compatibility: https://console.groq.com/docs/openai
- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility
