import { runCommit } from './commit';
import { runDoctor } from './doctor';
import { CliArgumentError, validateCommandArguments } from './arguments';
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

const CLI_REFERENCE =
  'https://github.com/AndrewUlloa/diffwright/blob/main/documentation/cli-reference.md';

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

Complete reference: ${CLI_REFERENCE}
`);
}

function printCommitHelp(): void {
  console.log(`Usage: diffwright commit [--dry-run]

Generate a Conventional Commit message from the staged diff.

Options:
  --dry-run   Generate and print the message without committing or pushing.
              If the index is empty, this still stages all changes and calls the provider.

Without --dry-run, Diffwright may stage all changes, calls the selected provider,
creates a commit, and pushes the current branch.

Complete reference: ${CLI_REFERENCE}
`);
}

function printPrHelp(): void {
  console.log(`Usage: diffwright pr [options]

Generate a pull-request summary for the current branch.

Options:
  --base <branch>     Base branch (default: main)
  --out <path>        Detailed output file (default: .pr-summaries/PR_SUMMARY.md)
  --limit <number>    Maximum commits to inspect (default: 400)
  --issue <number>    Add issue context and append "Closes #<number>" to the PR body
  --mode <mode>       Summary mode: feature or release
  --dry-run           Show the range and plan without provider calls or output files
  --create-pr         Run project gates and create or update a PR with gh
  --skip-format       Skip the optional npm format script
  --no-format         Alias for --skip-format

Dry runs may fetch the base branch. Normal runs call the provider at least three
times and write both detailed and PR-ready summary files.

Complete reference: ${CLI_REFERENCE}
`);
}

function printDoctorHelp(): void {
  console.log(`Usage: diffwright doctor [--live]

Validate the resolved provider, model, endpoint, and credential source.

Options:
  --live   Make one provider request after the offline configuration check

Complete reference: ${CLI_REFERENCE}
`);
}

function printInitHelp(): void {
  console.log(`Usage: diffwright init

Add missing Diffwright scripts to the current package.json and migrate exact
legacy ChangeScribe script values. Existing custom scripts are preserved.

This command accepts no options.

Complete reference: ${CLI_REFERENCE}
`);
}

function printCommandHelp(command: string): void {
  if (command === 'commit') {
    printCommitHelp();
  } else if (command === 'doctor') {
    printDoctorHelp();
  } else if (command === 'init') {
    printInitHelp();
  } else {
    printPrHelp();
  }
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

  const validatedCommand =
    command === 'pr:summary' || command === 'feature:pr' || command === 'staging:pr'
      ? 'pr'
      : command;
  if (
    (rest.length === 1 && (rest[0] === '-h' || rest[0] === '--help')) &&
    (validatedCommand === 'commit' ||
      validatedCommand === 'doctor' ||
      validatedCommand === 'init' ||
      validatedCommand === 'pr')
  ) {
    printCommandHelp(validatedCommand);
    return 0;
  }
  if (validatedCommand === 'commit' || validatedCommand === 'doctor' || validatedCommand === 'init' || validatedCommand === 'pr') {
    try {
      validateCommandArguments(validatedCommand, rest);
    } catch (error) {
      if (error instanceof CliArgumentError) {
        console.error(`Error: ${error.message}`);
        return 1;
      }
      throw error;
    }
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
