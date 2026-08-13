import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http, { type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

const bin = path.resolve(__dirname, '..', 'bin', 'diffwright.js');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function createRepository(context: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-byok-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  git(directory, ['init', '--quiet', '--initial-branch=main']);
  git(directory, ['config', 'user.email', 'diffwright@example.test']);
  git(directory, ['config', 'user.name', 'Diffwright Test']);
  fs.writeFileSync(path.join(directory, 'README.md'), '# fixture\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'initial']);
  return directory;
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function createCompletionServer(context: TestContext): Promise<{
  baseURL: string;
  requests: Array<{ url: string; authorization: string; body: Record<string, unknown> }>;
}> {
  const requests: Array<{
    url: string;
    authorization: string;
    body: Record<string, unknown>;
  }> = [];
  const server = http.createServer((request, response) => {
    void body(request).then((parsed) => {
      requests.push({
        url: request.url ?? '',
        authorization: request.headers.authorization ?? '',
        body: parsed,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: `chatcmpl_${requests.length}`,
          object: 'chat.completion',
          created: 1,
          model: 'fixture-model',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content:
                  'fix: support provider-neutral configuration\n\n' +
                  '- change: route completions through the selected endpoint\n' +
                  '- why: let users bring their own provider\n' +
                  '- risk: workflow-secret ambient-secret\n\n' +
                  'What issue is this PR related to?\nRelated: (not provided)\n\n' +
                  'What change does this PR add?\n- Add provider-neutral completion routing\n\n' +
                  'How did you test your change?\nTesting: local wire test\n\n' +
                  'Anything you want reviewers to scrutinize?\n- Provider precedence\n\n' +
                  'Other notes reviewers should know (risks + follow-ups)\n- None',
              },
            },
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
  return { baseURL: `http://127.0.0.1:${address.port}/v1`, requests };
}

async function run(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
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

function customEnvironment(baseURL: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DIFFWRIGHT_PROVIDER: 'custom',
    DIFFWRIGHT_BASE_URL: baseURL,
    DIFFWRIGHT_API_KEY: 'workflow-secret',
    DIFFWRIGHT_MODEL: 'fixture-model',
    GROQ_API_KEY: 'ambient-secret',
  };
}

function createFakeGh(
  context: TestContext,
  capturePath: string,
): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-gh-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'gh');
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('gh version fixture');
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'list') {
  console.log('[]');
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'create') {
  if (args.includes('--issue')) {
    console.error('unknown flag: --issue');
    process.exit(2);
  }
  const bodyIndex = args.indexOf('--body-file');
  const body = fs.readFileSync(args[bodyIndex + 1], 'utf8');
  fs.writeFileSync(process.env.GH_CAPTURE_PATH, JSON.stringify({ args, body }));
  console.log('https://github.com/example/repo/pull/1');
  process.exit(0);
}
console.error('unexpected gh invocation: ' + args.join(' '));
process.exit(2);
`,
    'utf8',
  );
  fs.chmodSync(executable, 0o755);
  return directory;
}

test('commit workflow uses explicit custom provider through the shared transport', async (context) => {
  const directory = createRepository(context);
  fs.appendFileSync(
    path.join(directory, 'README.md'),
    'change workflow-secret ambient-secret\n',
  );
  git(directory, ['add', 'README.md']);
  const head = git(directory, ['rev-parse', 'HEAD']).trim();
  const server = await createCompletionServer(context);

  const result = await run(
    directory,
    ['commit', '--dry-run'],
    customEnvironment(server.baseURL),
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Generating commit message with AI \(custom\)/);
  assert.match(result.stdout, /fix: support provider-neutral configuration/);
  assert.doesNotMatch(result.stdout, /workflow-secret|ambient-secret/);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].url, '/v1/chat/completions');
  assert.equal(server.requests[0].authorization, 'Bearer workflow-secret');
  assert.equal(server.requests[0].body.model, 'fixture-model');
  assert.doesNotMatch(
    JSON.stringify(server.requests[0].body),
    /workflow-secret|ambient-secret/,
  );
  assert.deepEqual(Object.keys(server.requests[0].body).sort(), [
    'messages',
    'model',
  ]);
  assert.equal(git(directory, ['rev-parse', 'HEAD']).trim(), head);
});

test('PR workflow uses explicit custom provider for every synthesis pass', async (context) => {
  const directory = createRepository(context);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(
    path.join(directory, 'README.md'),
    'feature workflow-secret ambient-secret\n',
  );
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feat: add fixture feature']);
  const output = path.join(directory, 'summary.md');
  const server = await createCompletionServer(context);

  const result = await run(
    directory,
    ['pr', '--base', 'main', '--out', output],
    customEnvironment(server.baseURL),
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Provider.*custom/i);
  assert.equal(server.requests.length, 3);
  for (const request of server.requests) {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.authorization, 'Bearer workflow-secret');
    assert.equal(request.body.model, 'fixture-model');
    assert.doesNotMatch(
      JSON.stringify(request.body),
      /workflow-secret|ambient-secret/,
    );
    assert.deepEqual(Object.keys(request.body).sort(), ['messages', 'model']);
  }
  assert.match(fs.readFileSync(output, 'utf8'), /What change does this PR add\?/);
  assert.doesNotMatch(
    fs.readFileSync(output, 'utf8'),
    /workflow-secret|ambient-secret/,
  );
});

test('PR creation links an issue in the body without passing an unsupported gh flag', async (context) => {
  const directory = createRepository(context);
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture',
        private: true,
        scripts: {
          test: 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    ),
  );
  git(directory, ['add', 'package.json']);
  git(directory, ['commit', '--quiet', '-m', 'chore: add package scripts']);

  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-remote-'));
  context.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  git(remote, ['init', '--quiet', '--bare']);
  git(directory, ['remote', 'add', 'origin', remote]);
  git(directory, ['push', '--quiet', '-u', 'origin', 'main']);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'issue-linked feature\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feat: add linked feature']);

  const output = path.join(directory, 'summary.md');
  const capture = path.join(directory, 'gh-capture.json');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context);
  const env = customEnvironment(server.baseURL);
  env.PATH = `${fakeBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_CAPTURE_PATH = capture;

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--out',
      output,
      '--issue',
      '#123',
      '--create-pr',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const captured = JSON.parse(fs.readFileSync(capture, 'utf8')) as {
    args: string[];
    body: string;
  };
  assert.equal(captured.args.includes('--issue'), false);
  assert.match(captured.body, /(?:^|\n)Closes #123(?:\n|$)/);
  assert.match(
    JSON.stringify(server.requests.map((request) => request.body)),
    /Issue hint: #123/,
  );
});
