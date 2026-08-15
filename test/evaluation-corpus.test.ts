import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  git,
  materializeRepository,
  type RepositoryFixture,
} from './git-fixture';

interface CommitCase {
  id: string;
  candidate?: string;
  candidates?: string[];
  changes?: string[];
  expected: Record<string, unknown>;
}

interface RepositoryCase extends RepositoryFixture {
  expected: {
    nameStatus: string[];
    patchIncludes: string[];
    patchExcludes: string[];
    verificationClaims?: string[];
  };
}

interface ClaimCase {
  id: string;
  claimKind: string;
  statement: string;
  evidenceKinds: string[];
  expected: {
    accepted: boolean;
    diagnostic?: string;
  };
}

interface EvidenceCorpus {
  schemaVersion: number;
  commitCases: CommitCase[];
  repositoryCases: RepositoryCase[];
  claimCases: ClaimCase[];
}

const repoRoot = path.resolve(__dirname, '..');
const corpusPath = path.join(
  repoRoot,
  'fixtures',
  'evidence-v2',
  'corpus.json',
);

function loadCorpus(): EvidenceCorpus {
  return JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
}

test('evidence corpus has a stable schema and unique case identifiers', () => {
  const corpus = loadCorpus();
  assert.equal(corpus.schemaVersion, 1);
  assert.ok(corpus.commitCases.length >= 6);
  assert.ok(corpus.repositoryCases.length >= 5);
  assert.ok(corpus.claimCases.length >= 5);

  const allIds = [
    ...corpus.commitCases.map((fixture) => fixture.id),
    ...corpus.repositoryCases.map((fixture) => fixture.id),
    ...corpus.claimCases.map((fixture) => fixture.id),
  ];
  assert.equal(new Set(allIds).size, allIds.length);

  for (const fixture of corpus.commitCases) {
    assert.ok(
      fixture.candidate || fixture.candidates?.length || fixture.changes?.length,
    );
    assert.ok(Object.keys(fixture.expected).length > 0);
  }
  for (const fixture of corpus.claimCases) {
    assert.ok(fixture.statement.trim());
    assert.ok(fixture.evidenceKinds.length > 0);
    if (!fixture.expected.accepted) {
      assert.ok(fixture.expected.diagnostic);
    }
  }
});

test('repository fixtures describe the final merge-base diff, not commit history', (context) => {
  const corpus = loadCorpus();

  for (const fixture of corpus.repositoryCases) {
    const repository = materializeRepository(fixture);
    context.after(() =>
      fs.rmSync(repository.directory, { recursive: true, force: true }),
    );
    const mergeBase = git(repository.directory, [
      'merge-base',
      repository.baseBranch,
      'HEAD',
    ]).trim();
    const head = git(repository.directory, ['rev-parse', 'HEAD']).trim();
    const nameStatus = git(repository.directory, [
      'diff',
      '--find-renames',
      '--name-status',
      mergeBase,
      head,
      '--',
    ])
      .trim()
      .split('\n')
      .filter(Boolean);
    const patch = git(repository.directory, [
      'diff',
      '--find-renames',
      '--unified=3',
      mergeBase,
      head,
      '--',
    ]);

    assert.deepEqual(nameStatus, fixture.expected.nameStatus, fixture.id);
    for (const expectedText of fixture.expected.patchIncludes) {
      assert.match(patch, new RegExp(escapeRegExp(expectedText)), fixture.id);
    }
    for (const excludedText of fixture.expected.patchExcludes) {
      assert.doesNotMatch(
        patch,
        new RegExp(escapeRegExp(excludedText)),
        fixture.id,
      );
    }
  }
});

test('corpus separates changed tests from observed verification', () => {
  const corpus = loadCorpus();
  const fixture = corpus.repositoryCases.find(
    (candidate) => candidate.id === 'tests-changed-no-run',
  );
  assert.ok(fixture);
  assert.deepEqual(fixture.expected.verificationClaims, []);

  const unsupported = corpus.claimCases.find(
    (candidate) => candidate.id === 'changed-test-is-not-passed-test',
  );
  assert.ok(unsupported);
  assert.equal(unsupported.expected.accepted, false);
  assert.equal(
    unsupported.expected.diagnostic,
    'verification-requires-passed-receipt',
  );
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
