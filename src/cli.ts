import fs from 'node:fs';
import path from 'node:path';
import { runCommit } from './commit';
import { runDoctor } from './doctor';
import { CliArgumentError, validateCommandArguments } from './arguments';
import { formatSafeError } from './errors';
import { runInit } from './init';
import { runMerge } from './merge';
import { runPrSummary } from './pr-summary';
import { knownSecretValues, loadRuntimeConfig } from './runtime-config';
import { runTitleCheck } from './title-check';

interface CliRunners {
  runCommit(args: string[]): Promise<void>;
  runDoctor(args: string[]): Promise<void>;
  runInit(args: string[]): void | Promise<void>;
  runMerge(args: string[]): Promise<void>;
  runPrSummary(args: string[]): Promise<void>;
  runTitleCheck(args: string[]): void | Promise<void>;
}

const defaultRunners: CliRunners = {
  runCommit,
  runDoctor,
  runInit,
  runMerge,
  runPrSummary,
  runTitleCheck,
};

const CLI_REFERENCE =
  'https://github.com/AndrewUlloa/diffwright/blob/main/documentation/cli-reference.md';

function printVersion(): void {
  const packagePath = path.resolve(__dirname, '..', 'package.json');
  const parsed: unknown = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Unable to read the Diffwright package version.');
  }
  const version: unknown = Reflect.get(parsed, 'version');
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Unable to read the Diffwright package version.');
  }
  console.log(version);
}

function printHelp(): void {
  console.log(`diffwright <command> [options]

Commands:
  commit        Generate a commit message and commit/push changes
  pr            Generate a PR summary (optionally create/update PR)
  doctor        Validate provider configuration (add --live for one request)
  init          Interactively configure Diffwright in the current repo
  merge         Validate and squash-merge the current pull request
  title-check   Validate a pull-request event title against base policy
  pr:summary    Alias for pr
  feature:pr    Alias for: pr --base staging --create-pr --mode feature
  staging:pr    Alias for: pr --base main --create-pr --mode release

Global options:
  --version, -v  Print the installed Diffwright version

Examples:
  diffwright init
  diffwright doctor
  diffwright doctor --live
  diffwright commit --all --dry-run
  diffwright pr --base main --mode release
  diffwright merge --dry-run
  diffwright title-check --event-file "$GITHUB_EVENT_PATH"
  diffwright feature:pr
  diffwright staging:pr

Complete reference: ${CLI_REFERENCE}
`);
}

function printCommitHelp(): void {
  console.log(`Usage: diffwright commit [--dry-run] [--all] [--timings] [--context-file <path>]

Generate a Conventional Commit message from the staged diff.

Options:
  --dry-run   Generate and print the message without committing or pushing.
  --all       Stage every tracked and untracked working-tree change first.
  --timings   Print privacy-safe phase durations after the command finishes.
  --context-file <path>
              Add bounded source-agnostic intent from a regular project file.

Without --all, Diffwright analyzes only the existing staged diff and never changes
the index. Without --dry-run, it creates a commit and pushes the current branch.

Complete reference: ${CLI_REFERENCE}
`);
}

function printPrHelp(): void {
  console.log(`Usage: diffwright pr [options]

Generate a pull-request summary for the current branch.

Options:
  --base <branch>     Base branch (default: main)
  --out <path>        Detailed output file (default: .pr-summaries/PR_SUMMARY.md)
  --limit <number>    Legacy history cap; never limits the final net diff
  --issue <number>    Add issue context and append "Closes #<number>" to the PR body
  --mode <mode>       Summary mode: feature or release
  --context-file <path>
                      Add bounded source-agnostic intent from a regular project file
  --dry-run           Show the range and plan without provider calls or output files
  --create-pr         Run project gates and create or update a PR with gh
  --yes               Approve GitHub mutation noninteractively after validation
  --skip-format       Skip the optional package-manager format script
  --no-format         Alias for --skip-format
  --timings           Print privacy-safe phase durations after the command finishes

Dry runs may fetch the base branch. Normal runs use a structured draft request
and one terminal critic request. One deterministic draft repair can raise the
maximum to three requests. They write detailed and PR-ready summary files.

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
  console.log(`Usage: diffwright init [options]

Configure Diffwright in an existing project. When both input and output are an
interactive TTY, init starts a guided setup and previews proposed changes.
Without a TTY, with --yes, or with a configuration option, init runs headlessly
using supplied options and detected defaults.

Options:
  --yes                          Accept defaults and skip interactive prompts
  --dry-run                      Preview without installs, writes, or live provider requests
  --provider <id>                Provider: openai, anthropic, google, xai,
                                 deepseek, openrouter, vercel, cerebras, groq,
                                 ollama, or custom
  --model <id>                   Exact provider model ID
  --base <branch>                Pull-request base branch
  --agents <selection>           claude, codex, claude,codex, codex,claude, or none
  --credential-source <source>   existing or file; never a credential value
  --scope-mode <mode>            optional or forbidden
  --scope <token>                Confirm an allowed scope; repeatable
  --issue-context <expectation>  optional, recommended, or required
  --merge-strategy <strategy>    squash or platform
  --delete-branch                Delete the branch after a confirmed squash merge
  --pr-template <preference>     create or preserve
  --live                         Make one provider request after the offline doctor check

After guided confirmation or deterministic invocation, init may install the exact Diffwright
version and write package.json, .env.local, .gitignore,
CLAUDE.md, AGENTS.md, or .diffwrightrc.json. Existing custom package scripts
and file content are preserved. The offline doctor check runs after setup;
--live opts into one additional provider request.

Complete reference: ${CLI_REFERENCE}
`);
}

function printMergeHelp(): void {
  console.log(`Usage: diffwright merge [--dry-run] [--yes]

Validate the current pull request and merge its exact reviewed head as one
squash commit using its Conventional Commit title. No provider calls are made.

Options:
  --dry-run        Validate and preview without merging
  --yes            Approve the merge noninteractively after validation

Diffwright pins the origin repository, local and remote head, base revision,
title policy, review decision, and check results before invoking GitHub CLI.

Complete reference: ${CLI_REFERENCE}
`);
}

function printTitleCheckHelp(): void {
  console.log(`Usage: diffwright title-check --event-file <path>

Read one bounded pull-request event and validate its title against canonical
Conventional Commit grammar and the repository policy pinned to the event's
base revision. This command makes no provider, network, or GitHub mutation.

Options:
  --event-file <path>   GitHub pull_request event JSON file

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
  } else if (command === 'merge') {
    printMergeHelp();
  } else if (command === 'title-check') {
    printTitleCheckHelp();
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
  if (command === '-v' || command === '--version') {
    printVersion();
    return 0;
  }

  const validatedCommand =
    command === 'pr:summary' || command === 'feature:pr' || command === 'staging:pr'
      ? 'pr'
      : command;
  if (
    (rest.includes('-h') || rest.includes('--help')) &&
    (validatedCommand === 'commit' ||
      validatedCommand === 'doctor' ||
      validatedCommand === 'init' ||
      validatedCommand === 'merge' ||
      validatedCommand === 'title-check' ||
      validatedCommand === 'pr')
  ) {
    printCommandHelp(validatedCommand);
    return 0;
  }
  if (validatedCommand === 'commit' || validatedCommand === 'doctor' || validatedCommand === 'init' || validatedCommand === 'merge' || validatedCommand === 'title-check' || validatedCommand === 'pr') {
    try {
      validateCommandArguments(validatedCommand, rest);
    } catch (error) {
      if (error instanceof CliArgumentError) {
        console.error(
          `Error: ${formatSafeError(error, knownSecretValues(process.env))}`,
        );
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
    await runners.runInit(rest);
    return 0;
  }

  if (command === 'merge') {
    await runners.runMerge(rest);
    return 0;
  }

  if (command === 'title-check') {
    await runners.runTitleCheck(rest);
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

  console.error('Unknown command. Run `diffwright --help` for usage.');
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
