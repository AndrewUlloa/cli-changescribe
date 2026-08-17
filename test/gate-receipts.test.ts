import assert from 'node:assert/strict';
import test from 'node:test';
import type { SpawnSyncReturns } from 'node:child_process';

interface CommandRunner {
  exec(): string;
  spawn(
    file: string,
    args: readonly string[],
    options?: Record<string, unknown>,
  ): SpawnSyncReturns<string>;
}

interface GateReceiptsModule {
  runGateReceipt(
    id: string,
    command: { file: string; args: readonly string[]; display: string },
    options: {
      cwd?: string;
      runner: CommandRunner;
      clock?: () => number;
      resultParser?: 'tap';
      writeStdout?: (output: string) => void;
      writeStderr?: (output: string) => void;
    },
  ): {
    id: string;
    command: { file: string; args: readonly string[]; display: string };
    status: 'passed' | 'failed' | 'skipped';
    exitCode: number | null;
    durationMs: number;
    source: 'diffwright' | 'external';
    result?: {
      type: 'test-summary';
      tests: number;
      passed: number;
      failed: number;
      skipped: number;
      cancelled: number;
      todo: number;
    };
    limitation?: 'output-unrecognized';
    skipReason?: 'not-configured' | 'user-requested';
  };
  createSkippedGateReceipt(
    id: string,
    command: { file: string; args: readonly string[]; display: string },
    reason: 'not-configured' | 'user-requested',
  ): {
    status: string;
    exitCode: number | null;
    durationMs: number;
    skipReason: string;
  };
  parseTapTestSummary(output: string): unknown;
  requirePassedGate(
    receipt: { status: string; command: { display: string } },
    guidance: string,
  ): void;
}

const receipts: GateReceiptsModule = require('../dist/gate-receipts.js');

function spawnResult(status: number): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: [null, '', ''],
    stdout: '',
    stderr: '',
    status,
    signal: null,
  };
}

test('records the exact successful command, status, and duration', () => {
  const calls: Array<{
    file: string;
    args: readonly string[];
    options?: Record<string, unknown>;
  }> = [];
  const runner: CommandRunner = {
    exec: () => '',
    spawn(file, args, options) {
      calls.push({ file, args, options });
      return spawnResult(0);
    },
  };
  const times = [100, 137];
  const receipt = receipts.runGateReceipt(
    'gate-test',
    { file: 'pnpm', args: ['run', 'test'], display: 'pnpm run test' },
    {
      cwd: '/fixture',
      runner,
      clock: () => times.shift() ?? 137,
    },
  );

  assert.deepEqual(calls, [
    {
      file: 'pnpm',
      args: ['run', 'test'],
      options: {
        cwd: '/fixture',
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: 'pipe',
      },
    },
  ]);
  assert.deepEqual(receipt, {
    id: 'gate-test',
    command: {
      file: 'pnpm',
      args: ['run', 'test'],
      display: 'pnpm run test',
    },
    status: 'passed',
    exitCode: 0,
    durationMs: 37,
    source: 'diffwright',
  });
  assert.equal(Object.isFrozen(receipt), true);
});

test('records a nonzero gate as failed and never treats it as passed', () => {
  const runner: CommandRunner = {
    exec: () => '',
    spawn: () => spawnResult(17),
  };
  const receipt = receipts.runGateReceipt(
    'gate-build',
    { file: 'npm', args: ['run', 'build'], display: 'npm run build' },
    { runner, clock: () => 10 },
  );

  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.exitCode, 17);
  assert.throws(
    () => receipts.requirePassedGate(receipt, 'fix the build and retry'),
    /npm run build failed; fix the build and retry/,
  );
});

test('records skipped gates separately and rejects unstarted processes', () => {
  const command = {
    file: 'npm',
    args: ['run', 'format'],
    display: 'npm run format',
  };
  assert.deepEqual(
    receipts.createSkippedGateReceipt(
      'gate-format',
      command,
      'not-configured',
    ),
    {
    id: 'gate-format',
    command,
    status: 'skipped',
    exitCode: null,
    durationMs: 0,
    source: 'diffwright',
      skipReason: 'not-configured',
    },
  );

  const runner: CommandRunner = {
    exec: () => '',
    spawn: () => ({
      pid: 0,
      output: [null, null, null],
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: new Error('secret process detail'),
    }),
  };
  assert.throws(
    () => receipts.runGateReceipt('gate-test', command, { runner }),
    /^Error: Could not run npm run format\.$/,
  );
});

test('parses bounded root TAP totals and re-emits raw output locally', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: example',
    'ok 1 - example',
    '1..3',
    '# tests 3',
    '# suites 1',
    '# pass 2',
    '# fail 0',
    '# cancelled 0',
    '# skipped 1',
    '# todo 0',
    '# duration_ms 42.5',
    '',
  ].join('\n');
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runner: CommandRunner = {
    exec: () => '',
    spawn: () => ({ ...spawnResult(0), stdout: tap, stderr: 'local warning\n' }),
  };
  const receipt = receipts.runGateReceipt(
    'gate-test',
    { file: 'npm', args: ['test'], display: 'npm test' },
    {
      runner,
      resultParser: 'tap',
      writeStdout: (output) => stdout.push(output),
      writeStderr: (output) => stderr.push(output),
      clock: () => 10,
    },
  );

  assert.deepEqual(receipt.result, {
    type: 'test-summary',
    tests: 3,
    passed: 2,
    failed: 0,
    skipped: 1,
    cancelled: 0,
    todo: 0,
  });
  assert.equal(receipt.limitation, undefined);
  assert.deepEqual(stdout, [tap]);
  assert.deepEqual(stderr, ['local warning\n']);
});

test('marks unrecognized output without inventing test counts', () => {
  const runner: CommandRunner = {
    exec: () => '',
    spawn: () => ({ ...spawnResult(0), stdout: '3 examples, 0 failures\n' }),
  };
  const receipt = receipts.runGateReceipt(
    'gate-test',
    { file: 'bundle', args: ['exec', 'test'], display: 'bundle exec test' },
    {
      runner,
      resultParser: 'tap',
      writeStdout: () => undefined,
      writeStderr: () => undefined,
    },
  );

  assert.equal(receipt.result, undefined);
  assert.equal(receipt.limitation, 'output-unrecognized');
});

test('uses only a complete final TAP summary and rejects injected duplicates', () => {
  const realSummary = [
    '1..1',
    '# tests 1',
    '# pass 1',
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
  ].join('\n');
  const injected = [
    '1..999',
    '# tests 999',
    '# pass 999',
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    realSummary,
  ].join('\n');

  assert.deepEqual(receipts.parseTapTestSummary(injected), {
    type: 'test-summary',
    tests: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    todo: 0,
  });
  assert.equal(
    receipts.parseTapTestSummary(`${realSummary}\n# tests 1`),
    null,
  );
});
