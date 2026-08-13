import assert from 'node:assert/strict';
import test from 'node:test';

type CliCall = ['commit' | 'pr', string[]] | ['init'];

interface CliRunners {
  runCommit(args: string[]): Promise<void>;
  runInit(): Promise<void>;
  runPrSummary(args: string[]): Promise<void>;
}

type RunCli = (argv: string[], runners?: CliRunners) => Promise<number>;

const { runCli }: { runCli: RunCli } = require('../dist/cli.js');

function recordingRunners(): { calls: CliCall[]; runners: CliRunners } {
  const calls: CliCall[] = [];
  return {
    calls,
    runners: {
      runCommit: async (args: string[]) => {
        calls.push(['commit', args]);
      },
      runInit: async () => {
        calls.push(['init']);
      },
      runPrSummary: async (args: string[]) => {
        calls.push(['pr', args]);
      },
    },
  };
}

test('CLI routes primary commands and the PR alias', async () => {
  const { calls, runners } = recordingRunners();

  assert.equal(await runCli(['commit', '--dry-run'], runners), 0);
  assert.equal(await runCli(['init'], runners), 0);
  assert.equal(await runCli(['pr', '--base', 'develop'], runners), 0);
  assert.equal(await runCli(['pr:summary', '--dry-run'], runners), 0);

  assert.deepEqual(calls, [
    ['commit', ['--dry-run']],
    ['init'],
    ['pr', ['--base', 'develop']],
    ['pr', ['--dry-run']],
  ]);
});

test('CLI aliases prepend defaults while preserving later user overrides', async () => {
  const { calls, runners } = recordingRunners();

  assert.equal(
    await runCli(['feature:pr', '--dry-run', '--base', 'main'], runners),
    0,
  );
  assert.equal(
    await runCli(['staging:pr', '--dry-run', '--mode', 'feature'], runners),
    0,
  );

  assert.deepEqual(calls, [
    [
      'pr',
      [
        '--base',
        'staging',
        '--create-pr',
        '--mode',
        'feature',
        '--dry-run',
        '--base',
        'main',
      ],
    ],
    [
      'pr',
      [
        '--base',
        'main',
        '--create-pr',
        '--mode',
        'release',
        '--dry-run',
        '--mode',
        'feature',
      ],
    ],
  ]);
});

test('help does not invoke a command runner', async () => {
  const { calls, runners } = recordingRunners();

  assert.equal(await runCli(['commit', '--help'], runners), 0);
  assert.deepEqual(calls, []);
});
