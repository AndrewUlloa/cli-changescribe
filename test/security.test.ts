import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

interface CommitDependencies {
  loadRuntimeConfig(): {
    values: Readonly<NodeJS.ProcessEnv>;
    sources: Readonly<Record<string, 'shell' | '.env.local'>>;
  };
  resolveProvider(): {
    profile: {
      id: 'cerebras';
      model: string;
      baseURL: string;
      credentialEnv: string;
      transport: 'openai-chat-completions';
      status: 'docs-verified';
      outputTokenField: 'max_completion_tokens';
    };
    credential: { value: string; source: 'shell' };
  };
  completeChat(): Promise<{
    content: string;
    reasoning: string;
    finishReason: string | null;
  }>;
}

type RunCommit = (
  argv: string[],
  dependencies: CommitDependencies,
) => Promise<void>;

const bin = path.resolve(__dirname, '..', 'bin', 'diffwright.js');
const { runCommit }: { runCommit: RunCommit } = require('../dist/commit.js');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function createRepository(context: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-security-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  git(directory, ['init', '--quiet', '--initial-branch=main']);
  git(directory, ['config', 'user.email', 'diffwright@example.test']);
  git(directory, ['config', 'user.name', 'Diffwright Test']);
  fs.writeFileSync(path.join(directory, 'README.md'), '# fixture\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'initial']);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'change\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feature change']);
  return directory;
}

test('PR base refs are passed to Git without shell evaluation', (context) => {
  const directory = createRepository(context);
  const marker = path.join(directory, 'injected');
  const maliciousBase = `main;touch ${marker}`;

  const result = spawnSync(bin, ['pr', '--dry-run', '--base', maliciousBase], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, CEREBRAS_API_KEY: 'test-key' },
  });

  assert.notEqual(result.status, null, result.stderr);
  assert.equal(fs.existsSync(marker), false);
});

test('PR rejects option-like base refs before Git can execute an upload-pack helper', (context) => {
  const directory = createRepository(context);
  const remote = path.join(directory, 'remote.git');
  git(directory, ['init', '--quiet', '--bare', remote]);
  git(directory, ['remote', 'add', 'origin', remote]);

  const marker = path.join(directory, 'upload-pack-ran');
  const probe = path.join(directory, 'upload-pack-probe.sh');
  fs.writeFileSync(
    probe,
    `#!/bin/sh\ntouch ${marker}\nexit 1\n`,
    { encoding: 'utf8', mode: 0o700 },
  );

  const result = spawnSync(
    bin,
    ['pr', '--dry-run', '--base', `--upload-pack=${probe}`],
    {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, CEREBRAS_API_KEY: 'test-key' },
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--base requires a value/i);
  assert.equal(fs.existsSync(marker), false);
});

test('a mistyped commit dry-run flag fails before provider, commit, or push work', (context) => {
  const directory = createRepository(context);
  fs.appendFileSync(path.join(directory, 'README.md'), 'uncommitted change\n');
  const head = git(directory, ['rev-parse', 'HEAD']).trim();
  const status = git(directory, ['status', '--porcelain']);

  const result = spawnSync(bin, ['commit', '--dry-rnu'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, CEREBRAS_API_KEY: 'test-key' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown commit option/);
  assert.equal(git(directory, ['rev-parse', 'HEAD']).trim(), head);
  assert.equal(git(directory, ['status', '--porcelain']), status);
  assert.doesNotMatch(result.stdout, /Generating commit message|Staging all changes/);
});

test('PR dry-run inspects a valid range without API calls or output writes', (context) => {
  const directory = createRepository(context);
  const output = path.join(directory, 'summary.md');
  const headBefore = git(directory, ['rev-parse', 'HEAD']).trim();

  const result = spawnSync(
    bin,
    ['pr', '--dry-run', '--base', 'main', '--out', output],
    {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, CEREBRAS_API_KEY: 'test-key' },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run \(no API calls\)/);
  assert.match(result.stdout, /Provider: cerebras/);
  assert.match(result.stdout, /Model: gpt-oss-120b/);
  assert.equal(fs.existsSync(output), false);
  assert.equal(git(directory, ['rev-parse', 'HEAD']).trim(), headBefore);
});

test('invalid PR_SUMMARY_LIMIT fails instead of removing the commit cap', (context) => {
  const directory = createRepository(context);
  const output = path.join(directory, 'summary.md');

  for (const limit of ['abc', '0', '-1', '999999999999999999999999999']) {
    const result = spawnSync(
      bin,
      ['pr', '--dry-run', '--base', 'main', '--out', output],
      {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          CEREBRAS_API_KEY: 'test-key',
          PR_SUMMARY_LIMIT: limit,
        },
      },
    );

    assert.equal(result.status, 1, limit);
    assert.match(result.stderr, /PR_SUMMARY_LIMIT must be a positive safe integer/);
    assert.equal(fs.existsSync(output), false);
    assert.doesNotMatch(result.stdout, /Fetching base branch|Collecting/);
  }
});

test('commit dry-run treats staged filenames as data and never commits', async (context) => {
  const directory = createRepository(context);
  const previousDirectory = process.cwd();
  context.after(() => process.chdir(previousDirectory));
  process.chdir(directory);

  const marker = path.join(directory, 'injected');
  const maliciousFilename = 'change$(touch${IFS}injected).ts';
  fs.writeFileSync(path.join(directory, maliciousFilename), 'export {};\n');
  git(directory, ['add', maliciousFilename]);
  const headBefore = git(directory, ['rev-parse', 'HEAD']).trim();
  let completionCalls = 0;
  await runCommit(['--dry-run'], {
    loadRuntimeConfig: () => ({
      values: { CEREBRAS_API_KEY: 'test-key' },
      sources: { CEREBRAS_API_KEY: 'shell' },
    }),
    resolveProvider: () => ({
      profile: {
        id: 'cerebras',
        model: 'test-model',
        baseURL: 'https://api.cerebras.ai/v1',
        credentialEnv: 'CEREBRAS_API_KEY',
        transport: 'openai-chat-completions',
        status: 'docs-verified',
        outputTokenField: 'max_completion_tokens',
      },
      credential: { value: 'test-key', source: 'shell' },
    }),
    completeChat: async () => {
      completionCalls += 1;
      return {
        content: JSON.stringify({
          schemaVersion: 1,
          title: {
            type: 'fix',
            breaking: false,
            subject: 'prevent unsafe command parsing',
          },
          claims: [
            {
              id: 'claim-change',
              kind: 'change',
              text: 'Treat staged filenames as data.',
              evidenceIds: ['change-1'],
              basis: 'observed',
              significance: 'primary',
            },
          ],
          sections: [
            { kind: 'summary', claimIds: ['claim-change'] },
          ],
          trailers: [],
        }),
        reasoning: '',
        finishReason: 'stop',
      };
    },
  });

  assert.equal(completionCalls, 1);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(git(directory, ['rev-parse', 'HEAD']).trim(), headBefore);
  assert.match(git(directory, ['status', '--porcelain']), /change\$\(touch/);
});
