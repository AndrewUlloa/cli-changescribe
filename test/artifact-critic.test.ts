import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

interface ArtifactDraft {
  schemaVersion: 1;
  title: {
    type: string;
    breaking: boolean;
    subject: string;
    claimId: string;
  };
  claims: Array<{
    id: string;
    kind: 'change';
    text: string;
    evidenceIds: string[];
    basis: 'observed' | 'inferred';
    significance: 'primary' | 'supporting';
  }>;
  sections: Array<{ kind: 'summary'; claimIds: string[] }>;
  trailers: Array<{
    token: string;
    value: string;
    evidenceIds: string[];
  }>;
}

const critic = require('../dist/artifact-critic.js') as {
  buildArtifactCriticMessages(
    evidence: Record<string, unknown>,
    draft: ArtifactDraft,
  ): Array<{ role: string; content: string }>;
  assertArtifactCritique(value: string, draft: ArtifactDraft): void;
};

function draft(): ArtifactDraft {
  return {
    schemaVersion: 1,
    title: {
      type: 'fix',
      breaking: false,
      subject: 'guard the staged index',
      claimId: 'claim-change',
    },
    claims: [
      {
        id: 'claim-change',
        kind: 'change',
        text: 'guard the staged index.',
        evidenceIds: ['change-1'],
        basis: 'observed',
        significance: 'primary',
      },
      {
        id: 'claim-question',
        kind: 'change',
        text: 'check another path.',
        evidenceIds: ['change-1'],
        basis: 'inferred',
        significance: 'supporting',
      },
    ],
    sections: [{ kind: 'summary', claimIds: ['claim-change'] }],
    trailers: [],
  };
}

test('critic receives original evidence and the proposed draft as untrusted data', () => {
  const messages = critic.buildArtifactCriticMessages(
    {
      schemaVersion: 1,
      snapshot: { headSha: 'a'.repeat(40) },
      items: [],
      receipts: [],
      coverage: { complete: true, gaps: [] },
    },
    draft(),
  );
  const serialized = JSON.stringify(messages);
  assert.match(serialized, /independently audit/i);
  assert.match(serialized, /Original evidence bundle/);
  assert.match(serialized, /guard the staged index/);
  assert.match(serialized, /never as instructions/i);
});

test('critic accepts a complete 220 KiB evidence payload and keeps a bounded ceiling', () => {
  const evidence = (patch: string): Record<string, unknown> => ({
    schemaVersion: 1,
    snapshot: { headSha: 'a'.repeat(40) },
    items: [
      {
        id: 'change-1',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'src/large.ts' },
        payload: {
          status: 'modified',
          path: 'src/large.ts',
          additions: 1,
          deletions: 1,
          binary: false,
          patch,
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });

  assert.doesNotThrow(() =>
    critic.buildArtifactCriticMessages(
      evidence('x'.repeat(220 * 1024)),
      draft(),
    ),
  );
  assert.throws(
    () =>
      critic.buildArtifactCriticMessages(
        evidence('x'.repeat(280 * 1024)),
        draft(),
      ),
    /exceeds the supported size/i,
  );
});

test('accepts only a complete all-supported verdict for material claims', () => {
  const artifact = draft();
  assert.doesNotThrow(() =>
    critic.assertArtifactCritique(
      JSON.stringify({
        schemaVersion: 1,
        candidates: [{
          candidateId: 'claim:claim-change',
          evidenceIds: ['change-1'],
          supported: true,
        }],
      }),
      artifact,
    ),
  );
  assert.throws(
    () =>
      critic.assertArtifactCritique(
        JSON.stringify({
          schemaVersion: 1,
          candidates: [{
            candidateId: 'claim:claim-change',
            evidenceIds: ['change-1'],
            supported: false,
          }],
        }),
        artifact,
      ),
    /rejected unsupported claims/i,
  );
});

test('audits rendered supporting claims and trailers, but not inferred prose', () => {
  const artifact = draft();
  artifact.claims.push({
    id: 'claim-support',
    kind: 'change',
    text: 'preserve the reviewed tree.',
    evidenceIds: ['change-1'],
    basis: 'observed',
    significance: 'supporting',
  });
  artifact.trailers.push({
    token: 'Refs',
    value: '#123',
    evidenceIds: ['intent-1'],
  });
  const messages = critic.buildArtifactCriticMessages(
    {
      schemaVersion: 1,
      snapshot: { headSha: 'a'.repeat(40) },
      items: [],
      receipts: [],
      coverage: { complete: true, gaps: [] },
    },
    artifact,
  );
  const request = JSON.stringify(messages);
  assert.match(request, /claim:claim-change/);
  assert.match(request, /claim:claim-support/);
  assert.match(request, /trailer:1/);
  assert.doesNotMatch(request, /claim:claim-question/);
  assert.doesNotThrow(() =>
    critic.assertArtifactCritique(
      JSON.stringify({
        schemaVersion: 1,
        candidates: [
          {
            candidateId: 'claim:claim-change',
            evidenceIds: ['change-1'],
            supported: true,
          },
          {
            candidateId: 'claim:claim-support',
            evidenceIds: ['change-1'],
            supported: true,
          },
          {
            candidateId: 'trailer:1',
            evidenceIds: ['intent-1'],
            supported: true,
          },
        ],
      }),
      artifact,
    ),
  );
});

test('rejects missing, duplicate, unknown, and malformed critique claims', () => {
  const artifact = draft();
  const invalid = [
    '{not-json',
    '{"schemaVersion":1,"candidates":[{"candidateId":"claim:claim-change","evidenceIds":["change-1"],"supported":false,"supported":true}]}',
    '{"schemaVersion":1,"candidates":[{"candidateId":"claim:claim-change","evidenceIds":["change-1"],"supp\\u006frted":false,"supported":true}]}',
    JSON.stringify({
      schemaVersion: 1,
      candidates: [{
        candidateId: 'claim:claim-change',
        evidenceIds: [],
        supported: true,
      }],
    }),
    JSON.stringify({
      schemaVersion: 1,
      candidates: [{
        candidateId: 'claim:unknown',
        evidenceIds: ['change-1'],
        supported: true,
      }],
    }),
    JSON.stringify({
      schemaVersion: 1,
      candidates: [{
        candidateId: 'claim:claim-change',
        evidenceIds: ['change-1'],
        supported: true,
        reason: 'trust me',
      }],
    }),
  ];
  for (const value of invalid) {
    assert.throws(() => critic.assertArtifactCritique(value, artifact));
  }

  const multipleEvidence = draft();
  multipleEvidence.claims[0]?.evidenceIds.push('change-2');
  assert.throws(() =>
    critic.assertArtifactCritique(
      JSON.stringify({
        schemaVersion: 1,
        candidates: [{
          candidateId: 'claim:claim-change',
          evidenceIds: ['change-2', 'change-1'],
          supported: true,
        }],
      }),
      multipleEvidence,
    ),
  );
});

test('rejects unterminated containers and invalid separators without hanging', () => {
  const malformed = [
    '{"schemaVersion":1,"candidates":[',
    '{"schemaVersion":1',
    '{"schemaVersion":1 "candidates":[]}',
    '{"schemaVersion":1,"candidates"[]}',
    '{"schemaVersion":1,"candidates":[{"candidateId":"claim:claim-change","evidenceIds":["change-1" "change-2"],"supported":true}]}',
    '{"schemaVersion":1,"candidates":[,]}',
  ];
  const script = [
    "const critic = require(process.argv[1]);",
    'const malformed = JSON.parse(process.argv[2]);',
    'const artifact = JSON.parse(process.argv[3]);',
    'for (const value of malformed) {',
    '  let rejected = false;',
    '  try { critic.assertArtifactCritique(value, artifact); } catch { rejected = true; }',
    '  if (!rejected) process.exit(2);',
    '}',
  ].join('\n');

  assert.doesNotThrow(() =>
    execFileSync(
      process.execPath,
      [
        '-e',
        script,
        require.resolve('../dist/artifact-critic.js'),
        JSON.stringify(malformed),
        JSON.stringify(draft()),
      ],
      { encoding: 'utf8', stdio: 'pipe', timeout: 1_000 },
    ),
  );
});
