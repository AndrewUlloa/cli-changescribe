import { AsyncLocalStorage } from 'node:async_hooks';
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

interface ActiveMeasurement {
  readonly start: number;
  readonly childIntervals: TimeInterval[];
  readonly parent?: ActiveMeasurement;
}

interface TimeInterval {
  readonly start: number;
  readonly end: number;
}

function durationBetween(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error('Operation timing clock returned an invalid value.');
  }
  return end - start;
}

function coveredDuration(intervals: readonly TimeInterval[]): number {
  const ordered = [...intervals].sort((left, right) =>
    left.start - right.start || left.end - right.end,
  );
  let total = 0;
  let currentStart: number | undefined;
  let currentEnd: number | undefined;
  for (const interval of ordered) {
    durationBetween(interval.start, interval.end);
    if (currentStart === undefined || currentEnd === undefined) {
      currentStart = interval.start;
      currentEnd = interval.end;
      continue;
    }
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  if (currentStart !== undefined && currentEnd !== undefined) {
    total += currentEnd - currentStart;
  }
  return total;
}

export function createOperationTimings(
  clock: MonotonicClock = () => performance.now(),
): OperationTimings {
  const records: TimingRecord[] = [];
  const active = new AsyncLocalStorage<ActiveMeasurement>();

  function begin(): ActiveMeasurement {
    const parent = active.getStore();
    return {
      start: clock(),
      childIntervals: [],
      ...(parent === undefined ? {} : { parent }),
    };
  }

  function record(
    phase: TimingPhase,
    measurement: ActiveMeasurement,
  ): void {
    const end = clock();
    const durationMs = durationBetween(measurement.start, end);
    const nestedDurationMs = coveredDuration(measurement.childIntervals);
    if (nestedDurationMs > durationMs) {
      throw new Error('Operation timing nested duration is invalid.');
    }
    if (measurement.parent !== undefined) {
      measurement.parent.childIntervals.push({
        start: measurement.start,
        end,
      });
    }
    records.push(
      Object.freeze({
        phase,
        durationMs: Number(
          (durationMs - nestedDurationMs).toFixed(3),
        ),
      }),
    );
  }

  return Object.freeze({
    measureSync<T>(phase: TimingPhase, operation: () => T): T {
      const measurement = begin();
      return active.run(measurement, () => {
        try {
          return operation();
        } finally {
          record(phase, measurement);
        }
      });
    },
    async measure<T>(
      phase: TimingPhase,
      operation: () => Promise<T>,
    ): Promise<T> {
      const measurement = begin();
      return active.run(measurement, async () => {
        try {
          return await operation();
        } finally {
          record(phase, measurement);
        }
      });
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
