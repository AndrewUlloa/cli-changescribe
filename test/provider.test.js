const assert = require('node:assert/strict');
const test = require('node:test');

const { createClient } = require('../dist/provider.js');

test('provider resolution can be tested with an isolated environment and SDK factory', () => {
  const clients = [];
  const factory = (options) => {
    const client = { options };
    clients.push(client);
    return client;
  };

  const selected = createClient(
    {
      CEREBRAS_API_KEY: 'cerebras-test-key',
      GROQ_API_KEY: 'groq-test-key',
    },
    factory,
  );

  assert.equal(selected.provider, 'cerebras');
  assert.equal(selected.defaultModel, 'gpt-oss-120b');
  assert.equal(selected.client, clients[0]);
  assert.deepEqual(clients[0].options, {
    apiKey: 'cerebras-test-key',
    baseURL: 'https://api.cerebras.ai/v1',
  });
});

test('provider resolution preserves Groq fallback and null behavior', () => {
  const calls = [];
  const factory = (options) => {
    calls.push(options);
    return { options };
  };

  const groq = createClient({ GROQ_API_KEY: 'groq-test-key' }, factory);
  const missing = createClient({}, factory);

  assert.equal(groq.provider, 'groq');
  assert.equal(groq.defaultModel, 'openai/gpt-oss-120b');
  assert.deepEqual(calls, [
    {
      apiKey: 'groq-test-key',
      baseURL: 'https://api.groq.com/openai/v1',
    },
  ]);
  assert.equal(missing, null);
});
