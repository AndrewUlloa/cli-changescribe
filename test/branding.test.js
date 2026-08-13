const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runInit } = require('../src/init');

const repoRoot = path.resolve(__dirname, '..');

test('package exposes the diffwright executable', () => {
  const pkg = require('../package.json');

  assert.equal(pkg.name, 'diffwright');
  assert.deepEqual(pkg.bin, { diffwright: 'bin/diffwright.js' });
});

test('help uses the Diffwright command name', () => {
  const output = execFileSync(
    process.execPath,
    [path.join(repoRoot, 'bin/diffwright.js'), '--help'],
    { encoding: 'utf8' }
  );

  assert.match(output, /diffwright <command>/);
  assert.doesNotMatch(output, /changescribe <command>/i);
});

test('init adds Diffwright npm scripts', (context) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-init-'));
  context.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(fixtureDir, 'package.json'),
    `${JSON.stringify({ name: 'fixture' }, null, 2)}\n`
  );

  runInit(fixtureDir);

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

  runInit(fixtureDir);

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
