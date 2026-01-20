#!/usr/bin/env node

const { runCommit } = require('../src/commit');
const { runPrSummary } = require('../src/pr-summary');

function printHelp() {
  console.log(`changescribe <command> [options]

Commands:
  commit        Generate a commit message and commit/push changes
  pr            Generate a PR summary (optionally create/update PR)
  pr:summary    Alias for pr
  feature:pr    Alias for: pr --base staging --create-pr --mode feature
  staging:pr    Alias for: pr --base main --create-pr --mode release

Examples:
  changescribe commit --dry-run
  changescribe pr --base main --mode release
  changescribe feature:pr
  changescribe staging:pr
`);
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (!command || command === '-h' || command === '--help') {
    printHelp();
    return;
  }

  if (command === 'commit') {
    await runCommit(rest);
    return;
  }

  if (command === 'pr' || command === 'pr:summary') {
    await runPrSummary(rest);
    return;
  }

  if (command === 'feature:pr') {
    await runPrSummary(['--base', 'staging', '--create-pr', '--mode', 'feature']);
    return;
  }

  if (command === 'staging:pr') {
    await runPrSummary(['--base', 'main', '--create-pr', '--mode', 'release']);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main();
