import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  completeChat(
    _resolved: unknown,
    input: { messages: Array<{ content?: unknown }> },
  ): Promise<{ content: string; reasoning: string; finishReason: string | null }>;
}

type RunCommit = (
  argv: string[],
  dependencies: CommitDependencies,
) => Promise<void>;

const { runCommit }: { runCommit: RunCommit } = require('../dist/commit.js');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function repository(context: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-commit-v2-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  git(directory, ['init', '--quiet', '--initial-branch=main']);
  git(directory, ['config', 'user.email', 'diffwright@example.test']);
  git(directory, ['config', 'user.name', 'Diffwright Test']);
  fs.writeFileSync(path.join(directory, 'README.md'), '# fixture\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'chore: create fixture']);
  return directory;
}

function dependencies(capture: {
  resolveCalls: number;
  completionCalls: number;
  prompt: string;
}, responses = [JSON.stringify(validDraft())]): CommitDependencies {
  return {
    loadRuntimeConfig: () => ({
      values: { CEREBRAS_API_KEY: 'test-key' },
      sources: { CEREBRAS_API_KEY: 'shell' },
    }),
    resolveProvider: () => {
      capture.resolveCalls += 1;
      return {
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
      };
    },
    completeChat: async (_resolved, input) => {
      capture.completionCalls += 1;
      capture.prompt = JSON.stringify(input.messages);
      return {
        content:
          responses[Math.min(capture.completionCalls - 1, responses.length - 1)] ??
          '',
        reasoning: '',
        finishReason: 'stop',
      };
    },
  };
}

function validDraft(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    title: {
      type: 'fix',
      breaking: false,
      subject: 'describe staged change',
    },
    claims: [
      {
        id: 'claim-change',
        kind: 'change',
        text: 'Describe the staged change.',
        evidenceIds: ['change-1'],
        basis: 'observed',
        significance: 'primary',
      },
    ],
    sections: [{ kind: 'summary', claimIds: ['claim-change'] }],
    trailers: [],
  };
}

function useRepository(context: TestContext, directory: string): void {
  const previous = process.cwd();
  context.after(() => process.chdir(previous));
  process.chdir(directory);
}

test('default commit refuses an empty index without mutation or provider work', async (context) => {
  const directory = repository(context);
  useRepository(context, directory);
  fs.appendFileSync(path.join(directory, 'README.md'), 'unstaged only\n');
  const statusBefore = git(directory, ['status', '--porcelain']);
  const capture = { resolveCalls: 0, completionCalls: 0, prompt: '' };

  await assert.rejects(
    runCommit([], dependencies(capture)),
    /No staged changes.*--all/,
  );

  assert.equal(capture.resolveCalls, 0);
  assert.equal(capture.completionCalls, 0);
  assert.equal(git(directory, ['status', '--porcelain']), statusBefore);
  assert.equal(git(directory, ['diff', '--staged']), '');
});

test('dry-run analyzes only staged content and leaves unrelated files unstaged', async (context) => {
  const directory = repository(context);
  useRepository(context, directory);
  fs.writeFileSync(path.join(directory, 'staged.txt'), 'staged-evidence\n');
  fs.writeFileSync(path.join(directory, 'unstaged.txt'), 'unstaged-private-value\n');
  git(directory, ['add', 'staged.txt']);
  const head = git(directory, ['rev-parse', 'HEAD']).trim();
  const capture = { resolveCalls: 0, completionCalls: 0, prompt: '' };

  await runCommit(['--dry-run'], dependencies(capture));

  assert.equal(capture.completionCalls, 1);
  assert.match(capture.prompt, /staged-evidence/);
  assert.doesNotMatch(capture.prompt, /unstaged-private-value/);
  assert.equal(git(directory, ['rev-parse', 'HEAD']).trim(), head);
  assert.match(git(directory, ['status', '--porcelain']), /\?\? unstaged\.txt/);
});

test('--all is the explicit stage-all path, including during dry-run', async (context) => {
  const directory = repository(context);
  useRepository(context, directory);
  fs.writeFileSync(path.join(directory, 'first.txt'), 'first change\n');
  fs.writeFileSync(path.join(directory, 'second.txt'), 'second change\n');
  const capture = { resolveCalls: 0, completionCalls: 0, prompt: '' };

  await runCommit(['--all', '--dry-run'], dependencies(capture));

  assert.equal(capture.completionCalls, 1);
  assert.match(capture.prompt, /first change/);
  assert.match(capture.prompt, /second change/);
  assert.match(git(directory, ['diff', '--staged', '--name-only']), /first\.txt/);
  assert.match(git(directory, ['diff', '--staged', '--name-only']), /second\.txt/);
});

test('a clean repository exits without resolving or calling a provider', async (context) => {
  const directory = repository(context);
  useRepository(context, directory);
  const capture = { resolveCalls: 0, completionCalls: 0, prompt: '' };

  await runCommit([], dependencies(capture));

  assert.equal(capture.resolveCalls, 0);
  assert.equal(capture.completionCalls, 0);
});

test('repairs one invalid draft from the original staged evidence', async (context) => {
  const directory = repository(context);
  useRepository(context, directory);
  fs.writeFileSync(path.join(directory, 'value.txt'), 'evidence-value\n');
  git(directory, ['add', 'value.txt']);
  const capture = { resolveCalls: 0, completionCalls: 0, prompt: '' };

  await runCommit(
    ['--dry-run'],
    dependencies(capture, ['not-json', JSON.stringify(validDraft())]),
  );

  assert.equal(capture.completionCalls, 2);
  assert.match(capture.prompt, /previous response failed deterministic validation/);
  assert.match(capture.prompt, /evidence-value/);
  assert.doesNotMatch(capture.prompt, /not-json/);
});

test('rejects an invented breaking change after one repair', async (context) => {
  const directory = repository(context);
  useRepository(context, directory);
  fs.writeFileSync(path.join(directory, 'value.txt'), 'ordinary change\n');
  git(directory, ['add', 'value.txt']);
  const capture = { resolveCalls: 0, completionCalls: 0, prompt: '' };
  const breakingDraft = validDraft();
  (breakingDraft.title as Record<string, unknown>).breaking = true;

  await assert.rejects(
    runCommit(
      ['--dry-run'],
      dependencies(capture, [JSON.stringify(breakingDraft)]),
    ),
    /invalid evidence-linked commit draft after one repair/,
  );
  assert.equal(capture.completionCalls, 2);
});

test('aborts before commit when the staged index moves during generation', async (context) => {
  const directory = repository(context);
  useRepository(context, directory);
  fs.writeFileSync(path.join(directory, 'value.txt'), 'first staged value\n');
  git(directory, ['add', 'value.txt']);
  const head = git(directory, ['rev-parse', 'HEAD']).trim();
  const capture = { resolveCalls: 0, completionCalls: 0, prompt: '' };
  const injected = dependencies(capture);
  const complete = injected.completeChat;
  injected.completeChat = async (resolved, input) => {
    const completion = await complete(resolved, input);
    fs.writeFileSync(path.join(directory, 'later.txt'), 'later staged value\n');
    git(directory, ['add', 'later.txt']);
    return completion;
  };

  await assert.rejects(
    runCommit([], injected),
    /Repository index changed after evidence collection/,
  );
  assert.equal(git(directory, ['rev-parse', 'HEAD']).trim(), head);
});

test('adds bounded source-agnostic context as provided evidence', async (context) => {
  const directory = repository(context);
  useRepository(context, directory);
  fs.writeFileSync(
    path.join(directory, 'intent.md'),
    'Preserve the staged-index contract while removing test-key from prompts.\n',
  );
  git(directory, ['add', 'intent.md']);
  git(directory, ['commit', '--quiet', '-m', 'docs: add intent fixture']);
  fs.writeFileSync(path.join(directory, 'value.txt'), 'staged implementation\n');
  git(directory, ['add', 'value.txt']);
  const capture = { resolveCalls: 0, completionCalls: 0, prompt: '' };

  await runCommit(
    ['--dry-run', '--context-file', 'intent.md'],
    dependencies(capture),
  );

  assert.match(capture.prompt, /staged-index contract/);
  assert.match(capture.prompt, /context-file/);
  assert.match(capture.prompt, /provided/);
  assert.match(capture.prompt, /\[REDACTED\]/);
  assert.doesNotMatch(capture.prompt, /test-key/);
});

test('validates context before the explicit stage-all mutation', async (context) => {
  const directory = repository(context);
  useRepository(context, directory);
  fs.writeFileSync(path.join(directory, 'value.txt'), 'leave unstaged\n');
  fs.symlinkSync(
    path.join(directory, 'README.md'),
    path.join(directory, 'unsafe-context.md'),
  );
  const capture = { resolveCalls: 0, completionCalls: 0, prompt: '' };

  await assert.rejects(
    runCommit(
      ['--all', '--context-file', 'unsafe-context.md'],
      dependencies(capture),
    ),
    /context file/i,
  );
  assert.equal(git(directory, ['diff', '--staged']), '');
  assert.equal(capture.resolveCalls, 0);
  assert.equal(capture.completionCalls, 0);
});
