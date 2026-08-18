import assert from 'node:assert/strict';
import test from 'node:test';

interface ChangeFixture {
  readonly id: string;
  readonly path: string;
  readonly oldPath?: string;
}

interface HistoryFixture {
  readonly id: string;
  readonly subject?: string;
}

interface HistoryAdjacency {
  readonly historyId: string;
  readonly changeEvidenceIds: readonly string[];
}

interface TopicHint {
  readonly id: string;
  readonly historyEvidenceIds: readonly string[];
  readonly changeEvidenceIds: readonly string[];
}

interface TopicHints {
  readonly schemaVersion: 1;
  readonly hints: readonly TopicHint[];
  readonly unlinkedChangeEvidenceIds: readonly string[];
  readonly targetProseTopicCount: number;
}

interface TopicPlan {
  readonly schemaVersion: 1;
  readonly targetProseTopicCount: number;
  readonly topics: readonly {
    readonly id: string;
    readonly claimId: string;
    readonly changeEvidenceIds: readonly string[];
    readonly historyEvidenceIds: readonly string[];
  }[];
  readonly mapOnlyChangeEvidenceIds: readonly string[];
}

interface TestClaim {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
  readonly evidenceIds: readonly string[];
  readonly basis: string;
  readonly significance: 'primary' | 'supporting' | 'incidental';
}

interface TestDraft {
  readonly claims: readonly TestClaim[];
  readonly sections: readonly {
    readonly kind: string;
    readonly claimIds: readonly string[];
  }[];
}

interface ReviewerTopicsModule {
  buildReviewerTopicHints(
    evidence: unknown,
    adjacency: readonly HistoryAdjacency[],
    policy?: {
      readonly supportingPaths?: readonly string[];
      readonly primaryPaths?: readonly string[];
    },
  ): TopicHints;
  buildReviewerTopicPlan(
    draft: TestDraft,
    hints: TopicHints,
    evidence: unknown,
    policy?: {
      readonly supportingPaths?: readonly string[];
      readonly primaryPaths?: readonly string[];
    },
  ): TopicPlan;
}

interface ChangeEvidenceModule {
  createEvidenceBundle(input: unknown): unknown;
}

const reviewerTopics: ReviewerTopicsModule = require(
  '../dist/reviewer-topics.js'
);
const changeEvidence: ChangeEvidenceModule = require(
  '../dist/change-evidence.js'
);

function evidence(
  changes: readonly ChangeFixture[],
  histories: readonly HistoryFixture[] = [],
  includeIntent = false,
): unknown {
  return changeEvidence.createEvidenceBundle({
    snapshot: { headSha: 'a'.repeat(40) },
    items: [
      ...changes.map((change) => ({
        id: change.id,
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: change.path },
        payload: {
          status: change.oldPath === undefined ? 'modified' : 'renamed',
          ...(change.oldPath === undefined ? {} : { oldPath: change.oldPath }),
          path: change.path,
          additions: 1,
          deletions: 0,
          binary: false,
          patch: '+fixture\n',
        },
      })),
      ...(includeIntent
        ? [{
            id: 'intent-private',
            kind: 'intent',
            basis: 'provided',
            source: { kind: 'context-file', locator: 'private-context.md' },
            payload: { text: 'Private context.' },
          }]
        : []),
      ...histories.map((history, index) => ({
        id: history.id,
        kind: 'history',
        basis: 'provided',
        source: { kind: 'git-log', locator: `commit-${index + 1}` },
        payload: {
          sha: (index + 1).toString(16).padStart(40, '0'),
          subject: history.subject ?? `Checkpoint ${index + 1}`,
          body: '',
        },
      })),
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
}

function primary(evidenceId: string): TestClaim {
  return {
    id: 'claim-primary',
    kind: 'change',
    text: 'Update the branch.',
    evidenceIds: [evidenceId],
    basis: 'observed',
    significance: 'primary',
  };
}

function detail(
  id: string,
  evidenceIds: readonly string[],
  basis = 'observed',
): TestClaim {
  return {
    id,
    kind: 'change',
    text: 'Update one reviewer topic.',
    evidenceIds,
    basis,
    significance: 'supporting',
  };
}

function draft(
  primaryEvidenceId: string,
  claims: readonly TestClaim[],
  changesOrder: readonly string[] = claims.map((claim) => claim.id),
): TestDraft {
  const primaryClaim = primary(primaryEvidenceId);
  return {
    claims: [primaryClaim, ...claims],
    sections: [
      { kind: 'summary', claimIds: [primaryClaim.id] },
      ...(changesOrder.length === 0
        ? []
        : [{ kind: 'changes', claimIds: changesOrder }]),
    ],
  };
}

function expectHintError(run: () => unknown, secret = 'private'): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  assert.equal(caught.message, 'Reviewer topic hints are invalid.');
  assert.doesNotMatch(caught.message, new RegExp(secret, 'iu'));
}

function expectPlanError(run: () => unknown, secret = 'private'): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  assert.equal(caught.message, 'Reviewer topic plan is invalid.');
  assert.doesNotMatch(caught.message, new RegExp(secret, 'iu'));
}

test('collapses identical substantive adjacency and preserves evidence chronology', () => {
  const bundle = evidence(
    [
      { id: 'change-b', path: 'src/b.ts' },
      { id: 'change-a', path: 'src/a.ts', oldPath: 'src/old-a.ts' },
      { id: 'change-unlinked', path: 'src/unlinked.ts' },
      { id: 'change-supporting', path: 'README.md' },
    ],
    [
      { id: 'history-first' },
      { id: 'history-second' },
      { id: 'history-supporting' },
      { id: 'history-zero' },
    ],
  );
  const adjacency: HistoryAdjacency[] = [
    { historyId: 'history-zero', changeEvidenceIds: [] },
    {
      historyId: 'history-second',
      changeEvidenceIds: ['change-b', 'change-a'],
    },
    {
      historyId: 'history-supporting',
      changeEvidenceIds: ['change-supporting'],
    },
    {
      historyId: 'history-first',
      changeEvidenceIds: ['change-a', 'change-b'],
    },
  ];

  const hints = reviewerTopics.buildReviewerTopicHints(bundle, adjacency);

  assert.deepEqual(hints, {
    schemaVersion: 1,
    hints: [{
      id: 'reviewer-topic-hint-1',
      historyEvidenceIds: ['history-first', 'history-second'],
      changeEvidenceIds: ['change-a', 'change-b'],
    }],
    unlinkedChangeEvidenceIds: ['change-unlinked'],
    targetProseTopicCount: 1,
  });
  assert.equal(Object.isFrozen(hints), true);
  assert.equal(Object.isFrozen(hints.hints), true);
  assert.equal(Object.isFrozen(hints.hints[0]), true);
  assert.equal(Object.isFrozen(hints.hints[0]?.historyEvidenceIds), true);
  assert.equal(Object.isFrozen(hints.hints[0]?.changeEvidenceIds), true);
  assert.equal(Object.isFrozen(hints.unlinkedChangeEvidenceIds), true);

  adjacency[0]?.changeEvidenceIds.length;
  adjacency.reverse();
  assert.deepEqual(
    reviewerTopics.buildReviewerTopicHints(bundle, adjacency),
    hints,
  );
});

test('uses semantic groups instead of file count and caps the target at six', () => {
  const manyChanges = Array.from({ length: 100 }, (_, index) => ({
    id: `change-${String(index + 1).padStart(3, '0')}`,
    path: `src/file-${index + 1}.ts`,
  }));
  const oneThemeBundle = evidence(manyChanges, [{ id: 'history-codemod' }]);
  const oneTheme = reviewerTopics.buildReviewerTopicHints(oneThemeBundle, [{
    historyId: 'history-codemod',
    changeEvidenceIds: manyChanges.map((change) => change.id),
  }]);
  assert.equal(oneTheme.hints.length, 1);
  assert.equal(oneTheme.hints[0]?.changeEvidenceIds.length, 100);
  assert.equal(oneTheme.targetProseTopicCount, 1);

  const groupedChanges = Array.from({ length: 8 }, (_, index) => ({
    id: `change-group-${index + 1}`,
    path: `src/group-${index + 1}.ts`,
  }));
  const groupedHistories = groupedChanges.map((_, index) => ({
    id: `history-group-${index + 1}`,
  }));
  const groupedBundle = evidence(groupedChanges, groupedHistories);
  const grouped = reviewerTopics.buildReviewerTopicHints(
    groupedBundle,
    groupedChanges.map((change, index) => ({
      historyId: `history-group-${index + 1}`,
      changeEvidenceIds: [change.id],
    })),
  );
  assert.equal(grouped.hints.length, 8);
  assert.equal(grouped.targetProseTopicCount, 6);
});

test('rejects incomplete, duplicate, unknown, and non-change adjacency generically', () => {
  const bundle = evidence(
    [{ id: 'change-private', path: 'src/private.ts' }],
    [{ id: 'history-private' }],
    true,
  );
  const invalid: readonly (readonly HistoryAdjacency[])[] = [
    [],
    [
      { historyId: 'history-private', changeEvidenceIds: ['change-private'] },
      { historyId: 'history-private', changeEvidenceIds: ['change-private'] },
    ],
    [{ historyId: 'history-unknown', changeEvidenceIds: ['change-private'] }],
    [{ historyId: 'history-private', changeEvidenceIds: ['change-unknown'] }],
    [{ historyId: 'history-private', changeEvidenceIds: ['intent-private'] }],
    [{
      historyId: 'history-private',
      changeEvidenceIds: ['change-private', 'change-private'],
    }],
  ];
  for (const adjacency of invalid) {
    expectHintError(() =>
      reviewerTopics.buildReviewerTopicHints(bundle, adjacency),
    );
  }
});

test('builds topics in Changes order and derives an exact immutable partition', () => {
  const bundle = evidence(
    [
      { id: 'change-a', path: 'src/a.ts' },
      { id: 'change-b', path: 'src/b.ts' },
      { id: 'change-c', path: 'src/c.ts' },
      { id: 'change-map', path: 'src/map.ts' },
    ],
    [
      { id: 'history-a' },
      { id: 'history-b' },
      { id: 'history-c' },
    ],
  );
  const hints = reviewerTopics.buildReviewerTopicHints(bundle, [
    { historyId: 'history-c', changeEvidenceIds: ['change-c'] },
    { historyId: 'history-a', changeEvidenceIds: ['change-a'] },
    { historyId: 'history-b', changeEvidenceIds: ['change-b'] },
  ]);
  const claims = [
    detail('claim-c', ['change-c', 'history-c']),
    detail('claim-a', ['history-a', 'change-a']),
    detail('claim-b', ['change-b', 'history-b']),
  ];
  const candidate = draft(
    'change-a',
    [claims[2] as TestClaim, claims[0] as TestClaim, claims[1] as TestClaim],
    ['claim-a', 'claim-b', 'claim-c'],
  );

  const plan = reviewerTopics.buildReviewerTopicPlan(
    candidate,
    hints,
    bundle,
  );

  assert.deepEqual(plan, {
    schemaVersion: 1,
    targetProseTopicCount: 3,
    topics: [
      {
        id: 'reviewer-topic-1',
        claimId: 'claim-a',
        changeEvidenceIds: ['change-a'],
        historyEvidenceIds: ['history-a'],
      },
      {
        id: 'reviewer-topic-2',
        claimId: 'claim-b',
        changeEvidenceIds: ['change-b'],
        historyEvidenceIds: ['history-b'],
      },
      {
        id: 'reviewer-topic-3',
        claimId: 'claim-c',
        changeEvidenceIds: ['change-c'],
        historyEvidenceIds: ['history-c'],
      },
    ],
    mapOnlyChangeEvidenceIds: ['change-map'],
  });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.topics), true);
  assert.equal(Object.isFrozen(plan.topics[0]), true);
  assert.equal(Object.isFrozen(plan.topics[0]?.changeEvidenceIds), true);
  assert.equal(Object.isFrozen(plan.topics[0]?.historyEvidenceIds), true);
  assert.equal(Object.isFrozen(plan.mapOnlyChangeEvidenceIds), true);
});

test('does not introduce a 64-change planning ceiling', () => {
  const changes = Array.from({ length: 70 }, (_, index) => ({
    id: `change-wide-${String(index + 1).padStart(2, '0')}`,
    path: `src/wide-${index + 1}.ts`,
  }));
  const bundle = evidence(changes, [{ id: 'history-wide' }]);
  const changeIds = changes.map((change) => change.id);
  const hints = reviewerTopics.buildReviewerTopicHints(bundle, [{
    historyId: 'history-wide',
    changeEvidenceIds: changeIds,
  }]);
  const plan = reviewerTopics.buildReviewerTopicPlan(
    draft('change-wide-01', [
      detail('claim-wide', [...changeIds, 'history-wide']),
    ]),
    hints,
    bundle,
  );

  assert.equal(plan.topics.length, 1);
  assert.equal(plan.topics[0]?.changeEvidenceIds.length, 70);
  assert.deepEqual(plan.mapOnlyChangeEvidenceIds, []);
});

test('keeps builder and validator bounds closed at 100,000 adjacency edges', () => {
  const changes = Array.from({ length: 1_100 }, (_, index) => ({
    id: `change-bound-${String(index + 1).padStart(4, '0')}`,
    path: `src/bound-${index + 1}.ts`,
  }));
  const histories = Array.from({ length: 100 }, (_, index) => ({
    id: `history-bound-${String(index + 1).padStart(3, '0')}`,
  }));
  const bundle = evidence(changes, histories);
  const adjacency = histories.map((history, historyIndex) => ({
    historyId: history.id,
    changeEvidenceIds: Array.from(
      { length: 1_000 },
      (_, edgeIndex) =>
        changes[(historyIndex + edgeIndex) % changes.length]?.id ?? '',
    ),
  }));
  const hints = reviewerTopics.buildReviewerTopicHints(bundle, adjacency);
  const detailClaims = histories.slice(0, 6).map((history, index) =>
    detail(`claim-bound-${index + 1}`, [
      changes[index]?.id ?? '',
      history.id,
    ]),
  );

  const plan = reviewerTopics.buildReviewerTopicPlan(
    draft('change-bound-0001', detailClaims),
    hints,
    bundle,
  );

  assert.equal(hints.targetProseTopicCount, 6);
  assert.equal(plan.topics.length, 6);
  assert.equal(plan.mapOnlyChangeEvidenceIds.length, 1_094);
});

test('rejects overlap, unknown evidence, supporting-only topics, and mismatched history ownership', () => {
  const bundle = evidence(
    [
      { id: 'change-a', path: 'src/a.ts' },
      { id: 'change-b', path: 'src/b.ts' },
      { id: 'change-supporting', path: 'README.md' },
    ],
    [{ id: 'history-a' }, { id: 'history-b' }],
  );
  const hints = reviewerTopics.buildReviewerTopicHints(bundle, [
    { historyId: 'history-a', changeEvidenceIds: ['change-a'] },
    { historyId: 'history-b', changeEvidenceIds: ['change-b'] },
  ]);
  const invalidDrafts: readonly TestDraft[] = [
    draft('change-a', [
      detail('claim-one', ['change-a', 'history-a']),
      detail('claim-two', ['change-a', 'change-b', 'history-b']),
    ]),
    draft('change-a', [detail('claim-one', ['change-private'])]),
    draft('change-a', [detail('claim-one', ['change-supporting'])]),
    draft('change-a', [
      detail('claim-one', ['change-a', 'history-a']),
      detail('claim-two', ['change-b', 'history-a']),
    ]),
  ];
  for (const candidate of invalidDrafts) {
    expectPlanError(() =>
      reviewerTopics.buildReviewerTopicPlan(candidate, hints, bundle),
    );
  }
});

test('rejects unlinked and mismatched history labels for prose topics', () => {
  const bundle = evidence(
    [
      { id: 'change-a', path: 'src/a.ts' },
      { id: 'change-b', path: 'src/b.ts' },
    ],
    [
      { id: 'history-a' },
      { id: 'history-b' },
      { id: 'history-zero' },
    ],
  );
  const hints = reviewerTopics.buildReviewerTopicHints(bundle, [
    { historyId: 'history-a', changeEvidenceIds: ['change-a'] },
    { historyId: 'history-b', changeEvidenceIds: ['change-b'] },
    { historyId: 'history-zero', changeEvidenceIds: [] },
  ]);

  expectPlanError(() =>
    reviewerTopics.buildReviewerTopicPlan(
      draft('change-a', [detail('claim-one', ['change-a', 'history-zero'])]),
      hints,
      bundle,
    ),
  );
  expectPlanError(() =>
    reviewerTopics.buildReviewerTopicPlan(
      draft('change-a', [detail('claim-one', ['change-a', 'history-b'])]),
      hints,
      bundle,
    ),
  );
});

test('allows one broad history label across disjoint topics without inflating its group', () => {
  const bundle = evidence(
    [
      { id: 'change-a', path: 'src/a.ts' },
      { id: 'change-b', path: 'src/b.ts' },
    ],
    [{ id: 'history-broad' }],
  );
  const hints = reviewerTopics.buildReviewerTopicHints(bundle, [{
    historyId: 'history-broad',
    changeEvidenceIds: ['change-a', 'change-b'],
  }]);
  const plan = reviewerTopics.buildReviewerTopicPlan(
    draft('change-a', [
      detail('claim-a', ['change-a', 'history-broad']),
      detail('claim-b', ['change-b', 'history-broad']),
    ]),
    hints,
    bundle,
  );

  assert.equal(plan.targetProseTopicCount, 1);
  assert.equal(plan.topics.length, 2);
});

test('requires distinct hint-group matching instead of reusable anchors', () => {
  const bundle = evidence(
    [
      { id: 'change-a', path: 'src/a.ts' },
      { id: 'change-b', path: 'src/b.ts' },
      { id: 'change-c', path: 'src/c.ts' },
      { id: 'change-d', path: 'src/d.ts' },
      { id: 'change-e', path: 'src/e.ts' },
    ],
    [
      { id: 'history-group-one-a' },
      { id: 'history-group-one-b' },
      { id: 'history-group-two' },
      { id: 'history-group-three' },
    ],
  );
  const hints = reviewerTopics.buildReviewerTopicHints(bundle, [
    {
      historyId: 'history-group-one-a',
      changeEvidenceIds: ['change-a', 'change-b', 'change-c'],
    },
    {
      historyId: 'history-group-one-b',
      changeEvidenceIds: ['change-c', 'change-b', 'change-a'],
    },
    { historyId: 'history-group-two', changeEvidenceIds: ['change-d'] },
    { historyId: 'history-group-three', changeEvidenceIds: ['change-e'] },
  ]);
  assert.equal(hints.targetProseTopicCount, 3);

  expectPlanError(() =>
    reviewerTopics.buildReviewerTopicPlan(
      draft('change-a', [
        detail('claim-one', ['change-a', 'history-group-one-a']),
        detail('claim-two', ['change-b', 'history-group-one-b']),
        detail('claim-three', [
          'change-c',
          'change-d',
          'change-e',
          'history-group-two',
          'history-group-three',
        ]),
      ]),
      hints,
      bundle,
    ),
  );
});

test('rejects malformed section assignment and rendered provided changes', () => {
  const bundle = evidence(
    [{ id: 'change-a', path: 'src/a.ts' }],
    [{ id: 'history-a' }],
  );
  const hints = reviewerTopics.buildReviewerTopicHints(bundle, [{
    historyId: 'history-a',
    changeEvidenceIds: ['change-a'],
  }]);
  const base = draft('change-a', [
    detail('claim-detail', ['change-a', 'history-a']),
  ]);
  const malformed: readonly TestDraft[] = [
    {
      ...base,
      sections: [...base.sections, { kind: 'changes', claimIds: [] }],
    },
    {
      ...base,
      sections: [
        { kind: 'summary', claimIds: ['claim-primary', 'claim-detail'] },
        { kind: 'changes', claimIds: ['claim-detail'] },
      ],
    },
    {
      claims: [...base.claims, detail('claim-orphan', ['change-a'])],
      sections: base.sections,
    },
    draft('change-a', [
      detail('claim-provided', ['change-a', 'history-a'], 'provided'),
    ]),
  ];
  for (const candidate of malformed) {
    expectPlanError(() =>
      reviewerTopics.buildReviewerTopicPlan(candidate, hints, bundle),
    );
  }

  const inferred = detail(
    'claim-inferred',
    ['change-a', 'history-a'],
    'inferred',
  );
  const observed = detail('claim-observed', ['change-a', 'history-a']);
  const inferredPlan = reviewerTopics.buildReviewerTopicPlan(
    draft('change-a', [inferred, observed]),
    hints,
    bundle,
  );
  assert.deepEqual(
    inferredPlan.topics.map((topic) => topic.claimId),
    ['claim-observed'],
  );
});

test('returns an empty safe plan for supporting-only and no-change evidence', () => {
  const supportingBundle = evidence(
    [{ id: 'change-readme', path: 'README.md' }],
    [{ id: 'history-readme' }],
  );
  const supportingHints = reviewerTopics.buildReviewerTopicHints(
    supportingBundle,
    [{ historyId: 'history-readme', changeEvidenceIds: ['change-readme'] }],
  );
  assert.deepEqual(supportingHints, {
    schemaVersion: 1,
    hints: [],
    unlinkedChangeEvidenceIds: [],
    targetProseTopicCount: 0,
  });
  assert.deepEqual(
    reviewerTopics.buildReviewerTopicPlan(
      draft('change-readme', []),
      supportingHints,
      supportingBundle,
    ),
    {
      schemaVersion: 1,
      targetProseTopicCount: 0,
      topics: [],
      mapOnlyChangeEvidenceIds: [],
    },
  );
  expectPlanError(() =>
    reviewerTopics.buildReviewerTopicPlan(
      draft('change-readme', [
        detail('claim-readme', ['change-readme']),
      ]),
      supportingHints,
      supportingBundle,
    ),
  );

  const emptyBundle = evidence([]);
  const emptyHints = reviewerTopics.buildReviewerTopicHints(emptyBundle, []);
  assert.deepEqual(emptyHints, {
    schemaVersion: 1,
    hints: [],
    unlinkedChangeEvidenceIds: [],
    targetProseTopicCount: 0,
  });
  assert.deepEqual(
    reviewerTopics.buildReviewerTopicPlan(
      { claims: [], sections: [] },
      emptyHints,
      emptyBundle,
    ).topics,
    [],
  );
});

test('validates forged hint partitions without exposing attacker-controlled ids', () => {
  const bundle = evidence(
    [{ id: 'change-private', path: 'src/private.ts' }],
    [{ id: 'history-private' }],
  );
  const valid = reviewerTopics.buildReviewerTopicHints(bundle, [{
    historyId: 'history-private',
    changeEvidenceIds: ['change-private'],
  }]);
  const forged: readonly TopicHints[] = [
    { ...valid, targetProseTopicCount: 0 },
    { ...valid, unlinkedChangeEvidenceIds: ['change-private'] },
    {
      ...valid,
      hints: [...valid.hints, {
        id: 'reviewer-topic-hint-private',
        historyEvidenceIds: ['history-private'],
        changeEvidenceIds: ['change-private'],
      }],
    },
    {
      ...valid,
      hints: [{
        ...valid.hints[0] as TopicHint,
        historyEvidenceIds: ['history-unknown'],
      }],
    },
  ];
  for (const hints of forged) {
    expectPlanError(() =>
      reviewerTopics.buildReviewerTopicPlan(
        draft('change-private', [
          detail('claim-private', ['change-private', 'history-private']),
        ]),
        hints,
        bundle,
      ),
    );
  }
});
