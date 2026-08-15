import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

interface RenderedPullRequest {
  readonly title: string;
  readonly body: string;
  readonly warnings: readonly string[];
}

interface SpawnResult {
  readonly pid: number;
  readonly output: readonly unknown[];
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

interface SpawnRunner {
  spawn(
    file: string,
    args: readonly string[],
    options?: object,
  ): SpawnResult;
}

interface PrEditorModule {
  createProcessPrEditor(options?: {
    env?: NodeJS.ProcessEnv;
    runner?: SpawnRunner;
    temporaryRoot?: string;
  }): {
    edit(artifact: RenderedPullRequest): Promise<RenderedPullRequest>;
  };
}

const { createProcessPrEditor } = require('../dist/pr-editor.js') as PrEditorModule;

function temporaryDirectory(context: test.TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-editor-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('opens one fixed-argv editor and returns the edited artifact', async (context) => {
  const temporaryRoot = temporaryDirectory(context);
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const runner: SpawnRunner = {
    spawn(file, args) {
      calls.push({ file, args });
      fs.writeFileSync(
        args[0]!,
        'fix(editor): validate reviewed output\r\n\r\n## Summary\r\n\r\n- Keep the human in control.\r\n',
        'utf8',
      );
      return { pid: 1, output: [], stdout: '', stderr: '', status: 0, signal: null };
    },
  };
  const original = {
    title: 'fix: validate output',
    body: '## Summary\n\n- Validate output.',
    warnings: ['title warning'],
  };

  const edited = await createProcessPrEditor({
    env: { DIFFWRIGHT_EDITOR: '/usr/bin/example-editor' },
    runner,
    temporaryRoot,
  }).edit(original);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.file, '/usr/bin/example-editor');
  assert.equal(calls[0]?.args.length, 1);
  assert.match(calls[0]?.args[0] ?? '', /pull-request\.txt$/u);
  assert.equal(edited.title, 'fix(editor): validate reviewed output');
  assert.equal(
    edited.body,
    '## Summary\r\n\r\n- Keep the human in control.\r\n',
  );
  assert.deepEqual(edited.warnings, original.warnings);
  assert.deepEqual(fs.readdirSync(temporaryRoot), []);
});

test('rejects editor command strings instead of invoking a shell', async (context) => {
  const temporaryRoot = temporaryDirectory(context);
  let called = false;
  const runner: SpawnRunner = {
    spawn() {
      called = true;
      return { pid: 1, output: [], stdout: '', stderr: '', status: 0, signal: null };
    },
  };

  await assert.rejects(
    createProcessPrEditor({
      env: { EDITOR: 'code --wait' },
      runner,
      temporaryRoot,
    }).edit({
      title: 'fix: validate output',
      body: '## Summary\n\n- Validate output.',
      warnings: [],
    }),
    /one executable without arguments/,
  );
  assert.equal(called, false);
  assert.deepEqual(fs.readdirSync(temporaryRoot), []);
});

test('treats empty editor variables as unset without accepting whitespace commands', async (context) => {
  const temporaryRoot = temporaryDirectory(context);
  const calls: string[] = [];
  const artifact = {
    title: 'fix: validate output',
    body: '## Summary\n\n- Validate output.',
    warnings: [],
  };
  const runner: SpawnRunner = {
    spawn(file) {
      calls.push(file);
      return {
        pid: 1,
        output: [],
        stdout: '',
        stderr: '',
        status: 0,
        signal: null,
      };
    },
  };

  await createProcessPrEditor({
    env: { DIFFWRIGHT_EDITOR: '', EDITOR: 'nano' },
    runner,
    temporaryRoot,
  }).edit(artifact);
  await createProcessPrEditor({
    env: { DIFFWRIGHT_EDITOR: '', EDITOR: '' },
    runner,
    temporaryRoot,
  }).edit(artifact);
  await assert.rejects(
    createProcessPrEditor({
      env: { DIFFWRIGHT_EDITOR: '   ', EDITOR: 'nano' },
      runner,
      temporaryRoot,
    }).edit(artifact),
    /one executable without arguments/,
  );

  assert.deepEqual(calls, ['nano', 'vi']);
  assert.deepEqual(fs.readdirSync(temporaryRoot), []);
});

test('rejects unsuccessful editors and malformed edited files', async (context) => {
  const temporaryRoot = temporaryDirectory(context);
  const artifact = {
    title: 'fix: validate output',
    body: '## Summary\n\n- Validate output.',
    warnings: [],
  };
  const failedRunner: SpawnRunner = {
    spawn() {
      return { pid: 1, output: [], stdout: '', stderr: '', status: 1, signal: null };
    },
  };
  await assert.rejects(
    createProcessPrEditor({ runner: failedRunner, temporaryRoot }).edit(artifact),
    /did not exit successfully/,
  );

  const malformedRunner: SpawnRunner = {
    spawn(_file, args) {
      fs.writeFileSync(args[0]!, 'fix: no body separator\n', 'utf8');
      return { pid: 1, output: [], stdout: '', stderr: '', status: 0, signal: null };
    },
  };
  await assert.rejects(
    createProcessPrEditor({ runner: malformedRunner, temporaryRoot }).edit(artifact),
    /separated by a blank line/,
  );
});
