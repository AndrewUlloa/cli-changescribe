const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'diffwright.js');

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('package exposes the diffwright executable', () => {
  const pkg = require('../package.json');

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

test('no arguments and short help both print help successfully', () => {
  for (const args of [[], ['-h']]) {
    const result = runCli(args);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /diffwright <command>/);
    assert.equal(result.stderr, '');
  }
});

test('command help prints global help without running the command', () => {
  for (const command of ['commit', 'init', 'pr', 'feature:pr', 'staging:pr']) {
    const result = runCli([command, '--help']);

    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, /diffwright <command>/);
    assert.equal(result.stderr, '');
  }
});

test('unknown commands fail with an error and print help', () => {
  const result = runCli(['not-a-command']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: not-a-command/);
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

  const fixturePackage = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, 'package.json'), 'utf8')
  );
  assert.deepEqual(fixturePackage.scripts, {
    commit: 'diffwright commit',
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

  const fixturePackage = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, 'package.json'), 'utf8')
  );
  assert.deepEqual(fixturePackage.scripts, {
    commit: 'diffwright commit',
    'pr:summary': 'node custom-summary.js',
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
      commit: 'diffwright commit',
      'pr:summary': 'diffwright pr:summary',
      'feature:pr': 'diffwright feature:pr',
      'staging:pr': 'diffwright staging:pr',
    },
  };
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const result = runCli(['init'], { cwd: fixtureDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Scripts already present/);
  assert.deepEqual(JSON.parse(fs.readFileSync(packagePath, 'utf8')), packageJson);
});

test('init reports a missing package.json with exit code 1', (context) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-no-package-'));
  context.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

  const result = runCli(['init'], { cwd: fixtureDir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No package\.json found/);
});
