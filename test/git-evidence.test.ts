import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  git,
  materializeRepository,
  type RepositoryFixture,
} from './git-fixture';

interface ChangeItem {
  id: string;
  kind: 'change';
  payload: {
    status:
      | 'added'
      | 'modified'
      | 'deleted'
      | 'renamed'
      | 'copied'
      | 'type-changed';
    oldPath?: string;
    path: string;
    additions: number | null;
    deletions: number | null;
    binary: boolean;
    patch: string | null;
  };
}

interface EvidenceBundle {
  schemaVersion: 1;
  snapshot: {
    headSha: string;
    baseRef?: string;
    baseSha?: string;
    mergeBaseSha?: string;
  };
  items: ChangeItem[];
  receipts: [];
  coverage: {
    complete: boolean;
    gaps: Array<{
      source: string;
      reason: string;
      locator?: string;
      omittedBytes?: number;
    }>;
  };
}

interface HistoryItem {
  id: string;
  kind: 'history';
  basis: 'provided';
  source: { kind: string; locator: string };
  payload: { sha: string; subject: string; body: string };
}

interface GitEvidenceModule {
  collectPullRequestEvidenceSnapshot(options: {
    baseBranch: string;
    cwd?: string;
    fetch?: boolean;
    maxPatchCharsPerFile?: number;
    maxTotalPatchChars?: number;
    historyLimit?: number;
  }, runner?: CommandRunner): PullRequestEvidenceSnapshot;
  collectPullRequestEvidence(options: {
    baseBranch: string;
    cwd?: string;
    fetch?: boolean;
    maxPatchCharsPerFile?: number;
    maxTotalPatchChars?: number;
    historyLimit?: number;
  }, runner?: CommandRunner): EvidenceBundle;
  assertEvidenceSnapshotCurrent(
    snapshot: EvidenceBundle['snapshot'],
    cwd?: string,
    runner?: CommandRunner,
  ): void;
  assertRemoteEvidenceBaseCurrent(
    snapshot: EvidenceBundle['snapshot'],
    baseBranch: string,
    cwd?: string,
    runner?: CommandRunner,
  ): void;
  assertRemoteEvidenceHeadCurrent(
    snapshot: EvidenceBundle['snapshot'],
    headBranch: string,
    cwd?: string,
    runner?: CommandRunner,
  ): void;
}

interface PullRequestEvidenceSnapshot {
  readonly evidence: EvidenceBundle;
  readonly historyAdjacency: readonly Readonly<{
    historyId: string;
    changeEvidenceIds: readonly string[];
  }>[];
  readonly historyTruncated: boolean;
}

interface CommandRunner {
  exec(
    file: string,
    args: readonly string[],
    options?: Record<string, unknown>,
  ): string;
  spawn(
    file: string,
    args: readonly string[],
    options?: Record<string, unknown>,
  ): unknown;
}

const gitEvidence: GitEvidenceModule = require('../dist/git-evidence.js');
const { defaultCommandRunner }: { defaultCommandRunner: CommandRunner } = require(
  '../dist/subprocess.js'
);
const repoRoot = path.resolve(__dirname, '..');

interface Corpus {
  repositoryCases: Array<
    RepositoryFixture & {
      expected: { nameStatus: string[] };
    }
  >;
}

function loadCorpus(): Corpus {
  return JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'fixtures', 'evidence-v2', 'corpus.json'),
      'utf8',
    ),
  );
}

function fixture(id: string): RepositoryFixture {
  const found = loadCorpus().repositoryCases.find(
    (candidate) => candidate.id === id,
  );
  assert.ok(found, `Missing fixture ${id}`);
  return found;
}

function patchFailingRunner(failure: unknown): CommandRunner {
  return {
    exec(file, args, options) {
      if (
        file === 'git' &&
        args[0] === 'diff' &&
        args.includes('--unified=3')
      ) {
        throw failure;
      }
      return defaultCommandRunner.exec(file, args, options);
    },
    spawn(file, args, options) {
      return defaultCommandRunner.spawn(file, args, options);
    },
  };
}

function nodeMaxBufferError(): Error {
  try {
    defaultCommandRunner.exec(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(1024))'],
      { encoding: 'utf8', maxBuffer: 1, stdio: 'pipe' },
    );
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  throw new Error('Expected Node to reject output beyond maxBuffer.');
}

test('collects delete-only evidence with the removed patch', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
  });

  assert.equal(bundle.coverage.complete, true);
  assert.equal(bundle.items.length, 1);
  assert.equal(bundle.items[0].payload.status, 'deleted');
  assert.equal(bundle.items[0].payload.path, 'src/legacy.ts');
  assert.match(bundle.items[0].payload.patch ?? '', /-export const legacy/);
});

test('collects rename evidence with both paths and rename metadata', (context) => {
  const repository = materializeRepository(fixture('rename'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
  });
  const change = bundle.items[0];
  assert.equal(change.payload.status, 'renamed');
  assert.equal(change.payload.oldPath, 'src/old.ts');
  assert.equal(change.payload.path, 'src/new.ts');
  assert.match(change.payload.patch ?? '', /rename from src\/old\.ts/);
  assert.match(change.payload.patch ?? '', /rename to src\/new\.ts/);
});

test('uses the final net diff and excludes reverted intermediate values', (context) => {
  const reverted = materializeRepository(fixture('revert-to-base'));
  const replaced = materializeRepository(fixture('revert-then-replace'));
  context.after(() => {
    fs.rmSync(reverted.directory, { recursive: true, force: true });
    fs.rmSync(replaced.directory, { recursive: true, force: true });
  });

  const empty = gitEvidence.collectPullRequestEvidence({
    cwd: reverted.directory,
    baseBranch: reverted.baseBranch,
    fetch: false,
  });
  assert.deepEqual(empty.items, []);
  assert.equal(empty.coverage.complete, true);

  const final = gitEvidence.collectPullRequestEvidence({
    cwd: replaced.directory,
    baseBranch: replaced.baseBranch,
    fetch: false,
  });
  assert.equal(final.items.length, 1);
  assert.match(final.items[0].payload.patch ?? '', /-timeout=30/);
  assert.match(final.items[0].payload.patch ?? '', /\+timeout=45/);
  assert.doesNotMatch(final.items[0].payload.patch ?? '', /timeout=60/);
});

test('collects bounded authored history from the pinned branch range', (context) => {
  const repository = materializeRepository({
    id: 'authored-history',
    baseFiles: { 'src/value.ts': 'export const value = 1;\n' },
    commits: [
      {
        message: 'feat: add intermediate value',
        body: 'Why: expose the first supported value.',
        operations: [
          {
            kind: 'write',
            path: 'src/value.ts',
            content: 'export const value = 2;\n',
          },
        ],
      },
      {
        message: 'refactor: rename the exported value',
        operations: [
          {
            kind: 'write',
            path: 'src/value.ts',
            content: 'export const currentValue = 2;\n',
          },
        ],
      },
      {
        message: 'fix: return the final value',
        body: 'Why: callers require the value to remain three.',
        operations: [
          {
            kind: 'write',
            path: 'src/value.ts',
            content: 'export const currentValue = 3;\n',
          },
        ],
      },
    ],
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
    historyLimit: 2,
  });
  const history = bundle.items.filter(
    (item) => (item as unknown as HistoryItem).kind === 'history',
  ) as unknown as HistoryItem[];

  assert.deepEqual(
    history.map((item) => item.payload.subject),
    ['refactor: rename the exported value', 'fix: return the final value'],
  );
  assert.equal(history[0].payload.body, '');
  assert.equal(
    history[1].payload.body,
    'Why: callers require the value to remain three.\n',
  );
  for (const item of history) {
    assert.equal(item.basis, 'provided');
    assert.equal(item.source.kind, 'git-history');
    assert.equal(item.source.locator, item.payload.sha);
    assert.match(item.payload.sha, /^[0-9a-f]{40}$/u);
  }
});

test('collects one bounded history adjacency batch and preserves zero-adjacency history', (context) => {
  const shaShapedPath = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const repository = materializeRepository({
    id: 'history-adjacency',
    baseFiles: {
      'src/value.ts': 'export const value = 1;\n',
      'src/remove.ts': 'export const remove = true;\n',
    },
    commits: [
      {
        message: 'feat: add reverted path',
        operations: [
          { kind: 'write', path: 'src/reverted.ts', content: 'temporary\n' },
        ],
      },
      {
        message: 'revert: remove reverted path',
        operations: [{ kind: 'delete', path: 'src/reverted.ts' }],
      },
      {
        message: 'refactor: rename value',
        operations: [
          {
            kind: 'rename',
            from: 'src/value.ts',
            path: 'src/current.ts',
          },
        ],
      },
      {
        message: 'fix: update final paths',
        operations: [
          {
            kind: 'write',
            path: 'src/current.ts',
            content: 'export const value = 2;\n',
          },
          { kind: 'delete', path: 'src/remove.ts' },
          { kind: 'write', path: shaShapedPath, content: 'safe path\n' },
        ],
      },
    ],
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  const diffTreeCalls: Array<{
    args: readonly string[];
    input: unknown;
    maxBuffer: unknown;
  }> = [];
  const runner: CommandRunner = {
    exec(file, args, options) {
      if (file === 'git' && args[0] === 'diff-tree') {
        diffTreeCalls.push({
          args: [...args],
          input: options?.input,
          maxBuffer: options?.maxBuffer,
        });
      }
      return defaultCommandRunner.exec(file, args, options);
    },
    spawn(file, args, options) {
      return defaultCommandRunner.spawn(file, args, options);
    },
  };

  const snapshot = gitEvidence.collectPullRequestEvidenceSnapshot(
    {
      cwd: repository.directory,
      baseBranch: repository.baseBranch,
      fetch: false,
      historyLimit: 10,
    },
    runner,
  );
  const histories = snapshot.evidence.items.filter(
    (item) => (item as unknown as HistoryItem).kind === 'history',
  ) as unknown as HistoryItem[];
  assert.equal(diffTreeCalls.length, 1);
  assert.deepEqual(diffTreeCalls[0]?.args, [
    'diff-tree',
    '--stdin',
    '--always',
    '--root',
    '-r',
    '--name-status',
    '-z',
    '--find-renames',
  ]);
  assert.equal(
    diffTreeCalls[0]?.input,
    `${histories.map((item) => item.payload.sha).join('\n')}\n`,
  );
  assert.equal(diffTreeCalls[0]?.maxBuffer, 10 * 1024 * 1024);
  assert.deepEqual(
    snapshot.historyAdjacency.map((entry) => ({
      historyId: entry.historyId,
      paths: entry.changeEvidenceIds.map(
        (id) =>
          snapshot.evidence.items.find((item) => item.id === id)?.payload.path,
      ),
    })),
    [
      { historyId: 'history-1', paths: [] },
      { historyId: 'history-2', paths: [] },
      {
        historyId: 'history-3',
        paths: ['src/current.ts', 'src/value.ts'],
      },
      {
        historyId: 'history-4',
        paths: [shaShapedPath, 'src/current.ts', 'src/remove.ts'],
      },
    ],
  );
  assert.equal(snapshot.historyTruncated, false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.historyAdjacency), true);
  assert.equal(Object.isFrozen(snapshot.historyAdjacency[0]), true);
  assert.equal(
    Object.isFrozen(snapshot.historyAdjacency[0]?.changeEvidenceIds),
    true,
  );
  assert.equal(
    gitEvidence.collectPullRequestEvidence(
      {
        cwd: repository.directory,
        baseBranch: repository.baseBranch,
        fetch: false,
        historyLimit: 10,
      },
      runner,
    ).schemaVersion,
    snapshot.evidence.schemaVersion,
  );
});

test('accepts copy and type-change records in the NUL adjacency stream', (context) => {
  const repository = materializeRepository({
    id: 'copy-type-history-adjacency',
    baseFiles: { 'src/value.ts': 'export const value = 0;\n' },
    commits: [1, 2].map((value) => ({
      message: `feat: set parser value ${value}`,
      operations: [
        {
          kind: 'write' as const,
          path: 'src/value.ts',
          content: `export const value = ${value};\n`,
        },
      ],
    })),
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );
  const runner: CommandRunner = {
    exec(file, args, options) {
      if (file === 'git' && args[0] === 'diff-tree') {
        assert.equal(typeof options?.input, 'string');
        const shas = (options?.input as string).trimEnd().split('\n');
        return [
          shas[0],
          'C100',
          'src/value.ts',
          'src/copied.ts',
          shas[1],
          'T',
          'src/value.ts',
          '',
        ].join('\0');
      }
      return defaultCommandRunner.exec(file, args, options);
    },
    spawn(file, args, options) {
      return defaultCommandRunner.spawn(file, args, options);
    },
  };

  const snapshot = gitEvidence.collectPullRequestEvidenceSnapshot(
    {
      cwd: repository.directory,
      baseBranch: repository.baseBranch,
      fetch: false,
      historyLimit: 2,
    },
    runner,
  );
  const changeId = snapshot.evidence.items.find(
    (item) => item.kind === 'change',
  )?.id;
  assert.notEqual(changeId, undefined);
  assert.deepEqual(snapshot.historyAdjacency, [
    { historyId: 'history-1', changeEvidenceIds: [changeId] },
    { historyId: 'history-2', changeEvidenceIds: [changeId] },
  ]);
});

test('keeps same-path stale histories as non-evidentiary adjacency hints', (context) => {
  const repository = materializeRepository({
    id: 'same-path-history-adjacency',
    baseFiles: { 'src/value.ts': 'export const value = 0;\n' },
    commits: [
      {
        message: 'feat: add stale intermediate behavior',
        operations: [
          {
            kind: 'write',
            path: 'src/value.ts',
            content: 'export const value = 1;\n',
          },
        ],
      },
      {
        message: 'revert: remove stale intermediate behavior',
        operations: [
          {
            kind: 'write',
            path: 'src/value.ts',
            content: 'export const value = 0;\n',
          },
        ],
      },
      {
        message: 'fix: add different final behavior',
        operations: [
          {
            kind: 'write',
            path: 'src/value.ts',
            content: 'export const value = 2;\n',
          },
        ],
      },
    ],
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  const snapshot = gitEvidence.collectPullRequestEvidenceSnapshot({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
    historyLimit: 3,
  });
  const changeId = snapshot.evidence.items.find(
    (item) => item.kind === 'change',
  )?.id;
  assert.notEqual(changeId, undefined);
  assert.deepEqual(snapshot.historyAdjacency, [
    { historyId: 'history-1', changeEvidenceIds: [changeId] },
    { historyId: 'history-2', changeEvidenceIds: [changeId] },
    { historyId: 'history-3', changeEvidenceIds: [changeId] },
  ]);
});

test('keeps a header-only merge history row empty without losing surrounding records', (context) => {
  const repository = materializeRepository({
    id: 'merge-history-adjacency',
    baseFiles: { 'src/base.ts': 'export const base = true;\n' },
    commits: [
      {
        message: 'feat: add first change',
        operations: [
          {
            kind: 'write',
            path: 'src/first.ts',
            content: 'export const first = true;\n',
          },
        ],
      },
    ],
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  git(repository.directory, ['switch', '-c', 'feature/side-change']);
  fs.writeFileSync(
    path.join(repository.directory, 'src', 'side.ts'),
    'export const side = true;\n',
    'utf8',
  );
  git(repository.directory, ['add', 'src/side.ts']);
  git(repository.directory, ['commit', '-m', 'feat: add side change']);
  git(repository.directory, ['switch', repository.featureBranch]);
  fs.writeFileSync(
    path.join(repository.directory, 'src', 'second.ts'),
    'export const second = true;\n',
    'utf8',
  );
  git(repository.directory, ['add', 'src/second.ts']);
  git(repository.directory, ['commit', '-m', 'feat: add second change']);
  git(repository.directory, [
    'merge',
    '--no-ff',
    'feature/side-change',
    '-m',
    'merge: combine side change',
  ]);
  fs.writeFileSync(
    path.join(repository.directory, 'src', 'after.ts'),
    'export const after = true;\n',
    'utf8',
  );
  git(repository.directory, ['add', 'src/after.ts']);
  git(repository.directory, ['commit', '-m', 'feat: add post-merge change']);

  let diffTreeCalls = 0;
  let diffTreeOutput = '';
  const runner: CommandRunner = {
    exec(file, args, options) {
      const output = defaultCommandRunner.exec(file, args, options);
      if (file === 'git' && args[0] === 'diff-tree') {
        diffTreeCalls += 1;
        diffTreeOutput = output;
      }
      return output;
    },
    spawn(file, args, options) {
      return defaultCommandRunner.spawn(file, args, options);
    },
  };
  const snapshot = gitEvidence.collectPullRequestEvidenceSnapshot(
    {
      cwd: repository.directory,
      baseBranch: repository.baseBranch,
      fetch: false,
      historyLimit: 10,
    },
    runner,
  );
  const histories = snapshot.evidence.items.filter(
    (item) => (item as unknown as HistoryItem).kind === 'history',
  ) as unknown as HistoryItem[];
  const adjacencyBySubject = new Map(
    snapshot.historyAdjacency.map((entry) => [
      histories.find((item) => item.id === entry.historyId)?.payload.subject,
      entry.changeEvidenceIds,
    ]),
  );
  const merge = histories.find(
    (item) => item.payload.subject === 'merge: combine side change',
  );
  assert.notEqual(merge, undefined);
  assert.equal(diffTreeCalls, 1);
  assert.equal(diffTreeOutput.includes(merge!.payload.sha), true);
  assert.deepEqual(adjacencyBySubject.get('merge: combine side change'), []);
  for (const subject of [
    'feat: add first change',
    'feat: add side change',
    'feat: add second change',
    'feat: add post-merge change',
  ]) {
    assert.ok((adjacencyBySubject.get(subject)?.length ?? 0) > 0, subject);
  }
});

test('collects a header-only merge when it is the entire retained slice', (context) => {
  const repository = materializeRepository({
    id: 'merge-only-history-adjacency',
    baseFiles: { 'src/base.ts': 'export const base = true;\n' },
    commits: [
      {
        message: 'feat: add merge-only first change',
        operations: [
          {
            kind: 'write',
            path: 'src/first.ts',
            content: 'export const first = true;\n',
          },
        ],
      },
    ],
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  git(repository.directory, ['switch', '-c', 'feature/merge-only-side']);
  fs.writeFileSync(
    path.join(repository.directory, 'src', 'side.ts'),
    'export const side = true;\n',
    'utf8',
  );
  git(repository.directory, ['add', 'src/side.ts']);
  git(repository.directory, ['commit', '-m', 'feat: add merge-only side']);
  git(repository.directory, ['switch', repository.featureBranch]);
  fs.writeFileSync(
    path.join(repository.directory, 'src', 'second.ts'),
    'export const second = true;\n',
    'utf8',
  );
  git(repository.directory, ['add', 'src/second.ts']);
  git(repository.directory, ['commit', '-m', 'feat: add merge-only second']);
  git(repository.directory, [
    'merge',
    '--no-ff',
    'feature/merge-only-side',
    '-m',
    'merge: finish merge-only history',
  ]);

  let diffTreeCalls = 0;
  let diffTreeOutput: string | undefined;
  const runner: CommandRunner = {
    exec(file, args, options) {
      const output = defaultCommandRunner.exec(file, args, options);
      if (file === 'git' && args[0] === 'diff-tree') {
        diffTreeCalls += 1;
        diffTreeOutput = output;
      }
      return output;
    },
    spawn(file, args, options) {
      return defaultCommandRunner.spawn(file, args, options);
    },
  };
  const snapshot = gitEvidence.collectPullRequestEvidenceSnapshot(
    {
      cwd: repository.directory,
      baseBranch: repository.baseBranch,
      fetch: false,
      historyLimit: 1,
    },
    runner,
  );
  const histories = snapshot.evidence.items.filter(
    (item) => (item as unknown as HistoryItem).kind === 'history',
  ) as unknown as HistoryItem[];

  assert.equal(diffTreeCalls, 1);
  assert.equal(diffTreeOutput?.includes(histories[0]!.payload.sha), true);
  assert.equal(snapshot.historyTruncated, true);
  assert.deepEqual(
    histories.map((item) => item.payload.subject),
    ['merge: finish merge-only history'],
  );
  assert.deepEqual(snapshot.historyAdjacency, [
    { historyId: 'history-1', changeEvidenceIds: [] },
  ]);
});

test('collects a header-only allow-empty commit between ordinary histories', (context) => {
  const repository = materializeRepository({
    id: 'allow-empty-history-adjacency',
    baseFiles: { 'src/value.ts': 'export const value = 0;\n' },
    commits: [
      {
        message: 'feat: add value before empty checkpoint',
        operations: [
          {
            kind: 'write',
            path: 'src/value.ts',
            content: 'export const value = 1;\n',
          },
        ],
      },
    ],
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );
  git(repository.directory, [
    'commit',
    '--allow-empty',
    '-m',
    'chore: record empty checkpoint',
  ]);
  fs.writeFileSync(
    path.join(repository.directory, 'src', 'value.ts'),
    'export const value = 2;\n',
    'utf8',
  );
  git(repository.directory, ['add', 'src/value.ts']);
  git(repository.directory, [
    'commit',
    '-m',
    'fix: update value after empty checkpoint',
  ]);

  let diffTreeOutput = '';
  const runner: CommandRunner = {
    exec(file, args, options) {
      const output = defaultCommandRunner.exec(file, args, options);
      if (file === 'git' && args[0] === 'diff-tree') {
        diffTreeOutput = output;
      }
      return output;
    },
    spawn(file, args, options) {
      return defaultCommandRunner.spawn(file, args, options);
    },
  };
  const snapshot = gitEvidence.collectPullRequestEvidenceSnapshot(
    {
      cwd: repository.directory,
      baseBranch: repository.baseBranch,
      fetch: false,
      historyLimit: 10,
    },
    runner,
  );
  const histories = snapshot.evidence.items.filter(
    (item) => (item as unknown as HistoryItem).kind === 'history',
  ) as unknown as HistoryItem[];
  const adjacencyBySubject = new Map(
    snapshot.historyAdjacency.map((entry) => [
      histories.find((item) => item.id === entry.historyId)?.payload.subject,
      entry.changeEvidenceIds,
    ]),
  );
  const emptyHistory = histories.find(
    (item) => item.payload.subject === 'chore: record empty checkpoint',
  );

  assert.notEqual(emptyHistory, undefined);
  assert.equal(diffTreeOutput.includes(emptyHistory!.payload.sha), true);
  assert.deepEqual(adjacencyBySubject.get('chore: record empty checkpoint'), []);
  assert.ok(
    (adjacencyBySubject.get('feat: add value before empty checkpoint')
      ?.length ?? 0) > 0,
  );
  assert.ok(
    (adjacencyBySubject.get('fix: update value after empty checkpoint')
      ?.length ?? 0) > 0,
  );
});

test('signals history truncation and batches only the retained chronological SHAs', (context) => {
  const repository = materializeRepository({
    id: 'history-truncation',
    baseFiles: { 'src/value.ts': 'export const value = 0;\n' },
    commits: [1, 2, 3].map((value) => ({
      message: `feat: set value ${value}`,
      operations: [
        {
          kind: 'write' as const,
          path: 'src/value.ts',
          content: `export const value = ${value};\n`,
        },
      ],
    })),
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );
  let diffTreeInput: unknown;
  const runner: CommandRunner = {
    exec(file, args, options) {
      if (file === 'git' && args[0] === 'diff-tree') {
        diffTreeInput = options?.input;
      }
      return defaultCommandRunner.exec(file, args, options);
    },
    spawn(file, args, options) {
      return defaultCommandRunner.spawn(file, args, options);
    },
  };

  const snapshot = gitEvidence.collectPullRequestEvidenceSnapshot(
    {
      cwd: repository.directory,
      baseBranch: repository.baseBranch,
      fetch: false,
      historyLimit: 2,
    },
    runner,
  );
  const histories = snapshot.evidence.items.filter(
    (item) => (item as unknown as HistoryItem).kind === 'history',
  ) as unknown as HistoryItem[];

  assert.equal(snapshot.historyTruncated, true);
  assert.deepEqual(
    histories.map((item) => item.payload.subject),
    ['feat: set value 2', 'feat: set value 3'],
  );
  assert.equal(
    diffTreeInput,
    `${histories.map((item) => item.payload.sha).join('\n')}\n`,
  );
  assert.deepEqual(
    snapshot.historyAdjacency.map((entry) => entry.historyId),
    ['history-1', 'history-2'],
  );
});

test('fails closed on malformed, missing, repeated, and out-of-order adjacency records', (context) => {
  const repository = materializeRepository({
    id: 'malformed-history-adjacency',
    baseFiles: { 'src/value.ts': 'export const value = 0;\n' },
    commits: [1, 2].map((value) => ({
      message: `feat: set malformed value ${value}`,
      operations: [
        {
          kind: 'write' as const,
          path: 'src/value.ts',
          content: `export const value = ${value};\n`,
        },
      ],
    })),
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  const malformedOutputs = [
    (shas: readonly string[]) => `${shas[0]}\0M\0`,
    (shas: readonly string[]) => `${shas[0]}\0M\0src/value.ts\0`,
    (shas: readonly string[]) =>
      `${shas[0]}\0M\0src/value.ts\0${shas[0]}\0`,
    (shas: readonly string[]) =>
      `${shas[1]}\0M\0src/value.ts\0${shas[0]}\0`,
    (shas: readonly string[]) =>
      `${shas[0]}\0Z\0src/value.ts\0${shas[1]}\0`,
    (shas: readonly string[]) =>
      `${shas[0]}\0M\0src/value.ts\0M\0src/value.ts\0${shas[1]}\0`,
  ];

  for (const makeOutput of malformedOutputs) {
    const runner: CommandRunner = {
      exec(file, args, options) {
        if (file === 'git' && args[0] === 'diff-tree') {
          assert.equal(typeof options?.input, 'string');
          const shas = (options?.input as string).trimEnd().split('\n');
          return makeOutput(shas);
        }
        return defaultCommandRunner.exec(file, args, options);
      },
      spawn(file, args, options) {
        return defaultCommandRunner.spawn(file, args, options);
      },
    };

    assert.throws(
      () =>
        gitEvidence.collectPullRequestEvidenceSnapshot(
          {
            cwd: repository.directory,
            baseBranch: repository.baseBranch,
            fetch: false,
            historyLimit: 2,
          },
          runner,
        ),
      /^Error: Git returned malformed history adjacency\.$/,
    );
  }
});

test('rechecks snapshot freshness after collecting history adjacency', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );
  let moved = false;
  const runner: CommandRunner = {
    exec(file, args, options) {
      const output = defaultCommandRunner.exec(file, args, options);
      if (!moved && file === 'git' && args[0] === 'diff-tree') {
        moved = true;
        git(repository.directory, [
          'commit',
          '--allow-empty',
          '-m',
          'chore: move head after adjacency',
        ]);
      }
      return output;
    },
    spawn(file, args, options) {
      return defaultCommandRunner.spawn(file, args, options);
    },
  };

  assert.throws(
    () =>
      gitEvidence.collectPullRequestEvidenceSnapshot(
        {
          cwd: repository.directory,
          baseBranch: repository.baseBranch,
          fetch: false,
          historyLimit: 10,
        },
        runner,
      ),
    /HEAD changed while evidence was being collected/,
  );
});

test('keeps reverted commits as supplemental history without final change evidence', (context) => {
  const repository = materializeRepository(fixture('revert-to-base'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
    historyLimit: 10,
  });

  assert.equal(bundle.items.some((item) => item.kind === 'change'), false);
  assert.equal(
    bundle.items.some((item) => (item as unknown as HistoryItem).kind === 'history'),
    true,
  );
  assert.equal(bundle.coverage.complete, true);
});

test('rejects invalid authored-history limits before Git execution', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  for (const historyLimit of [0, -1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(
      () =>
        gitEvidence.collectPullRequestEvidence({
          cwd: repository.directory,
          baseBranch: repository.baseBranch,
          fetch: false,
          historyLimit,
        }),
      /History limit is invalid/,
    );
  }
});

test('excludes changes made only on the base branch after divergence', (context) => {
  const repository = materializeRepository({
    id: 'diverged-base',
    baseFiles: { 'shared.txt': 'shared\n' },
    commits: [
      {
        message: 'feat: add feature value',
        operations: [
          { kind: 'write', path: 'feature.txt', content: 'feature\n' },
        ],
      },
    ],
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );
  git(repository.directory, ['switch', repository.baseBranch]);
  fs.writeFileSync(
    path.join(repository.directory, 'base-only.txt'),
    'base only\n',
    'utf8',
  );
  git(repository.directory, ['add', 'base-only.txt']);
  git(repository.directory, ['commit', '-m', 'feat: add base-only value']);
  git(repository.directory, ['switch', repository.featureBranch]);

  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
  });
  assert.deepEqual(
    bundle.items.map((item) => item.payload.path),
    ['feature.txt'],
  );
});

test('does not create verification evidence from changed test files', (context) => {
  const repository = materializeRepository(fixture('tests-changed-no-run'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
  });
  assert.equal(bundle.receipts.length, 0);
  assert.equal(
    bundle.items.some((item) => item.payload.path === 'test/value.test.ts'),
    true,
  );
});

test('parses odd filenames without line-delimited ambiguity', (context) => {
  const oddPath = 'src/odd\tname\nvalue.ts';
  const repository = materializeRepository({
    id: 'odd-path',
    baseFiles: { [oddPath]: 'export const value = 1;\n' },
    commits: [
      {
        message: 'fix: update odd path',
        operations: [
          { kind: 'write', path: oddPath, content: 'export const value = 2;\n' },
        ],
      },
    ],
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
  });
  assert.equal(bundle.items.length, 1);
  assert.equal(bundle.items[0].payload.path, oddPath);
});

test('marks binary and oversized patches as explicit coverage gaps', (context) => {
  const repository = materializeRepository({
    id: 'coverage-gaps',
    baseFiles: {
      'large.txt': 'base\n',
      'image.bin': 'base\u0000binary',
    },
    commits: [
      {
        message: 'feat: add large and binary changes',
        operations: [
          { kind: 'write', path: 'large.txt', content: `${'changed\n'.repeat(80)}` },
          { kind: 'write', path: 'image.bin', content: 'next\u0000binary' },
        ],
      },
    ],
  });
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
    maxPatchCharsPerFile: 100,
    maxTotalPatchChars: 200,
  });
  assert.equal(bundle.coverage.complete, false);
  assert.equal(bundle.coverage.gaps.some((gap) => gap.reason === 'binary'), true);
  assert.equal(
    bundle.coverage.gaps.some((gap) => gap.reason === 'size-limit'),
    true,
  );
  assert.equal(
    bundle.items.find((item) => item.payload.path === 'large.txt')?.payload.patch,
    null,
  );
});

test('classifies only Node maxBuffer patch failures as size limits', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );

  const bundle = gitEvidence.collectPullRequestEvidence(
    {
      cwd: repository.directory,
      baseBranch: repository.baseBranch,
      fetch: false,
    },
    patchFailingRunner(nodeMaxBufferError()),
  );

  assert.deepEqual(bundle.coverage.gaps, [
    {
      source: 'git-patch',
      reason: 'size-limit',
      locator: 'src/legacy.ts',
    },
  ]);
  assert.equal(bundle.items[0].payload.patch, null);
});

test('marks other patch failures unavailable without trusting lookalike data', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );
  const lookalike = {
    code: 'ENOBUFS',
    syscall: 'spawnSync git',
  };

  const bundle = gitEvidence.collectPullRequestEvidence(
    {
      cwd: repository.directory,
      baseBranch: repository.baseBranch,
      fetch: false,
    },
    patchFailingRunner(lookalike),
  );

  assert.deepEqual(bundle.coverage.gaps, [
    {
      source: 'git-patch',
      reason: 'unavailable',
      locator: 'src/legacy.ts',
    },
  ]);
  assert.equal(bundle.items[0].payload.patch, null);
});

test('pins the evidence snapshot and rejects option-like base input', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );
  const expectedHead = git(repository.directory, ['rev-parse', 'HEAD']).trim();
  const expectedBase = git(repository.directory, [
    'rev-parse',
    'main^{commit}',
  ]).trim();

  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: 'main',
    fetch: false,
  });
  assert.equal(bundle.snapshot.headSha, expectedHead);
  assert.equal(bundle.snapshot.baseSha, expectedBase);
  assert.match(bundle.snapshot.mergeBaseSha ?? '', /^[0-9a-f]{40}$/);

  assert.throws(
    () =>
      gitEvidence.collectPullRequestEvidence({
        cwd: repository.directory,
        baseBranch: '--upload-pack=malicious',
        fetch: false,
      }),
    /Base branch is invalid/,
  );
});

test('uses an explicit fetch refspec and aborts when HEAD moves', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );
  let capturedFetch: readonly string[] | undefined;
  let headReads = 0;
  const runner: CommandRunner = {
    exec(file, args, options) {
      if (file === 'git' && args[0] === 'fetch') {
        capturedFetch = args;
      }
      if (
        file === 'git' &&
        args[0] === 'rev-parse' &&
        args.includes('HEAD^{commit}') &&
        ++headReads === 2
      ) {
        git(repository.directory, [
          'commit',
          '--allow-empty',
          '-m',
          'chore: move evidence head',
        ]);
      }
      return defaultCommandRunner.exec(file, args, options);
    },
    spawn(file, args, options) {
      return defaultCommandRunner.spawn(file, args, options);
    },
  };

  assert.throws(
    () =>
      gitEvidence.collectPullRequestEvidence(
        {
          cwd: repository.directory,
          baseBranch: repository.baseBranch,
        },
        runner,
      ),
    /HEAD changed while evidence was being collected/,
  );
  assert.deepEqual(capturedFetch, [
    'fetch',
    '--quiet',
    '--no-tags',
    'origin',
    '+refs/heads/main:refs/remotes/origin/main',
  ]);
});

test('rechecks a pinned snapshot before downstream mutation', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );
  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
  });
  assert.doesNotThrow(() =>
    gitEvidence.assertEvidenceSnapshotCurrent(
      bundle.snapshot,
      repository.directory,
    ),
  );
  git(repository.directory, [
    'commit',
    '--allow-empty',
    '-m',
    'chore: move head after evidence',
  ]);
  assert.throws(
    () =>
      gitEvidence.assertEvidenceSnapshotCurrent(
        bundle.snapshot,
        repository.directory,
      ),
    /HEAD changed after evidence collection/,
  );
});

test('rechecks the pinned base before downstream mutation', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  context.after(() =>
    fs.rmSync(repository.directory, { recursive: true, force: true }),
  );
  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
  });
  const baseRef = bundle.snapshot.baseRef;
  const baseSha = bundle.snapshot.baseSha;
  assert.notEqual(baseRef, undefined);
  assert.notEqual(baseSha, undefined);
  const tree = git(repository.directory, ['rev-parse', `${baseSha}^{tree}`]).trim();
  const movedBase = git(repository.directory, [
    'commit-tree',
    tree,
    '-p',
    baseSha!,
    '-m',
    'chore: move base after evidence',
  ]).trim();
  git(repository.directory, ['update-ref', baseRef!, movedBase]);

  assert.throws(
    () =>
      gitEvidence.assertEvidenceSnapshotCurrent(
        bundle.snapshot,
        repository.directory,
      ),
    /base changed after evidence collection/,
  );
});

test('rechecks the actual remote base before GitHub mutation', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  const remote = fs.mkdtempSync(path.join(path.dirname(repository.directory), 'remote-'));
  context.after(() => {
    fs.rmSync(repository.directory, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });
  git(remote, ['init', '--quiet', '--bare']);
  git(repository.directory, ['remote', 'add', 'origin', remote]);
  git(repository.directory, ['push', '--quiet', 'origin', 'main']);
  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
  });

  assert.doesNotThrow(() =>
    gitEvidence.assertRemoteEvidenceBaseCurrent(
      bundle.snapshot,
      repository.baseBranch,
      repository.directory,
    ),
  );
  const baseSha = bundle.snapshot.baseSha;
  assert.notEqual(baseSha, undefined);
  const tree = git(repository.directory, ['rev-parse', `${baseSha}^{tree}`]).trim();
  const movedBase = git(repository.directory, [
    'commit-tree',
    tree,
    '-p',
    baseSha!,
    '-m',
    'chore: move remote base after evidence',
  ]).trim();
  git(repository.directory, [
    'push',
    '--quiet',
    'origin',
    `+${movedBase}:refs/heads/${repository.baseBranch}`,
  ]);

  assert.throws(
    () =>
      gitEvidence.assertRemoteEvidenceBaseCurrent(
        bundle.snapshot,
        repository.baseBranch,
        repository.directory,
      ),
    /Remote base changed after evidence collection/,
  );
});

test('does not accept a local base when the remote base is unavailable', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  const remote = fs.mkdtempSync(
    path.join(path.dirname(repository.directory), 'empty-remote-'),
  );
  context.after(() => {
    fs.rmSync(repository.directory, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });
  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
  });

  assert.throws(
    () =>
      gitEvidence.assertRemoteEvidenceBaseCurrent(
        bundle.snapshot,
        repository.baseBranch,
        repository.directory,
      ),
    /Remote base is unavailable/,
  );

  git(remote, ['init', '--quiet', '--bare']);
  git(repository.directory, ['remote', 'add', 'origin', remote]);
  assert.throws(
    () =>
      gitEvidence.assertRemoteEvidenceBaseCurrent(
        bundle.snapshot,
        repository.baseBranch,
        repository.directory,
      ),
    /Remote base is unavailable/,
  );
});

test('rechecks the actual remote feature branch before GitHub mutation', (context) => {
  const repository = materializeRepository(fixture('delete-only'));
  const remote = fs.mkdtempSync(path.join(path.dirname(repository.directory), 'remote-'));
  context.after(() => {
    fs.rmSync(repository.directory, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });
  git(remote, ['init', '--quiet', '--bare']);
  git(repository.directory, ['remote', 'add', 'origin', remote]);
  git(repository.directory, [
    'push',
    '--quiet',
    'origin',
    repository.featureBranch,
  ]);
  const bundle = gitEvidence.collectPullRequestEvidence({
    cwd: repository.directory,
    baseBranch: repository.baseBranch,
    fetch: false,
  });

  assert.doesNotThrow(() =>
    gitEvidence.assertRemoteEvidenceHeadCurrent(
      bundle.snapshot,
      repository.featureBranch,
      repository.directory,
    ),
  );
  assert.notEqual(bundle.snapshot.baseSha, undefined);
  git(repository.directory, [
    'push',
    '--quiet',
    'origin',
    `+${bundle.snapshot.baseSha!}:refs/heads/${repository.featureBranch}`,
  ]);
  assert.throws(
    () =>
      gitEvidence.assertRemoteEvidenceHeadCurrent(
        bundle.snapshot,
        repository.featureBranch,
        repository.directory,
      ),
    /does not match the reviewed evidence/,
  );
});
