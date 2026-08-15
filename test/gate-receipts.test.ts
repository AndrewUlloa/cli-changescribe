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
    },
  ): {
    id: string;
    command: { file: string; args: readonly string[]; display: string };
    status: 'passed' | 'failed' | 'skipped';
    exitCode: number | null;
    durationMs: number;
    source: 'diffwright' | 'external';
  };
  createSkippedGateReceipt(
    id: string,
    command: { file: string; args: readonly string[]; display: string },
  ): {
    status: string;
    exitCode: number | null;
    durationMs: number;
  };
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
      options: { cwd: '/fixture', encoding: 'utf8', stdio: 'inherit' },
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
  assert.deepEqual(receipts.createSkippedGateReceipt('gate-format', command), {
    id: 'gate-format',
    command,
    status: 'skipped',
    exitCode: null,
    durationMs: 0,
    source: 'diffwright',
  });

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
