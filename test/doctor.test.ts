import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http, { type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

const bin = path.resolve(__dirname, '..', 'bin', 'diffwright.js');

async function run(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      env,
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

test('offline doctor resolves configuration without making a request', async () => {
  const result = await run(['doctor'], {
    ...process.env,
    DIFFWRIGHT_PROVIDER: 'custom',
    DIFFWRIGHT_BASE_URL: 'http://127.0.0.1:9/private/v1',
    DIFFWRIGHT_API_KEY: 'doctor-secret',
    DIFFWRIGHT_MODEL: 'doctor-model',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Provider: custom/);
  assert.match(result.stdout, /Model: doctor-model/);
  assert.match(result.stdout, /Endpoint: 127\.0\.0\.1/);
  assert.match(result.stdout, /Credential: DIFFWRIGHT_API_KEY \(shell\)/);
  assert.match(result.stdout, /Transport: openai-chat-completions/);
  assert.match(result.stdout, /Status: user-defined/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /doctor-secret|private\/v1|Authorization/i);
});

test('live doctor makes exactly one minimal production-transport request', async (context: TestContext) => {
  const requests: Array<{
    url: string;
    authorization: string;
    body: Record<string, unknown>;
  }> = [];
  const server = http.createServer((request, response) => {
    void readBody(request).then((parsed) => {
      requests.push({
        url: request.url ?? '',
        authorization: request.headers.authorization ?? '',
        body: parsed,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'chatcmpl_doctor',
          object: 'chat.completion',
          created: 1,
          model: 'doctor-model',
          choices: [
            { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const address = server.address() as AddressInfo;

  const result = await run(['doctor', '--live'], {
    ...process.env,
    DIFFWRIGHT_PROVIDER: 'custom',
    DIFFWRIGHT_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    DIFFWRIGHT_API_KEY: 'doctor-secret',
    DIFFWRIGHT_MODEL: 'doctor-model',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Live check: OK/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].authorization, 'Bearer doctor-secret');
  assert.deepEqual(Object.keys(requests[0].body).sort(), ['messages', 'model']);
  assert.match(JSON.stringify(requests[0].body), /exactly OK/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /doctor-secret/);
});

test('live doctor uses only the fixed dummy credential for a keyless loopback endpoint', async (context) => {
  let authorization = '';
  let requestBody = '';
  const server = http.createServer((request, response) => {
    authorization = request.headers.authorization ?? '';
    void readBody(request).then((parsed) => {
      requestBody = JSON.stringify(parsed);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'chatcmpl_local',
        object: 'chat.completion',
        created: 1,
        model: 'local-model',
        choices: [
          { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } },
        ],
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as AddressInfo;

  const result = await run(['doctor', '--live'], {
    ...process.env,
    DIFFWRIGHT_PROVIDER: 'custom',
    DIFFWRIGHT_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    DIFFWRIGHT_MODEL: 'local-model',
    GROQ_API_KEY: 'ambient-secret',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(authorization, 'Bearer diffwright-local');
  assert.doesNotMatch(requestBody, /ambient-secret/);
});

test('CLI redacts a provider error that echoes the selected credential', async (context) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(500, {
      'content-type': 'application/json',
      'x-request-id': 'req_echo',
    });
    response.end(JSON.stringify({ error: { message: 'echo doctor-secret' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as AddressInfo;

  const result = await run(['doctor', '--live'], {
    ...process.env,
    DIFFWRIGHT_PROVIDER: 'custom',
    DIFFWRIGHT_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    DIFFWRIGHT_API_KEY: 'doctor-secret',
    DIFFWRIGHT_MODEL: 'doctor-model',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /provider_error|provider error/i);
  assert.match(result.stderr, /\[REDACTED\]/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /doctor-secret/);
});

for (const [credentialName, credentialValue, model] of [
  ['CEREBRAS_API_KEY', 'cerebras-file-secret', 'gpt-oss-120b'],
  ['GROQ_API_KEY', 'groq-file-secret', 'openai/gpt-oss-120b'],
] as const) {
  test(`offline doctor preserves legacy ${credentialName} .env.local defaults`, async (context) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-doctor-env-'));
    context.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    fs.writeFileSync(
      path.join(cwd, '.env.local'),
      `${credentialName}=${credentialValue}\n`,
      'utf8',
    );

    const result = await run(['doctor'], { PATH: process.env.PATH }, cwd);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Model: ${model.replace('/', '\\/')}`));
    assert.match(result.stdout, /Credential: .* \(\.env\.local\)/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(credentialValue));
  });
}

test('doctor rejects unknown flags', async () => {
  const result = await run(['doctor', '--surprise'], {
    ...process.env,
    CEREBRAS_API_KEY: 'doctor-secret',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown doctor option/);
  assert.doesNotMatch(result.stderr, /doctor-secret/);
});
