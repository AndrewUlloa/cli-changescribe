import assert from 'node:assert/strict';
import test from 'node:test';

interface ArtifactDraft {
  readonly claims: readonly {
    readonly id: string;
    readonly kind: string;
    readonly basis: string;
    readonly evidenceIds: readonly string[];
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
