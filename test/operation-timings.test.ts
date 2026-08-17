import assert from 'node:assert/strict';
import test from 'node:test';

type TimingPhase =
  | 'project-gates'
  | 'git-evidence'
  | 'context'
  | 'policy'
  | 'provider-draft'
  | 'provider-repair'
  | 'provider-critic'
  | 'render'
  | 'review'
  | 'mutation-validation'
  | 'git-mutation'
  | 'github-mutation';

interface TimingRecord {
  readonly phase: TimingPhase;
  readonly durationMs: number;
}

interface OperationTimings {
  measureSync<T>(phase: TimingPhase, operation: () => T): T;
  measure<T>(phase: TimingPhase, operation: () => Promise<T>): Promise<T>;
  snapshot(): readonly Readonly<TimingRecord>[];
}

const operationTimings: {
  TIMING_PHASES: readonly TimingPhase[];
  createOperationTimings(clock?: () => number): OperationTimings;
  renderOperationTimings(records: readonly TimingRecord[]): string;
} = require('../dist/operation-timings.js');

const {
  TIMING_PHASES,
  createOperationTimings,
  renderOperationTimings,
} = operationTimings;

function sequenceClock(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error('Test clock exhausted.');
    }
    return value;
  };
}

test('records successful sync and async phases with immutable snapshots', async () => {
  const timings = createOperationTimings(sequenceClock([10, 13.4567, 20, 25]));

  assert.equal(timings.measureSync('git-evidence', () => 'evidence'), 'evidence');
  assert.equal(
    await timings.measure('provider-draft', async () => 'draft'),
    'draft',
  );

  const snapshot = timings.snapshot();
  assert.deepEqual(snapshot, [
    { phase: 'git-evidence', durationMs: 3.457 },
    { phase: 'provider-draft', durationMs: 5 },
  ]);
  assert.equal(Object.isFrozen(timings), true);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(snapshot.every(Object.isFrozen), true);
});

test('records failed operations without changing their errors', async () => {
  const timings = createOperationTimings(sequenceClock([0, 2, 3, 7]));
  const syncError = new Error('sync failure');
  const asyncError = new Error('async failure');

  assert.throws(
    () => timings.measureSync('render', () => {
      throw syncError;
    }),
    (error: unknown) => error === syncError,
  );
  await assert.rejects(
    timings.measure('provider-critic', async () => {
      throw asyncError;
    }),
    (error: unknown) => error === asyncError,
  );

  assert.deepEqual(timings.snapshot(), [
    { phase: 'render', durationMs: 2 },
    { phase: 'provider-critic', durationMs: 4 },
  ]);
});

test('records nested phases exclusively so total is not double-counted', () => {
  const timings = createOperationTimings(sequenceClock([0, 10, 20, 30]));

  timings.measureSync('github-mutation', () => {
    timings.measureSync('mutation-validation', () => undefined);
  });

  assert.deepEqual(timings.snapshot(), [
    { phase: 'mutation-validation', durationMs: 10 },
    { phase: 'github-mutation', durationMs: 20 },
  ]);
  assert.match(renderOperationTimings(timings.snapshot()), /total: 30\.000/u);
});

test('accounts with raw fractional durations before rounding records', () => {
  const timings = createOperationTimings(
    sequenceClock([0, 0.0001, 0.0007, 0.0007, 0.0013, 0.0013]),
  );

  assert.doesNotThrow(() => {
    timings.measureSync('github-mutation', () => {
      timings.measureSync('git-mutation', () => undefined);
      timings.measureSync('mutation-validation', () => undefined);
    });
  });
  assert.equal(timings.snapshot().length, 3);
});

test('keeps concurrent async root measurements independent in either completion order', async () => {
  for (const firstToFinish of ['first', 'second'] as const) {
    const timings = createOperationTimings(sequenceClock([0, 1, 2, 3]));
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const first = timings.measure(
      'provider-draft',
      () => new Promise<string>((resolve) => {
        finishFirst = () => resolve('first');
      }),
    );
    const second = timings.measure(
      'provider-critic',
      () => new Promise<string>((resolve) => {
        finishSecond = () => resolve('second');
      }),
    );

    if (firstToFinish === 'first') {
      finishFirst?.();
      assert.equal(await first, 'first');
      finishSecond?.();
      assert.equal(await second, 'second');
    } else {
      finishSecond?.();
      assert.equal(await second, 'second');
      finishFirst?.();
      assert.equal(await first, 'first');
    }
    assert.deepEqual(
      new Set(timings.snapshot().map((record) => record.phase)),
      new Set(['provider-draft', 'provider-critic']),
    );
  }
});

test('renders only fixed phase names and aggregates repeated phases', () => {
  const report = renderOperationTimings([
    { phase: 'provider-draft', durationMs: 2.5 },
    { phase: 'git-evidence', durationMs: 1 },
    { phase: 'provider-draft', durationMs: 3.25 },
  ]);

  assert.equal(
    report,
    [
      'Diffwright timings (milliseconds)',
      'git-evidence: 1.000',
      'provider-draft: 5.750',
      'total: 6.750',
    ].join('\n'),
  );
  assert.deepEqual(TIMING_PHASES, [
    'project-gates',
    'git-evidence',
    'context',
    'policy',
    'provider-draft',
    'provider-repair',
    'provider-critic',
    'render',
    'review',
    'mutation-validation',
    'git-mutation',
    'github-mutation',
  ]);
});

test('fails closed for invalid clocks and records', () => {
  const timings = createOperationTimings(sequenceClock([5, 4]));
  assert.throws(
    () => timings.measureSync('policy', () => undefined),
    /clock returned an invalid value/,
  );
  assert.throws(
    () =>
      renderOperationTimings([
        { phase: 'git-evidence', durationMs: Number.NaN },
      ]),
    /invalid duration/,
  );
});
