import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http, { type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

const bin = path.resolve(__dirname, '..', 'bin', 'diffwright.js');

type ArtifactResponseKind = 'parse-invalid' | 'render-invalid' | 'valid';

function isArtifactPrompt(serialized: string): boolean {
  return serialized.includes('Produce one evidence-linked draft') ||
    serialized.includes('previous response failed deterministic validation') ||
    serialized.includes('previous primary claim failed evidence review');
}

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

async function createCompletionServer(
  context: TestContext,
  options: {
    invalidArtifactResponses?: number;
    renderInvalidArtifactResponses?: number;
    artifactResponses?: readonly ArtifactResponseKind[];
    scope?: string;
    dishonestSupporting?: boolean;
    primaryRejectedCritiques?: number;
  } = {},
): Promise<{
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
      const serializedRequest = JSON.stringify(parsed);
      const isArtifactCritic = serializedRequest.includes(
        'independently audit every proposed model-authored artifact claim',
      );
      const isArtifactRequest = isArtifactPrompt(serializedRequest);
      const criticRequestCount = requests.filter((item) =>
        JSON.stringify(item.body).includes(
          'independently audit every proposed model-authored artifact claim',
        ),
      ).length;
      const artifactRequestCount = requests.filter((item) =>
        isArtifactPrompt(JSON.stringify(item.body)),
      ).length;
      const configuredResponse =
        options.artifactResponses?.[artifactRequestCount - 1];
      const parseInvalid = isArtifactRequest &&
        (configuredResponse === 'parse-invalid' ||
          (configuredResponse === undefined &&
            artifactRequestCount <= (options.invalidArtifactResponses ?? 0)));
      const renderInvalid =
        isArtifactRequest &&
        (configuredResponse === 'render-invalid' ||
          (configuredResponse === undefined &&
            artifactRequestCount <=
              (options.renderInvalidArtifactResponses ?? 0)));
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
                content: isArtifactCritic
                    ? JSON.stringify({
                      schemaVersion: 1,
                      candidates: [
                        {
                          candidateId: 'claim:claim-change',
                          evidenceIds: ['change-1'],
                          supported: criticRequestCount >
                            (options.primaryRejectedCritiques ?? 0),
                        },
                        ...(options.dishonestSupporting
                          ? [{
                              candidateId: 'claim:claim-plan',
                              evidenceIds: ['change-1'],
                              supported: false,
                            }]
                          : []),
                      ],
                    })
                  : parseInvalid
                  ? 'not valid artifact json'
                  : isArtifactRequest
                  ? JSON.stringify({
                      schemaVersion: 1,
                      title: {
                        type: 'fix',
                        ...(options.scope === undefined
                          ? {}
                          : { scope: options.scope }),
                        breaking: false,
                        subject: renderInvalid
                          ? 'route completions through provider-neutral configuration.'
                          : 'route completions through provider-neutral configuration',
                        claimId: 'claim-change',
                      },
                      claims: [
                        {
                          id: 'claim-change',
                          kind: 'change',
                          text: 'route completions through provider-neutral configuration.',
                          evidenceIds: ['change-1'],
                          basis: 'observed',
                          significance: 'primary',
                        },
                        ...(options.dishonestSupporting
                          ? [{
                              id: 'claim-plan',
                              kind: 'change',
                              text: 'mark the plan task complete.',
                              evidenceIds: ['change-1'],
                              basis: 'observed',
                              significance: 'supporting',
                            }]
                          : []),
                      ],
                      sections: [
                        { kind: 'summary', claimIds: ['claim-change'] },
                        ...(options.dishonestSupporting
                          ? [{ kind: 'changes', claimIds: ['claim-plan'] }]
                          : []),
                      ],
                      trailers: [],
                    })
                  :
                      'fix: support provider-neutral configuration\n\n' +
                      '- change: route completions through the selected endpoint\n' +
                      '- why: let users bring their own provider\n' +
                      '- risk: workflow-secret ambient-secret',
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
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('gh version fixture');
  process.exit(0);
}
if (args[0] === 'pr' && process.env.GH_EXPECT_REPO) {
  const repoIndex = args.indexOf('--repo');
  if (repoIndex < 0 || args[repoIndex + 1] !== process.env.GH_EXPECT_REPO) {
    console.error('gh repository identity was not pinned');
    process.exit(23);
  }
}
if (args[0] === 'pr' && args[1] === 'list') {
  if (process.env.GH_LIST_COUNTER_PATH) {
    const counterPath = process.env.GH_LIST_COUNTER_PATH;
    const count = fs.existsSync(counterPath)
      ? Number(fs.readFileSync(counterPath, 'utf8')) + 1
      : 1;
    fs.writeFileSync(counterPath, String(count));
    if (count === 2 && process.env.GH_MOVE_BASE_SHA) {
      execFileSync('git', [
        'push',
        '--quiet',
        'origin',
        '+' + process.env.GH_MOVE_BASE_SHA + ':refs/heads/main',
      ]);
    }
    if (count === 2 && process.env.GH_LIST_RAW_ON_SECOND) {
      console.log(process.env.GH_LIST_RAW_ON_SECOND);
      process.exit(0);
    }
  }
  if (process.env.GH_LIST_EXIT === '1') process.exit(2);
  if (process.env.GH_LIST_RAW) {
    console.log(process.env.GH_LIST_RAW);
    process.exit(0);
  }
  console.log(process.env.GH_EXISTING_PR === '1'
    ? JSON.stringify([{
        number: 7,
        title: 'Existing',
        url: 'https://github.com/example/repo/pull/7',
        headRefOid: process.env.GH_EXISTING_PR_HEAD || '',
        isCrossRepository: process.env.GH_CROSS_REPOSITORY === '1',
      }])
    : '[]');
  process.exit(0);
}
if (args[0] === 'pr' && (args[1] === 'create' || args[1] === 'edit')) {
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
  const gitExecutable = path.join(directory, 'git');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(
    gitExecutable,
    `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.join(' ') === 'remote get-url --all origin') {
  console.log(process.env.GIT_FAKE_ORIGIN_URL || 'https://github.com/diffwright/fixture.git');
  process.exit(0);
}
if (args.join(' ') === 'remote get-url --push --all origin') {
  console.log(process.env.GIT_FAKE_PUSH_URL || process.env.GIT_FAKE_ORIGIN_URL || 'https://github.com/diffwright/fixture.git');
  process.exit(0);
}
const forwarded = [...args];
if (forwarded[0] === 'push' && forwarded[1] === 'https://github.com/diffwright/fixture.git') {
  forwarded[1] = 'origin';
}
const result = spawnSync(${JSON.stringify(realGit)}, forwarded, { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
`,
    'utf8',
  );
  fs.chmodSync(gitExecutable, 0o755);
  return directory;
}

function createGitPushRaceWrapper(context: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-git-race-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'git');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node
const { spawnSync, execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
const realGit = ${JSON.stringify(realGit)};
if (args.join(' ') === 'remote get-url --all origin' ||
    args.join(' ') === 'remote get-url --push --all origin') {
  console.log('https://github.com/diffwright/fixture.git');
  process.exit(0);
}
if (args[0] === 'push' && process.env.GIT_MOVE_FEATURE_ON_PUSH === '1') {
  const current = execFileSync(realGit, ['rev-parse', 'refs/heads/feature'], { encoding: 'utf8' }).trim();
  const tree = execFileSync(realGit, ['rev-parse', current + '^{tree}'], { encoding: 'utf8' }).trim();
  const moved = execFileSync(realGit, ['commit-tree', tree, '-p', current, '-m', 'chore: move feature before push'], { encoding: 'utf8' }).trim();
  execFileSync(realGit, ['update-ref', 'refs/heads/feature', moved, current]);
  if (process.env.GIT_MOVED_SHA_PATH) require('node:fs').writeFileSync(process.env.GIT_MOVED_SHA_PATH, moved);
}
const forwarded = [...args];
if (forwarded[0] === 'push' && forwarded[1] === 'https://github.com/diffwright/fixture.git') {
  forwarded[1] = 'origin';
}
const result = spawnSync(realGit, forwarded, { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
`,
    'utf8',
  );
  fs.chmodSync(executable, 0o755);
  return directory;
}

function addPrMutationFixture(
  context: TestContext,
  directory: string,
  pushFeature = true,
): { remote: string; reviewedHead: string } {
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
  fs.appendFileSync(path.join(directory, 'README.md'), 'reviewed feature\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feat: add reviewed feature']);
  if (pushFeature) {
    git(directory, ['push', '--quiet', '-u', 'origin', 'feature']);
  }
  return {
    remote,
    reviewedHead: git(directory, ['rev-parse', 'HEAD']).trim(),
  };
}

type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun';

interface PackageManagerInvocation {
  args: string[];
  leakedCredential: string | null;
}

function createFakePackageManager(
  context: TestContext,
  manager: PackageManagerName,
): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'diffwright-manager-bin-'),
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executable = path.join(directory, manager);
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const script = args[0] === 'test' ? 'test' : (args[0] === 'run' ? args[1] : '');
fs.appendFileSync(process.env.PACKAGE_MANAGER_CAPTURE_PATH, JSON.stringify({
  args,
  leakedCredential: process.env.DIFFWRIGHT_API_KEY || null,
}) + '\\n');
if (script === process.env.PACKAGE_MANAGER_FAIL_SCRIPT) process.exit(17);
process.exit(0);
`,
    'utf8',
  );
  fs.chmodSync(executable, 0o755);
  return directory;
}

function addPackageManagerFixture(
  directory: string,
  manager: PackageManagerName,
): void {
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'fixture',
        private: true,
        packageManager: `${manager}@1.0.0`,
        scripts: {
          format: 'fixture-format',
          test: 'fixture-test',
          build: 'fixture-build',
        },
      },
      null,
      2,
    )}\n`,
  );
  git(directory, ['add', 'package.json']);
  git(directory, ['commit', '--quiet', '-m', 'chore: add package scripts']);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), `${manager} feature\n`);
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feat: add manager fixture']);
}

function readPackageManagerInvocations(
  capturePath: string,
): PackageManagerInvocation[] {
  return fs
    .readFileSync(capturePath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as PackageManagerInvocation);
}

for (const manager of ['npm', 'pnpm', 'yarn', 'bun'] as const) {
  test(
    `PR project gates use fixed ${manager} argv and a sanitized environment`,
    async (context) => {
      const directory = createRepository(context);
      addPackageManagerFixture(directory, manager);
      const managerCapture = path.join(directory, 'manager-capture.jsonl');
      const ghCapture = path.join(directory, 'gh-capture.json');
      const fakeManagerBin = createFakePackageManager(context, manager);
      const fakeGhBin = createFakeGh(context, ghCapture);
      const env = customEnvironment('http://127.0.0.1:9/v1');
      env.PATH = [fakeManagerBin, fakeGhBin, env.PATH ?? ''].join(
        path.delimiter,
      );
      env.PACKAGE_MANAGER_CAPTURE_PATH = managerCapture;
      env.PACKAGE_MANAGER_FAIL_SCRIPT = 'build';
      env.GH_CAPTURE_PATH = ghCapture;
      env.GH_EXISTING_PR = '1';
      env.GH_EXISTING_PR_HEAD = git(directory, ['rev-parse', 'HEAD']).trim();

      const result = await run(
        directory,
        [
          'pr',
          '--base',
          'main',
          '--out',
          'summary.md',
          '--create-pr',
          '--yes',
        ],
        env,
      );

      assert.equal(result.status, 1, result.stderr || result.stdout);
      const invocations = readPackageManagerInvocations(managerCapture);
      assert.deepEqual(
        invocations.map(({ args }) => args),
        manager === 'npm'
          ? [['run', 'format'], ['test'], ['run', 'build']]
          : [['run', 'format'], ['run', 'test'], ['run', 'build']],
      );
      assert.equal(
        invocations.every(({ leakedCredential }) => leakedCredential === null),
        true,
      );
      const testDisplay =
        manager === 'npm' ? 'npm test' : `${manager} run test`;
      assert.match(
        result.stdout,
        new RegExp(`Running ${testDisplay} before PR creation`),
      );
      assert.match(
        result.stderr,
        new RegExp(`${manager} run build failed; fix build errors first`),
      );
    },
  );
}

test(
  'npm gate failures preserve the established command and error message',
  async (context) => {
    const directory = createRepository(context);
    addPackageManagerFixture(directory, 'npm');
    const managerCapture = path.join(directory, 'manager-capture.jsonl');
    const ghCapture = path.join(directory, 'gh-capture.json');
    const fakeManagerBin = createFakePackageManager(context, 'npm');
    const fakeGhBin = createFakeGh(context, ghCapture);
    const env = customEnvironment('http://127.0.0.1:9/v1');
    env.PATH = [fakeManagerBin, fakeGhBin, env.PATH ?? ''].join(path.delimiter);
    env.PACKAGE_MANAGER_CAPTURE_PATH = managerCapture;
    env.PACKAGE_MANAGER_FAIL_SCRIPT = 'test';
    env.GH_CAPTURE_PATH = ghCapture;
    env.GH_EXISTING_PR = '1';
    env.GH_EXISTING_PR_HEAD = git(directory, ['rev-parse', 'HEAD']).trim();

    const result = await run(
      directory,
      ['pr', '--base', 'main', '--create-pr', '--yes'],
      env,
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Running npm test before PR creation/);
    assert.match(result.stderr, /npm test failed; fix test failures first/);
    assert.deepEqual(
      readPackageManagerInvocations(managerCapture).map(({ args }) => args),
      [['run', 'format'], ['test']],
    );
  },
);

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
  assert.match(
    result.stdout,
    /fix: route completions through provider-neutral configuration/,
  );
  assert.doesNotMatch(result.stdout, /workflow-secret|ambient-secret/);
  assert.equal(server.requests.length, 2);
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
  assert.equal(git(directory, ['rev-parse', 'HEAD']).trim(), head);
});

test('repository policy stays local while standard generation remains valid', async (context) => {
  const directory = createRepository(context);
  fs.writeFileSync(
    path.join(directory, '.diffwrightrc.json'),
    `${JSON.stringify(
      {
        version: 1,
        title: {
          additionalTypes: ['private-policy-token'],
          targetLength: 45,
        },
        editorial: {
          terminologyGroups: [
            {
              name: 'private-vocabulary',
              terms: ['internal-term-one', 'internal-term-two'],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  git(directory, ['add', '.diffwrightrc.json']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'policy privacy fixture\n');
  git(directory, ['add', 'README.md']);
  const server = await createCompletionServer(context);

  const result = await run(
    directory,
    ['commit', '--dry-run'],
    customEnvironment(server.baseURL),
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(server.requests.length, 2);
  const request = JSON.stringify(server.requests.map((item) => item.body));
  assert.doesNotMatch(
    request,
    /private-policy-token|private-vocabulary|internal-term/,
  );
  assert.match(request, /git-policy-metadata/);
  assert.match(
    result.stdout,
    /fix: route completions through provider-neutral configuration/,
  );
});

test('PR workflow uses an evidence-linked draft and separate terminal critic', async (context) => {
  const directory = createRepository(context);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(
    path.join(directory, 'README.md'),
    'feature workflow-secret ambient-secret\n',
  );
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feat: add fixture feature']);
  fs.writeFileSync(
    path.join(directory, 'intent.txt'),
    'Keep provider routing source-agnostic.\n',
  );
  const output = path.join(directory, 'summary.md');
  const server = await createCompletionServer(context);

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--out',
      output,
      '--context-file',
      'intent.txt',
    ],
    customEnvironment(server.baseURL),
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Provider.*custom/i);
  assert.equal(server.requests.length, 2);
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
  assert.match(
    JSON.stringify(server.requests[0].body),
    /Original evidence bundle.*kind.*change/is,
  );
  assert.match(
    JSON.stringify(server.requests[0].body),
    /provider routing source-agnostic/,
  );
  assert.match(fs.readFileSync(output, 'utf8'), /## Summary/);
  assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /5Cs|Pass 2/);
  assert.doesNotMatch(
    fs.readFileSync(output, 'utf8'),
    /workflow-secret|ambient-secret/,
  );
});

test('headless GitHub mutation requires explicit --yes before provider work', async (context) => {
  const directory = createRepository(context);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'headless fixture\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feat: add headless fixture']);

  const result = await run(
    directory,
    ['pr', '--base', 'main', '--create-pr'],
    customEnvironment('http://127.0.0.1:9/v1'),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive review or explicit --yes/i);
  assert.doesNotMatch(result.stdout, /Collecting|Generating|Running npm/);
});

test('PR workflow repairs one invalid draft and never chains model summaries', async (context) => {
  const directory = createRepository(context);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'repair fixture\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'fix: add repair fixture']);
  const output = path.join(directory, 'summary.md');
  const server = await createCompletionServer(context, {
    invalidArtifactResponses: 1,
  });

  const result = await run(
    directory,
    ['pr', '--base', 'main', '--out', output],
    customEnvironment(server.baseURL),
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(server.requests.length, 3);
  assert.match(result.stdout, /requesting one repair/);
  assert.equal(
    server.requests.every((request) =>
      JSON.stringify(request.body).includes('Original evidence bundle'),
    ),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(server.requests[1].body),
    /not valid artifact json/,
  );
  assert.match(
    JSON.stringify(server.requests[1].body),
    /Repair category: json-shape/,
  );
});

test('PR workflow repairs a draft that fails deterministic rendering', async (context) => {
  const directory = createRepository(context);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'render repair fixture\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'fix: add render repair fixture']);
  const output = path.join(directory, 'summary.md');
  const server = await createCompletionServer(context, {
    renderInvalidArtifactResponses: 1,
  });

  const result = await run(
    directory,
    ['pr', '--base', 'main', '--out', output],
    customEnvironment(server.baseURL),
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(server.requests.length, 3);
  assert.match(result.stdout, /requesting one repair/);
  assert.match(
    JSON.stringify(server.requests[1].body),
    /Repair category: title-policy/,
  );
  assert.match(
    fs.readFileSync(output, 'utf8'),
    /route completions through provider-neutral configuration/i,
  );
});

test('PR workflow discards a render-invalid draft when its repair cannot be parsed', async (context) => {
  const directory = createRepository(context);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'failed repair fixture\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'fix: add failed repair fixture']);
  const output = path.join(directory, 'summary.md');
  const server = await createCompletionServer(context, {
    artifactResponses: ['render-invalid', 'parse-invalid'],
  });

  const result = await run(
    directory,
    ['pr', '--base', 'main', '--out', output],
    customEnvironment(server.baseURL),
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(
    result.stderr,
    /invalid evidence-linked artifact after one repair/i,
  );
  assert.equal(server.requests.length, 2);
  assert.equal(fs.existsSync(output), false);
});

test('PR critic removes dishonest supporting prose before GitHub mutation', async (context) => {
  const directory = createRepository(context);
  addPrMutationFixture(context, directory);
  const output = path.join(directory, 'summary.md');
  const capture = path.join(directory, 'gh-capture.json');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context, {
    dishonestSupporting: true,
  });
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
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Critic removed 1 unsupported optional item/i);
  assert.equal(server.requests.length, 2);
  assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /mark the plan/i);
  assert.doesNotMatch(
    JSON.parse(fs.readFileSync(capture, 'utf8')).body as string,
    /mark the plan/i,
  );
});

test('PR critic re-audits one grounded replacement for an unsupported primary claim', async (context) => {
  const directory = createRepository(context);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'grounded repair fixture\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'fix: add grounded repair fixture']);
  const output = path.join(directory, 'summary.md');
  const server = await createCompletionServer(context, {
    primaryRejectedCritiques: 1,
  });

  const result = await run(
    directory,
    ['pr', '--base', 'main', '--out', output],
    customEnvironment(server.baseURL),
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(server.requests.length, 4);
  assert.match(result.stdout, /requesting one grounded replacement/i);
  assert.match(
    JSON.stringify(server.requests[2].body),
    /Repair category: primary-grounding/,
  );
  assert.equal(fs.existsSync(output), true);
});

test('PR workflow skips provider and output when branch history reverts to base', async (context) => {
  const directory = createRepository(context);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'temporary value\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feat: add temporary value']);
  git(directory, ['revert', '--quiet', '--no-edit', 'HEAD']);
  const output = path.join(directory, 'summary.md');
  const server = await createCompletionServer(context);

  const result = await run(
    directory,
    ['pr', '--base', 'main', '--out', output],
    customEnvironment(server.baseURL),
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(output), false);
  assert.match(result.stdout, /No final branch changes found/);
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
  env.GH_REPO = 'github.com/attacker/wrong-repository';
  env.GH_EXPECT_REPO = 'github.com/diffwright/fixture';

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
      '--yes',
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
  assert.equal(
    captured.args[captured.args.indexOf('--repo') + 1],
    'github.com/diffwright/fixture',
  );
  assert.equal(
    captured.args[captured.args.indexOf('--title') + 1],
    'fix: route completions through provider-neutral configuration',
  );
  assert.match(captured.body, /(?:^|\n)Closes #123(?:\n|$)/);
  assert.match(captured.body, /Passed: `npm run build`\n\nCloses #123$/u);
  assert.match(
    fs.readFileSync(path.join(directory, 'summary.final.md'), 'utf8'),
    /Closes #123$/u,
  );
  assert.match(captured.body, /Skipped: `npm run format`/);
  assert.match(captured.body, /Passed: `npm test`/);
  assert.match(captured.body, /Passed: `npm run build`/);
  const title = captured.args[captured.args.indexOf('--title') + 1];
  assert.match(title, /^[a-z][a-z0-9-]*(?:\([a-z0-9._/-]+\))?!?: .+/);
  assert.equal(title.length <= 72, true);
  assert.match(
    JSON.stringify(server.requests.map((request) => request.body)),
    /issue-reference.*#123/,
  );
});

test('PR generation uses pinned base policy and redacts feature policy bytes', async (context) => {
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
  fs.writeFileSync(
    path.join(directory, '.diffwrightrc.json'),
    `${JSON.stringify({
      version: 1,
      title: { scopeMode: 'forbidden' },
    })}\n`,
  );
  git(directory, ['add', 'package.json', '.diffwrightrc.json']);
  git(directory, ['commit', '--quiet', '-m', 'chore: add base policy']);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-remote-'));
  context.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  git(remote, ['init', '--quiet', '--bare']);
  git(directory, ['remote', 'add', 'origin', remote]);
  git(directory, ['push', '--quiet', '-u', 'origin', 'main']);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.writeFileSync(
    path.join(directory, '.diffwrightrc.json'),
    `${JSON.stringify({
      version: 1,
      title: { scopeMode: 'optional' },
    })}\n`,
  );
  git(directory, ['add', '.diffwrightrc.json']);
  git(directory, ['commit', '--quiet', '-m', 'chore: weaken feature policy']);

  const capture = path.join(directory, 'gh-capture.json');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context, { scope: 'cli' });
  const env = customEnvironment(server.baseURL);
  env.PATH = `${fakeBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_CAPTURE_PATH = capture;

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const captured = JSON.parse(fs.readFileSync(capture, 'utf8')) as {
    args: string[];
  };
  assert.equal(
    captured.args[captured.args.indexOf('--title') + 1],
    'fix: route completions through provider-neutral configuration',
  );
  const requests = JSON.stringify(server.requests.map((request) => request.body));
  assert.equal(requests.includes('\\"scopeMode\\":\\"optional\\"'), false);
  assert.equal(requests.includes('\\"scopeMode\\":\\"forbidden\\"'), false);
  assert.match(requests, /git-policy-metadata/);
});

test('PR summary without GitHub mutation also redacts feature policy bytes', async (context) => {
  const directory = createRepository(context);
  fs.writeFileSync(
    path.join(directory, '.diffwrightrc.json'),
    `${JSON.stringify({ version: 1, title: { scopeMode: 'forbidden' } })}\n`,
  );
  git(directory, ['add', '.diffwrightrc.json']);
  git(directory, ['commit', '--quiet', '-m', 'chore: add base policy']);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.writeFileSync(
    path.join(directory, '.diffwrightrc.json'),
    `${JSON.stringify({
      version: 1,
      editorial: {
        vagueAbsolutes: ['feature-policy-egress-sentinel'],
      },
    })}\n`,
  );
  fs.appendFileSync(path.join(directory, 'README.md'), 'policy summary fixture\n');
  git(directory, ['add', '.diffwrightrc.json', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'chore: update feature policy']);
  const server = await createCompletionServer(context);

  const result = await run(
    directory,
    ['pr', '--base', 'main', '--out', 'summary.md'],
    customEnvironment(server.baseURL),
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const requests = JSON.stringify(server.requests.map((request) => request.body));
  assert.doesNotMatch(requests, /feature-policy-egress-sentinel/);
  assert.match(requests, /git-policy-metadata/);
});

test('PR update links an issue in the body without passing an unsupported gh flag', async (context) => {
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
  fs.appendFileSync(path.join(directory, 'README.md'), 'updated feature\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feat: update fixture feature']);
  git(directory, ['push', '--quiet', '-u', 'origin', 'feature']);

  const capture = path.join(directory, 'gh-capture.json');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context);
  const env = customEnvironment(server.baseURL);
  env.PATH = `${fakeBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_CAPTURE_PATH = capture;
  env.GH_EXISTING_PR = '1';
  env.GH_EXISTING_PR_HEAD = git(directory, ['rev-parse', 'HEAD']).trim();

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--issue',
      '456',
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const captured = JSON.parse(fs.readFileSync(capture, 'utf8')) as {
    args: string[];
    body: string;
  };
  assert.deepEqual(captured.args.slice(0, 3), ['pr', 'edit', '7']);
  assert.equal(captured.args.includes('--issue'), false);
  assert.match(captured.body, /(?:^|\n)Closes #456(?:\n|$)/);
  assert.match(
    JSON.stringify(server.requests.map((request) => request.body)),
    /issue-reference.*#456/,
  );
});

test('PR update aborts when the remote feature branch is stale', async (context) => {
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
  fs.appendFileSync(path.join(directory, 'README.md'), 'first feature commit\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feat: add first feature commit']);
  git(directory, ['push', '--quiet', '-u', 'origin', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'unpublished feature commit\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'fix: add unpublished commit']);

  const capture = path.join(directory, 'gh-capture.json');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context);
  const env = customEnvironment(server.baseURL);
  env.PATH = `${fakeBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_CAPTURE_PATH = capture;
  env.GH_EXISTING_PR = '1';
  env.GH_EXISTING_PR_HEAD = git(directory, ['rev-parse', 'HEAD']).trim();

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /does not match the reviewed evidence/);
  assert.equal(fs.existsSync(capture), false);
});

test('PR creation aborts when a divergent remote feature rejects the push', async (context) => {
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
  fs.appendFileSync(path.join(directory, 'README.md'), 'shared feature root\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feat: add shared feature root']);
  git(directory, ['push', '--quiet', '-u', 'origin', 'feature']);
  const sharedHead = git(directory, ['rev-parse', 'HEAD']).trim();
  const sharedTree = git(directory, ['rev-parse', `${sharedHead}^{tree}`]).trim();
  fs.appendFileSync(path.join(directory, 'README.md'), 'local divergence\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'fix: add local divergence']);
  const remoteDivergence = git(directory, [
    'commit-tree',
    sharedTree,
    '-p',
    sharedHead,
    '-m',
    'fix: add remote divergence',
  ]).trim();
  git(directory, [
    'push',
    '--quiet',
    'origin',
    `${remoteDivergence}:refs/heads/feature`,
  ]);

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
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Could not push the reviewed PR branch/);
  assert.equal(fs.existsSync(capture), false);
});

test('PR creation rejects a push URL for a different GitHub repository', async (context) => {
  const directory = createRepository(context);
  addPrMutationFixture(context, directory, false);
  const capture = path.join(directory, 'gh-capture.json');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context);
  const env = customEnvironment(server.baseURL);
  env.PATH = `${fakeBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_CAPTURE_PATH = capture;
  env.GIT_FAKE_PUSH_URL = 'https://github.com/attacker/wrong-repository.git';

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /push destination does not match/i);
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(capture), false);
});

test('PR creation rejects an origin URL with an explicit port', async (context) => {
  const directory = createRepository(context);
  addPrMutationFixture(context, directory, false);
  const capture = path.join(directory, 'gh-capture.json');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context);
  const env = customEnvironment(server.baseURL);
  env.PATH = `${fakeBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_CAPTURE_PATH = capture;
  env.GIT_FAKE_ORIGIN_URL =
    'https://github.enterprise.example:8443/diffwright/fixture.git';

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /not a supported GitHub repository URL/i);
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(capture), false);
});

test('PR creation rejects a sensitive SCP username before provider work', async (context) => {
  const directory = createRepository(context);
  addPrMutationFixture(context, directory, false);
  const capture = path.join(directory, 'gh-capture.json');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context);
  const env = customEnvironment(server.baseURL);
  env.PATH = `${fakeBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_CAPTURE_PATH = capture;
  const secretUsername = 'sensitive_username_token';
  env.GIT_FAKE_PUSH_URL =
    `${secretUsername}@github.com:diffwright/fixture.git`;

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /not a supported GitHub repository URL/i);
  assert.doesNotMatch(result.stdout, new RegExp(secretUsername, 'u'));
  assert.doesNotMatch(result.stderr, new RegExp(secretUsername, 'u'));
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(capture), false);
});

test('PR mutation aborts when the remote base moves during GitHub lookup', async (context) => {
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
  const baseSha = git(directory, ['rev-parse', 'HEAD']).trim();
  const baseTree = git(directory, ['rev-parse', `${baseSha}^{tree}`]).trim();
  const movedBase = git(directory, [
    'commit-tree',
    baseTree,
    '-p',
    baseSha,
    '-m',
    'chore: move remote base during review',
  ]).trim();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-remote-'));
  context.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  git(remote, ['init', '--quiet', '--bare']);
  git(directory, ['remote', 'add', 'origin', remote]);
  git(directory, ['push', '--quiet', '-u', 'origin', 'main']);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'remote race fixture\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'fix: add remote race fixture']);
  git(directory, ['push', '--quiet', '-u', 'origin', 'feature']);

  const capture = path.join(directory, 'gh-capture.json');
  const counter = path.join(directory, 'gh-list-count.txt');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context);
  const env = customEnvironment(server.baseURL);
  env.PATH = `${fakeBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_CAPTURE_PATH = capture;
  env.GH_EXISTING_PR = '1';
  env.GH_EXISTING_PR_HEAD = git(directory, ['rev-parse', 'HEAD']).trim();
  env.GH_LIST_COUNTER_PATH = counter;
  env.GH_MOVE_BASE_SHA = movedBase;

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /base changed after evidence collection/i);
  assert.equal(fs.existsSync(capture), false);
});

test('PR discovery fails closed when the final GitHub lookup is malformed', async (context) => {
  const directory = createRepository(context);
  addPrMutationFixture(context, directory);
  const capture = path.join(directory, 'gh-capture.json');
  const counter = path.join(directory, 'gh-list-count.txt');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context);
  const env = customEnvironment(server.baseURL);
  env.PATH = `${fakeBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_CAPTURE_PATH = capture;
  env.GH_LIST_COUNTER_PATH = counter;
  env.GH_LIST_RAW_ON_SECOND = '{malformed';

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /could not inspect existing pull requests/i);
  assert.equal(fs.existsSync(capture), false);
});

test('PR update refuses a cross-repository pull request with the same head name', async (context) => {
  const directory = createRepository(context);
  const { reviewedHead } = addPrMutationFixture(context, directory);
  const capture = path.join(directory, 'gh-capture.json');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context);
  const env = customEnvironment(server.baseURL);
  env.PATH = `${fakeBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_CAPTURE_PATH = capture;
  env.GH_EXISTING_PR = '1';
  env.GH_EXISTING_PR_HEAD = reviewedHead;
  env.GH_CROSS_REPOSITORY = '1';

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /belongs to another repository/i);
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(capture), false);
});

test('PR update explains how to resolve a reviewed-head mismatch', async (context) => {
  const directory = createRepository(context);
  const { reviewedHead } = addPrMutationFixture(context, directory);
  const capture = path.join(directory, 'gh-capture.json');
  const fakeBin = createFakeGh(context, capture);
  const server = await createCompletionServer(context);
  const env = customEnvironment(server.baseURL);
  env.PATH = `${fakeBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_CAPTURE_PATH = capture;
  env.GH_EXISTING_PR = '1';
  env.GH_EXISTING_PR_HEAD = git(directory, ['rev-parse', 'main']).trim();

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.notEqual(env.GH_EXISTING_PR_HEAD, reviewedHead);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Push the reviewed HEAD and retry/i);
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(capture), false);
});

test('PR creation pushes the immutable reviewed SHA when the local branch moves', async (context) => {
  const directory = createRepository(context);
  const { remote, reviewedHead } = addPrMutationFixture(
    context,
    directory,
    false,
  );
  const capture = path.join(directory, 'gh-capture.json');
  const movedShaPath = path.join(directory, 'moved-sha.txt');
  const fakeGh = createFakeGh(context, capture);
  const gitWrapper = createGitPushRaceWrapper(context);
  const server = await createCompletionServer(context);
  const env = customEnvironment(server.baseURL);
  env.PATH = [gitWrapper, fakeGh, env.PATH ?? ''].join(path.delimiter);
  env.GH_CAPTURE_PATH = capture;
  env.GIT_MOVE_FEATURE_ON_PUSH = '1';
  env.GIT_MOVED_SHA_PATH = movedShaPath;

  const result = await run(
    directory,
    [
      'pr',
      '--base',
      'main',
      '--create-pr',
      '--yes',
      '--skip-format',
    ],
    env,
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /HEAD changed after evidence collection/i);
  assert.notEqual(fs.readFileSync(movedShaPath, 'utf8'), reviewedHead);
  assert.equal(
    git(remote, ['rev-parse', 'refs/heads/feature']).trim(),
    reviewedHead,
  );
  assert.equal(fs.existsSync(capture), false);
});
