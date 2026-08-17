import assert from 'node:assert/strict';
import test from 'node:test';

interface ArtifactDraft {
  readonly claims: readonly {
    readonly id: string;
    readonly kind: string;
    readonly basis: string;
    readonly evidenceIds: readonly string[];
    readonly significance?: 'primary' | 'supporting' | 'incidental';
  }[];
}

interface CompletenessReport {
  readonly complete: boolean;
  readonly requiredEvidenceIds: readonly string[];
  readonly coveredEvidenceIds: readonly string[];
  readonly missingEvidenceIds: readonly string[];
}

interface CompletenessModule {
  evaluateArtifactCompleteness(
    draft: ArtifactDraft,
    evidence: unknown,
    selectionPolicy?: {
      readonly supportingPaths?: readonly string[];
      readonly primaryPaths?: readonly string[];
    },
  ): CompletenessReport;
  assertArtifactCompleteness(
    draft: ArtifactDraft,
    evidence: unknown,
    selectionPolicy?: {
      readonly supportingPaths?: readonly string[];
      readonly primaryPaths?: readonly string[];
    },
  ): void;
  evaluateArtifactNarrativeBreadth(
    draft: ArtifactDraft,
    evidence: unknown,
    selectionPolicy?: {
      readonly supportingPaths?: readonly string[];
      readonly primaryPaths?: readonly string[];
    },
  ): {
    readonly complete: boolean;
    readonly requiredClaimCount: number;
    readonly maximumEvidenceIdsPerClaim: number;
    readonly detailClaimIds: readonly string[];
    readonly coveredEvidenceIds: readonly string[];
    readonly missingEvidenceIds: readonly string[];
    readonly overbroadClaimIds: readonly string[];
  };
  assertArtifactNarrativeBreadth(
    draft: ArtifactDraft,
    evidence: unknown,
    selectionPolicy?: {
      readonly supportingPaths?: readonly string[];
      readonly primaryPaths?: readonly string[];
    },
  ): void;
}

interface ChangeEvidenceModule {
  createEvidenceBundle(input: unknown): unknown;
}

const completeness: CompletenessModule = require(
  '../dist/artifact-completeness.js'
);
const changeEvidence: ChangeEvidenceModule = require(
  '../dist/change-evidence.js'
);

interface ChangeFixture {
  readonly id: string;
  readonly path: string;
}

function evidence(changes: readonly ChangeFixture[]): unknown {
  return changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'a'.repeat(40) },
    items: changes.map((change) => ({
      id: change.id,
      kind: 'change',
      basis: 'observed',
      source: { kind: 'git-diff', locator: change.path },
      payload: {
        status: 'modified',
        path: change.path,
        additions: 1,
        deletions: 0,
        binary: false,
        patch: '+fixture\n',
      },
    })),
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
}

function draft(claims: ArtifactDraft['claims']): ArtifactDraft {
  return { claims };
}

function observedChange(
  id: string,
  ...evidenceIds: string[]
): ArtifactDraft['claims'][number] {
  return {
    id,
    kind: 'change',
    basis: 'observed',
    evidenceIds,
    significance: id === 'claim-primary' ? 'primary' : 'supporting',
  };
}

test('requires every substantive change across supported observed claims', () => {
  const bundle = evidence([
    { id: 'change-source-a', path: 'src/a.ts' },
    { id: 'change-docs', path: 'README.md' },
    { id: 'change-source-b', path: 'src/b.ts' },
    { id: 'change-tests', path: 'test/a.test.ts' },
    { id: 'change-config', path: 'package.json' },
  ]);
  const report = completeness.evaluateArtifactCompleteness(
    draft([
      observedChange('claim-primary', 'change-source-a'),
      observedChange(
        'claim-supporting',
        'change-source-a',
        'change-source-b',
      ),
    ]),
    bundle,
  );

  assert.deepEqual(report, {
    complete: true,
    requiredEvidenceIds: ['change-source-a', 'change-source-b'],
    coveredEvidenceIds: ['change-source-a', 'change-source-b'],
    missingEvidenceIds: [],
  });
  assert.equal(Object.isFrozen(report), true);
  assert.doesNotThrow(() =>
    completeness.assertArtifactCompleteness(
      draft([
        observedChange('claim-primary', 'change-source-a'),
        observedChange('claim-supporting', 'change-source-b'),
      ]),
      bundle,
    ),
  );
});

test('fails with one stable generic error when substantive coverage is missing', () => {
  const bundle = evidence([
    { id: 'change-secret-a', path: 'src/private-a.ts' },
    { id: 'change-secret-b', path: 'src/private-b.ts' },
  ]);
  const candidate = draft([
    observedChange('claim-primary', 'change-secret-a'),
  ]);

  assert.deepEqual(
    completeness.evaluateArtifactCompleteness(candidate, bundle),
    {
      complete: false,
      requiredEvidenceIds: ['change-secret-a', 'change-secret-b'],
      coveredEvidenceIds: ['change-secret-a'],
      missingEvidenceIds: ['change-secret-b'],
    },
  );
  let caught: unknown;
  try {
    completeness.assertArtifactCompleteness(candidate, bundle);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  assert.equal(
    caught.message,
    'Pull-request artifact does not cover every substantive change.',
  );
  assert.doesNotMatch(caught.message, /private|change-secret/iu);
});

test('does not count inferred, provided, or non-change claims as coverage', () => {
  const bundle = evidence([
    { id: 'change-a', path: 'src/a.ts' },
    { id: 'change-b', path: 'src/b.ts' },
  ]);
  const report = completeness.evaluateArtifactCompleteness(
    draft([
      observedChange('claim-primary', 'change-a'),
      {
        id: 'claim-inferred',
        kind: 'change',
        basis: 'inferred',
        evidenceIds: ['change-b'],
      },
      {
        id: 'claim-provided',
        kind: 'change',
        basis: 'provided',
        evidenceIds: ['change-b'],
      },
      {
        id: 'claim-review',
        kind: 'review-focus',
        basis: 'observed',
        evidenceIds: ['change-b'],
      },
    ]),
    bundle,
  );

  assert.deepEqual(report.coveredEvidenceIds, ['change-a']);
  assert.deepEqual(report.missingEvidenceIds, ['change-b']);
});

test('keeps supporting-only documentation and test pull requests valid', () => {
  const bundle = evidence([
    { id: 'change-docs-a', path: 'README.md' },
    { id: 'change-docs-b', path: 'documentation/cli-reference.md' },
    { id: 'change-tests', path: 'test/cli.test.ts' },
    { id: 'change-manifest', path: 'package.json' },
  ]);
  const report = completeness.evaluateArtifactCompleteness(
    draft([observedChange('claim-primary', 'change-docs-a')]),
    bundle,
  );

  assert.deepEqual(report, {
    complete: true,
    requiredEvidenceIds: [],
    coveredEvidenceIds: [],
    missingEvidenceIds: [],
  });
  assert.doesNotThrow(() =>
    completeness.assertArtifactCompleteness(
      draft([observedChange('claim-primary', 'change-docs-a')]),
      bundle,
    ),
  );
});

test('uses the artifact selection override semantics without weakening coverage', () => {
  const bundle = evidence([
    { id: 'change-source', path: 'generated/client.ts' },
    { id: 'change-docs', path: 'docs/api.md' },
  ]);

  assert.deepEqual(
    completeness.evaluateArtifactCompleteness(
      draft([observedChange('claim-primary', 'change-docs')]),
      bundle,
      {
        supportingPaths: ['generated/**', 'docs/**'],
        primaryPaths: ['docs/**'],
      },
    ).requiredEvidenceIds,
    ['change-docs'],
  );
});

test('scales detailed narrative requirements proportionately and deterministically', () => {
  const boundaries = [
    { count: 0, claims: 0, span: 0 },
    { count: 3, claims: 0, span: 0 },
    { count: 4, claims: 2, span: 3 },
    { count: 23, claims: 5, span: 6 },
    { count: 25, claims: 5, span: 6 },
    { count: 36, claims: 6, span: 7 },
    { count: 100, claims: 6, span: 18 },
  ];

  for (const expected of boundaries) {
    const changes = Array.from({ length: expected.count }, (_, index) => ({
      id: `change-${String(index + 1).padStart(3, '0')}`,
      path: `src/module-${String(index + 1).padStart(3, '0')}.ts`,
    }));
    const report = completeness.evaluateArtifactNarrativeBreadth(
      draft([]),
      evidence([...changes].reverse()),
    );
    assert.equal(report.requiredClaimCount, expected.claims);
    assert.equal(report.maximumEvidenceIdsPerClaim, expected.span);
  }
});

test('does not let one broad primary claim satisfy detailed coverage', () => {
  const changes = Array.from({ length: 23 }, (_, index) => ({
    id: `change-${String(index + 1).padStart(2, '0')}`,
    path: `src/module-${String(index + 1).padStart(2, '0')}.ts`,
  }));
  const ids = changes.map((change) => change.id);
  const candidate = draft([
    observedChange('claim-primary', ...ids),
    observedChange('claim-catch-all', ...ids),
  ]);
  const report = completeness.evaluateArtifactNarrativeBreadth(
    candidate,
    evidence(changes),
  );

  assert.equal(report.complete, false);
  assert.equal(report.requiredClaimCount, 5);
  assert.equal(report.maximumEvidenceIdsPerClaim, 6);
  assert.deepEqual(report.detailClaimIds, []);
  assert.deepEqual(report.coveredEvidenceIds, []);
  assert.deepEqual(report.missingEvidenceIds, [...ids].sort());
  assert.deepEqual(report.overbroadClaimIds, ['claim-catch-all']);
  assert.throws(
    () => completeness.assertArtifactNarrativeBreadth(candidate, evidence(changes)),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        'Pull-request artifact needs more grounded change detail.',
      );
      assert.doesNotMatch(error.message, /module|change-/iu);
      return true;
    },
  );
});

test('accepts five bounded detailed claims for the PR 20 scale', () => {
  const changes = Array.from({ length: 23 }, (_, index) => ({
    id: `change-${String(index + 1).padStart(2, '0')}`,
    path: `src/module-${String(index + 1).padStart(2, '0')}.ts`,
  }));
  const ids = changes.map((change) => change.id);
  const detailClaims = Array.from({ length: 5 }, (_, index) =>
    observedChange(
      `claim-detail-${index + 1}`,
      ...ids.slice(index * 5, index === 4 ? ids.length : (index + 1) * 5),
    ),
  );
  const candidate = draft([
    observedChange('claim-primary', ...ids),
    ...detailClaims,
  ]);
  const report = completeness.evaluateArtifactNarrativeBreadth(
    candidate,
    evidence(changes),
  );

  assert.equal(report.complete, true);
  assert.equal(report.requiredClaimCount, 5);
  assert.equal(report.maximumEvidenceIdsPerClaim, 6);
  assert.deepEqual(report.detailClaimIds, [
    'claim-detail-1',
    'claim-detail-2',
    'claim-detail-3',
    'claim-detail-4',
    'claim-detail-5',
  ]);
  assert.deepEqual(report.coveredEvidenceIds, [...ids].sort());
  assert.deepEqual(report.missingEvidenceIds, []);
  assert.deepEqual(report.overbroadClaimIds, []);
  assert.doesNotThrow(() =>
    completeness.assertArtifactNarrativeBreadth(candidate, evidence(changes)),
  );
});

test('keeps small and supporting-only pull requests adaptive', () => {
  const small = evidence([
    { id: 'change-a', path: 'src/a.ts' },
    { id: 'change-b', path: 'src/b.ts' },
    { id: 'change-c', path: 'src/c.ts' },
  ]);
  assert.equal(
    completeness.evaluateArtifactNarrativeBreadth(
      draft([observedChange('claim-primary', 'change-a', 'change-b', 'change-c')]),
      small,
    ).complete,
    true,
  );

  const supportingOnly = evidence([
    { id: 'change-docs', path: 'README.md' },
    { id: 'change-tests', path: 'test/readme.test.ts' },
    { id: 'change-manifest', path: 'package.json' },
    { id: 'change-lock', path: 'package-lock.json' },
  ]);
  assert.equal(
    completeness.evaluateArtifactNarrativeBreadth(
      draft([observedChange('claim-primary', 'change-docs')]),
      supportingOnly,
    ).complete,
    true,
  );
});
