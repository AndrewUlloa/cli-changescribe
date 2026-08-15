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

interface GitEvidenceModule {
  collectPullRequestEvidence(options: {
    baseBranch: string;
    cwd?: string;
    fetch?: boolean;
    maxPatchCharsPerFile?: number;
    maxTotalPatchChars?: number;
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
