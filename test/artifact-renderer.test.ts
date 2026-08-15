import assert from 'node:assert/strict';
import test from 'node:test';

interface RendererModule {
  renderConventionalTitle(
    draft: { type: string; scope?: string; breaking: boolean; subject: string },
    policy?: {
      allowedTypes?: readonly string[];
      scopeMode?: 'optional' | 'required' | 'forbidden';
      allowedScopes?: readonly string[];
      targetLength?: number;
      maximumLength?: number;
    },
  ): { header: string; warnings: readonly string[] };
  renderPullRequestArtifact(
    draft: unknown,
    evidence: unknown,
    titlePolicy?: object,
    editorialPolicy?: object,
  ): { title: string; body: string; warnings: readonly string[] };
  renderCommitArtifact(
    draft: unknown,
    evidence: unknown,
    titlePolicy?: object,
    editorialPolicy?: object,
  ): { title: string; message: string; warnings: readonly string[] };
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
      {
        id: 'intent-1',
        kind: 'intent',
        basis: 'provided',
        source: { kind: 'user-intent', locator: 'test-fixture' },
        payload: {
          text: 'Keep empty input compatible with existing parser callers.',
        },
      },
      {
        id: 'constraint-issue',
        kind: 'constraint',
        basis: 'provided',
        source: { kind: 'workflow', locator: 'issue-reference' },
        payload: { name: 'issue-reference', value: '#123' },
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
      subject: 'handle empty tokens in the parser',
      claimId: 'claim-change',
    },
    claims: [
      {
        id: 'claim-change',
        kind: 'change',
        text: 'handle empty tokens in the parser.',
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

test('enforces repository type and scope policy without changing grammar', () => {
  assert.equal(
    renderer.renderConventionalTitle(
      {
        type: 'security',
        scope: 'cli',
        breaking: false,
        subject: 'reject unsafe configuration',
      },
      {
        allowedTypes: ['security'],
        scopeMode: 'required',
        allowedScopes: ['cli'],
      },
    ).header,
    'security(cli): reject unsafe configuration',
  );
  assert.throws(
    () =>
      renderer.renderConventionalTitle(
        {
          type: 'security',
          breaking: false,
          subject: 'reject unsafe configuration',
        },
        {
          allowedTypes: ['security'],
          scopeMode: 'required',
          allowedScopes: ['cli'],
        },
      ),
    /scope is required/i,
  );
  assert.equal(
    renderer.renderConventionalTitle(
      {
        type: 'fix',
        scope: 'cli',
        breaking: false,
        subject: 'reject unsafe configuration',
      },
      { scopeMode: 'forbidden' },
    ).header,
    'fix: reject unsafe configuration',
  );
});

test('renders an adaptive wrapped commit without forced filler', () => {
  const evidence = bundle();
  const draft = artifactDraft.parseArtifactDraft(
    JSON.stringify({
      schemaVersion: 1,
      title: {
        type: 'fix',
        scope: 'parser',
        breaking: false,
        subject: 'handle empty tokens without throwing from the parser',
        claimId: 'claim-change',
      },
      claims: [
        {
          id: 'claim-change',
          kind: 'change',
          text: 'handle empty tokens without throwing from the parser.',
          evidenceIds: ['change-1'],
          basis: 'observed',
          significance: 'primary',
        },
        {
          id: 'claim-rationale',
          kind: 'rationale',
          text: 'Keep empty input compatible with existing parser callers.',
          evidenceIds: ['intent-1'],
          basis: 'provided',
          significance: 'supporting',
        },
      ],
      sections: [
        { kind: 'summary', claimIds: ['claim-change'] },
        { kind: 'rationale', claimIds: ['claim-rationale'] },
      ],
      trailers: [
        { token: 'Refs', value: '#123', evidenceIds: ['constraint-issue'] },
      ],
    }),
    evidence,
  );
  const artifact = renderer.renderCommitArtifact(draft, evidence);

  assert.equal(
    artifact.title,
    'fix(parser): handle empty tokens without throwing from the parser',
  );
  assert.equal(
    artifact.message,
    [
      'fix(parser): handle empty tokens without throwing from the parser',
      '',
      'Keep empty input compatible with existing parser callers.',
      '',
      'Refs: #123',
    ].join('\n'),
  );
  assert.doesNotMatch(artifact.message, /not provided|risk:/i);
  for (const line of artifact.message.split('\n')) {
    assert.ok(line.length <= 72, line);
  }
});

test('uses a subject-only commit when no durable body context is supported', () => {
  const evidence = bundle();
  const draft = artifactDraft.parseArtifactDraft(
    draftJson({ includeVerification: false }),
    evidence,
  );
  assert.equal(
    renderer.renderCommitArtifact(draft, evidence).message,
    'fix(parser): handle empty tokens in the parser',
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

test('rejects Unicode controls and invalid UTF-8 in canonical titles', () => {
  for (const subject of [
    'spoof\u202Etxt',
    'isolate\u2066txt',
    'arabic-mark\u061Ctxt',
    'right-to-left-mark\u200Ftxt',
    'control\u0085txt',
    'surrogate\ud800txt',
  ]) {
    assert.throws(
      () =>
        renderer.renderConventionalTitle({
          type: 'fix',
          breaking: false,
          subject,
        }),
      /subject is invalid/i,
    );
  }
});

test('adds editorial findings as warnings without rewriting rendered bytes', () => {
  const evidence = bundle();
  const draft = artifactDraft.parseArtifactDraft(
    draftJson({ includeVerification: false }),
    evidence,
  );
  const baseline = renderer.renderCommitArtifact(draft, evidence);
  const reviewed = renderer.renderCommitArtifact(draft, evidence, {}, {
    vagueAbsolutes: ['handle'],
  });

  assert.equal(reviewed.message, baseline.message);
  assert.equal(reviewed.title, baseline.title);
  assert.match(
    reviewed.warnings.join('\n'),
    /\[vague-absolute\].*handle/i,
  );
});

test('renders adaptive PR sections and exact receipts, not model test prose', () => {
  const evidence = bundle();
  const draft = artifactDraft.parseArtifactDraft(draftJson(), evidence);
  const artifact = renderer.renderPullRequestArtifact(draft, evidence);

  assert.equal(artifact.title, 'fix(parser): handle empty tokens in the parser');
  assert.match(artifact.body, /## Summary\n\n- handle empty tokens in the parser\./);
  assert.match(artifact.body, /## Verification\n\n- Passed: `npm test`/);
  assert.doesNotMatch(artifact.body, /Tests passed somehow/);
  assert.doesNotMatch(artifact.body, /## Risks/);
  assert.doesNotMatch(artifact.body, /not provided/i);
  assert.doesNotMatch(artifact.body, /## Changes|## Why|## Follow-ups/);
});

test('renders authoritative receipts without requiring model verification prose', () => {
  const evidence = bundle();
  const draft = artifactDraft.parseArtifactDraft(
    draftJson({ includeVerification: false }),
    evidence,
  );
  const artifact = renderer.renderPullRequestArtifact(draft, evidence);

  assert.match(artifact.body, /## Verification\n\n- Passed: `npm test`/);
});

test('renders only authoritative receipts in a PR verification section', () => {
  const evidence = bundle();
  const draft = artifactDraft.parseArtifactDraft(draftJson(), evidence);
  const artifact = renderer.renderPullRequestArtifact(draft, evidence);

  assert.match(
    artifact.body,
    /## Verification\n\n- Passed: `npm test`(?:\n|$)/,
  );
  assert.doesNotMatch(artifact.body, /Tests passed somehow/);
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
