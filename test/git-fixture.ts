import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface FixtureOperation {
  kind: 'write' | 'delete' | 'rename';
  path: string;
  from?: string;
  content?: string;
}

export interface FixtureCommit {
  message: string;
  body?: string;
  operations: FixtureOperation[];
}

export interface RepositoryFixture {
  id: string;
  baseFiles: Record<string, string>;
  commits: FixtureCommit[];
}

export interface MaterializedRepository {
  directory: string;
  baseBranch: string;
  featureBranch: string;
}

export function git(directory: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Diffwright Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'Diffwright Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.com',
    },
  });
}

function resolveFixturePath(directory: string, relativePath: string): string {
  const resolved = path.resolve(directory, relativePath);
  const prefix = `${path.resolve(directory)}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    throw new Error(`Fixture path escapes repository: ${relativePath}`);
  }
  return resolved;
}

function writeFixtureFile(
  directory: string,
  relativePath: string,
  contents: string,
): void {
  const target = resolveFixturePath(directory, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
}

function applyOperation(directory: string, operation: FixtureOperation): void {
  if (operation.kind === 'write') {
    if (typeof operation.content !== 'string') {
      throw new Error(`Write operation requires content: ${operation.path}`);
    }
    writeFixtureFile(directory, operation.path, operation.content);
    return;
  }

  if (operation.kind === 'delete') {
    fs.unlinkSync(resolveFixturePath(directory, operation.path));
    return;
  }

  if (!operation.from) {
    throw new Error(`Rename operation requires a source: ${operation.path}`);
  }
  const source = resolveFixturePath(directory, operation.from);
  const target = resolveFixturePath(directory, operation.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
}

export function materializeRepository(
  fixture: RepositoryFixture,
): MaterializedRepository {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), `diffwright-evidence-${fixture.id}-`),
  );
  const baseBranch = 'main';
  const featureBranch = 'feature/evidence-fixture';

  git(directory, ['init', '-b', baseBranch]);
  for (const [relativePath, contents] of Object.entries(fixture.baseFiles)) {
    writeFixtureFile(directory, relativePath, contents);
  }
  git(directory, ['add', '.']);
  git(directory, ['commit', '-m', 'chore: create fixture base']);
  git(directory, ['switch', '-c', featureBranch]);

  for (const commit of fixture.commits) {
    for (const operation of commit.operations) {
      applyOperation(directory, operation);
    }
    git(directory, ['add', '--all']);
    git(directory, [
      'commit',
      '-m',
      commit.message,
      ...(commit.body === undefined ? [] : ['-m', commit.body]),
    ]);
  }

  return { directory, baseBranch, featureBranch };
}
