import assert from 'node:assert/strict';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import test, { type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';

interface PublicProviderProfile {
  id: string;
  baseURL: string;
  model: string;
  credentialEnv: string | null;
  transport: 'openai-chat-completions';
  status: string;
  outputTokenField: 'max_tokens' | 'max_completion_tokens' | null;
  defaultHeaders?: Readonly<Record<string, string>>;
}

interface ResolvedProvider {
  profile: Readonly<PublicProviderProfile>;
  credential: Readonly<{
    value: string;
    source: 'shell' | '.env.local' | 'dummy';
  }>;
}

interface ParsedCompletion {
  content: string;
  reasoning: string;
  finishReason: string | null;
}

interface TransportModule {
  DEFAULT_TIMEOUT_MS: number;
  buildChatRequest(
    profile: PublicProviderProfile,
    messages: Array<{ role: string; content: string }>,
    outputLimit?: number,
    intent?: 'workflow' | 'doctor',
  ): Record<string, unknown>;
  completeChat(
    resolved: ResolvedProvider,
    input: {
      messages: Array<{ role: string; content: string }>;
      outputLimit?: number;
      intent?: 'workflow' | 'doctor';
    },
    options?: { timeoutMs?: number },
  ): Promise<ParsedCompletion>;
  parseChatResponse(value: unknown): ParsedCompletion;
}

interface ErrorsModule {
  TransportError: new (...args: never[]) => Error;
  formatSafeError(error: unknown, secrets?: readonly string[]): string;
}

const transport: TransportModule = require('../dist/transport.js');
const errors: ErrorsModule = require('../dist/errors.js');

function profile(
  overrides: Partial<PublicProviderProfile> = {},
): PublicProviderProfile {
  return {
    id: 'custom',
    baseURL: 'http://127.0.0.1:1/v1',
    model: 'test-model',
    credentialEnv: 'DIFFWRIGHT_API_KEY',
    transport: 'openai-chat-completions',
    status: 'user-defined',
    outputTokenField: null,
    ...overrides,
  };
}

function resolved(
  baseURL: string,
  secret = 'selected-secret',
  overrides: Partial<PublicProviderProfile> = {},
): ResolvedProvider {
  return {
    profile: profile({ baseURL, ...overrides }),
    credential: { value: secret, source: 'shell' },
  };
}

async function listen(
  context: TestContext,
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ baseURL: string; requests: IncomingMessage[] }> {
  const requests: IncomingMessage[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request);
    handler(request, response);
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen),
  );
  context.after(
    () =>
      new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      ),
  );
  const address = server.address() as AddressInfo;
  return { baseURL: `http://127.0.0.1:${address.port}`, requests };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

test('request builder applies exact provider token policy and omits speculative fields', () => {
  const messages = [{ role: 'user', content: 'hello' }];
  assert.deepEqual(
    transport.buildChatRequest(
      profile({ id: 'cerebras', outputTokenField: 'max_completion_tokens' }),
      messages,
      123,
    ),
    { model: 'test-model', messages, max_completion_tokens: 123 },
  );
  assert.deepEqual(
    transport.buildChatRequest(
      profile({ id: 'anthropic', outputTokenField: 'max_tokens' }),
      messages,
      123,
    ),
    { model: 'test-model', messages, max_tokens: 123 },
  );
  assert.deepEqual(transport.buildChatRequest(profile(), messages, 123), {
    model: 'test-model',
    messages,
  });
});

test('Groq reasoning effort is workflow-only for the retained default model', () => {
  const messages = [{ role: 'user', content: 'hello' }];
  const groq = profile({
    id: 'groq',
    model: 'openai/gpt-oss-120b',
    outputTokenField: 'max_completion_tokens',
  });
  assert.equal(
    transport.buildChatRequest(groq, messages, 1024, 'workflow').reasoning_effort,
    'high',
  );
  assert.equal(
    'reasoning_effort' in transport.buildChatRequest(groq, messages, 1024, 'doctor'),
    false,
  );
  assert.equal(
    'reasoning_effort' in transport.buildChatRequest(
      { ...groq, model: 'different-model' },
      messages,
      1024,
    ),
    false,
  );
});

test('real SDK sends one exact Chat Completions request and parses it', async (context) => {
  let capturedBody = '';
  let capturedAuthorization = '';
  const server = await listen(context, (request, response) => {
    void readBody(request).then((body) => {
      capturedBody = body;
      capturedAuthorization = request.headers.authorization ?? '';
      response.writeHead(200, {
        'content-type': 'application/json',
        'x-request-id': 'req_test',
      });
      response.end(
        JSON.stringify({
          id: 'chatcmpl_test',
          object: 'chat.completion',
          created: 1,
          model: 'test-model',
          choices: [
            { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } },
          ],
        }),
      );
    });
  });

  const completion = await transport.completeChat(
    resolved(`${server.baseURL}/nested/v1/`),
    { messages: [{ role: 'user', content: 'say OK' }] },
  );

  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].method, 'POST');
  assert.equal(server.requests[0].url, '/nested/v1/chat/completions');
  assert.equal(capturedAuthorization, 'Bearer selected-secret');
  assert.deepEqual(JSON.parse(capturedBody), {
    model: 'test-model',
    messages: [{ role: 'user', content: 'say OK' }],
  });
  assert.deepEqual(completion, {
    content: 'OK',
    reasoning: '',
    finishReason: 'stop',
  });
});

test('provider 500 is classified and never retried', async (context) => {
  const server = await listen(context, (_request, response) => {
    response.writeHead(500, {
      'content-type': 'application/json',
      'x-request-id': 'req_failure',
    });
    response.end(JSON.stringify({ error: { message: 'provider exploded selected-secret' } }));
  });

  await assert.rejects(
    transport.completeChat(
      resolved(`${server.baseURL}/v1`),
      { messages: [{ role: 'user', content: 'hello' }] },
    ),
    (error: unknown) => {
      assert.ok(error instanceof errors.TransportError);
      const output = errors.formatSafeError(error, ['selected-secret']);
      assert.match(output, /provider_error/);
      assert.match(output, /500/);
      assert.match(output, /req_failure/);
      assert.doesNotMatch(output, /selected-secret/);
      return true;
    },
  );
  assert.equal(server.requests.length, 1);
});

test('redirects are rejected before a diff body reaches another origin', async (context) => {
  const destination = await listen(context, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  const redirector = await listen(context, (_request, response) => {
    response.writeHead(307, {
      location: `${destination.baseURL}/v1/chat/completions`,
    });
    response.end();
  });

  await assert.rejects(
    transport.completeChat(
      resolved(`${redirector.baseURL}/v1`),
      { messages: [{ role: 'user', content: 'private diff' }] },
    ),
    /redirect|connection/i,
  );
  assert.equal(redirector.requests.length, 1);
  assert.equal(destination.requests.length, 0);
});

test('short injected timeout is classified without waiting for production timeout', async (context) => {
  const server = await listen(context, () => {
    // Intentionally leave the response open until the client timeout fires.
  });

  assert.equal(transport.DEFAULT_TIMEOUT_MS, 120_000);
  await assert.rejects(
    transport.completeChat(
      resolved(`${server.baseURL}/v1`),
      { messages: [{ role: 'user', content: 'hello' }] },
      { timeoutMs: 30 },
    ),
    (error: unknown) => {
      assert.match(errors.formatSafeError(error), /timeout/);
      return true;
    },
  );
  assert.equal(server.requests.length, 1);
});

test('malformed completions fail as incompatible responses', () => {
  assert.throws(
    () => transport.parseChatResponse({ choices: [] }),
    /incompatible response/i,
  );
});

test('safe error formatting redacts known values and bearer tokens without dumping objects', () => {
  const error = Object.assign(new Error('failed secret-a Bearer token-value\nnext'), {
    response: {
      status: 401,
      headers: { authorization: 'Bearer secret-b', arbitrary: 'do-not-print' },
      data: { apiKey: 'secret-a' },
    },
    config: { headers: { authorization: 'Bearer secret-a' } },
  });
  const output = errors.formatSafeError(error, ['secret-a', 'secret-b', '']);

  assert.doesNotMatch(output, /secret-a|secret-b|token-value|do-not-print|authorization|config/i);
  assert.match(output, /\[REDACTED\]/);
  assert.ok(output.length < 1_000);
});
