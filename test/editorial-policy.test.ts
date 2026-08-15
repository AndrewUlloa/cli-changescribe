import assert from 'node:assert/strict';
import test from 'node:test';

interface EditorialTerminologyGroup {
  readonly name: string;
  readonly terms: readonly string[];
}

interface EditorialPolicy {
  readonly maxSentenceWords: number;
  readonly duplicateClaimMinWords: number;
  readonly vagueAbsolutes: readonly string[];
  readonly terminologyGroups: readonly EditorialTerminologyGroup[];
}

interface EditorialWarning {
  readonly code: string;
  readonly severity: 'warning';
  readonly message: string;
  readonly sentenceIndexes?: readonly number[];
  readonly terms?: readonly string[];
}

interface EditorialReview {
  readonly text: string;
  readonly warnings: readonly EditorialWarning[];
}

const editorialPolicy: {
  DEFAULT_EDITORIAL_POLICY: Readonly<EditorialPolicy>;
  reviewEditorialText(
    text: string,
    policy?: Partial<EditorialPolicy>,
  ): EditorialReview;
} = require('../dist/editorial-policy.js');

const { DEFAULT_EDITORIAL_POLICY, reviewEditorialText } = editorialPolicy;

test('default policy emits advisory warnings in deterministic source order', () => {
  const text = [
    'This change always guarantees that every configured provider resolves the correct endpoint for every request without any possible failure in any environment at any time during normal operation.',
    'Cache the provider result before transport starts.',
    'Cache the provider result before transport starts!',
  ].join(' ');

  const first = reviewEditorialText(text);
  const second = reviewEditorialText(text);

  assert.deepEqual(second, first);
  assert.equal(first.text, text);
  assert.deepEqual(
    first.warnings.map((warning) => warning.code),
    [
      'excessive-sentence-length',
      'vague-absolute',
      'vague-absolute',
      'vague-absolute',
      'duplicate-normalized-claim',
    ],
  );
  assert.equal(
    first.warnings.every((warning) => warning.severity === 'warning'),
    true,
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.warnings), true);
  assert.equal(first.warnings.every(Object.isFrozen), true);
});

test('policy thresholds and vague absolute vocabulary are configurable', () => {
  const result = reviewEditorialText(
    'The command definitely works for local projects.',
    {
      maxSentenceWords: 5,
      vagueAbsolutes: ['definitely'],
    },
  );

  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    ['excessive-sentence-length', 'vague-absolute'],
  );
  assert.match(result.warnings[1]?.message ?? '', /definitely/);
});

test('duplicate detection normalizes presentation without changing source', () => {
  const text = [
    'Reject malformed provider URLs.',
    '  reject   malformed provider URLs! ',
  ].join('\n');
  const result = reviewEditorialText(text);

  assert.equal(result.text, text);
  assert.equal(
    result.warnings.filter(
      (warning) => warning.code === 'duplicate-normalized-claim',
    ).length,
    1,
  );
  assert.deepEqual(
    result.warnings.find(
      (warning) => warning.code === 'duplicate-normalized-claim',
    )?.sentenceIndexes,
    [0, 1],
  );
});

test('configured terminology warns without selecting or rewriting a term', () => {
  const text =
    'Create the pull request after validation. Update the PR after review.';
  const result = reviewEditorialText(text, {
    terminologyGroups: [
      {
        name: 'pull request',
        terms: ['pull request', 'PR'],
      },
    ],
  });

  assert.equal(result.text, text);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]?.code, 'unstable-terminology');
  assert.deepEqual(result.warnings[0]?.terms, ['pull request', 'PR']);
  assert.doesNotMatch(result.warnings[0]?.message ?? '', /replace|preferred/i);
  assert.equal(Object.isFrozen(result.warnings[0]?.terms), true);
});

test('URLs and inline identifiers remain opaque to vocabulary checks', () => {
  const text =
    'Open https://example.test/always and call `neverRetry` in DiffwrightRepo.';
  const result = reviewEditorialText(text, {
    vagueAbsolutes: ['always', 'never'],
  });

  assert.equal(result.text, text);
  assert.deepEqual(result.warnings, []);
  assert.match(result.text, /https:\/\/example\.test\/always/);
  assert.match(result.text, /`neverRetry`/);
  assert.match(result.text, /DiffwrightRepo/);
});

test('terminal URL punctuation preserves sentence boundaries', () => {
  const text = [
    'See https://example.test/setup.',
    'This always works.',
    'Open (https://example.test/search?q=value#result).',
  ].join(' ');
  const result = reviewEditorialText(text, {
    maxSentenceWords: 5,
    vagueAbsolutes: ['always'],
  });

  assert.equal(result.text, text);
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    ['vague-absolute'],
  );
});

test('default policy is deeply frozen and assumes no repository terminology', () => {
  assert.equal(Object.isFrozen(DEFAULT_EDITORIAL_POLICY), true);
  assert.equal(Object.isFrozen(DEFAULT_EDITORIAL_POLICY.vagueAbsolutes), true);
  assert.equal(Object.isFrozen(DEFAULT_EDITORIAL_POLICY.terminologyGroups), true);
  assert.deepEqual(DEFAULT_EDITORIAL_POLICY.terminologyGroups, []);
});
