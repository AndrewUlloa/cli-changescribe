import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  git,
  materializeRepository,
  type RepositoryFixture,
} from './git-fixture';

interface RendererModule {
  renderConventionalTitle(draft: {
    type: string;
    scope?: string;
    breaking: boolean;
    subject: string;
  }): { header: string; warnings: readonly string[] };
  renderCommitArtifact(
    draft: unknown,
    evidence: unknown,
  ): { message: string };
}

interface ChangeEvidenceModule {
  createEvidenceBundle(input: unknown): unknown;
  assertSupportedClaims(bundle: unknown, claims: readonly unknown[]): void;
}

interface ArtifactDraftModule {
  parseArtifactDraft(input: string, evidence: unknown): unknown;
}

interface ChangeMapModule {
  buildChangeMap(evidence: unknown): {
    fileCount: number;
    groups: readonly {
      category: string;
      fileCount: number;
      additions: { value: number; complete: boolean };
      deletions: { value: number; complete: boolean };
    }[];
  };
}

interface CompletenessModule {
  evaluateArtifactCompleteness(
    draft: { claims: readonly unknown[] },
    evidence: unknown,
  ): {
    complete: boolean;
    requiredEvidenceIds: readonly string[];
    coveredEvidenceIds: readonly string[];
  };
}

interface TitleSemanticsModule {
  evaluateTitleSemantics(
    evidence: unknown,
    options?: { allowedScopes?: readonly string[] },
  ): { allowedTypes: readonly string[]; scope?: string };
}

interface SetupFilesModule {
  transformRepositoryPolicy(contents: string, preferences: {
    scopeMode: 'optional' | 'forbidden';
    allowedScopes?: readonly string[];
    issueContext: 'optional' | 'recommended' | 'required';
    template: 'create' | 'preserve';
    mergeStrategy: 'squash' | 'platform';
    deleteBranch: boolean;
  }): { contents: string };
}

const renderer: RendererModule = require('../dist/artifact-renderer.js');
const changeEvidence: ChangeEvidenceModule = require('../dist/change-evidence.js');
const artifactDraft: ArtifactDraftModule = require('../dist/artifact-draft.js');
const changeMap: ChangeMapModule = require('../dist/change-map.js');
const completeness: CompletenessModule = require(
  '../dist/artifact-completeness.js'
);
const titleSemantics: TitleSemanticsModule = require(
  '../dist/title-semantics.js'
);
const setupFiles: SetupFilesModule = require('../dist/setup-files.js');

interface CommitCase {
  id: string;
  candidate?: string;
  candidates?: string[];
  expected: Record<string, unknown>;
}

interface RepositoryCase extends RepositoryFixture {
  expected: {
    nameStatus: string[];
    patchIncludes: string[];
    patchExcludes: string[];
    verificationClaims?: string[];
  };
}

interface ClaimCase {
  id: string;
  claimKind: string;
  statement: string;
  evidenceKinds: string[];
  expected: {
    accepted: boolean;
    diagnostic?: string;
  };
}

interface PullRequestCase {
  id: string;
  changes: Array<{
    id: string;
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }>;
  intents?: string[];
  allowedScopes?: string[];
  claims: Array<{ domain: string; evidenceIds: string[] }>;
  requestSequence: string[];
  oracle: {
    changeMap: Record<string, { files: number; additions: number; deletions: number }>;
    requiredDomains: string[];
    allowedTypes: string[];
    expectedScope: string | null;
    requestCeiling: number;
  };
}

interface InitCase {
  id: string;
  preferences: {
    scopeMode: 'optional' | 'forbidden';
    allowedScopes?: string[];
    issueContext: 'optional' | 'recommended' | 'required';
    template: 'create' | 'preserve';
    mergeStrategy: 'squash' | 'platform';
    deleteBranch: boolean;
  };
  oracle: {
    allowedScopes: string[] | null;
    issueContext: string;
    template: string;
    mergeStrategy: string;
    deleteBranch: boolean;
  };
}

interface EvidenceCorpus {
  schemaVersion: number;
  commitCases: CommitCase[];
  repositoryCases: RepositoryCase[];
  claimCases: ClaimCase[];
  prCases: PullRequestCase[];
  initCases: InitCase[];
}

const repoRoot = path.resolve(__dirname, '..');
const corpusPath = path.join(
  repoRoot,
  'fixtures',
  'evidence-v2',
  'corpus.json',
);

function loadCorpus(): EvidenceCorpus {
  return JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
}

test('evidence corpus has a stable schema and unique case identifiers', () => {
  const corpus = loadCorpus();
  assert.equal(corpus.schemaVersion, 2);
  assert.ok(corpus.commitCases.length >= 5);
  assert.ok(corpus.repositoryCases.length >= 5);
  assert.ok(corpus.claimCases.length >= 5);
  assert.ok(corpus.prCases.length >= 3);
  assert.ok(corpus.initCases.length >= 2);

  const allIds = [
    ...corpus.commitCases.map((fixture) => fixture.id),
    ...corpus.repositoryCases.map((fixture) => fixture.id),
    ...corpus.claimCases.map((fixture) => fixture.id),
    ...corpus.prCases.map((fixture) => fixture.id),
    ...corpus.initCases.map((fixture) => fixture.id),
  ];
  assert.equal(new Set(allIds).size, allIds.length);

  for (const fixture of corpus.commitCases) {
    assert.ok(
      fixture.candidate || fixture.candidates?.length,
    );
    assert.ok(Object.keys(fixture.expected).length > 0);
  }
  for (const fixture of corpus.claimCases) {
    assert.ok(fixture.statement.trim());
    assert.ok(fixture.evidenceKinds.length > 0);
    if (!fixture.expected.accepted) {
      assert.ok(fixture.expected.diagnostic);
    }
  }
});

test('PR corpus executes change maps, substantive coverage, domains, and title semantics', () => {
  const corpus = loadCorpus();
  for (const fixture of corpus.prCases) {
    const evidence = changeEvidence.createEvidenceBundle({
      snapshot: {
        headSha: '3'.repeat(40),
        baseSha: '1'.repeat(40),
        mergeBaseSha: '2'.repeat(40),
      },
      items: [
        ...fixture.changes.map((change) => ({
          id: change.id,
          kind: 'change',
          basis: 'observed',
          source: { kind: 'git-diff', locator: change.path },
          payload: {
            ...change,
            binary: false,
            patch: `+fixture ${change.id}`,
          },
        })),
        ...(fixture.intents ?? []).map((text, index) => ({
          id: `intent-${String(index + 1)}`,
          kind: 'intent',
          basis: 'provided',
          source: { kind: 'context-file', locator: 'intent.md' },
          payload: { text },
        })),
      ],
      receipts: [],
      coverage: { complete: true, gaps: [] },
    });
    const map = changeMap.buildChangeMap(evidence);
    assert.equal(map.fileCount, fixture.changes.length, fixture.id);
    for (const [category, expected] of Object.entries(fixture.oracle.changeMap)) {
      const group = map.groups.find((candidate) => candidate.category === category);
      assert.ok(group, `${fixture.id}:${category}`);
      assert.deepEqual(
        {
          files: group.fileCount,
          additions: group.additions.value,
          deletions: group.deletions.value,
        },
        expected,
        `${fixture.id}:${category}`,
      );
      assert.equal(group.additions.complete, true, fixture.id);
      assert.equal(group.deletions.complete, true, fixture.id);
    }

    const claims = fixture.claims.map((claim, index) => ({
      id: `claim-${String(index + 1)}`,
      kind: 'change',
      basis: 'observed',
      significance: index === 0 ? 'primary' : 'supporting',
      evidenceIds: claim.evidenceIds,
    }));
    const report = completeness.evaluateArtifactCompleteness({ claims }, evidence);
    assert.equal(report.complete, true, fixture.id);
    assert.deepEqual(
      [...report.coveredEvidenceIds].sort(),
      [...report.requiredEvidenceIds].sort(),
      fixture.id,
    );

    const representedDomains = new Set(
      fixture.claims
        .filter((claim) => claim.evidenceIds.length > 0)
        .map((claim) => claim.domain),
    );
    assert.deepEqual(
      [...representedDomains].sort(),
      [...fixture.oracle.requiredDomains].sort(),
      fixture.id,
    );
    const semantics = titleSemantics.evaluateTitleSemantics(evidence, {
      allowedScopes: fixture.allowedScopes,
    });
    assert.deepEqual(semantics.allowedTypes, fixture.oracle.allowedTypes, fixture.id);
    assert.equal(semantics.scope ?? null, fixture.oracle.expectedScope, fixture.id);
    assert.ok(
      fixture.requestSequence.length <= fixture.oracle.requestCeiling,
      fixture.id,
    );
    assert.equal(fixture.requestSequence[0], 'draft', fixture.id);
    assert.equal(
      fixture.requestSequence.at(-1),
      'critic',
      fixture.id,
    );
    assert.doesNotMatch(JSON.stringify(evidence), /"domain"/u, fixture.id);
  }
});

test('init corpus executes safe policy preferences without inventing scopes', () => {
  const corpus = loadCorpus();
  for (const fixture of corpus.initCases) {
    const transformed = setupFiles.transformRepositoryPolicy(
      '',
      fixture.preferences,
    );
    const policy = JSON.parse(transformed.contents) as {
      title: { allowedScopes?: string[] };
      pullRequest: { issueContext: string; template: string };
      merge: { strategy: string; deleteBranch: boolean };
    };
    assert.deepEqual(
      policy.title.allowedScopes ?? null,
      fixture.oracle.allowedScopes,
      fixture.id,
    );
    assert.equal(
      policy.pullRequest.issueContext,
      fixture.oracle.issueContext,
      fixture.id,
    );
    assert.equal(policy.pullRequest.template, fixture.oracle.template, fixture.id);
    assert.equal(policy.merge.strategy, fixture.oracle.mergeStrategy, fixture.id);
    assert.equal(policy.merge.deleteBranch, fixture.oracle.deleteBranch, fixture.id);
  }
});

test('commit corpus executes Conventional Commit grammar and length boundaries', () => {
  const corpus = loadCorpus();
  for (const fixture of corpus.commitCases) {
    const candidates = [
      ...(fixture.candidate === undefined ? [] : [fixture.candidate]),
      ...(fixture.candidates ?? []),
    ];
    const expectedBands = fixture.expected.lengthBands as string[] | undefined;
    const actualBands: string[] = [];

    for (const candidate of candidates) {
      const draft = parseTitle(candidate);
      try {
        const rendered = renderer.renderConventionalTitle(draft);
        assert.equal(rendered.header, candidate.split('\n', 1)[0], fixture.id);
        actualBands.push(rendered.warnings.length === 0 ? 'target' : 'advisory');
      } catch (error) {
        if (!expectedBands?.includes('blocking')) {
          throw error;
        }
        actualBands.push('blocking');
      }
    }

    if (expectedBands !== undefined) {
      assert.deepEqual(actualBands, expectedBands, fixture.id);
    } else if (fixture.expected.valid === true) {
      assert.equal(actualBands.includes('blocking'), false, fixture.id);
    }
    if (fixture.expected.lengthBand !== undefined) {
      assert.deepEqual(actualBands, [fixture.expected.lengthBand], fixture.id);
    }
    if (fixture.expected.breaking === true) {
      assert.equal(parseTitle(fixture.candidate ?? '').breaking, true, fixture.id);
    }
    if (
      fixture.candidate !== undefined &&
      (fixture.expected.bodyRequired !== undefined ||
        fixture.expected.trailers !== undefined)
    ) {
      assert.equal(renderCorpusCommit(fixture.candidate), fixture.candidate, fixture.id);
    }
  }
});

test('repository fixtures describe the final merge-base diff, not commit history', (context) => {
  const corpus = loadCorpus();

  for (const fixture of corpus.repositoryCases) {
    const repository = materializeRepository(fixture);
    context.after(() =>
      fs.rmSync(repository.directory, { recursive: true, force: true }),
    );
    const mergeBase = git(repository.directory, [
      'merge-base',
      repository.baseBranch,
      'HEAD',
    ]).trim();
    const head = git(repository.directory, ['rev-parse', 'HEAD']).trim();
    const nameStatus = git(repository.directory, [
      'diff',
      '--find-renames',
      '--name-status',
      mergeBase,
      head,
      '--',
    ])
      .trim()
      .split('\n')
      .filter(Boolean);
    const patch = git(repository.directory, [
      'diff',
      '--find-renames',
      '--unified=3',
      mergeBase,
      head,
      '--',
    ]);

    assert.deepEqual(nameStatus, fixture.expected.nameStatus, fixture.id);
    for (const expectedText of fixture.expected.patchIncludes) {
      assert.match(patch, new RegExp(escapeRegExp(expectedText)), fixture.id);
    }
    for (const excludedText of fixture.expected.patchExcludes) {
      assert.doesNotMatch(
        patch,
        new RegExp(escapeRegExp(excludedText)),
        fixture.id,
      );
    }
  }
});

test('corpus separates changed tests from observed verification', () => {
  const corpus = loadCorpus();
  const fixture = corpus.repositoryCases.find(
    (candidate) => candidate.id === 'tests-changed-no-run',
  );
  assert.ok(fixture);
  assert.deepEqual(fixture.expected.verificationClaims, []);

  const unsupported = corpus.claimCases.find(
    (candidate) => candidate.id === 'changed-test-is-not-passed-test',
  );
  assert.ok(unsupported);
  assert.equal(unsupported.expected.accepted, false);
  assert.equal(
    unsupported.expected.diagnostic,
    'verification-requires-passed-receipt',
  );
});

test('claim corpus executes evidence-kind and coverage validation', () => {
  const corpus = loadCorpus();
  for (const fixture of corpus.claimCases) {
    const receipts: Array<Record<string, unknown>> = [];
    const items: Array<Record<string, unknown>> = fixture.evidenceKinds.map((kind, index) => {
      const id = `evidence-${index + 1}`;
      if (kind === 'verification') {
        const receiptId = `receipt-${index + 1}`;
        receipts.push({
          id: receiptId,
          command: { file: 'npm', args: ['test'], display: 'npm test' },
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          source: 'diffwright',
        });
        return {
          id,
          kind: 'verification',
          basis: 'observed',
          source: { kind: 'fixture', locator: 'npm test' },
          payload: { receiptId },
        };
      }
      if (kind === 'intent') {
        return {
          id,
          kind: 'intent',
          basis: 'provided',
          source: { kind: 'fixture', locator: 'intent' },
          payload: { text: fixture.statement },
        };
      }
      return {
        id,
        kind: 'change',
        basis: 'observed',
        source: { kind: 'fixture', locator: 'src/value.ts' },
        payload: {
          status: 'modified',
          path: 'src/value.ts',
          additions: 1,
          deletions: 1,
          binary: false,
          patch:
            (Reflect.get(fixture, 'evidenceText') as string | undefined) ??
            '+export const value = 2;',
        },
      };
    });
    const complete = Reflect.get(fixture, 'coverageComplete') !== false;
    const bundle = changeEvidence.createEvidenceBundle({
      snapshot: { headSha: '1'.repeat(40) },
      items,
      receipts,
      coverage: {
        complete,
        gaps: complete
          ? []
          : [
              {
                source: 'fixture',
                reason: 'size-limit',
                locator: 'src/value.ts',
              },
            ],
      },
    });
    const claim = {
      id: 'claim-1',
      kind: fixture.claimKind,
      text: fixture.statement,
      evidenceIds: items.map((item) => item.id as string),
      basis: items.some((item) => item.basis === 'provided')
        ? 'provided'
        : 'observed',
      significance: 'primary',
    };

    let diagnostic: string | undefined;
    try {
      changeEvidence.assertSupportedClaims(bundle, [claim]);
    } catch (error) {
      diagnostic = claimDiagnostic(error);
    }
    assert.equal(diagnostic === undefined, fixture.expected.accepted, fixture.id);
    if (!fixture.expected.accepted) {
      assert.equal(diagnostic, fixture.expected.diagnostic, fixture.id);
    }
  }
});

function parseTitle(candidate: string): {
  type: string;
  scope?: string;
  breaking: boolean;
  subject: string;
} {
  const header = candidate.split('\n', 1)[0];
  const match =
    /^([a-z][a-z0-9-]*)(?:\(([a-z0-9._/-]+)\))?(!)?: (.+)$/u.exec(
      header,
    );
  assert.ok(match, `Invalid corpus header: ${header}`);
  return {
    type: match[1],
    ...(match[2] === undefined ? {} : { scope: match[2] }),
    breaking: match[3] === '!',
    subject: match[4],
  };
}

function renderCorpusCommit(candidate: string): string {
  const title = parseTitle(candidate);
  const lines = candidate.split('\n');
  const body = lines.find(
    (line, index) => index > 0 && line.length > 0 && !line.includes(': '),
  );
  const trailerLines = lines.filter(
    (line, index) =>
      index > 0 &&
      /^(BREAKING CHANGE|[A-Za-z][A-Za-z0-9-]*): /u.test(line),
  );
  const items: Array<Record<string, unknown>> = [
    {
      id: 'change-1',
      kind: 'change',
      basis: 'observed',
      source: { kind: 'fixture', locator: 'src/parser.ts' },
      payload: {
        status: 'modified',
        path: 'src/parser.ts',
        additions: 1,
        deletions: 1,
        binary: false,
        patch: '+updated parser behavior',
      },
    },
  ];
  if (body !== undefined || trailerLines.length > 0) {
    items.push({
      id: 'intent-1',
      kind: 'intent',
      basis: 'provided',
      source: { kind: 'fixture', locator: 'provided-context' },
      payload: { text: [body, ...trailerLines].filter(Boolean).join('\n') },
    });
  }
  if (title.breaking) {
    items.push({
      id: 'constraint-breaking',
      kind: 'constraint',
      basis: 'provided',
      source: { kind: 'fixture', locator: 'breaking-change' },
      payload: { name: 'breaking-change', value: true },
    });
  }
  const evidence = changeEvidence.createEvidenceBundle({
    snapshot: { headSha: '2'.repeat(40) },
    items,
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const claims = [
    {
      id: 'claim-change',
      kind: 'change',
      text: `${title.subject}.`,
      evidenceIds: ['change-1'],
      basis: 'observed',
      significance: 'primary',
    },
    ...(body === undefined
      ? []
      : [
          {
            id: 'claim-rationale',
            kind: 'rationale',
            text: body,
            evidenceIds: ['intent-1'],
            basis: 'provided',
            significance: 'supporting',
          },
        ]),
  ];
  const trailers = trailerLines.map((line) => {
    const match = /^(BREAKING CHANGE|[A-Za-z][A-Za-z0-9-]*): (.+)$/u.exec(line);
    assert.ok(match);
    return {
      token: match[1],
      value: match[2],
      evidenceIds: [
        match[1] === 'BREAKING CHANGE' ? 'constraint-breaking' : 'intent-1',
      ],
    };
  });
  const parsed = artifactDraft.parseArtifactDraft(
    JSON.stringify({
      schemaVersion: 1,
      title: { ...title, claimId: 'claim-change' },
      claims,
      sections: [
        { kind: 'summary', claimIds: ['claim-change'] },
        ...(body === undefined
          ? []
          : [{ kind: 'rationale', claimIds: ['claim-rationale'] }]),
      ],
      trailers,
    }),
    evidence,
  );
  return renderer.renderCommitArtifact(parsed, evidence).message;
}

function claimDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/requires a passed receipt/iu.test(message)) {
    return 'verification-requires-passed-receipt';
  }
  if (/requires provided intent/iu.test(message)) {
    return 'rationale-requires-provided-intent';
  }
  if (/identifier is absent from cited evidence/iu.test(message)) {
    return 'identifier-not-in-evidence';
  }
  if (/universal claim that requires complete coverage/iu.test(message)) {
    return 'universal-claim-with-incomplete-coverage';
  }
  return `unexpected:${message}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
