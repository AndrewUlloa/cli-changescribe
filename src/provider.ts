import OpenAI from 'openai';

export type ProviderId = 'cerebras' | 'groq';

export interface ProviderInfo {
  client: OpenAI;
  provider: ProviderId;
  defaultModel: string;
}

export type OpenAIClientOptions = ConstructorParameters<typeof OpenAI>[0];
export type OpenAIClientFactory = (options: OpenAIClientOptions) => OpenAI;

const defaultClientFactory: OpenAIClientFactory = (options) =>
  new OpenAI(options);

/**
 * Create an LLM client that works with Cerebras or Groq.
 *
 * Priority:
 *   1. CEREBRAS_API_KEY → Cerebras (64K TPM, 1M TPD)
 *   2. GROQ_API_KEY     → Groq (fallback)
 *
 * Both providers expose an OpenAI-compatible API so we use the
 * `openai` SDK for both, swapping only baseURL and model name.
 */
export function createClient(
  env: NodeJS.ProcessEnv = process.env,
  clientFactory: OpenAIClientFactory = defaultClientFactory,
): ProviderInfo | null {
  const cerebrasKey = env.CEREBRAS_API_KEY;
  const groqKey = env.GROQ_API_KEY;

  if (cerebrasKey) {
    return {
      client: clientFactory({
        apiKey: cerebrasKey,
        baseURL: 'https://api.cerebras.ai/v1',
      }),
      provider: 'cerebras',
      defaultModel: 'gpt-oss-120b',
    };
  }

  if (groqKey) {
    return {
      client: clientFactory({
        apiKey: groqKey,
        baseURL: 'https://api.groq.com/openai/v1',
      }),
      provider: 'groq',
      defaultModel: 'openai/gpt-oss-120b',
    };
  }

  return null;
}
