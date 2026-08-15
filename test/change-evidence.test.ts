import assert from 'node:assert/strict';
import test from 'node:test';

type EvidenceItem =
  | {
      id: string;
      kind: 'change';
      basis: 'observed';
      source: { kind: string; locator: string };
      payload: {
        status: 'modified';
        path: string;
        additions: number | null;
        deletions: number | null;
        binary: boolean;
        patch: string | null;
      };
    }
  | {
      id: string;
      kind: 'intent';
      basis: 'provided';
      source: { kind: string; locator: string };
      payload: { text: string };
    }
  | {
      id: string;
      kind: 'verification';
      basis: 'observed';
      source: { kind: string; locator: string };
      payload: { receiptId: string };
    };

interface VerificationReceipt {
  id: string;
  command: { file: string; args: string[]; display: string };
  status: 'passed' | 'failed' | 'skipped';
  exitCode: number | null;
  durationMs: number;
  source: 'diffwright' | 'external';
}

interface EvidenceBundleInput {
  snapshot: {
    headSha: string;
    baseRef?: string;
    baseSha?: string;
    mergeBaseSha?: string;
  };
  items: EvidenceItem[];
  receipts: VerificationReceipt[];
  coverage: {
    complete: boolean;
    gaps: Array<{
      source: string;
      reason: 'size-limit' | 'binary' | 'unavailable' | 'unsupported';
      locator?: string;
      omittedBytes?: number;
    }>;
  };
}

interface DraftClaim {
  id: string;
  kind:
    | 'change'
    | 'rationale'
    | 'verification'
    | 'risk'
    | 'review-focus'
    | 'follow-up';
  text: string;
  evidenceIds: readonly string[];
  basis: 'observed' | 'provided' | 'inferred';
  significance: 'primary' | 'supporting' | 'incidental';
}

interface EvidenceBundle extends EvidenceBundleInput {
  schemaVersion: 1;
}

interface ChangeEvidenceModule {
  createEvidenceBundle(input: EvidenceBundleInput): EvidenceBundle;
  serializeEvidenceBundle(bundle: EvidenceBundle): string;
  assertSupportedClaims(
    bundle: EvidenceBundle,
    claims: readonly DraftClaim[],
  ): void;
  selectRenderableClaims(
    bundle: EvidenceBundle,
    claims: readonly DraftClaim[],
  ): readonly DraftClaim[];
}

const changeEvidence: ChangeEvidenceModule = require('../dist/change-evidence.js');
const {
  assertSupportedClaims,
  createEvidenceBundle,
  selectRenderableClaims,
  serializeEvidenceBundle,
} = changeEvidence;

function baseInput(): EvidenceBundleInput {
  return {
    snapshot: {
      headSha: 'a'.repeat(40),
      baseRef: 'main',
      baseSha: 'b'.repeat(40),
      mergeBaseSha: 'c'.repeat(40),
    },
    items: [
      {
        id: 'change-1',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'src/parser.ts' },
        payload: {
          status: 'modified',
          path: 'src/parser.ts',
          additions: 2,
          deletions: 1,
          binary: false,
          patch: '+export function parse() {}\n',
        },
      },
      {
        id: 'intent-1',
        kind: 'intent',
        basis: 'provided',
        source: { kind: 'context-file', locator: 'intent.txt' },
        payload: { text: 'Handle empty tokens without throwing.' },
      },
      {
        id: 'verification-1',
        kind: 'verification',
        basis: 'observed',
        source: { kind: 'project-gate', locator: 'npm test' },
        payload: { receiptId: 'receipt-1' },
      },
    ],
    receipts: [
      {
        id: 'receipt-1',
        command: {
          file: 'npm',
          args: ['test'],
          display: 'npm test',
        },
        status: 'passed',
        exitCode: 0,
        durationMs: 42,
        source: 'diffwright',
      },
    ],
    coverage: { complete: true, gaps: [] },
  };
}

test('creates an immutable raw evidence bundle and serializes its provenance', () => {
  const input = baseInput();
  const bundle = createEvidenceBundle(input);
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.items), true);
  assert.equal(Object.isFrozen(bundle.items[0]), true);

  const serialized = serializeEvidenceBundle(bundle);
  assert.match(serialized, /"kind":"change"/);
  assert.match(serialized, /src\/parser\.ts/);
  assert.match(serialized, /"status":"passed"/);
  assert.doesNotMatch(serialized, /summarized evidence/i);

  input.snapshot.headSha = 'd'.repeat(40);
  assert.equal(bundle.snapshot.headSha, 'a'.repeat(40));
});

test('rejects duplicate identifiers, inconsistent coverage, and invalid receipts', () => {
  const duplicate = baseInput();
  duplicate.items.push({ ...duplicate.items[0] });
  assert.throws(() => createEvidenceBundle(duplicate), /Duplicate evidence id/);

  const inconsistentCoverage = baseInput();
  inconsistentCoverage.coverage = {
    complete: true,
    gaps: [{ source: 'git-diff', reason: 'size-limit', omittedBytes: 10 }],
  };
  assert.throws(
    () => createEvidenceBundle(inconsistentCoverage),
    /Complete coverage cannot contain gaps/,
  );

  const invalidReceipt = baseInput();
  invalidReceipt.receipts[0] = {
    ...invalidReceipt.receipts[0],
    status: 'passed',
    exitCode: 1,
  };
  assert.throws(
    () => createEvidenceBundle(invalidReceipt),
    /Passed receipt must have exit code 0/,
  );

  const missingReceipt = baseInput();
  missingReceipt.receipts = [];
  assert.throws(
    () => createEvidenceBundle(missingReceipt),
    /references unknown receipt/,
  );
});

test('validates change, rationale, and verification claims by evidence kind', () => {
  const bundle = createEvidenceBundle(baseInput());
  const claims: DraftClaim[] = [
    {
      id: 'claim-change',
      kind: 'change',
      text: 'Update src/parser.ts to handle tokens.',
      evidenceIds: ['change-1'],
      basis: 'observed',
      significance: 'primary',
    },
    {
      id: 'claim-rationale',
      kind: 'rationale',
      text: 'Handle empty tokens without throwing.',
      evidenceIds: ['intent-1'],
      basis: 'provided',
      significance: 'supporting',
    },
    {
      id: 'claim-verification',
      kind: 'verification',
      text: 'npm test passed.',
      evidenceIds: ['verification-1'],
      basis: 'observed',
      significance: 'supporting',
    },
  ];

  assert.doesNotThrow(() => assertSupportedClaims(bundle, claims));

  assert.throws(
    () =>
      assertSupportedClaims(bundle, [
        { ...claims[2], evidenceIds: ['change-1'] },
      ]),
    /requires a passed receipt/i,
  );
  assert.throws(
    () =>
      assertSupportedClaims(bundle, [
        { ...claims[1], evidenceIds: ['change-1'] },
      ]),
    /provided (?:evidence|intent)/i,
  );
  assert.throws(
    () =>
      assertSupportedClaims(bundle, [
        { ...claims[0], evidenceIds: ['missing-1'] },
      ]),
    /references unknown evidence id/,
  );
});

test('fails universal and identifier claims that exceed their cited evidence', () => {
  const input = baseInput();
  input.coverage = {
    complete: false,
    gaps: [
      {
        source: 'git-diff',
        reason: 'size-limit',
        locator: 'src/large.ts',
        omittedBytes: 100,
      },
    ],
  };
  const bundle = createEvidenceBundle(input);

  assert.throws(
    () =>
      assertSupportedClaims(bundle, [
        {
          id: 'claim-universal',
          kind: 'change',
          text: 'Update all provider integrations.',
          evidenceIds: ['change-1'],
          basis: 'observed',
          significance: 'primary',
        },
      ]),
    /requires complete coverage/i,
  );

  assert.throws(
    () =>
      assertSupportedClaims(bundle, [
        {
          id: 'claim-option',
          kind: 'change',
          text: 'Add the --package-manager option.',
          evidenceIds: ['change-1'],
          basis: 'observed',
          significance: 'primary',
        },
      ]),
    /identifier is absent from cited evidence/i,
  );
});

test('omits inferred prose from renderable claims and never echoes claim text in errors', () => {
  const bundle = createEvidenceBundle(baseInput());
  const secretLikeText = 'guarantees secret-looking-value is always safe';
  const claims: DraftClaim[] = [
    {
      id: 'claim-supported',
      kind: 'change',
      text: 'Update src/parser.ts.',
      evidenceIds: ['change-1'],
      basis: 'observed',
      significance: 'primary',
    },
    {
      id: 'claim-inferred',
      kind: 'risk',
      text: 'This may affect downstream parsers.',
      evidenceIds: ['change-1'],
      basis: 'inferred',
      significance: 'supporting',
    },
  ];

  assert.deepEqual(
    selectRenderableClaims(bundle, claims).map((claim) => claim.id),
    ['claim-supported'],
  );

  assert.throws(
    () =>
      assertSupportedClaims(bundle, [
        {
          ...claims[0],
          id: 'claim-secret',
          text: secretLikeText,
          evidenceIds: ['missing-1'],
        },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /secret-looking-value/);
      return true;
    },
  );
});
