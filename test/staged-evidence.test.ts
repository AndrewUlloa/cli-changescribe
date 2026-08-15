import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { git } from './git-fixture';

interface ChangeItem {
  id: string;
  kind: 'change';
  source: { kind: string; locator: string };
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

interface StagedGitSnapshot {
  headSha: string;
  indexTreeSha: string;
}

interface StagedEvidenceBundle {
  schemaVersion: 1;
  snapshot: StagedGitSnapshot;
  items: ChangeItem[];
  receipts: [];
  coverage: { complete: boolean; gaps: [] };
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

interface StagedEvidenceModule {
  collectStagedEvidence(
    options?: {
      cwd?: string;
      maxPatchBytesPerFile?: number;
      maxTotalPatchBytes?: number;
    },
    runner?: CommandRunner,
  ): StagedEvidenceBundle;
  assertStagedEvidenceSnapshotCurrent(
    snapshot: StagedGitSnapshot,
    cwd?: string,
    runner?: CommandRunner,
  ): void;
}

const stagedEvidence: StagedEvidenceModule = require(
  '../dist/staged-evidence.js'
);
const { defaultCommandRunner }: { defaultCommandRunner: CommandRunner } = require(
  '../dist/subprocess.js'
);

function resolvePath(directory: string, relativePath: string): string {
  const resolved = path.resolve(directory, relativePath);
  assert.ok(resolved.startsWith(`${path.resolve(directory)}${path.sep}`));
  return resolved;
}

function writeFile(
  directory: string,
  relativePath: string,
  contents: string | Buffer,
): void {
  const target = resolvePath(directory, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function createRepository(
  context: TestContext,
  files: Readonly<Record<string, string | Buffer>>,
): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'diffwright-staged-evidence-'),
  );
  context.after(() =>
    fs.rmSync(directory, { recursive: true, force: true }),
  );
  git(directory, ['init', '--quiet', '-b', 'main']);
  for (const [relativePath, contents] of Object.entries(files)) {
    writeFile(directory, relativePath, contents);
  }
  git(directory, ['add', '--all']);
  git(directory, ['commit', '--quiet', '-m', 'chore: create fixture base']);
  return directory;
}

function collect(directory: string): StagedEvidenceBundle {
  return stagedEvidence.collectStagedEvidence({ cwd: directory });
}

test('collects a staged deletion with its complete removed patch', (context) => {
  const directory = createRepository(context, {
    'src/legacy.ts': 'export const legacy = true;\n',
  });
  fs.unlinkSync(path.join(directory, 'src', 'legacy.ts'));
  git(directory, ['add', '--all']);

  const bundle = collect(directory);

  assert.equal(bundle.coverage.complete, true);
  assert.deepEqual(bundle.coverage.gaps, []);
  assert.equal(bundle.items.length, 1);
  assert.equal(bundle.items[0].payload.status, 'deleted');
  assert.equal(bundle.items[0].payload.path, 'src/legacy.ts');
  assert.equal(bundle.items[0].payload.additions, 0);
  assert.equal(bundle.items[0].payload.deletions, 1);
  assert.match(bundle.items[0].payload.patch ?? '', /deleted file mode/);
  assert.match(bundle.items[0].payload.patch ?? '', /-export const legacy/);
  assert.equal(bundle.items[0].source.kind, 'git-index');
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.snapshot), true);
});

test('parses a staged rename with tabs and newlines in both paths', (context) => {
  const oldPath = 'src/old\tname\nvalue.ts';
  const newPath = 'src/new\tname\nvalue.ts';
  const directory = createRepository(context, {
    [oldPath]: 'export const value = 1;\n',
  });
  fs.renameSync(resolvePath(directory, oldPath), resolvePath(directory, newPath));
  git(directory, ['add', '--all']);

  const bundle = collect(directory);
  const change = bundle.items[0];

  assert.equal(bundle.items.length, 1);
  assert.equal(change.payload.status, 'renamed');
  assert.equal(change.payload.oldPath, oldPath);
  assert.equal(change.payload.path, newPath);
  assert.equal(change.payload.additions, 0);
  assert.equal(change.payload.deletions, 0);
  assert.match(change.payload.patch ?? '', /similarity index 100%/);
});

test('collects a complete binary patch and binary numstat metadata', (context) => {
  const directory = createRepository(context, {
    'assets/image.bin': Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
  });
  writeFile(
    directory,
    'assets/image.bin',
    Buffer.from([0, 1, 2, 3, 4, 5, 6, 8]),
  );
  git(directory, ['add', '--all']);

  const bundle = collect(directory);
  const change = bundle.items[0];

  assert.equal(change.payload.status, 'modified');
  assert.equal(change.payload.binary, true);
  assert.equal(change.payload.additions, null);
  assert.equal(change.payload.deletions, null);
  assert.match(change.payload.patch ?? '', /GIT binary patch/);
  assert.equal(bundle.coverage.complete, true);
});

test('reports staged copies and file type changes without collapsing statuses', (context) => {
  const source = `${'export const value = 1;\n'.repeat(30)}`;
  const directory = createRepository(context, {
    'src/source.ts': source,
    'src/link.ts': 'export const target = true;\n',
  });
  writeFile(directory, 'src/copy.ts', source);
  fs.unlinkSync(path.join(directory, 'src', 'link.ts'));
  fs.symlinkSync('source.ts', path.join(directory, 'src', 'link.ts'));
  git(directory, ['add', '--all']);

  const bundle = collect(directory);
  const copy = bundle.items.find((item) => item.payload.path === 'src/copy.ts');
  const typeChange = bundle.items.find(
    (item) => item.payload.path === 'src/link.ts',
  );

  assert.equal(copy?.payload.status, 'copied');
  assert.equal(copy?.payload.oldPath, 'src/source.ts');
  assert.match(copy?.payload.patch ?? '', /copy from src\/source\.ts/);
  assert.equal(typeChange?.payload.status, 'type-changed');
  assert.match(typeChange?.payload.patch ?? '', /deleted file mode 100644/);
  assert.match(typeChange?.payload.patch ?? '', /new file mode 120000/);
});

test('returns a pinned complete empty bundle without staging working-tree files', (context) => {
  const directory = createRepository(context, { 'README.md': '# fixture\n' });
  writeFile(directory, 'unstaged.txt', 'leave me unstaged\n');
  const headSha = git(directory, ['rev-parse', 'HEAD^{commit}']).trim();
  const headTreeSha = git(directory, ['rev-parse', 'HEAD^{tree}']).trim();

  const bundle = collect(directory);

  assert.deepEqual(bundle.items, []);
  assert.equal(bundle.coverage.complete, true);
  assert.equal(bundle.snapshot.headSha, headSha);
  assert.equal(bundle.snapshot.indexTreeSha, headTreeSha);
  assert.match(git(directory, ['status', '--porcelain']), /^\?\? unstaged\.txt/m);
});

test('fails closed instead of returning a truncated staged patch', (context) => {
  const directory = createRepository(context, { 'large.txt': 'base\n' });
  writeFile(directory, 'large.txt', 'changed line\n'.repeat(200));
  git(directory, ['add', '--all']);

  assert.throws(
    () =>
      stagedEvidence.collectStagedEvidence({
        cwd: directory,
        maxPatchBytesPerFile: 128,
        maxTotalPatchBytes: 1024,
      }),
    /exceeds the per-file limit|failed or exceeded its supported size/,
  );
});

test('rechecks both the pinned HEAD and index before downstream mutation', (context) => {
  const indexDirectory = createRepository(context, { 'value.txt': 'one\n' });
  writeFile(indexDirectory, 'value.txt', 'two\n');
  git(indexDirectory, ['add', 'value.txt']);
  const indexBundle = collect(indexDirectory);
  assert.doesNotThrow(() =>
    stagedEvidence.assertStagedEvidenceSnapshotCurrent(
      indexBundle.snapshot,
      indexDirectory,
    ),
  );
  writeFile(indexDirectory, 'value.txt', 'three\n');
  git(indexDirectory, ['add', 'value.txt']);
  assert.throws(
    () =>
      stagedEvidence.assertStagedEvidenceSnapshotCurrent(
        indexBundle.snapshot,
        indexDirectory,
      ),
    /index changed after evidence collection/,
  );

  const headDirectory = createRepository(context, { 'README.md': '# fixture\n' });
  const headBundle = collect(headDirectory);
  git(headDirectory, ['commit', '--allow-empty', '-m', 'chore: move head']);
  assert.throws(
    () =>
      stagedEvidence.assertStagedEvidenceSnapshotCurrent(
        headBundle.snapshot,
        headDirectory,
      ),
    /HEAD changed after evidence collection/,
  );
});

test('aborts when the index moves during staged evidence collection', (context) => {
  const directory = createRepository(context, { 'value.txt': 'one\n' });
  writeFile(directory, 'value.txt', 'two\n');
  git(directory, ['add', 'value.txt']);
  let indexReads = 0;
  const runner: CommandRunner = {
    exec(file, args, options) {
      if (file === 'git' && args[0] === 'write-tree' && ++indexReads === 2) {
        writeFile(directory, 'later.txt', 'moved during collection\n');
        git(directory, ['add', 'later.txt']);
      }
      return defaultCommandRunner.exec(file, args, options);
    },
    spawn(file, args, options) {
      return defaultCommandRunner.spawn(file, args, options);
    },
  };

  assert.throws(
    () => stagedEvidence.collectStagedEvidence({ cwd: directory }, runner),
    /index changed while evidence was being collected/,
  );
});
