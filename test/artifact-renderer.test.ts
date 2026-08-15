import assert from 'node:assert/strict';
import test from 'node:test';

interface RendererModule {
  renderConventionalTitle(
    draft: { type: string; scope?: string; breaking: boolean; subject: string },
    policy?: {
      allowedTypes?: readonly string[];
      targetLength?: number;
      maximumLength?: number;
    },
  ): { header: string; warnings: readonly string[] };
  renderPullRequestArtifact(
    draft: unknown,
    evidence: unknown,
  ): { title: string; body: string; warnings: readonly string[] };
}

interface ArtifactDraftModule {
  parseArtifactDraft(input: string, evidence: unknown): unknown;
}

interface ChangeEvidenceModule {
  createEvidenceBundle(input: unknown): unknown;
}

const renderer: RendererModule = require('../dist/artifact-renderer.js');
const artifactDraft: ArtifactDraftModule = require('../dist/artifact-draft.js');
const changeEvidence: ChangeEvidenceModule = require('../dist/change-evidence.js');

function bundle(
  receiptStatus: 'passed' | 'failed' | 'skipped' = 'passed',
  complete = true,
): unknown {
  const exitCode =
    receiptStatus === 'passed' ? 0 : receiptStatus === 'failed' ? 17 : null;
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
          additions: 1,
          deletions: 1,
          binary: false,
          patch: '-old\n+new\n',
        },
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
        status: receiptStatus,
        exitCode,
        durationMs: 30,
        source: 'diffwright',
      },
    ],
    coverage: complete
      ? { complete: true, gaps: [] }
      : {
          complete: false,
          gaps: [{ source: 'git-patch', reason: 'size-limit' }],
        },
  });
}

function draftJson(options: { includeVerification?: boolean } = {}): string {
  const includeVerification = options.includeVerification ?? true;
  return JSON.stringify({
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
        text: 'Handle empty tokens in the parser.',
        evidenceIds: ['change-1'],
        basis: 'observed',
        significance: 'primary',
      },
      ...(includeVerification
        ? [
            {
              id: 'claim-verification',
              kind: 'verification',
              text: 'Tests passed somehow.',
              evidenceIds: ['verification-1'],
              basis: 'observed',
              significance: 'supporting',
            },
          ]
        : []),
      {
        id: 'claim-risk',
        kind: 'risk',
        text: 'This might affect unusual token streams.',
        evidenceIds: ['change-1'],
        basis: 'inferred',
        significance: 'incidental',
      },
    ],
    sections: [
      { kind: 'summary', claimIds: ['claim-change'] },
      ...(includeVerification
        ? [{ kind: 'verification', claimIds: ['claim-verification'] }]
        : []),
      { kind: 'risks', claimIds: ['claim-risk'] },
    ],
    trailers: [],
  });
}

test('renders standard, scoped, and breaking Conventional Commit titles', () => {
  for (const type of ['docs', 'test', 'refactor', 'perf', 'build', 'ci']) {
    assert.equal(
      renderer.renderConventionalTitle({
        type,
        breaking: false,
        subject: 'update project behavior',
      }).header,
      `${type}: update project behavior`,
    );
  }
  assert.equal(
    renderer.renderConventionalTitle({
      type: 'feat',
      scope: 'api',
      breaking: true,
      subject: 'remove legacy endpoint',
    }).header,
    'feat(api)!: remove legacy endpoint',
  );
});

test('treats 50 as a target and 72 as the hard default maximum', () => {
  const subjectFor = (headerLength: number): string =>
    'a'.repeat(headerLength - 'fix: '.length);
  assert.deepEqual(
    renderer.renderConventionalTitle({
      type: 'fix',
      breaking: false,
      subject: subjectFor(50),
    }).warnings,
    [],
  );
  for (const length of [51, 72]) {
    assert.deepEqual(
      renderer.renderConventionalTitle({
        type: 'fix',
        breaking: false,
        subject: subjectFor(length),
      }).warnings,
      ['Header exceeds the 50-character target.'],
    );
  }
  assert.throws(
    () =>
      renderer.renderConventionalTitle({
        type: 'fix',
        breaking: false,
        subject: subjectFor(73),
      }),
    /72-character maximum/,
  );
  assert.throws(
    () =>
      renderer.renderConventionalTitle({
        type: 'fix',
        breaking: false,
        subject: 'end with a period.',
      }),
    /must not end with a period/,
  );
});

test('renders adaptive PR sections and exact receipts, not model test prose', () => {
  const evidence = bundle();
  const draft = artifactDraft.parseArtifactDraft(draftJson(), evidence);
  const artifact = renderer.renderPullRequestArtifact(draft, evidence);

  assert.equal(artifact.title, 'fix(parser): handle empty tokens');
  assert.match(artifact.body, /## Summary\n\n- Handle empty tokens/);
  assert.match(artifact.body, /## Verification\n\n- Passed: `npm test`/);
  assert.doesNotMatch(artifact.body, /Tests passed somehow/);
  assert.doesNotMatch(artifact.body, /## Risks/);
  assert.doesNotMatch(artifact.body, /not provided/i);
  assert.doesNotMatch(artifact.body, /## Changes|## Why|## Follow-ups/);
});

test('never renders a failed or skipped receipt as passed', () => {
  for (const status of ['failed', 'skipped'] as const) {
    const evidence = bundle(status);
    const draft = artifactDraft.parseArtifactDraft(
      draftJson({ includeVerification: false }),
      evidence,
    );
    const artifact = renderer.renderPullRequestArtifact(draft, evidence);
    assert.doesNotMatch(artifact.body, /Passed:/);
    assert.match(
      artifact.body,
      status === 'failed' ? /Failed \(exit 17\):/ : /Skipped:/,
    );
  }
});

test('fails closed when evidence coverage is incomplete', () => {
  const completeEvidence = bundle();
  const draft = artifactDraft.parseArtifactDraft(
    draftJson(),
    completeEvidence,
  );
  assert.throws(
    () => renderer.renderPullRequestArtifact(draft, bundle('passed', false)),
    /evidence is incomplete/,
  );
});
