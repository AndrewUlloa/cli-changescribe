#!/usr/bin/env node

const { runCommit } = require('../src/commit');
const { runPrSummary } = require('../src/pr-summary');

function printHelp() {
  console.log(`changescribe <command> [options]

Commands:
  commit    Generate a commit message and commit/push changes
  pr        Generate a PR summary (optionally create/update PR)

Examples:
  changescribe commit --dry-run
  changescribe pr --base main --mode release
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

  if (command === 'pr') {
    await runPrSummary(rest);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main();
