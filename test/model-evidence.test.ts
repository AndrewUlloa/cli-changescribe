import assert from 'node:assert/strict';
import test from 'node:test';

interface ChangeEvidenceItem {
  readonly id: string;
  readonly kind: 'change';
  readonly basis: 'observed';
  readonly source: { readonly kind: string; readonly locator: string };
  readonly payload: {
    readonly status: 'modified' | 'renamed';
    readonly oldPath?: string;
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
    } | {
      readonly id: string;
      readonly kind: 'history';
      readonly basis: 'provided';
      readonly source: { readonly kind: string; readonly locator: string };
      readonly payload: {
        readonly sha: string;
        readonly subject: string;
        readonly body: string;
      };
    }
  >;
}

interface PullRequestEvidenceSnapshot {
  readonly evidence: EvidenceBundle;
  readonly historyAdjacency: readonly {
    readonly historyId: string;
    readonly changeEvidenceIds: readonly string[];
  }[];
  readonly historyTruncated: boolean;
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
  projectPullRequestEvidenceForModel,
}: {
  projectEvidenceForModel(
    evidence: EvidenceBundle,
    detailedChangeIds: readonly string[],
  ): EvidenceBundle;
  projectPullRequestEvidenceForModel(
    snapshot: PullRequestEvidenceSnapshot,
    detailedChangeIds: readonly string[],
    knownSecrets?: readonly string[],
  ): PullRequestEvidenceSnapshot;
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

function history(id: string, subject: string, body = 'Private rationale.') {
  const ordinal = Number(id.replace(/\D/gu, '')) || 1;
  return {
    id,
    kind: 'history' as const,
    basis: 'provided' as const,
    source: { kind: 'git-history', locator: String(ordinal).repeat(40) },
    payload: {
      sha: String(ordinal).repeat(40),
      subject,
      body,
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

test('excludes history from the low-level model projection by default', () => {
  const privateSubject = 'Private commit subject';
  const privateBody = 'Private commit body';
  const evidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [
      change('change-source', 'src/api.ts', '+source\n'),
      history('history-1', privateSubject, privateBody),
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });

  const serialized = JSON.stringify(
    projectEvidenceForModel(evidence, ['change-source']),
  );

  assert.doesNotMatch(serialized, new RegExp(privateSubject, 'u'));
  assert.doesNotMatch(serialized, new RegExp(privateBody, 'u'));
});

test('projects only histories adjacent to detailed final changes and strips bodies', () => {
  const evidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [
      change('change-source', 'src/api.ts', '+source\n'),
      change('change-supporting', 'README.md', '+docs\n'),
      history('history-1', 'Add the provider-safe workflow'),
      history('history-2', 'Document supporting behavior'),
      history('history-3', 'Implement then revert an experiment'),
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const snapshot: PullRequestEvidenceSnapshot = {
    evidence,
    historyAdjacency: [
      { historyId: 'history-1', changeEvidenceIds: ['change-source'] },
      { historyId: 'history-2', changeEvidenceIds: ['change-supporting'] },
      { historyId: 'history-3', changeEvidenceIds: [] },
    ],
    historyTruncated: true,
  };

  const projected = projectPullRequestEvidenceForModel(
    snapshot,
    ['change-source'],
  );

  assert.deepEqual(projected.historyAdjacency, [{
    historyId: 'history-1',
    changeEvidenceIds: ['change-source'],
  }]);
  assert.deepEqual(
    projected.evidence.items.map((item) => item.id),
    ['change-source', 'history-1'],
  );
  const projectedHistory = projected.evidence.items[1];
  assert.equal(projectedHistory?.kind, 'history');
  if (projectedHistory?.kind === 'history') {
    assert.equal(projectedHistory.payload.subject, 'Add the provider-safe workflow');
    assert.equal(projectedHistory.payload.body, '');
  }
  assert.equal(projected.historyTruncated, true);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.historyAdjacency), true);
  assert.equal(Object.isFrozen(projected.historyAdjacency[0]), true);
  assert.equal(Object.isFrozen(projected.historyAdjacency[0]?.changeEvidenceIds), true);
  const originalHistory = snapshot.evidence.items[2];
  assert.equal(originalHistory?.kind, 'history');
  if (originalHistory?.kind === 'history') {
    assert.equal(originalHistory.payload.body, 'Private rationale.');
  }
});

test('restricts kept adjacency to detailed changes', () => {
  const evidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [
      change('change-source', 'src/api.ts', '+source\n'),
      change('change-supporting', 'README.md', '+docs\n'),
      history('history-1', 'Update source and documentation'),
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });

  const projected = projectPullRequestEvidenceForModel({
    evidence,
    historyAdjacency: [{
      historyId: 'history-1',
      changeEvidenceIds: ['change-source', 'change-supporting'],
    }],
    historyTruncated: false,
  }, ['change-source']);

  assert.deepEqual(projected.historyAdjacency[0]?.changeEvidenceIds, [
    'change-source',
  ]);
});

test('suppresses a history that touches protected policy even when it also touches source', () => {
  const evidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [
      change('change-source', 'src/api.ts', '+source\n'),
      change('change-policy', '.diffwrightrc.json', '+private policy\n'),
      history('history-1', 'Update source and private policy'),
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const protectedEvidence = protectRepositoryPolicyEvidence(evidence);

  const projected = projectPullRequestEvidenceForModel({
    evidence: protectedEvidence,
    historyAdjacency: [{
      historyId: 'history-1',
      changeEvidenceIds: ['change-source', 'change-policy'],
    }],
    historyTruncated: false,
  }, ['change-source']);

  assert.deepEqual(projected.historyAdjacency, []);
  assert.deepEqual(
    projected.evidence.items.map((item) => item.id),
    ['change-source'],
  );
});

test('redacts configured subject secrets and rejects unknown credential shapes generically', () => {
  const configuredSecret = `gsk_${'A'.repeat(28)}`;
  const configuredEvidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [
      change('change-source', 'src/api.ts', '+source\n'),
      history('history-1', `Avoid logging ${configuredSecret}`),
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const adjacency = [{
    historyId: 'history-1',
    changeEvidenceIds: ['change-source'],
  }];

  const redacted = projectPullRequestEvidenceForModel({
    evidence: configuredEvidence,
    historyAdjacency: adjacency,
    historyTruncated: false,
  }, ['change-source'], [configuredSecret]);
  const projectedHistory = redacted.evidence.items[1];
  assert.equal(projectedHistory?.kind, 'history');
  if (projectedHistory?.kind === 'history') {
    assert.equal(projectedHistory.payload.subject, 'Avoid logging [REDACTED]');
  }
  assert.doesNotMatch(JSON.stringify(redacted), new RegExp(configuredSecret, 'u'));

  const unknownSecret = `ghp_${'B'.repeat(36)}`;
  const unsafeEvidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [
      change('change-source', 'src/api.ts', '+source\n'),
      history('history-1', `Remove ${unknownSecret} from fixtures`),
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  let thrown: unknown;
  try {
    projectPullRequestEvidenceForModel({
      evidence: unsafeEvidence,
      historyAdjacency: adjacency,
      historyTruncated: false,
    }, ['change-source']);
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown instanceof Error, true);
  assert.match((thrown as Error).message, /credential-like value/u);
  assert.doesNotMatch((thrown as Error).message, new RegExp(unknownSecret, 'u'));

  const normalSubjectEvidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [
      change('change-source', 'src/api.ts', '+source\n'),
      history('history-1', `Update task-${'a'.repeat(28)} tracking`),
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  assert.doesNotThrow(() => projectPullRequestEvidenceForModel({
    evidence: normalSubjectEvidence,
    historyAdjacency: adjacency,
    historyTruncated: false,
  }, ['change-source']));

  for (const token of [
    `sk-proj-${'c'.repeat(28)}`,
    `sk-ant-${'d'.repeat(28)}`,
    `sk-or-v1-${'e'.repeat(64)}`,
    `github_pat_${'g'.repeat(40)}`,
    `npm_${'f'.repeat(36)}`,
  ]) {
    const tokenEvidence = createEvidenceBundle({
      snapshot: { headSha: SHA },
      items: [
        change('change-source', 'src/api.ts', '+source\n'),
        history('history-1', `Remove ${token} from a fixture`),
      ],
      receipts: [],
      coverage: { complete: true, gaps: [] },
    });
    assert.throws(
      () => projectPullRequestEvidenceForModel({
        evidence: tokenEvidence,
        historyAdjacency: adjacency,
        historyTruncated: false,
      }, ['change-source']),
      /credential-like value/u,
    );
  }
});

test('protects raw repository policy evidence including renames before projection', () => {
  const policyChanges: ChangeEvidenceItem[] = [
    change(
      'change-policy',
      '.diffwrightrc.json',
      '+unprotected-policy-value\n',
    ),
    {
      ...change(
        'change-policy-rename-in',
        '.diffwrightrc.json',
        '+renamed-private-value\n',
      ),
      payload: {
        ...change(
          'change-policy-rename-in',
          '.diffwrightrc.json',
          '+renamed-private-value\n',
        ).payload,
        status: 'renamed',
        oldPath: 'config/diffwright.json',
      },
    },
    {
      ...change(
        'change-policy-rename-out',
        'config/diffwright.json',
        '+renamed-private-value\n',
      ),
      payload: {
        ...change(
          'change-policy-rename-out',
          'config/diffwright.json',
          '+renamed-private-value\n',
        ).payload,
        status: 'renamed',
        oldPath: '.diffwrightrc.json',
      },
    },
  ];

  for (const policyChange of policyChanges) {
    const privatePatch = policyChange.payload.patch ?? '';
    const evidence = createEvidenceBundle({
      snapshot: { headSha: SHA },
      items: [
        change('change-source', 'src/api.ts', '+source\n'),
        policyChange,
        history('history-1', 'Update source and private policy'),
      ],
      receipts: [],
      coverage: { complete: true, gaps: [] },
    });
    const projected = projectPullRequestEvidenceForModel({
      evidence,
      historyAdjacency: [{
        historyId: 'history-1',
        changeEvidenceIds: ['change-source', policyChange.id],
      }],
      historyTruncated: false,
    }, ['change-source', policyChange.id]);
    const serialized = JSON.stringify(projected);
    assert.deepEqual(projected.historyAdjacency, []);
    assert.doesNotMatch(serialized, /Update source and private policy/u);
    assert.equal(serialized.includes(privatePatch), false);
    const projectedPolicy = projected.evidence.items.find(
      (item) => item.id === policyChange.id,
    );
    assert.equal(projectedPolicy?.kind, 'change');
    if (projectedPolicy?.kind === 'change') {
      assert.equal(projectedPolicy.source.kind, 'git-policy-metadata');
      assert.equal(projectedPolicy.payload.patch, null);
    }
  }
});

test('rejects forged policy markers without exposing evidence values', () => {
  const privateValue = 'forged-policy-private-value';
  const forged = {
    ...change('change-source', 'src/api.ts', `+${privateValue}\n`),
    source: { kind: 'git-policy-metadata', locator: 'src/api.ts' },
  };
  const evidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [forged, history('history-1', 'Update source')],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  let thrown: unknown;
  try {
    projectPullRequestEvidenceForModel({
      evidence,
      historyAdjacency: [{
        historyId: 'history-1',
        changeEvidenceIds: ['change-source'],
      }],
      historyTruncated: false,
    }, ['change-source']);
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown instanceof Error, true);
  assert.match((thrown as Error).message, /invalid policy protection/u);
  assert.doesNotMatch((thrown as Error).message, new RegExp(privateValue, 'u'));
});

test('rejects malformed history adjacency with one generic error', () => {
  const evidence = createEvidenceBundle({
    snapshot: { headSha: SHA },
    items: [
      change('change-source', 'src/api.ts', '+source\n'),
      history('history-1', 'Update source'),
      history('history-2', 'Refine source'),
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const invalidCases = [
    [{ historyId: 'history-1', changeEvidenceIds: ['change-source'] }],
    [
      { historyId: 'history-1', changeEvidenceIds: ['change-source'] },
      { historyId: 'history-1', changeEvidenceIds: [] },
    ],
    [
      { historyId: 'history-1', changeEvidenceIds: ['change-missing'] },
      { historyId: 'history-2', changeEvidenceIds: [] },
    ],
    [
      {
        historyId: 'history-1',
        changeEvidenceIds: ['change-source', 'change-source'],
      },
      { historyId: 'history-2', changeEvidenceIds: [] },
    ],
    [
      { historyId: 'history-missing', changeEvidenceIds: ['change-source'] },
      { historyId: 'history-2', changeEvidenceIds: [] },
    ],
  ];

  for (const historyAdjacency of invalidCases) {
    assert.throws(
      () => projectPullRequestEvidenceForModel({
        evidence,
        historyAdjacency,
        historyTruncated: false,
      }, ['change-source']),
      (error: unknown) =>
        error instanceof Error &&
        error.message ===
          'Pull request model projection has invalid history adjacency.',
    );
  }

  for (const malformedSnapshot of [
    {
      evidence,
      historyAdjacency: 'not-an-array',
      historyTruncated: false,
    },
    {
      evidence,
      historyAdjacency: [],
      historyTruncated: 'false',
    },
    {
      evidence,
      historyAdjacency: [null],
      historyTruncated: false,
    },
    {
      evidence: { items: 'not-an-array' },
      historyAdjacency: [],
      historyTruncated: false,
    },
  ]) {
    assert.throws(
      () => projectPullRequestEvidenceForModel(
        malformedSnapshot as unknown as PullRequestEvidenceSnapshot,
        ['change-source'],
      ),
      /invalid history adjacency/u,
    );
  }
  assert.throws(
    () => projectPullRequestEvidenceForModel(
      {
        evidence: {
          ...evidence,
          items: [null],
        } as unknown as EvidenceBundle,
        historyAdjacency: [],
        historyTruncated: false,
      },
      ['change-source'],
    ),
    /evidence input is invalid/u,
  );

  assert.throws(
    () => projectPullRequestEvidenceForModel(
      {
        evidence,
        historyAdjacency: Array.from({ length: 10_001 }, () => ({
          historyId: 'history-1',
          changeEvidenceIds: [],
        })),
        historyTruncated: false,
      },
      ['change-source'],
    ),
    /invalid history adjacency/u,
  );
  assert.throws(
    () => projectPullRequestEvidenceForModel(
      {
        evidence,
        historyAdjacency: [
          {
            historyId: 'history-1',
            changeEvidenceIds: Array.from(
              { length: 100_001 },
              () => 'change-source',
            ),
          },
          { historyId: 'history-2', changeEvidenceIds: [] },
        ],
        historyTruncated: false,
      },
      ['change-source'],
    ),
    /invalid history adjacency/u,
  );
  assert.throws(
    () => projectPullRequestEvidenceForModel(
      {
        evidence,
        historyAdjacency: [
          { historyId: 'history-1', changeEvidenceIds: ['change-source'] },
          { historyId: 'history-2', changeEvidenceIds: [] },
        ],
        historyTruncated: false,
      },
      ['change-source'],
      'not-an-array' as unknown as readonly string[],
    ),
    /secret input is invalid/u,
  );
});
