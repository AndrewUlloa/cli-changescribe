import assert from 'node:assert/strict';
import test from 'node:test';

type ChangeCategory =
  | 'implementation'
  | 'tests'
  | 'documentation'
  | 'configuration'
  | 'other';

interface CountSummary {
  readonly value: number;
  readonly complete: boolean;
  readonly unknownFiles: number;
}

interface ChangeMapFile {
  readonly evidenceId: string;
  readonly category: ChangeCategory;
  readonly status: string;
  readonly path: string;
  readonly oldPath?: string;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly binary: boolean;
}

interface ChangeMapGroup {
  readonly category: ChangeCategory;
  readonly fileCount: number;
  readonly additions: CountSummary;
  readonly deletions: CountSummary;
  readonly binaryFiles: number;
  readonly files: readonly ChangeMapFile[];
}

interface ChangeMap {
  readonly fileCount: number;
  readonly additions: CountSummary;
  readonly deletions: CountSummary;
  readonly binaryFiles: number;
  readonly groups: readonly ChangeMapGroup[];
}

interface ChangeMapModule {
  CHANGE_MAP_CATEGORY_ORDER: readonly ChangeCategory[];
  buildChangeMap(evidence: unknown): ChangeMap;
}

interface ChangeEvidenceModule {
  createEvidenceBundle(input: unknown): unknown;
}

const changeMap: ChangeMapModule = require('../dist/change-map.js');
const changeEvidence: ChangeEvidenceModule = require(
  '../dist/change-evidence.js'
);

interface ChangeFixture {
  readonly id: string;
  readonly path: string;
  readonly status?:
    | 'added'
    | 'modified'
    | 'deleted'
    | 'renamed'
    | 'copied'
    | 'type-changed';
  readonly oldPath?: string;
  readonly additions?: number | null;
  readonly deletions?: number | null;
  readonly binary?: boolean;
}

function bundle(changes: readonly ChangeFixture[]): unknown {
  return changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'a'.repeat(40) },
    items: changes.map((change) => ({
      id: change.id,
      kind: 'change',
      basis: 'observed',
      source: { kind: 'git-diff', locator: change.path },
      payload: {
        status: change.status ?? 'modified',
        ...(change.oldPath === undefined ? {} : { oldPath: change.oldPath }),
        path: change.path,
        additions: change.additions === undefined ? 1 : change.additions,
        deletions: change.deletions === undefined ? 0 : change.deletions,
        binary: change.binary ?? false,
        patch: change.binary ? null : '+fixture\n',
      },
    })),
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
}

function group(map: ChangeMap, category: ChangeCategory): ChangeMapGroup {
  const result = map.groups.find((candidate) => candidate.category === category);
  assert.ok(result);
  return result;
}

test('classifies every change exactly once in a stable category order', () => {
  const evidence = bundle([
    { id: 'change-other', path: 'public/logo.svg' },
    { id: 'change-config', path: '.github/workflows/ci.yml' },
    { id: 'change-docs', path: 'documentation/cli-reference.md' },
    { id: 'change-tests', path: 'src/parser.spec.ts' },
    { id: 'change-source', path: 'src/parser.ts' },
  ]);

  const map = changeMap.buildChangeMap(evidence);

  assert.deepEqual(changeMap.CHANGE_MAP_CATEGORY_ORDER, [
    'implementation',
    'tests',
    'documentation',
    'configuration',
    'other',
  ]);
  assert.deepEqual(
    map.groups.map((candidate) => candidate.category),
    changeMap.CHANGE_MAP_CATEGORY_ORDER,
  );
  assert.deepEqual(
    map.groups.flatMap((candidate) =>
      candidate.files.map((file) => [file.evidenceId, file.category]),
    ),
    [
      ['change-source', 'implementation'],
      ['change-tests', 'tests'],
      ['change-docs', 'documentation'],
      ['change-config', 'configuration'],
      ['change-other', 'other'],
    ],
  );
  assert.equal(map.fileCount, 5);
  assert.equal(
    new Set(
      map.groups.flatMap((candidate) =>
        candidate.files.map((file) => file.evidenceId),
      ),
    ).size,
    map.fileCount,
  );
});

test('uses test and documentation precedence over source-like extensions', () => {
  const map = changeMap.buildChangeMap(
    bundle([
      { id: 'change-test-directory', path: 'tests/unit/value.ts' },
      { id: 'change-fixture', path: 'fixtures/project/src/value.ts' },
      { id: 'change-snapshot', path: 'src/__snapshots__/value.snap' },
      { id: 'change-doc-directory', path: 'docs/example.ts' },
      { id: 'change-specification', path: 'specs/feature/SPEC.md' },
      { id: 'change-readme', path: 'README' },
      { id: 'change-license', path: 'LICENSE' },
      { id: 'change-bin', path: 'bin/diffwright.js' },
      { id: 'change-script', path: 'scripts/release.sh' },
    ]),
  );

  assert.deepEqual(
    group(map, 'tests').files.map((file) => file.evidenceId),
    ['change-fixture', 'change-snapshot', 'change-test-directory'],
  );
  assert.deepEqual(
    group(map, 'documentation').files.map((file) => file.evidenceId),
    [
      'change-license',
      'change-readme',
      'change-doc-directory',
      'change-specification',
    ],
  );
  assert.deepEqual(
    group(map, 'implementation').files.map((file) => file.evidenceId),
    ['change-bin', 'change-script'],
  );
});

test('classifies common project and release configuration without swallowing data files', () => {
  const map = changeMap.buildChangeMap(
    bundle([
      { id: 'change-manifest', path: 'package.json' },
      { id: 'change-lock', path: 'pnpm-lock.yaml' },
      { id: 'change-tsconfig', path: 'tsconfig.test.json' },
      { id: 'change-dotenv', path: '.env.example' },
      { id: 'change-docker', path: 'Dockerfile' },
      { id: 'change-data', path: 'assets/catalog.json' },
    ]),
  );

  assert.deepEqual(
    group(map, 'configuration').files.map((file) => file.evidenceId),
    [
      'change-dotenv',
      'change-docker',
      'change-manifest',
      'change-lock',
      'change-tsconfig',
    ],
  );
  assert.deepEqual(
    group(map, 'other').files.map((file) => file.evidenceId),
    ['change-data'],
  );
});

test('is deterministic across evidence order and counts a rename once at its destination', () => {
  const changes: ChangeFixture[] = [
    {
      id: 'change-rename',
      status: 'renamed',
      oldPath: 'src/guide.ts',
      path: 'docs/guide.ts',
      additions: 0,
      deletions: 0,
    },
    {
      id: 'change-source',
      path: 'src/zeta.ts',
      additions: 3,
      deletions: 2,
    },
    {
      id: 'change-source-a',
      path: 'src/alpha.ts',
      additions: 2,
      deletions: 1,
    },
  ];

  const forward = changeMap.buildChangeMap(bundle(changes));
  const reversed = changeMap.buildChangeMap(bundle([...changes].reverse()));

  assert.deepEqual(reversed, forward);
  assert.equal(forward.fileCount, 3);
  assert.deepEqual(
    group(forward, 'documentation').files.map((file) => ({
      id: file.evidenceId,
      path: file.path,
      oldPath: file.oldPath,
    })),
    [
      {
        id: 'change-rename',
        path: 'docs/guide.ts',
        oldPath: 'src/guide.ts',
      },
    ],
  );
  assert.deepEqual(
    group(forward, 'implementation').files.map((file) => file.path),
    ['src/alpha.ts', 'src/zeta.ts'],
  );
});

test('retains binary and unknown line-count metadata without claiming exact totals', () => {
  const map = changeMap.buildChangeMap(
    bundle([
      {
        id: 'change-binary',
        path: 'public/logo.png',
        additions: null,
        deletions: null,
        binary: true,
      },
      {
        id: 'change-known',
        path: 'src/value.ts',
        additions: 4,
        deletions: 3,
      },
      {
        id: 'change-unknown-additions',
        path: 'src/generated.ts',
        additions: null,
        deletions: 2,
      },
    ]),
  );

  assert.deepEqual(map.additions, {
    value: 4,
    complete: false,
    unknownFiles: 2,
  });
  assert.deepEqual(map.deletions, {
    value: 5,
    complete: false,
    unknownFiles: 1,
  });
  assert.equal(map.binaryFiles, 1);
  assert.equal(group(map, 'other').binaryFiles, 1);
  assert.equal(group(map, 'other').files[0]?.additions, null);
  assert.equal(group(map, 'other').files[0]?.binary, true);
});

test('reproduces the PR 20 category and line-count oracle', () => {
  const oracle: ChangeFixture[] = [
    { id: 'docs-changelog', path: 'CHANGELOG.md', additions: 11, deletions: 0 },
    { id: 'docs-readme', path: 'README.md', additions: 19, deletions: 10 },
    { id: 'docs-cli', path: 'documentation/cli-reference.md', additions: 24, deletions: 11 },
    { id: 'src-arguments', path: 'src/arguments.ts', additions: 6, deletions: 1 },
    { id: 'src-critic', path: 'src/artifact-critic.ts', additions: 81, deletions: 4 },
    { id: 'src-draft', path: 'src/artifact-draft.ts', additions: 50, deletions: 0 },
    { id: 'src-cli', path: 'src/cli.ts', additions: 3, deletions: 1 },
    { id: 'src-commit', path: 'src/commit.ts', additions: 176, deletions: 55 },
    { id: 'src-timings', path: 'src/operation-timings.ts', additions: 106, deletions: 0 },
    { id: 'src-pr', path: 'src/pr-workflow.ts', additions: 211, deletions: 104 },
    { id: 'test-critic', path: 'test/artifact-critic.test.ts', additions: 86, deletions: 1 },
    { id: 'test-draft', path: 'test/artifact-draft.test.ts', additions: 38, deletions: 0 },
    { id: 'test-cli', path: 'test/cli-routing.test.ts', additions: 2, deletions: 0 },
    { id: 'test-commit', path: 'test/commit-v2.test.ts', additions: 112, deletions: 21 },
    { id: 'test-distribution', path: 'test/distribution.test.ts', additions: 1, deletions: 0 },
    { id: 'test-npm', path: 'test/npm-page.test.ts', additions: 3, deletions: 1 },
    { id: 'test-timings', path: 'test/operation-timings.test.ts', additions: 141, deletions: 0 },
    { id: 'test-security', path: 'test/security.test.ts', additions: 4, deletions: 1 },
    { id: 'test-migration', path: 'test/typescript-migration.test.ts', additions: 1, deletions: 0 },
    { id: 'test-workflow', path: 'test/workflow-byok.test.ts', additions: 80, deletions: 6 },
  ];

  const map = changeMap.buildChangeMap(bundle(oracle));

  assert.deepEqual(
    map.groups.map((candidate) => ({
      category: candidate.category,
      files: candidate.fileCount,
      additions: candidate.additions,
      deletions: candidate.deletions,
    })),
    [
      {
        category: 'implementation',
        files: 7,
        additions: { value: 633, complete: true, unknownFiles: 0 },
        deletions: { value: 165, complete: true, unknownFiles: 0 },
      },
      {
        category: 'tests',
        files: 10,
        additions: { value: 468, complete: true, unknownFiles: 0 },
        deletions: { value: 30, complete: true, unknownFiles: 0 },
      },
      {
        category: 'documentation',
        files: 3,
        additions: { value: 54, complete: true, unknownFiles: 0 },
        deletions: { value: 21, complete: true, unknownFiles: 0 },
      },
      {
        category: 'configuration',
        files: 0,
        additions: { value: 0, complete: true, unknownFiles: 0 },
        deletions: { value: 0, complete: true, unknownFiles: 0 },
      },
      {
        category: 'other',
        files: 0,
        additions: { value: 0, complete: true, unknownFiles: 0 },
        deletions: { value: 0, complete: true, unknownFiles: 0 },
      },
    ],
  );
  assert.equal(map.fileCount, 20);
  assert.deepEqual(map.additions, {
    value: 1_155,
    complete: true,
    unknownFiles: 0,
  });
  assert.deepEqual(map.deletions, {
    value: 216,
    complete: true,
    unknownFiles: 0,
  });
});

test('returns a deeply frozen map and does not retain mutable input objects', () => {
  const input: ChangeFixture[] = [
    { id: 'change-source', path: 'src/value.ts', additions: 2, deletions: 1 },
  ];
  const map = changeMap.buildChangeMap(bundle(input));
  input[0] = { id: 'changed-after-build', path: 'docs/changed.md' };

  assert.equal(Object.isFrozen(map), true);
  assert.equal(Object.isFrozen(map.additions), true);
  assert.equal(Object.isFrozen(map.groups), true);
  assert.equal(map.groups.every(Object.isFrozen), true);
  assert.equal(map.groups.every((candidate) => Object.isFrozen(candidate.files)), true);
  assert.equal(
    map.groups.every((candidate) => candidate.files.every(Object.isFrozen)),
    true,
  );
  assert.equal(group(map, 'implementation').files[0]?.evidenceId, 'change-source');
});

test('fails closed on absolute, escaping, control, and bidirectional paths without echoing them', () => {
  const unsafePaths = [
    '/absolute/private.ts',
    '../outside/private.ts',
    'src/../private.ts',
    'src/private\nvalue.ts',
    'src/private\u202evalue.ts',
    'src/private\u2066value.ts',
  ];

  for (const unsafePath of unsafePaths) {
    const forgedEvidence = {
      schemaVersion: 1,
      snapshot: { headSha: 'a'.repeat(40) },
      items: [
        {
          id: 'change-unsafe',
          kind: 'change',
          basis: 'observed',
          source: { kind: 'git-diff', locator: 'redacted' },
          payload: {
            status: 'modified',
            path: unsafePath,
            additions: 1,
            deletions: 0,
            binary: false,
            patch: '+fixture\n',
          },
        },
      ],
      receipts: [],
      coverage: { complete: true, gaps: [] },
    };

    let message = '';
    try {
      changeMap.buildChangeMap(forgedEvidence);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.match(message, /change path is unsafe/i);
    assert.doesNotMatch(message, /private|outside|absolute/i);
  }
});
