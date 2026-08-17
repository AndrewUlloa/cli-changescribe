import assert from 'node:assert/strict';
import test from 'node:test';

type CliCall = [
  'commit' | 'doctor' | 'init' | 'merge' | 'pr' | 'title-check',
  string[],
];

interface CliRunners {
  runCommit(args: string[]): Promise<void>;
  runDoctor(args: string[]): Promise<void>;
  runInit(args: string[]): Promise<void>;
  runMerge(args: string[]): Promise<void>;
  runPrSummary(args: string[]): Promise<void>;
  runTitleCheck(args: string[]): Promise<void>;
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
      runInit: async (args: string[]) => {
        calls.push(['init', args]);
      },
      runMerge: async (args: string[]) => {
        calls.push(['merge', args]);
      },
      runPrSummary: async (args: string[]) => {
        calls.push(['pr', args]);
      },
      runTitleCheck: async (args: string[]) => {
        calls.push(['title-check', args]);
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
  assert.equal(await runCli(['merge', '--dry-run'], runners), 0);
  assert.equal(
    await runCli(['title-check', '--event-file', 'event.json'], runners),
    0,
  );

  assert.deepEqual(calls, [
    ['commit', ['--dry-run']],
    ['init', []],
    ['pr', ['--base', 'develop']],
    ['pr', ['--dry-run']],
    ['merge', ['--dry-run']],
    ['title-check', ['--event-file', 'event.json']],
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
  assert.equal(await runCli(['commit', '--all', '--help'], runners), 0);
  assert.deepEqual(calls, []);
});

test('each command exposes focused help with its real options and side effects', async () => {
  const cases = [
    {
      invocation: ['title-check', '--help'],
      expected: [
        /Usage: diffwright title-check/,
        /--event-file <path>/,
        /base revision/i,
        /no provider, network, or GitHub mutation/i,
      ],
    },
    {
      invocation: ['merge', '--help'],
      expected: [
        /Usage: diffwright merge/,
        /--dry-run/,
        /--yes/,
        /squash/i,
        /Conventional Commit title/i,
      ],
    },
    {
      invocation: ['commit', '--help'],
      expected: [
        /Usage: diffwright commit/,
        /--dry-run/,
        /--all/,
        /--context-file <path>/,
        /--timings/,
        /only the existing staged diff/i,
      ],
    },
    {
      invocation: ['pr', '--help'],
      expected: [
        /Usage: diffwright pr/,
        /--create-pr/,
        /--yes/,
        /--issue <number>/,
        /--context-file <path>/,
        /--timings/,
      ],
    },
    {
      invocation: ['doctor', '--help'],
      expected: [/Usage: diffwright doctor/, /--live/, /one provider request/i],
    },
    {
      invocation: ['init', '--help'],
      expected: [
        /Usage: diffwright init/,
        /interactive TTY/i,
        /headless/i,
        /--provider <id>/,
        /install.*Diffwright/i,
        /write.*package\.json/i,
        /offline doctor/i,
        /--live.*provider request/i,
      ],
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

test('unknown command options fail before invoking a runner', async () => {
  const { calls, runners } = recordingRunners();

  assert.equal(await runCli(['commit', '--dry-rnu'], runners), 1);
  assert.equal(await runCli(['commit', '--dry-run', 'extra'], runners), 1);
  assert.equal(await runCli(['commit', '--context-file'], runners), 1);
  assert.equal(await runCli(['pr', '--context-file'], runners), 1);
  assert.equal(await runCli(['doctor', '--network'], runners), 1);
  assert.equal(await runCli(['init', '--force'], runners), 1);
  assert.equal(await runCli(['merge', '--delete-branch'], runners), 1);
  assert.equal(await runCli(['merge', '--yes', '--dry-run'], runners), 1);
  assert.equal(await runCli(['title-check'], runners), 1);
  assert.equal(await runCli(['title-check', '--event-file'], runners), 1);
  assert.equal(
    await runCli(
      ['title-check', '--event-file', 'one.json', '--event-file', 'two.json'],
      runners,
    ),
    1,
  );
  assert.equal(
    await runCli(['title-check', '--event-file', 'event.json', '--network'], runners),
    1,
  );

  assert.deepEqual(calls, []);
});

test('commit and PR context files reach their runners unchanged', async () => {
  const { calls, runners } = recordingRunners();
  assert.equal(
    await runCli(
      ['commit', '--dry-run', '--context-file', 'intent.md'],
      runners,
    ),
    0,
  );
  assert.equal(
    await runCli(
      [
        'pr',
        '--context-file',
        'intent.md',
        '--context-file',
        'constraints.txt',
      ],
      runners,
    ),
    0,
  );
  assert.deepEqual(calls, [
    ['commit', ['--dry-run', '--context-file', 'intent.md']],
    [
      'pr',
      [
        '--context-file',
        'intent.md',
        '--context-file',
        'constraints.txt',
      ],
    ],
  ]);
});

test('valid init options reach the runner unchanged', async () => {
  const { calls, runners } = recordingRunners();
  const args = [
    '--yes',
    '--provider',
    'openrouter',
    '--model',
    'anthropic/claude-sonnet-4',
    '--base',
    'develop',
    '--agents',
    'codex,claude',
    '--credential-source',
    'file',
    '--live',
  ];

  assert.equal(await runCli(['init', ...args], runners), 0);
  assert.deepEqual(calls, [['init', args]]);
});

test('init accepts every supported provider id', async () => {
  for (const provider of [
    'openai',
    'anthropic',
    'google',
    'xai',
    'deepseek',
    'openrouter',
    'vercel',
    'cerebras',
    'groq',
    'ollama',
    'custom',
  ]) {
    const { calls, runners } = recordingRunners();
    assert.equal(await runCli(['init', '--provider', provider], runners), 0);
    assert.deepEqual(calls, [['init', ['--provider', provider]]]);
  }
});

test('init accepts each documented agent and credential-source selection', async () => {
  for (const agents of [
    'claude',
    'codex',
    'claude,codex',
    'codex,claude',
    'none',
  ]) {
    for (const source of ['existing', 'file']) {
      const { calls, runners } = recordingRunners();
      const args = [
        '--dry-run',
        '--agents',
        agents,
        '--credential-source',
        source,
      ];
      assert.equal(await runCli(['init', ...args], runners), 0);
      assert.deepEqual(calls, [['init', args]]);
    }
  }
});

test('invalid init values fail before invoking the runner', async () => {
  const invalidInvocations = [
    ['init', '--provider'],
    ['init', '--provider', '--yes'],
    ['init', '--provider', 'mystery'],
    ['init', '--model'],
    ['init', '--model', '   '],
    ['init', '--base'],
    ['init', '--base', '--yes'],
    ['init', '--base', 'feature branch'],
    ['init', '--base', 'main\nnext'],
    ['init', '--agents'],
    ['init', '--agents', 'claude,none'],
    ['init', '--agents', 'copilot'],
    ['init', '--credential-source'],
    ['init', '--credential-source', 'shell'],
    ['init', '--provider', 'openai', '--provider', 'groq'],
    ['init', '--model', 'model-a', '--model', 'model-b'],
    ['init', '--base', 'main', '--base', 'staging'],
    ['init', '--agents', 'claude', '--agents', 'codex'],
    ['init', '--credential-source', 'existing', '--credential-source', 'file'],
    ['init', '--live', '--dry-run'],
    ['init', '--dry-run', '--live'],
    ['init', '--wat'],
  ];

  for (const invocation of invalidInvocations) {
    const { calls, runners } = recordingRunners();
    assert.equal(await runCli(invocation, runners), 1, invocation.join(' '));
    assert.deepEqual(calls, [], invocation.join(' '));
  }
});

test('argument errors redact shell credentials and normalize control characters', async () => {
  const { calls, runners } = recordingRunners();
  const secretName = 'OPENAI_API_KEY';
  const originalSecret = process.env[secretName];
  const secret = 'argument-secret';
  const errors: string[] = [];
  const originalError = console.error;
  process.env[secretName] = secret;
  console.error = (message?: unknown) => errors.push(String(message ?? ''));
  try {
    assert.equal(await runCli(['commit', `${secret}\nnext-line`], runners), 1);
  } finally {
    console.error = originalError;
    if (originalSecret === undefined) {
      delete process.env[secretName];
    } else {
      process.env[secretName] = originalSecret;
    }
  }

  assert.deepEqual(calls, []);
  assert.doesNotMatch(errors.join('\n'), new RegExp(secret));
  assert.doesNotMatch(errors.join('\n'), /\nnext-line/);
  assert.match(errors.join('\n'), /Unknown commit option/);
});

test('unknown commands never echo attacker-controlled command text', async () => {
  const secret = 'unknown-command-secret';
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => errors.push(String(message ?? ''));
  try {
    assert.equal(await runCli([`${secret}\u001b[31m`]), 1);
  } finally {
    console.error = originalError;
  }

  assert.doesNotMatch(errors.join('\n'), new RegExp(secret));
  assert.doesNotMatch(errors.join('\n'), /\u001b/);
  assert.match(errors.join('\n'), /Unknown command/);
});

test('invalid PR options fail before invoking a runner', async () => {
  const invalidInvocations = [
    ['pr', '--base'],
    ['pr', '--out', '--dry-run'],
    ['pr', '--limit', '0'],
    ['pr', '--limit', 'abc'],
    ['pr', '--limit', '999999999999999999999999999999999999999'],
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
