import { performance } from 'node:perf_hooks';

export const TIMING_PHASES = [
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
] as const;

export type TimingPhase = (typeof TIMING_PHASES)[number];

export interface TimingRecord {
  readonly phase: TimingPhase;
  readonly durationMs: number;
}

export interface OperationTimings {
  measureSync<T>(phase: TimingPhase, operation: () => T): T;
  measure<T>(phase: TimingPhase, operation: () => Promise<T>): Promise<T>;
  snapshot(): readonly Readonly<TimingRecord>[];
}

type MonotonicClock = () => number;

function durationBetween(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error('Operation timing clock returned an invalid value.');
  }
  return Number((end - start).toFixed(3));
}

export function createOperationTimings(
  clock: MonotonicClock = () => performance.now(),
): OperationTimings {
  const records: TimingRecord[] = [];

  function record(phase: TimingPhase, start: number): void {
    records.push(
      Object.freeze({
        phase,
        durationMs: durationBetween(start, clock()),
      }),
    );
  }

  return Object.freeze({
    measureSync<T>(phase: TimingPhase, operation: () => T): T {
      const start = clock();
      try {
        return operation();
      } finally {
        record(phase, start);
      }
    },
    async measure<T>(
      phase: TimingPhase,
      operation: () => Promise<T>,
    ): Promise<T> {
      const start = clock();
      try {
        return await operation();
      } finally {
        record(phase, start);
      }
    },
    snapshot(): readonly Readonly<TimingRecord>[] {
      return Object.freeze([...records]);
    },
  });
}

export function renderOperationTimings(
  records: readonly Readonly<TimingRecord>[],
): string {
  const totals = new Map<TimingPhase, number>();
  for (const record of records) {
    if (!TIMING_PHASES.includes(record.phase)) {
      throw new Error('Operation timing record has an unknown phase.');
    }
    if (!Number.isFinite(record.durationMs) || record.durationMs < 0) {
      throw new Error('Operation timing record has an invalid duration.');
    }
    totals.set(record.phase, (totals.get(record.phase) ?? 0) + record.durationMs);
  }

  const lines = ['Diffwright timings (milliseconds)'];
  let total = 0;
  for (const phase of TIMING_PHASES) {
    const duration = totals.get(phase);
    if (duration === undefined) {
      continue;
    }
    total += duration;
    lines.push(`${phase}: ${duration.toFixed(3)}`);
  }
  lines.push(`total: ${total.toFixed(3)}`);
  return lines.join('\n');
}
