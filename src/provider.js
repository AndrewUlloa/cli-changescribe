const OpenAI = require('openai');

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
function createClient() {
  const cerebrasKey = process.env.CEREBRAS_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (cerebrasKey) {
    return {
      client: new OpenAI({
        apiKey: cerebrasKey,
        baseURL: 'https://api.cerebras.ai/v1',
      }),
      provider: 'cerebras',
      defaultModel: 'gpt-oss-120b',
    };
  }

  if (groqKey) {
    return {
      client: new OpenAI({
        apiKey: groqKey,
        baseURL: 'https://api.groq.com/openai/v1',
      }),
      provider: 'groq',
      defaultModel: 'openai/gpt-oss-120b',
    };
  }

  return null;
}

module.exports = { createClient };
