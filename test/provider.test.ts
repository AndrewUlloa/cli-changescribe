import assert from 'node:assert/strict';
import test from 'node:test';

type CommandPurpose = 'commit' | 'pr' | 'doctor';
type CredentialSource = 'shell' | '.env.local' | 'dummy';

interface PublicProviderProfile {
  id: string;
  baseURL: string;
  model: string;
  credentialEnv: string | null;
  transport: 'openai-chat-completions';
  status: 'docs-verified' | 'experimental' | 'user-defined';
  outputTokenField: 'max_tokens' | 'max_completion_tokens' | null;
  reasoningEffort?: 'high';
}

interface ResolvedProvider {
  profile: Readonly<PublicProviderProfile>;
  credential: Readonly<{
    value: string;
    source: CredentialSource;
  }>;
}

interface ProviderModule {
  SUPPORTED_PROVIDER_IDS: readonly string[];
  ProviderConfigError: new (...args: never[]) => Error;
  resolveProvider(options: {
    env: NodeJS.ProcessEnv;
    sources?: Readonly<Record<string, 'shell' | '.env.local'>>;
    command: CommandPurpose;
  }): ResolvedProvider | null;
}

const provider: ProviderModule = require('../dist/provider.js');

const cases = [
  ['openai', 'OPENAI_API_KEY', 'https://api.openai.com/v1', 'max_completion_tokens', 'docs-verified'],
  ['anthropic', 'ANTHROPIC_API_KEY', 'https://api.anthropic.com/v1', 'max_tokens', 'experimental'],
  ['google', 'GEMINI_API_KEY', 'https://generativelanguage.googleapis.com/v1beta/openai', null, 'docs-verified'],
  ['xai', 'XAI_API_KEY', 'https://api.x.ai/v1', 'max_tokens', 'docs-verified'],
  ['deepseek', 'DEEPSEEK_API_KEY', 'https://api.deepseek.com', 'max_tokens', 'docs-verified'],
  ['openrouter', 'OPENROUTER_API_KEY', 'https://openrouter.ai/api/v1', 'max_completion_tokens', 'docs-verified'],
  ['vercel', 'AI_GATEWAY_API_KEY', 'https://ai-gateway.vercel.sh/v1', 'max_tokens', 'docs-verified'],
  ['cerebras', 'CEREBRAS_API_KEY', 'https://api.cerebras.ai/v1', 'max_completion_tokens', 'docs-verified'],
  ['groq', 'GROQ_API_KEY', 'https://api.groq.com/openai/v1', 'max_completion_tokens', 'docs-verified'],
] as const;

for (const [id, keyName, baseURL, tokenField, status] of cases) {
  test(`resolves explicit ${id} profile exactly`, () => {
    const secret = `${id}-secret`;
    const resolved = provider.resolveProvider({
      env: {
        DIFFWRIGHT_PROVIDER: id,
        DIFFWRIGHT_MODEL: `${id}-model`,
        CEREBRAS_API_KEY: 'unrelated-cerebras-key',
        GROQ_API_KEY: 'unrelated-groq-key',
        [keyName]: secret,
      },
      sources: { [keyName]: 'shell' },
      command: 'doctor',
    });

    assert.ok(resolved);
    assert.deepEqual(resolved.profile, {
      id,
      baseURL,
      model: `${id}-model`,
      credentialEnv: keyName,
      transport: 'openai-chat-completions',
      status,
      outputTokenField: tokenField,
      ...(id === 'google'
        ? { defaultHeaders: { 'x-goog-api-client': 'diffwright/0.3.0' } }
        : {}),
    });
    assert.deepEqual(resolved.credential, { value: secret, source: 'shell' });
    assert.equal(Object.isFrozen(resolved.profile), true);
    assert.equal(JSON.stringify(resolved.profile).includes(secret), false);
  });
}

test('explicit Cerebras and Groq retain defaults while other profiles require a model', () => {
  assert.equal(
    provider.resolveProvider({
      env: { DIFFWRIGHT_PROVIDER: 'cerebras', CEREBRAS_API_KEY: 'key' },
      command: 'commit',
    })?.profile.model,
    'gpt-oss-120b',
  );
  assert.equal(
    provider.resolveProvider({
      env: { DIFFWRIGHT_PROVIDER: 'groq', GROQ_API_KEY: 'key' },
      command: 'commit',
    })?.profile.model,
    'openai/gpt-oss-120b',
  );
  assert.throws(
    () =>
      provider.resolveProvider({
        env: { DIFFWRIGHT_PROVIDER: 'openai', OPENAI_API_KEY: 'key' },
        command: 'commit',
      }),
    /DIFFWRIGHT_MODEL/,
  );
});

test('resolves Ollama without a real credential', () => {
  const resolved = provider.resolveProvider({
    env: { DIFFWRIGHT_PROVIDER: 'ollama', DIFFWRIGHT_MODEL: 'qwen3:8b' },
    command: 'doctor',
  });

  assert.ok(resolved);
  assert.deepEqual(resolved.profile, {
    id: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    model: 'qwen3:8b',
    credentialEnv: null,
    transport: 'openai-chat-completions',
    status: 'docs-verified',
    outputTokenField: 'max_tokens',
  });
  assert.deepEqual(resolved.credential, {
    value: 'diffwright-local',
    source: 'dummy',
  });
});

test('explicit Vercel accepts OIDC but implicit OIDC never activates Vercel', () => {
  const explicit = provider.resolveProvider({
    env: {
      DIFFWRIGHT_PROVIDER: 'vercel',
      DIFFWRIGHT_MODEL: 'openai/gpt-5',
      VERCEL_OIDC_TOKEN: 'oidc',
    },
    command: 'doctor',
  });
  assert.equal(explicit?.profile.credentialEnv, 'VERCEL_OIDC_TOKEN');

  const implicit = provider.resolveProvider({
    env: { VERCEL_OIDC_TOKEN: 'oidc', CEREBRAS_API_KEY: 'cerebras' },
    command: 'commit',
  });
  assert.equal(implicit?.profile.id, 'cerebras');
});

test('implicit resolution preserves custom, Gateway, Cerebras, then Groq priority', () => {
  const base: NodeJS.ProcessEnv = {
    DIFFWRIGHT_BASE_URL: 'https://example.test/v1/',
    DIFFWRIGHT_API_KEY: 'custom',
    DIFFWRIGHT_MODEL: 'custom-model',
    AI_GATEWAY_API_KEY: 'gateway',
    CEREBRAS_API_KEY: 'cerebras',
    GROQ_API_KEY: 'groq',
  };
  assert.equal(provider.resolveProvider({ env: base, command: 'commit' })?.profile.id, 'custom');
  const { DIFFWRIGHT_BASE_URL: _url, DIFFWRIGHT_API_KEY: _key, ...withoutCustom } = base;
  assert.equal(provider.resolveProvider({ env: withoutCustom, command: 'commit' })?.profile.id, 'vercel');
  const { AI_GATEWAY_API_KEY: _gateway, ...withoutGateway } = withoutCustom;
  assert.equal(provider.resolveProvider({ env: withoutGateway, command: 'commit' })?.profile.id, 'cerebras');
  const { CEREBRAS_API_KEY: _cerebras, ...groqOnly } = withoutGateway;
  assert.equal(provider.resolveProvider({ env: groqOnly, command: 'commit' })?.profile.id, 'groq');
});

test('activated partial custom and Vercel configuration fail closed', () => {
  assert.throws(
    () => provider.resolveProvider({
      env: { DIFFWRIGHT_BASE_URL: 'https://example.test/v1', CEREBRAS_API_KEY: 'fallback' },
      command: 'commit',
    }),
    /DIFFWRIGHT_MODEL.*DIFFWRIGHT_API_KEY|DIFFWRIGHT_API_KEY.*DIFFWRIGHT_MODEL/,
  );
  assert.throws(
    () => provider.resolveProvider({
      env: { AI_GATEWAY_API_KEY: 'gateway', CEREBRAS_API_KEY: 'fallback' },
      command: 'commit',
    }),
    /DIFFWRIGHT_MODEL/,
  );
});

test('DIFFWRIGHT_MODEL alone remains a legacy model override', () => {
  assert.equal(
    provider.resolveProvider({
      env: { DIFFWRIGHT_MODEL: 'override', CEREBRAS_API_KEY: 'key' },
      command: 'commit',
    })?.profile.model,
    'override',
  );
});

test('legacy model precedence differs for commit and PR and applies to Cerebras', () => {
  const env: NodeJS.ProcessEnv = {
    CEREBRAS_API_KEY: 'key',
    CHANGESCRIBE_MODEL: 'changescribe',
    GROQ_PR_MODEL: 'pr-model',
    GROQ_MODEL: 'groq-model',
  };
  assert.equal(provider.resolveProvider({ env, command: 'commit' })?.profile.model, 'changescribe');
  assert.equal(provider.resolveProvider({ env, command: 'pr' })?.profile.model, 'changescribe');
  delete env.CHANGESCRIBE_MODEL;
  assert.equal(provider.resolveProvider({ env, command: 'commit' })?.profile.model, 'groq-model');
  assert.equal(provider.resolveProvider({ env, command: 'pr' })?.profile.model, 'pr-model');
});

test('custom URL validation accepts safe loopback and HTTPS endpoints', () => {
  for (const [baseURL, key] of [
    ['https://provider.example/v1/', 'secret'],
    ['http://localhost:11434/v1/', undefined],
    ['http://127.0.0.1:8000/v1', undefined],
    ['http://[::1]:1234/v1/', undefined],
  ] as const) {
    const resolved = provider.resolveProvider({
      env: {
        DIFFWRIGHT_PROVIDER: 'custom',
        DIFFWRIGHT_BASE_URL: baseURL,
        DIFFWRIGHT_MODEL: 'model',
        ...(key === undefined ? {} : { DIFFWRIGHT_API_KEY: key }),
      },
      command: 'doctor',
    });
    assert.equal(resolved?.profile.baseURL.endsWith('/'), false);
    assert.equal(resolved?.credential.source, key === undefined ? 'dummy' : 'shell');
  }
});

test('custom URL validation rejects unsafe or ambiguous endpoints', () => {
  for (const baseURL of [
    'http://example.com/v1',
    'ftp://example.com/v1',
    'https://user:pass@example.com/v1',
    'https://example.com/v1?key=value',
    'https://example.com/v1#fragment',
    'http://localhost.evil/v1',
    'http://127.0.0.1.evil/v1',
  ]) {
    assert.throws(
      () => provider.resolveProvider({
        env: {
          DIFFWRIGHT_PROVIDER: 'custom',
          DIFFWRIGHT_BASE_URL: baseURL,
          DIFFWRIGHT_API_KEY: 'secret',
          DIFFWRIGHT_MODEL: 'model',
        },
        command: 'doctor',
      }),
      /URL|HTTPS|loopback|credentials|query|fragment/i,
      baseURL,
    );
  }
});

test('unknown provider IDs fail with the supported IDs and no credentials', () => {
  assert.throws(
    () => provider.resolveProvider({
      env: { DIFFWRIGHT_PROVIDER: 'mystery', DIFFWRIGHT_API_KEY: 'do-not-print' },
      command: 'doctor',
    }),
    (error: unknown) => {
      assert.ok(error instanceof provider.ProviderConfigError);
      const message = String(error);
      assert.match(message, /openai/);
      assert.match(message, /custom/);
      assert.doesNotMatch(message, /do-not-print/);
      return true;
    },
  );
});
