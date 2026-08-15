import assert from 'node:assert/strict';
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'diffwright.js');

interface CliOptions {
  cwd?: string;
}

interface FixturePackage {
  name: string;
  scripts?: Record<string, string>;
}

interface PackageManifest {
  name: string;
  bin: Record<string, string>;
}

function runCli(
  args: string[],
  options: CliOptions = {},
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('package exposes the diffwright executable', () => {
  const pkg: PackageManifest = require('../package.json');

  assert.equal(pkg.name, 'diffwright');
  assert.deepEqual(pkg.bin, { diffwright: 'bin/diffwright.js' });
});

test('help uses the Diffwright command name', () => {
  const output = execFileSync(process.execPath, [cliPath, '--help'], {
    encoding: 'utf8',
  });

  assert.match(output, /diffwright <command>/);
  assert.doesNotMatch(output, /changescribe <command>/i);
});

test('version reports the running package version for local provenance checks', () => {
  const pkg: { version: string } = require('../package.json');
  for (const flag of ['--version', '-v']) {
    const result = runCli([flag]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), pkg.version);
  }
});

test('no arguments and short help both print help successfully', () => {
  for (const args of [[], ['-h']]) {
    const result = runCli(args);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /diffwright <command>/);
    assert.equal(result.stderr, '');
  }
});

test('command help prints command-specific help without running the command', () => {
  const commands: Array<[string, RegExp]> = [
    ['commit', /Usage: diffwright commit/],
    ['init', /Usage: diffwright init/],
    ['pr', /Usage: diffwright pr/],
    ['feature:pr', /Usage: diffwright pr/],
    ['staging:pr', /Usage: diffwright pr/],
  ];
  for (const [command, pattern] of commands) {
    const result = runCli([command, '--help']);

    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, pattern);
    assert.equal(result.stderr, '');
  }
});

test('unknown commands fail with an error and print help', () => {
  const result = runCli(['not-a-command']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command/);
  assert.match(result.stdout, /diffwright <command>/);
});

test('init adds Diffwright npm scripts', (context) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-init-'));
  context.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(fixtureDir, 'package.json'),
    `${JSON.stringify({ name: 'fixture' }, null, 2)}\n`
  );

  const result = runCli(['init'], { cwd: fixtureDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Added npm scripts/);

  const fixturePackage: FixturePackage = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, 'package.json'), 'utf8')
  );
  assert.deepEqual(fixturePackage.scripts, {
    commit: 'diffwright commit --all',
    'pr:summary': 'diffwright pr:summary',
    'feature:pr': 'diffwright feature:pr',
    'staging:pr': 'diffwright staging:pr',
  });
});

test('init migrates generated ChangeScribe scripts without replacing custom scripts', (context) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-migrate-'));
  context.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(fixtureDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'fixture',
        scripts: {
          commit: 'changescribe commit',
          'pr:summary': 'node custom-summary.js',
          'feature:pr': 'changescribe feature:pr',
        },
      },
      null,
      2
    )}\n`
  );

  const result = runCli(['init'], { cwd: fixtureDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Migrated npm scripts to Diffwright/);

  const fixturePackage: FixturePackage = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, 'package.json'), 'utf8')
  );
  assert.deepEqual(fixturePackage.scripts, {
    commit: 'diffwright commit --all',
    'pr:summary': 'node custom-summary.js',
    'feature:pr': 'diffwright feature:pr',
    'staging:pr': 'diffwright staging:pr',
  });
});

test('init migrates the unflagged Diffwright commit script', (context) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-unflagged-'));
  context.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(fixtureDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'fixture',
        scripts: {
          commit: 'diffwright commit',
          'pr:summary': 'diffwright pr:summary',
          'feature:pr': 'diffwright feature:pr',
          'staging:pr': 'diffwright staging:pr',
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = runCli(['init'], { cwd: fixtureDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Migrated npm scripts to Diffwright: commit/);
  const fixturePackage: FixturePackage = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, 'package.json'), 'utf8'),
  );
  assert.deepEqual(fixturePackage.scripts, {
    commit: 'diffwright commit --all',
    'pr:summary': 'diffwright pr:summary',
    'feature:pr': 'diffwright feature:pr',
    'staging:pr': 'diffwright staging:pr',
  });
});

test('init preserves existing Diffwright scripts and remains idempotent', (context) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-idempotent-'));
  context.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  const packagePath = path.join(fixtureDir, 'package.json');
  const packageJson = {
    name: 'fixture',
    scripts: {
      commit: 'diffwright commit --all',
      'pr:summary': 'diffwright pr:summary',
      'feature:pr': 'diffwright feature:pr',
      'staging:pr': 'diffwright staging:pr',
    },
  };
  const original = `${JSON.stringify(packageJson)}\n`;
  fs.writeFileSync(packagePath, original);

  const result = runCli(['init'], { cwd: fixtureDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Scripts already present/);
  assert.equal(fs.readFileSync(packagePath, 'utf8'), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(packagePath, 'utf8')), packageJson);
});

test('init reports a missing package.json with exit code 1', (context) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-no-package-'));
  context.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

  const result = runCli(['init'], { cwd: fixtureDir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No package\.json found/);
});

test('legacy non-TTY init refuses a symlinked package.json', (context) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-link-'));
  context.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  const externalPath = path.join(fixtureDir, 'external.json');
  const original = `${JSON.stringify({ name: 'external' })}\n`;
  fs.writeFileSync(externalPath, original);
  fs.symlinkSync(externalPath, path.join(fixtureDir, 'package.json'));

  const result = runCli(['init'], { cwd: fixtureDir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /regular, unlinked file|symbolic link/i);
  assert.equal(fs.readFileSync(externalPath, 'utf8'), original);
});
