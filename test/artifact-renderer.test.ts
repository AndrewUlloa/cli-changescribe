import assert from 'node:assert/strict';
import test from 'node:test';

interface RendererModule {
  MAX_GITHUB_PULL_REQUEST_BODY_BYTES: number;
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
  resultMode?: 'recognized' | 'unrecognized',
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
        ...(receiptStatus === 'skipped'
          ? { skipReason: 'not-configured' }
          : {}),
        ...(resultMode === 'recognized'
          ? {
              result: {
                type: 'test-summary',
                tests: 327,
                passed: 327,
                failed: 0,
                skipped: 0,
                cancelled: 0,
                todo: 0,
              },
            }
          : resultMode === 'unrecognized'
            ? { limitation: 'output-unrecognized' }
            : {}),
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

test('renders reviewer context in stable order and labels receipts as Validation', () => {
  const evidence = bundle();
  const draft = artifactDraft.parseArtifactDraft(
    JSON.stringify({
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
        {
          id: 'claim-problem',
          kind: 'problem',
          text: 'Empty input currently disrupts parser callers.',
          evidenceIds: ['intent-1'],
          basis: 'provided',
          significance: 'supporting',
        },
        {
          id: 'claim-detail',
          kind: 'change',
          text: 'Keep the parser result stable for empty input.',
          evidenceIds: ['change-1'],
          basis: 'observed',
          significance: 'supporting',
        },
        {
          id: 'claim-rationale',
          kind: 'rationale',
          text: 'Keep empty input compatible with existing parser callers.',
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
        {
          id: 'claim-compatibility',
          kind: 'compatibility',
          text: 'Existing parser callers keep their current result shape.',
          evidenceIds: ['intent-1'],
          basis: 'provided',
          significance: 'supporting',
        },
        {
          id: 'claim-review',
          kind: 'review-focus',
          text: 'Review empty-token handling at the parser boundary.',
          evidenceIds: ['change-1'],
          basis: 'observed',
          significance: 'supporting',
        },
        {
          id: 'claim-risk',
          kind: 'risk',
          text: 'Unusual token streams may need extra inspection.',
          evidenceIds: ['intent-1'],
          basis: 'provided',
          significance: 'supporting',
        },
        {
          id: 'claim-non-goal',
          kind: 'non-goal',
          text: 'This change does not redesign tokenization.',
          evidenceIds: ['intent-1'],
          basis: 'provided',
          significance: 'supporting',
        },
        {
          id: 'claim-follow-up',
          kind: 'follow-up',
          text: 'Evaluate token-stream telemetry separately.',
          evidenceIds: ['intent-1'],
          basis: 'provided',
          significance: 'supporting',
        },
      ],
      sections: [
        { kind: 'summary', claimIds: ['claim-change', 'claim-problem'] },
        { kind: 'changes', claimIds: ['claim-detail'] },
        { kind: 'rationale', claimIds: ['claim-rationale'] },
        { kind: 'verification', claimIds: ['claim-verification'] },
        { kind: 'compatibility', claimIds: ['claim-compatibility'] },
        { kind: 'review-focus', claimIds: ['claim-review'] },
        { kind: 'risks', claimIds: ['claim-risk'] },
        { kind: 'non-goals', claimIds: ['claim-non-goal'] },
        { kind: 'follow-ups', claimIds: ['claim-follow-up'] },
      ],
      trailers: [],
    }),
    evidence,
  );

  const artifact = renderer.renderPullRequestArtifact(draft, evidence);
  const headings = [...artifact.body.matchAll(/^## (.+)$/gmu)].map(
    (match) => match[1],
  );

  assert.deepEqual(headings, [
    'Summary',
    'Changes',
    'Why',
    'Validation',
    'Compatibility',
    'Review focus',
    'Risks',
    'Non-goals',
    'Follow-ups',
  ]);
  assert.match(
    artifact.body,
    /## Summary\n\n- handle empty tokens.*\n- Empty input currently/u,
  );
  assert.doesNotMatch(artifact.body, /## Verification/u);
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
  assert.match(artifact.body, /## Validation\n\n- Passed: `npm test`/);
  assert.doesNotMatch(artifact.body, /Tests passed somehow/);
  assert.doesNotMatch(artifact.body, /## Risks/);
  assert.doesNotMatch(artifact.body, /not provided/i);
  assert.match(
    artifact.body,
    /## Changes\n\n- \*\*Implementation:\*\* 1 file \(\+1 \/ -1\)/,
  );
  assert.doesNotMatch(artifact.body, /## Why|## Follow-ups/);
});

test('renders supported change claims followed by deterministic nonempty category totals', () => {
  const evidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'b'.repeat(40) },
    items: [
      {
        id: 'change-source-two',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'src/zeta.ts' },
        payload: {
          status: 'modified',
          path: 'src/zeta.ts',
          additions: 3,
          deletions: 2,
          binary: false,
          patch: '-old\n+new\n',
        },
      },
      {
        id: 'change-docs',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'README.md' },
        payload: {
          status: 'modified',
          path: 'README.md',
          additions: 4,
          deletions: 1,
          binary: false,
          patch: '+Document the change.\n',
        },
      },
      {
        id: 'change-source-one',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'src/alpha.ts' },
        payload: {
          status: 'added',
          path: 'src/alpha.ts',
          additions: 5,
          deletions: 0,
          binary: false,
          patch: '+export const alpha = true;\n',
        },
      },
      {
        id: 'change-test',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'test/alpha.test.ts' },
        payload: {
          status: 'added',
          path: 'test/alpha.test.ts',
          additions: 12,
          deletions: 0,
          binary: false,
          patch: '+test alpha\n',
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const draft = artifactDraft.parseArtifactDraft(
    JSON.stringify({
      schemaVersion: 1,
      title: {
        type: 'feat',
        breaking: false,
        subject: 'add deterministic change accounting',
        claimId: 'claim-primary',
      },
      claims: [
        {
          id: 'claim-primary',
          kind: 'change',
          text: 'add deterministic change accounting.',
          evidenceIds: ['change-source-one'],
          basis: 'observed',
          significance: 'primary',
        },
        {
          id: 'claim-supporting',
          kind: 'change',
          text: 'Preserve stable ordering across the accounting output.',
          evidenceIds: ['change-source-two'],
          basis: 'observed',
          significance: 'supporting',
        },
      ],
      sections: [
        { kind: 'summary', claimIds: ['claim-primary'] },
        { kind: 'changes', claimIds: ['claim-supporting'] },
      ],
      trailers: [],
    }),
    evidence,
  );

  const artifact = renderer.renderPullRequestArtifact(draft, evidence);

  assert.match(
    artifact.body,
    /## Changes\n\n- Preserve stable ordering across the accounting output\.\n- \*\*Implementation:\*\* 2 files \(\+8 \/ -2\)\n- \*\*Tests:\*\* 1 file \(\+12 \/ -0\)\n- \*\*Documentation:\*\* 1 file \(\+4 \/ -1\)/,
  );
  assert.doesNotMatch(artifact.body, /\*\*Configuration:|\*\*Other:/);
  assert.doesNotMatch(
    artifact.body,
    /src\/alpha|src\/zeta|test\/alpha|README\.md/,
  );
});

test('labels incomplete known counts and binary files without claiming exact totals', () => {
  const evidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'c'.repeat(40) },
    items: [
      {
        id: 'change-source',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'src/value.ts' },
        payload: {
          status: 'modified',
          path: 'src/value.ts',
          additions: 4,
          deletions: 5,
          binary: false,
          patch: '-old\n+new\n',
        },
      },
      {
        id: 'change-generated',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'src/generated.ts' },
        payload: {
          status: 'modified',
          path: 'src/generated.ts',
          additions: null,
          deletions: 2,
          binary: false,
          patch: null,
        },
      },
      {
        id: 'change-binary',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'public/logo.png' },
        payload: {
          status: 'added',
          path: 'public/logo.png',
          additions: null,
          deletions: null,
          binary: true,
          patch: null,
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const draft = artifactDraft.parseArtifactDraft(
    JSON.stringify({
      schemaVersion: 1,
      title: {
        type: 'feat',
        breaking: false,
        subject: 'account for incomplete change counts',
        claimId: 'claim-primary',
      },
      claims: [
        {
          id: 'claim-primary',
          kind: 'change',
          text: 'account for incomplete change counts.',
          evidenceIds: ['change-source'],
          basis: 'observed',
          significance: 'primary',
        },
      ],
      sections: [{ kind: 'summary', claimIds: ['claim-primary'] }],
      trailers: [],
    }),
    evidence,
  );

  const artifact = renderer.renderPullRequestArtifact(draft, evidence);

  assert.match(
    artifact.body,
    /- \*\*Implementation:\*\* 2 files \(\+4 known \(1 file unknown\) \/ -7\)/,
  );
  assert.match(
    artifact.body,
    /- \*\*Other:\*\* 1 file \(\+0 known \(1 file unknown\) \/ -0 known \(1 file unknown\)\); 1 binary file/,
  );
  assert.doesNotMatch(artifact.body, /\+4 \/ -7/);
});

test('does not expose Markdown-active change paths and rejects unsafe path metadata', () => {
  const safeButActivePath = 'src/[click](https:%2F%2Fevil.example).ts';
  const evidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'd'.repeat(40) },
    items: [
      {
        id: 'change-source',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: safeButActivePath },
        payload: {
          status: 'modified',
          path: safeButActivePath,
          additions: 1,
          deletions: 0,
          binary: false,
          patch: '+safe\n',
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const draft = artifactDraft.parseArtifactDraft(
    JSON.stringify({
      schemaVersion: 1,
      title: {
        type: 'fix',
        breaking: false,
        subject: 'keep accounting paths private',
        claimId: 'claim-primary',
      },
      claims: [
        {
          id: 'claim-primary',
          kind: 'change',
          text: 'keep accounting paths private.',
          evidenceIds: ['change-source'],
          basis: 'observed',
          significance: 'primary',
        },
      ],
      sections: [{ kind: 'summary', claimIds: ['claim-primary'] }],
      trailers: [],
    }),
    evidence,
  );

  const artifact = renderer.renderPullRequestArtifact(draft, evidence);
  assert.doesNotMatch(artifact.body, /click|evil\.example|https/);
  assert.match(artifact.body, /\*\*Implementation:\*\* 1 file/);

  const unsafeEvidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'e'.repeat(40) },
    items: [
      {
        id: 'change-source',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: 'redacted' },
        payload: {
          status: 'modified',
          path: 'src/private\u202evalue.ts',
          additions: 1,
          deletions: 0,
          binary: false,
          patch: '+safe\n',
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });

  let message = '';
  try {
    renderer.renderPullRequestArtifact(draft, unsafeEvidence);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /change path is unsafe/i);
  assert.doesNotMatch(message, /private|value/i);
});

test('keeps large change sets at reviewer-scale instead of emitting path bullets', () => {
  const changes = Array.from({ length: 250 }, (_, index) => ({
    id: `change-${String(index + 1)}`,
    kind: 'change',
    basis: 'observed',
    source: {
      kind: 'git-diff',
      locator: `src/generated/module-${String(index + 1)}.ts`,
    },
    payload: {
      status: 'modified',
      path: `src/generated/module-${String(index + 1)}.ts`,
      additions: 1,
      deletions: 0,
      binary: false,
      patch: '+export const generated = true;\n',
    },
  }));
  const evidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'f'.repeat(40) },
    items: changes,
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const draft = artifactDraft.parseArtifactDraft(
    JSON.stringify({
      schemaVersion: 1,
      title: {
        type: 'feat',
        breaking: false,
        subject: 'account for a large generated change',
        claimId: 'claim-primary',
      },
      claims: [
        {
          id: 'claim-primary',
          kind: 'change',
          text: 'account for a large generated change.',
          evidenceIds: ['change-1'],
          basis: 'observed',
          significance: 'primary',
        },
      ],
      sections: [{ kind: 'summary', claimIds: ['claim-primary'] }],
      trailers: [],
    }),
    evidence,
  );

  const artifact = renderer.renderPullRequestArtifact(draft, evidence);

  assert.match(
    artifact.body,
    /## Changes\n\n- \*\*Implementation:\*\* 250 files \(\+250 \/ -0\)/,
  );
  assert.equal(
    artifact.body.match(/\*\*Implementation:\*\*/gu)?.length,
    1,
  );
  assert.doesNotMatch(artifact.body, /module-(?:1|250)\.ts/);
  assert.equal(
    Buffer.byteLength(artifact.body, 'utf8') <
      renderer.MAX_GITHUB_PULL_REQUEST_BODY_BYTES,
    true,
  );
});

test('fails closed before returning a body above the existing GitHub limit', () => {
  assert.equal(renderer.MAX_GITHUB_PULL_REQUEST_BODY_BYTES, 64 * 1024);
  const evidence = bundle();
  const largeClaimText = `${'account for reviewer context '.repeat(300)}`.trim();
  const supportingClaims = Array.from({ length: 10 }, (_, index) => ({
    id: `claim-support-${String(index + 1)}`,
    kind: 'change',
    text: largeClaimText,
    evidenceIds: ['change-1'],
    basis: 'observed',
    significance: 'supporting',
  }));
  const oversizedDraft = {
    schemaVersion: 1,
    title: {
      type: 'fix',
      breaking: false,
      subject: 'bound the pull request body',
      claimId: 'claim-primary',
    },
    claims: [
      {
        id: 'claim-primary',
        kind: 'change',
        text: 'bound the pull request body.',
        evidenceIds: ['change-1'],
        basis: 'observed',
        significance: 'primary',
      },
      ...supportingClaims,
    ],
    sections: [
      { kind: 'summary', claimIds: ['claim-primary'] },
      {
        kind: 'changes',
        claimIds: supportingClaims.map((claim) => claim.id),
      },
    ],
    trailers: [],
  };

  assert.throws(
    () => renderer.renderPullRequestArtifact(oversizedDraft, evidence),
    /body exceeds its size limit/i,
  );
});

test('renders authoritative receipts without requiring model verification prose', () => {
  const evidence = bundle();
  const draft = artifactDraft.parseArtifactDraft(
    draftJson({ includeVerification: false }),
    evidence,
  );
  const artifact = renderer.renderPullRequestArtifact(draft, evidence);

  assert.match(artifact.body, /## Validation\n\n- Passed: `npm test`/);
});

test('renders only authoritative receipts in a PR Validation section', () => {
  const evidence = bundle();
  const draft = artifactDraft.parseArtifactDraft(draftJson(), evidence);
  const artifact = renderer.renderPullRequestArtifact(draft, evidence);

  assert.match(
    artifact.body,
    /## Validation\n\n- Passed: `npm test` in 30 ms(?:\n|$)/,
  );
  assert.doesNotMatch(artifact.body, /Tests passed somehow/);
});

test('renders exact recognized test totals and discloses unavailable counts', () => {
  const recognizedEvidence = bundle('passed', true, 'recognized');
  const recognizedDraft = artifactDraft.parseArtifactDraft(
    draftJson({ includeVerification: false }),
    recognizedEvidence,
  );
  const recognized = renderer.renderPullRequestArtifact(
    recognizedDraft,
    recognizedEvidence,
  );
  assert.match(
    recognized.body,
    /Passed: `npm test` in 30 ms — 327\/327 tests passed/u,
  );

  const unrecognizedEvidence = bundle('passed', true, 'unrecognized');
  const unrecognizedDraft = artifactDraft.parseArtifactDraft(
    draftJson({ includeVerification: false }),
    unrecognizedEvidence,
  );
  const unrecognized = renderer.renderPullRequestArtifact(
    unrecognizedDraft,
    unrecognizedEvidence,
  );
  assert.match(unrecognized.body, /test counts unavailable/u);
  assert.doesNotMatch(unrecognized.body, /\d+\/\d+ tests passed/u);
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
      status === 'failed'
        ? /Failed \(exit 17 after 30 ms\):/
        : /Skipped \(not configured\):/,
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
