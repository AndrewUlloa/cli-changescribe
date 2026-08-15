import assert from 'node:assert/strict';
import test from 'node:test';

interface ArtifactDraftModule {
  parseArtifactDraft(
    input: string,
    evidence: unknown,
    selectionPolicy?: {
      supportingPaths?: readonly string[];
      primaryPaths?: readonly string[];
    },
  ): {
    schemaVersion: 1;
    title: {
      type: string;
      scope?: string;
      breaking: boolean;
      subject: string;
      claimId: string;
    };
    claims: Array<{ id: string; text: string }>;
    sections: Array<{ kind: string; claimIds: string[] }>;
    trailers: Array<{ token: string; value: string; evidenceIds: string[] }>;
  };
}

interface ChangeEvidenceModule {
  createEvidenceBundle(input: unknown): unknown;
}

const artifactDraft: ArtifactDraftModule = require('../dist/artifact-draft.js');
const changeEvidence: ChangeEvidenceModule = require('../dist/change-evidence.js');

function evidenceBundle(): unknown {
  return changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'a'.repeat(40) },
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
        source: { kind: 'user-intent', locator: 'command-line' },
        payload: { text: 'Prevent empty tokens from throwing.' },
      },
      {
        id: 'constraint-issue',
        kind: 'constraint',
        basis: 'provided',
        source: { kind: 'workflow', locator: 'issue-reference' },
        payload: { name: 'issue-reference', value: '#123' },
      },
      {
        id: 'verification-1',
        kind: 'verification',
        basis: 'observed',
        source: { kind: 'project-gate', locator: 'npm test' },
        payload: { receiptId: 'gate-test' },
      },
    ],
    receipts: [
      {
        id: 'gate-test',
        command: { file: 'npm', args: ['test'], display: 'npm test' },
        status: 'passed',
        exitCode: 0,
        durationMs: 25,
        source: 'diffwright',
      },
    ],
    coverage: { complete: true, gaps: [] },
  });
}

function validDraft(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    title: {
      type: 'fix',
      scope: 'parser',
      breaking: false,
      subject: 'handle empty tokens in src/parser.ts',
      claimId: 'claim-change',
    },
    claims: [
      {
        id: 'claim-change',
        kind: 'change',
        text: 'handle empty tokens in src/parser.ts.',
        evidenceIds: ['change-1'],
        basis: 'observed',
        significance: 'primary',
      },
      {
        id: 'claim-rationale',
        kind: 'rationale',
        text: 'Prevent empty tokens from throwing.',
        evidenceIds: ['intent-1'],
        basis: 'provided',
        significance: 'supporting',
      },
      {
        id: 'claim-verification',
        kind: 'verification',
        text: 'The project test gate passed.',
        evidenceIds: ['verification-1'],
        basis: 'observed',
        significance: 'supporting',
      },
    ],
    sections: [
      { kind: 'summary', claimIds: ['claim-change'] },
      { kind: 'rationale', claimIds: ['claim-rationale'] },
      { kind: 'verification', claimIds: ['claim-verification'] },
    ],
    trailers: [
      { token: 'Refs', value: '#123', evidenceIds: ['constraint-issue'] },
    ],
  };
}

test('parses a bounded evidence-linked JSON draft and freezes it', () => {
  const draft = artifactDraft.parseArtifactDraft(
    JSON.stringify(validDraft()),
    evidenceBundle(),
  );
  assert.equal(draft.title.scope, 'parser');
  assert.equal(draft.title.claimId, 'claim-change');
  assert.equal(draft.claims.length, 3);
  assert.equal(draft.trailers[0].token, 'Refs');
  assert.deepEqual(draft.trailers[0].evidenceIds, ['constraint-issue']);
  assert.equal(Object.isFrozen(draft), true);
  assert.equal(Object.isFrozen(draft.claims), true);
});

test('requires every trailer to cite provided evidence', () => {
  for (const evidenceIds of [[], ['missing-1']]) {
    const candidate = validDraft();
    const trailers = candidate.trailers as Array<Record<string, unknown>>;
    trailers[0].evidenceIds = evidenceIds;
    assert.throws(
      () =>
        artifactDraft.parseArtifactDraft(
          JSON.stringify(candidate),
          evidenceBundle(),
        ),
      /trailer evidence/i,
    );
  }
});

test('rejects free-form markdown, unknown fields, and unknown evidence ids', () => {
  assert.throws(
    () => artifactDraft.parseArtifactDraft('## Summary\n- changed', evidenceBundle()),
    /not valid JSON/,
  );

  const withUnknownField = validDraft();
  withUnknownField.confidence = 0.9;
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(withUnknownField),
        evidenceBundle(),
      ),
    /missing or unknown fields/,
  );

  const withUnknownEvidence = validDraft();
  const claims = withUnknownEvidence.claims as Array<Record<string, unknown>>;
  claims[0].evidenceIds = ['missing-1'];
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(withUnknownEvidence),
        evidenceBundle(),
      ),
    /references unknown evidence id/,
  );
});

test('requires explicit evidence before rendering a breaking title', () => {
  const candidate = validDraft();
  (candidate.title as Record<string, unknown>).breaking = true;
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(candidate),
        evidenceBundle(),
      ),
    /explicit breaking-change constraint/,
  );
});

test('rejects unsupported rationale and risk instead of accepting plausible prose', () => {
  for (const kind of ['rationale', 'risk']) {
    const candidate = validDraft();
    const claims = candidate.claims as Array<Record<string, unknown>>;
    claims[1] = {
      ...claims[1],
      kind,
      evidenceIds: ['change-1'],
      basis: 'observed',
    };
    assert.throws(
      () =>
        artifactDraft.parseArtifactDraft(
          JSON.stringify(candidate),
          evidenceBundle(),
        ),
      /requires provided (?:evidence|intent)/i,
    );
  }
});

test('requires each claim exactly once and rejects duplicate references', () => {
  const omitted = validDraft();
  (omitted.sections as Array<Record<string, unknown>>).pop();
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(omitted),
        evidenceBundle(),
      ),
    /exactly one section/,
  );

  const duplicated = validDraft();
  (duplicated.sections as Array<{ kind: string; claimIds: string[] }>).push({
    kind: 'changes',
    claimIds: ['claim-change'],
  });
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(duplicated),
        evidenceBundle(),
      ),
    /more than one section/,
  );
});

test('requires one observed primary change as the sole summary and title anchor', () => {
  const duplicatePrimary = validDraft();
  const duplicateClaims = duplicatePrimary.claims as Array<
    Record<string, unknown>
  >;
  duplicateClaims[1].significance = 'primary';
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(duplicatePrimary),
        evidenceBundle(),
      ),
    /exactly one observed primary change claim/,
  );

  const providedPrimary = validDraft();
  const providedClaims = providedPrimary.claims as Array<
    Record<string, unknown>
  >;
  providedClaims[0].basis = 'provided';
  providedClaims[0].evidenceIds = ['change-1', 'intent-1'];
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(providedPrimary),
        evidenceBundle(),
      ),
    /exactly one observed primary change claim/,
  );

  const extraSummaryClaim = validDraft();
  const summary = (
    extraSummaryClaim.sections as Array<{
      kind: string;
      claimIds: string[];
    }>
  ).find((section) => section.kind === 'summary');
  assert.ok(summary);
  summary.claimIds.push('claim-rationale');
  const rationale = (
    extraSummaryClaim.sections as Array<{
      kind: string;
      claimIds: string[];
    }>
  ).find((section) => section.kind === 'rationale');
  assert.ok(rationale);
  rationale.claimIds = [];
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(extraSummaryClaim),
        evidenceBundle(),
      ),
    /incompatible section|summary must contain only/i,
  );

  const wrongTitleClaim = validDraft();
  (wrongTitleClaim.title as Record<string, unknown>).claimId =
    'claim-rationale';
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(wrongTitleClaim),
        evidenceBundle(),
      ),
    /title must reference the primary change claim/,
  );

  const unrelatedTitle = validDraft();
  (unrelatedTitle.title as Record<string, unknown>).subject =
    'update the project plan';
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(unrelatedTitle),
        evidenceBundle(),
      ),
    /title subject must match the primary change claim/,
  );
});

test('prevents supporting plan changes from displacing substantive source changes', () => {
  const evidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'b'.repeat(40) },
    items: [
      {
        id: 'change-source',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'src/commit.ts' },
        payload: {
          status: 'modified',
          path: 'src/commit.ts',
          additions: 120,
          deletions: 60,
          binary: false,
          patch: '+export function collectEvidence() {}\n',
        },
      },
      {
        id: 'change-plan',
        kind: 'change',
        basis: 'observed',
        source: {
          kind: 'git-diff',
          locator: 'specs/evidence-backed-generation-v2/PLAN.md',
        },
        payload: {
          status: 'modified',
          path: 'specs/evidence-backed-generation-v2/PLAN.md',
          additions: 1,
          deletions: 1,
          binary: false,
          patch: '- [ ] Task\n+ [x] Task\n',
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const planPrimary = {
    schemaVersion: 1,
    title: {
      type: 'docs',
      breaking: false,
      subject: 'mark the plan task complete',
      claimId: 'claim-plan',
    },
    claims: [
      {
        id: 'claim-source',
        kind: 'change',
        text: 'collect staged evidence.',
        evidenceIds: ['change-source'],
        basis: 'observed',
        significance: 'supporting',
      },
      {
        id: 'claim-plan',
        kind: 'change',
        text: 'mark the plan task complete.',
        evidenceIds: ['change-plan'],
        basis: 'observed',
        significance: 'primary',
      },
    ],
    sections: [
      { kind: 'summary', claimIds: ['claim-plan'] },
      { kind: 'changes', claimIds: ['claim-source'] },
    ],
    trailers: [],
  };

  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(JSON.stringify(planPrimary), evidence),
    /primary change may cite only substantive change evidence/,
  );

  const paddedPlanPrimary = structuredClone(planPrimary);
  paddedPlanPrimary.claims[1].evidenceIds = [
    'change-plan',
    'change-source',
  ];
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(paddedPlanPrimary),
        evidence,
      ),
    /primary change may cite only substantive change evidence/,
  );

  const sourcePrimary = structuredClone(planPrimary);
  sourcePrimary.title = {
    type: 'feat',
    breaking: false,
    subject: 'collect staged evidence',
    claimId: 'claim-source',
  };
  sourcePrimary.claims[0].significance = 'primary';
  sourcePrimary.claims[1].significance = 'supporting';
  sourcePrimary.sections = [
    { kind: 'summary', claimIds: ['claim-source'] },
    { kind: 'changes', claimIds: ['claim-plan'] },
  ];
  assert.doesNotThrow(() =>
    artifactDraft.parseArtifactDraft(JSON.stringify(sourcePrimary), evidence),
  );
});

test('treats executable GitHub configuration and substantive rename origins as primary', () => {
  const evidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'f'.repeat(40) },
    items: [
      {
        id: 'change-workflow',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: '.github/workflows/release.yml' },
        payload: {
          status: 'modified',
          path: '.github/workflows/release.yml',
          additions: 4,
          deletions: 1,
          binary: false,
          patch: '+permissions:\n+  contents: write\n',
        },
      },
      {
        id: 'change-rename',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'docs/legacy.ts' },
        payload: {
          status: 'renamed',
          oldPath: 'src/legacy.ts',
          path: 'docs/legacy.ts',
          additions: 0,
          deletions: 0,
          binary: false,
          patch: 'similarity index 100%\n',
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const workflowPrimary = {
    schemaVersion: 1,
    title: {
      type: 'ci',
      breaking: false,
      subject: 'grant release workflow write access',
      claimId: 'claim-workflow',
    },
    claims: [
      {
        id: 'claim-workflow',
        kind: 'change',
        text: 'grant release workflow write access.',
        evidenceIds: ['change-workflow'],
        basis: 'observed',
        significance: 'primary',
      },
      {
        id: 'claim-rename',
        kind: 'change',
        text: 'move the legacy source into documentation.',
        evidenceIds: ['change-rename'],
        basis: 'observed',
        significance: 'supporting',
      },
    ],
    sections: [
      { kind: 'summary', claimIds: ['claim-workflow'] },
      { kind: 'changes', claimIds: ['claim-rename'] },
    ],
    trailers: [],
  };

  assert.doesNotThrow(() =>
    artifactDraft.parseArtifactDraft(JSON.stringify(workflowPrimary), evidence),
  );
  const renamePrimary = structuredClone(workflowPrimary);
  renamePrimary.title = {
    type: 'refactor',
    breaking: false,
    subject: 'move the legacy source into documentation',
    claimId: 'claim-rename',
  };
  renamePrimary.claims[0].significance = 'supporting';
  renamePrimary.claims[1].significance = 'primary';
  renamePrimary.sections = [
    { kind: 'summary', claimIds: ['claim-rename'] },
    { kind: 'changes', claimIds: ['claim-workflow'] },
  ];
  assert.doesNotThrow(() =>
    artifactDraft.parseArtifactDraft(JSON.stringify(renamePrimary), evidence),
  );
});

test('keeps package manifests supporting when source changes are present', () => {
  const evidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'd'.repeat(40) },
    items: [
      {
        id: 'change-source',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'src/commit.ts' },
        payload: {
          status: 'modified',
          path: 'src/commit.ts',
          additions: 2,
          deletions: 1,
          binary: false,
          patch: '-old\n+new\n',
        },
      },
      {
        id: 'change-manifest',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'package.json' },
        payload: {
          status: 'modified',
          path: 'package.json',
          additions: 1,
          deletions: 1,
          binary: false,
          patch: '-old script\n+new script\n',
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const manifestPrimary = {
    schemaVersion: 1,
    title: {
      type: 'chore',
      breaking: false,
      subject: 'update the package script',
      claimId: 'claim-manifest',
    },
    claims: [
      {
        id: 'claim-manifest',
        kind: 'change',
        text: 'update the package script.',
        evidenceIds: ['change-manifest'],
        basis: 'observed',
        significance: 'primary',
      },
      {
        id: 'claim-source',
        kind: 'change',
        text: 'Update commit generation.',
        evidenceIds: ['change-source'],
        basis: 'observed',
        significance: 'supporting',
      },
    ],
    sections: [
      { kind: 'summary', claimIds: ['claim-manifest'] },
      { kind: 'changes', claimIds: ['claim-source'] },
    ],
    trailers: [],
  };

  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(manifestPrimary),
        evidence,
      ),
    /primary change may cite only substantive change evidence/,
  );

  const manifestOnly = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'e'.repeat(40) },
    items: [(evidence as { items: readonly unknown[] }).items[1]],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const onlyDraft = structuredClone(manifestPrimary);
  onlyDraft.claims = [onlyDraft.claims[0]];
  onlyDraft.sections = [{ kind: 'summary', claimIds: ['claim-manifest'] }];
  assert.doesNotThrow(() =>
    artifactDraft.parseArtifactDraft(JSON.stringify(onlyDraft), manifestOnly),
  );
});

test('allows supporting-only work and honors primary and supporting path overrides', () => {
  const docsOnlyEvidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'd'.repeat(40) },
    items: [
      {
        id: 'change-docs',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'docs/guide.md' },
        payload: {
          status: 'modified',
          path: 'docs/guide.md',
          additions: 2,
          deletions: 0,
          binary: false,
          patch: '+Explain setup.\n',
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const docsOnlyDraft = {
    schemaVersion: 1,
    title: {
      type: 'docs',
      breaking: false,
      subject: 'explain setup',
      claimId: 'claim-docs',
    },
    claims: [
      {
        id: 'claim-docs',
        kind: 'change',
        text: 'explain setup.',
        evidenceIds: ['change-docs'],
        basis: 'observed',
        significance: 'primary',
      },
    ],
    sections: [{ kind: 'summary', claimIds: ['claim-docs'] }],
    trailers: [],
  };
  assert.doesNotThrow(() =>
    artifactDraft.parseArtifactDraft(
      JSON.stringify(docsOnlyDraft),
      docsOnlyEvidence,
    ),
  );
  const testOnlyEvidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'e'.repeat(40) },
    items: [
      {
        id: 'change-test',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'test/parser.test.ts' },
        payload: {
          status: 'modified',
          path: 'test/parser.test.ts',
          additions: 3,
          deletions: 0,
          binary: false,
          patch: '+test("empty input", () => {});\n',
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const testOnlyDraft = structuredClone(docsOnlyDraft);
  testOnlyDraft.title.type = 'test';
  testOnlyDraft.title.subject = 'cover empty parser input';
  testOnlyDraft.title.claimId = 'claim-test';
  testOnlyDraft.claims[0].id = 'claim-test';
  testOnlyDraft.claims[0].text = 'cover empty parser input.';
  testOnlyDraft.claims[0].evidenceIds = ['change-test'];
  testOnlyDraft.sections[0].claimIds = ['claim-test'];
  assert.doesNotThrow(() =>
    artifactDraft.parseArtifactDraft(
      JSON.stringify(testOnlyDraft),
      testOnlyEvidence,
    ),
  );

  const evidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'c'.repeat(40) },
    items: [
      {
        id: 'change-docs',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'docs/guide.md' },
        payload: {
          status: 'modified',
          path: 'docs/guide.md',
          additions: 2,
          deletions: 0,
          binary: false,
          patch: '+Explain setup.\n',
        },
      },
      {
        id: 'change-generated',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'generated/client.ts' },
        payload: {
          status: 'modified',
          path: 'generated/client.ts',
          additions: 1,
          deletions: 1,
          binary: false,
          patch: '-old\n+new\n',
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const docsDraft = {
    schemaVersion: 1,
    title: {
      type: 'docs',
      breaking: false,
      subject: 'explain setup',
      claimId: 'claim-docs',
    },
    claims: [
      {
        id: 'claim-docs',
        kind: 'change',
        text: 'explain setup.',
        evidenceIds: ['change-docs'],
        basis: 'observed',
        significance: 'primary',
      },
      {
        id: 'claim-generated',
        kind: 'change',
        text: 'Refresh the generated client.',
        evidenceIds: ['change-generated'],
        basis: 'observed',
        significance: 'supporting',
      },
    ],
    sections: [
      { kind: 'summary', claimIds: ['claim-docs'] },
      { kind: 'changes', claimIds: ['claim-generated'] },
    ],
    trailers: [],
  };

  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(JSON.stringify(docsDraft), evidence),
    /primary change may cite only substantive change evidence/,
  );
  assert.doesNotThrow(() =>
    artifactDraft.parseArtifactDraft(JSON.stringify(docsDraft), evidence, {
      supportingPaths: ['docs/**', 'generated/**'],
    }),
  );
  assert.doesNotThrow(() =>
    artifactDraft.parseArtifactDraft(JSON.stringify(docsDraft), evidence, {
      supportingPaths: ['docs/**'],
      primaryPaths: ['docs/**'],
    }),
  );
});

test('rejects claims assigned to semantically incompatible sections', () => {
  const candidate = validDraft();
  const sections = candidate.sections as Array<{
    kind: string;
    claimIds: string[];
  }>;
  sections[0] = { kind: 'verification', claimIds: ['claim-change'] };
  sections[2] = { kind: 'summary', claimIds: ['claim-verification'] };
  assert.throws(
    () =>
      artifactDraft.parseArtifactDraft(
        JSON.stringify(candidate),
        evidenceBundle(),
      ),
    /incompatible section/,
  );
});

test('does not echo rejected claim text or unexpected field values', () => {
  const secret = 'gsk_sensitive_value';
  const candidate = validDraft();
  const claims = candidate.claims as Array<Record<string, unknown>>;
  claims[0].evidenceIds = [secret];
  let message = '';
  try {
    artifactDraft.parseArtifactDraft(JSON.stringify(candidate), evidenceBundle());
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message.includes(secret), false);
});
