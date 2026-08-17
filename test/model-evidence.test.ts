import assert from 'node:assert/strict';
import test from 'node:test';

interface ChangeEvidenceItem {
  readonly id: string;
  readonly kind: 'change';
  readonly basis: 'observed';
  readonly source: { readonly kind: string; readonly locator: string };
  readonly payload: {
    readonly status: 'modified';
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
    readonly binary: boolean;
    readonly patch: string | null;
  };
}

interface EvidenceBundle {
  readonly items: ReadonlyArray<
    ChangeEvidenceItem | {
      readonly id: string;
      readonly kind: 'constraint';
      readonly basis: 'provided';
      readonly source: { readonly kind: string; readonly locator: string };
      readonly payload: { readonly name: string; readonly value: string };
    }
  >;
}

const {
  createEvidenceBundle,
  serializeEvidenceBundle,
}: {
  createEvidenceBundle(input: unknown): EvidenceBundle;
  serializeEvidenceBundle(evidence: EvidenceBundle): string;
} = require('../dist/change-evidence.js');
const {
  projectEvidenceForModel,
}: {
  projectEvidenceForModel(
    evidence: EvidenceBundle,
    detailedChangeIds: readonly string[],
  ): EvidenceBundle;
} = require('../dist/model-evidence.js');
const {
  protectRepositoryPolicyEvidence,
}: {
  protectRepositoryPolicyEvidence(evidence: EvidenceBundle): EvidenceBundle;
} = require('../dist/repository-policy.js');

const SHA = 'a'.repeat(40);

function change(
  id: string,
  path: string,
  patch: string | null,
): ChangeEvidenceItem {
  return {
    id,
    kind: 'change',
    basis: 'observed',
    source: { kind: 'git-net-diff', locator: path },
    payload: {
      status: 'modified',
      path,
      additions: 1,
      deletions: 1,
      binary: patch === null,
      patch,
    },
  };
}

test('projects every changed line for detailed evidence and omits supporting items', () => {
  const evidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [
      change(
        'change-source',
        'src/api.ts',
        'diff --git a/src/api.ts b/src/api.ts\n@@ -1,3 +1,3 @@\n context\n-old\n+new\n context two\n',
      ),
      change('change-docs', 'README.md', '+documentation\n'),
      {
        id: 'constraint-mode',
        kind: 'constraint',
        basis: 'provided',
        source: { kind: 'workflow', locator: 'mode' },
        payload: { name: 'mode', value: 'feature' },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });

  const projected = projectEvidenceForModel(evidence, ['change-source']);

  assert.deepEqual(
    projected.items.map((item) => item.id),
    ['change-source', 'constraint-mode'],
  );
  const projectedChange = projected.items[0];
  assert.equal(projectedChange?.kind, 'change');
  if (projectedChange?.kind === 'change') {
    assert.match(projectedChange.payload.patch ?? '', /^diff --git/mu);
    assert.match(projectedChange.payload.patch ?? '', /^-old$/mu);
    assert.match(projectedChange.payload.patch ?? '', /^\+new$/mu);
    assert.doesNotMatch(projectedChange.payload.patch ?? '', /^ context/mu);
  }
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(evidence.items.length, 3);
});

test('keeps a large complete evidence set below the model ceiling without truncating changed lines', () => {
  const supportingPatch = ` ${'context'.repeat(4_000)}\n+documented\n`;
  const substantivePatch = ` ${'context'.repeat(20_000)}\n-old behavior\n+new behavior\n`;
  const evidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [
      change('change-source', 'src/api.ts', substantivePatch),
      ...Array.from({ length: 12 }, (_, index) =>
        change(`change-docs-${String(index)}`, `docs/${String(index)}.md`, supportingPatch)
      ),
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  assert.equal(serializeEvidenceBundle(evidence).length > 256 * 1024, true);

  const projected = projectEvidenceForModel(evidence, ['change-source']);

  assert.equal(serializeEvidenceBundle(projected).length < 256 * 1024, true);
  const serialized = serializeEvidenceBundle(projected);
  assert.match(serialized, /old behavior/u);
  assert.match(serialized, /new behavior/u);
  assert.doesNotMatch(serialized, /documented/u);
});

test('preserves metadata-only policy protection in a detailed projection', () => {
  const privatePolicyValue = 'private-policy-projection-value';
  const evidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [
      change(
        'change-policy',
        '.diffwrightrc.json',
        `diff --git a/.diffwrightrc.json b/.diffwrightrc.json\n-${privatePolicyValue}\n+replacement\n`,
      ),
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });

  const protectedEvidence = protectRepositoryPolicyEvidence(evidence);
  const projected = projectEvidenceForModel(protectedEvidence, [
    'change-policy',
  ]);
  const policyItem = projected.items[0];

  assert.equal(policyItem?.kind, 'change');
  if (policyItem?.kind === 'change') {
    assert.equal(policyItem.source.kind, 'git-policy-metadata');
    assert.equal(policyItem.payload.patch, null);
  }
  assert.doesNotMatch(serializeEvidenceBundle(projected), new RegExp(privatePolicyValue, 'u'));
});

test('supports all-detailed projections and rejects invalid detailed id sets', () => {
  const evidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [change('change-docs', 'README.md', '+documentation\n')],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  assert.equal(
    projectEvidenceForModel(evidence, ['change-docs']).items.length,
    1,
  );
  assert.throws(
    () => projectEvidenceForModel(evidence, ['change-docs', 'change-docs']),
    /duplicate change ids/u,
  );
  assert.throws(
    () => projectEvidenceForModel(evidence, ['change-missing']),
    /unknown change id/u,
  );
});
