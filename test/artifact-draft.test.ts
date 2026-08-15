import assert from 'node:assert/strict';
import test from 'node:test';

interface ArtifactDraftModule {
  parseArtifactDraft(input: string, evidence: unknown): {
    schemaVersion: 1;
    title: { type: string; scope?: string; breaking: boolean; subject: string };
    claims: Array<{ id: string; text: string }>;
    sections: Array<{ kind: string; claimIds: string[] }>;
    trailers: Array<{ token: string; value: string }>;
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
      subject: 'handle empty tokens',
    },
    claims: [
      {
        id: 'claim-change',
        kind: 'change',
        text: 'Handle empty tokens in src/parser.ts.',
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
    trailers: [{ token: 'Refs', value: '#123' }],
  };
}

test('parses a bounded evidence-linked JSON draft and freezes it', () => {
  const draft = artifactDraft.parseArtifactDraft(
    JSON.stringify(validDraft()),
    evidenceBundle(),
  );
  assert.equal(draft.title.scope, 'parser');
  assert.equal(draft.claims.length, 3);
  assert.equal(draft.trailers[0].token, 'Refs');
  assert.equal(Object.isFrozen(draft), true);
  assert.equal(Object.isFrozen(draft.claims), true);
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
