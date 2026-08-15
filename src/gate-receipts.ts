import { createVerificationReceipt, type VerificationReceipt } from './change-evidence';
import type { PackageCommand } from './package-manager';
import { defaultCommandRunner, type CommandRunner } from './subprocess';

export interface GateReceiptOptions {
  cwd?: string;
  runner?: CommandRunner;
  clock?: () => number;
}

export function runGateReceipt(
  id: string,
  command: PackageCommand,
  options: GateReceiptOptions = {},
): VerificationReceipt {
  const runner = options.runner ?? defaultCommandRunner;
  const clock = options.clock ?? performance.now.bind(performance);
  const startedAt = clock();
  const result = runner.spawn(command.file, command.args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  const durationMs = Math.max(0, clock() - startedAt);

  if (result.error || result.status === null) {
    throw new Error(`Could not run ${command.display}.`);
  }

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
  });
}

export function createSkippedGateReceipt(
  id: string,
  command: PackageCommand,
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
