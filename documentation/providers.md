# Provider setup

Diffwright uses OpenAI Chat Completions-compatible transports. Select a preset
with `DIFFWRIGHT_PROVIDER`, set the exact `DIFFWRIGHT_MODEL`, and provide the
credential listed below. These links point to provider-owned setup and model
documentation.

| Provider | ID | Credential | Official key/auth setup | Official model/API reference |
|---|---|---|---|---|
| OpenAI | `openai` | `OPENAI_API_KEY` | [API keys](https://platform.openai.com/api-keys) | [Models](https://developers.openai.com/api/docs/models) |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | [Authentication](https://platform.claude.com/docs/en/manage-claude/authentication) | [OpenAI SDK compatibility](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk) |
| Google Gemini | `google` | `GEMINI_API_KEY` | [Get an API key](https://ai.google.dev/gemini-api/docs/api-key) | [Models](https://ai.google.dev/gemini-api/docs/models) |
| xAI | `xai` | `XAI_API_KEY` | [Quickstart and API keys](https://docs.x.ai/developers/quickstart) | [Models](https://docs.x.ai/developers/models) |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | [First API call](https://api-docs.deepseek.com/) | [Models and pricing](https://api-docs.deepseek.com/quick_start/pricing) |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | [API keys](https://openrouter.ai/settings/keys) | [Models](https://openrouter.ai/models) |
| Vercel AI Gateway | `vercel` | `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` | [Authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok) | [Models](https://vercel.com/ai-gateway/models) |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` | [Quickstart](https://inference-docs.cerebras.ai/quickstart) | [Models](https://inference-docs.cerebras.ai/introduction) |
| Groq | `groq` | `GROQ_API_KEY` | [API keys](https://console.groq.com/keys) | [Models](https://console.groq.com/docs/models) |
| Ollama | `ollama` | none | [Quickstart](https://docs.ollama.com/quickstart) | [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) |

Anthropic's compatibility API is marked `experimental` because Anthropic
positions it for testing and comparison rather than a long-term native
integration. The other hosted presets are `docs-verified`: their adapters
match published contracts, but every model has not been live-tested.

## Examples

```bash
DIFFWRIGHT_PROVIDER="openai"
DIFFWRIGHT_MODEL="your-exact-model-id"
OPENAI_API_KEY="your-key-here"
```

```bash
DIFFWRIGHT_PROVIDER="ollama"
DIFFWRIGHT_MODEL="qwen3:8b"
```

Run `diffwright doctor` before a workflow. It resolves configuration offline.
Use `diffwright doctor --live` only when you intend to make one provider call.

## Vercel AI Gateway

Vercel Gateway always needs Gateway authentication. A downstream provider key
configured in Vercel does not replace `AI_GATEWAY_API_KEY` or
`VERCEL_OIDC_TOKEN`. When both exist, Diffwright chooses
`AI_GATEWAY_API_KEY`. OIDC is eligible only with explicit
`DIFFWRIGHT_PROVIDER=vercel`.

Diffwright makes one outbound request and disables its own retries and
failover. Vercel may independently route, retry, or use system-credit fallback.
Use Vercel's dashboard BYOK test and attempt observability to determine which
downstream credential was used.

## Custom endpoints

```bash
DIFFWRIGHT_PROVIDER="custom"
DIFFWRIGHT_BASE_URL="https://provider.example/v1"
DIFFWRIGHT_API_KEY="your-key-here"
DIFFWRIGHT_MODEL="provider-model-id"
```

Remote custom endpoints require HTTPS and a key. HTTP without a key is allowed
only on `localhost`, `127.0.0.1`, or IPv6 loopback `[::1]`. URLs containing
credentials, query strings, or fragments are rejected, and redirects are not
followed.

## Legacy implicit configuration

Existing Cerebras and Groq setups remain supported without
`DIFFWRIGHT_PROVIDER`:

```bash
CEREBRAS_API_KEY="your-key-here"
# or
GROQ_API_KEY="your-key-here"
```

Complete custom configuration wins first, followed by complete Vercel Gateway,
then Cerebras, then Groq. Activated but incomplete custom or Gateway
configuration fails closed rather than falling through. When Cerebras and Groq
are both configured, Cerebras wins.

Legacy `CHANGESCRIBE_MODEL`, `GROQ_MODEL`, and `GROQ_PR_MODEL` overrides remain
supported for implicit Cerebras/Groq routing. Explicit presets use
`DIFFWRIGHT_MODEL`, except Cerebras and Groq may use their documented built-in
defaults.

## Credential handling

Diffwright reads `.env.local` at invocation time without modifying
`process.env`; shell variables win. Credentials stay in process memory and are
sent only to the resolved endpoint. Known provider credentials are stripped
from child-process environments and redacted from prompts and generated text.

Add `.env.local` to `.gitignore`. Do not put credentials on the command line,
in committed configuration, or in bug reports.
