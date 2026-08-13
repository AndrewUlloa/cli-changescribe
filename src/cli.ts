import { runCommit } from './commit';
import { runDoctor } from './doctor';
import { formatSafeError } from './errors';
import { runInit } from './init';
import { runPrSummary } from './pr-summary';
import { knownSecretValues, loadRuntimeConfig } from './runtime-config';

interface CliRunners {
  runCommit(args: string[]): Promise<void>;
  runDoctor(args: string[]): Promise<void>;
  runInit(): void | Promise<void>;
  runPrSummary(args: string[]): Promise<void>;
}

const defaultRunners: CliRunners = {
  runCommit,
  runDoctor,
  runInit,
  runPrSummary,
};

function printHelp(): void {
  console.log(`diffwright <command> [options]

Commands:
  commit        Generate a commit message and commit/push changes
  pr            Generate a PR summary (optionally create/update PR)
  doctor        Validate provider configuration (add --live for one request)
  init          Add npm scripts to the current repo
  pr:summary    Alias for pr
  feature:pr    Alias for: pr --base staging --create-pr --mode feature
  staging:pr    Alias for: pr --base main --create-pr --mode release

Examples:
  diffwright init
  diffwright doctor
  diffwright doctor --live
  diffwright commit --dry-run
  diffwright pr --base main --mode release
  diffwright feature:pr
  diffwright staging:pr
`);
}

export async function runCli(
  argv: string[],
  runners: CliRunners = defaultRunners,
): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') {
    printHelp();
    return 0;
  }
  if (rest.includes('-h') || rest.includes('--help')) {
    printHelp();
    return 0;
  }

  if (command === 'commit') {
    await runners.runCommit(rest);
    return 0;
  }

  if (command === 'doctor') {
    await runners.runDoctor(rest);
    return 0;
  }

  if (command === 'init') {
    await runners.runInit();
    return 0;
  }

  if (command === 'pr' || command === 'pr:summary') {
    await runners.runPrSummary(rest);
    return 0;
  }

  if (command === 'feature:pr') {
    await runners.runPrSummary([
      '--base',
      'staging',
      '--create-pr',
      '--mode',
      'feature',
      ...rest,
    ]);
    return 0;
  }

  if (command === 'staging:pr') {
    await runners.runPrSummary([
      '--base',
      'main',
      '--create-pr',
      '--mode',
      'release',
      ...rest,
    ]);
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  return 1;
}

export async function main(): Promise<void> {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    let secrets = knownSecretValues(process.env);
    try {
      secrets = knownSecretValues(loadRuntimeConfig().values);
    } catch {
      // The original error remains more useful if configuration loading fails.
    }
    console.error(`❌ ${formatSafeError(error, secrets)}`);
    process.exitCode = 1;
  }
}
