import { createVerificationReceipt, type VerificationReceipt } from './change-evidence';
import type { PackageCommand } from './package-manager';
import { defaultCommandRunner, type CommandRunner } from './subprocess';

export interface GateReceiptOptions {
  cwd?: string;
  runner?: CommandRunner;
  clock?: () => number;
  resultParser?: 'tap';
  writeStdout?: (output: string) => void;
  writeStderr?: (output: string) => void;
}

const MAX_GATE_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_TAP_PARSE_CHARS = 256 * 1024;

type TestSummary = NonNullable<VerificationReceipt['result']>;

export function parseTapTestSummary(output: string): TestSummary | null {
  const bounded = output.slice(-MAX_TAP_PARSE_CHARS).replaceAll('\r\n', '\n');
  const planMatches = [...bounded.matchAll(/^1\.\.(\d+)$/gmu)];
  const finalPlan = planMatches.at(-1);
  if (finalPlan?.index === undefined) {
    return null;
  }
  const planned = Number(finalPlan[1]);
  const summaryText = bounded.slice(finalPlan.index + finalPlan[0].length);
  const names = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'] as const;
  const values = new Map<(typeof names)[number], number>();
  for (const match of summaryText.matchAll(
    /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu,
  )) {
    const name = match[1] as (typeof names)[number];
    if (values.has(name)) {
      return null;
    }
    values.set(name, Number(match[2]));
  }
  if (names.some((name) => !values.has(name))) {
    return null;
  }
  const tests = values.get('tests') ?? -1;
  const passed = values.get('pass') ?? -1;
  const failed = values.get('fail') ?? -1;
  const cancelled = values.get('cancelled') ?? -1;
  const skipped = values.get('skipped') ?? -1;
  const todo = values.get('todo') ?? -1;
  const counts = [planned, tests, passed, failed, cancelled, skipped, todo];
  if (
    counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    planned !== tests ||
    tests !== passed + failed + cancelled + skipped + todo
  ) {
    return null;
  }
  return Object.freeze({
    type: 'test-summary',
    tests,
    passed,
    failed,
    skipped,
    cancelled,
    todo,
  });
}

export function runGateReceipt(
  id: string,
  command: PackageCommand,
  options: GateReceiptOptions = {},
): VerificationReceipt {
  const runner = options.runner ?? defaultCommandRunner;
  const clock = options.clock ?? performance.now.bind(performance);
  const writeStdout = options.writeStdout ?? process.stdout.write.bind(process.stdout);
  const writeStderr = options.writeStderr ?? process.stderr.write.bind(process.stderr);
  const startedAt = clock();
  const result = runner.spawn(command.file, command.args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: MAX_GATE_OUTPUT_BYTES,
    stdio: 'pipe',
  });
  const durationMs = Math.max(0, clock() - startedAt);

  if (result.stdout) {
    writeStdout(result.stdout);
  }
  if (result.stderr) {
    writeStderr(result.stderr);
  }

  if (result.error || result.status === null) {
    throw new Error(`Could not run ${command.display}.`);
  }

  const parsedResult = options.resultParser === 'tap'
    ? parseTapTestSummary(result.stdout ?? '')
    : null;
  return createVerificationReceipt({
    id,
    command: {
      file: command.file,
      args: [...command.args],
      display: command.display,
    },
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    durationMs,
    source: 'diffwright',
    ...(parsedResult === null ? {} : { result: parsedResult }),
    ...(options.resultParser === 'tap' && parsedResult === null
      ? { limitation: 'output-unrecognized' as const }
      : {}),
  });
}

export function createSkippedGateReceipt(
  id: string,
  command: PackageCommand,
  reason: 'not-configured' | 'user-requested',
): VerificationReceipt {
  return createVerificationReceipt({
    id,
    command: {
      file: command.file,
      args: [...command.args],
      display: command.display,
    },
    status: 'skipped',
    exitCode: null,
    durationMs: 0,
    source: 'diffwright',
    skipReason: reason,
  });
}

export function requirePassedGate(
  receipt: VerificationReceipt,
  failureGuidance: string,
): void {
  if (receipt.status !== 'passed') {
    throw new Error(`${receipt.command.display} failed; ${failureGuidance}`);
  }
}
