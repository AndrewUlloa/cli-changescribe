import assert from 'node:assert/strict';
import test from 'node:test';

type CliCall = ['commit' | 'doctor' | 'pr', string[]] | ['init'];

interface CliRunners {
  runCommit(args: string[]): Promise<void>;
  runDoctor(args: string[]): Promise<void>;
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
      runDoctor: async (args: string[]) => {
        calls.push(['doctor', args]);
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

test('each command exposes focused help with its real options and side effects', async () => {
  const cases = [
    {
      invocation: ['commit', '--help'],
      expected: [/Usage: diffwright commit/, /--dry-run/, /stages all changes/i],
    },
    {
      invocation: ['pr', '--help'],
      expected: [/Usage: diffwright pr/, /--create-pr/, /--issue <number>/],
    },
    {
      invocation: ['doctor', '--help'],
      expected: [/Usage: diffwright doctor/, /--live/, /one provider request/i],
    },
    {
      invocation: ['init', '--help'],
      expected: [/Usage: diffwright init/, /package\.json/, /accepts no options/i],
    },
  ];

  for (const { invocation, expected } of cases) {
    const { calls, runners } = recordingRunners();
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => output.push(String(message ?? ''));
    try {
      assert.equal(await runCli(invocation, runners), 0);
    } finally {
      console.log = originalLog;
    }
    assert.deepEqual(calls, []);
    for (const pattern of expected) {
      assert.match(output.join('\n'), pattern, invocation.join(' '));
    }
  }
});

test('global help links to the complete CLI reference', async () => {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => output.push(String(message ?? ''));
  try {
    assert.equal(await runCli(['--help']), 0);
  } finally {
    console.log = originalLog;
  }

  assert.match(
    output.join('\n'),
    /github\.com\/AndrewUlloa\/diffwright\/blob\/main\/documentation\/cli-reference\.md/,
  );
});

test('unknown commit, doctor, and init options fail before invoking a runner', async () => {
  const { calls, runners } = recordingRunners();

  assert.equal(await runCli(['commit', '--dry-rnu'], runners), 1);
  assert.equal(await runCli(['commit', '--dry-run', 'extra'], runners), 1);
  assert.equal(await runCli(['doctor', '--network'], runners), 1);
  assert.equal(await runCli(['init', '--force'], runners), 1);

  assert.deepEqual(calls, []);
});

test('invalid PR options fail before invoking a runner', async () => {
  const invalidInvocations = [
    ['pr', '--base'],
    ['pr', '--out', '--dry-run'],
    ['pr', '--limit', '0'],
    ['pr', '--limit', 'abc'],
    ['pr', '--mode', 'other'],
    ['pr', '--issue', '#0'],
    ['pr', '--issue', 'abc'],
    ['pr', '--wat'],
  ];

  for (const invocation of invalidInvocations) {
    const { calls, runners } = recordingRunners();
    assert.equal(await runCli(invocation, runners), 1, invocation.join(' '));
    assert.deepEqual(calls, [], invocation.join(' '));
  }
});

test('valid doctor and PR options still reach their runners unchanged', async () => {
  const { calls, runners } = recordingRunners();

  assert.equal(await runCli(['doctor', '--live'], runners), 0);
  assert.equal(
    await runCli(
      [
        'pr',
        '--base',
        'develop',
        '--out',
        'summary.md',
        '--limit',
        '12',
        '--issue',
        '#34',
        '--mode',
        'feature',
        '--dry-run',
        '--create-pr',
        '--skip-format',
      ],
      runners,
    ),
    0,
  );

  assert.deepEqual(calls, [
    ['doctor', ['--live']],
    [
      'pr',
      [
        '--base',
        'develop',
        '--out',
        'summary.md',
        '--limit',
        '12',
        '--issue',
        '#34',
        '--mode',
        'feature',
        '--dry-run',
        '--create-pr',
        '--skip-format',
      ],
    ],
  ]);
});
