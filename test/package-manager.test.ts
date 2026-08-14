import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

interface CommandSpec {
  file: string;
  args: string[];
  display: string;
}

interface PackageManagerModule {
  detectPackageManager(
    cwd: string,
    declared?: unknown,
  ): 'npm' | 'pnpm' | 'yarn' | 'bun';
  buildInstallCommand(
    manager: 'npm' | 'pnpm' | 'yarn' | 'bun',
    version: string,
    options?: { yarnMajor?: number },
  ): CommandSpec;
  buildRunScriptCommand(
    manager: 'npm' | 'pnpm' | 'yarn' | 'bun',
    script: string,
  ): CommandSpec;
  isExactLocalDiffwrightInstalled(cwd: string, version: string): boolean;
  hasExactDiffwrightPin(cwd: string, version: string): boolean;
  buildLocalVersionCommand(
    manager: 'npm' | 'pnpm' | 'yarn' | 'bun',
  ): CommandSpec;
}

const packageManager: PackageManagerModule = require('../dist/package-manager.js');

function temporaryProject(context: test.TestContext): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-manager-'));
  context.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

test('detects declared and lockfile package managers', (context) => {
  const cwd = temporaryProject(context);
  assert.equal(packageManager.detectPackageManager(cwd), 'npm');

  fs.writeFileSync(path.join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  assert.equal(packageManager.detectPackageManager(cwd, 'pnpm@10.15.0'), 'pnpm');

  fs.rmSync(path.join(cwd, 'pnpm-lock.yaml'));
  fs.writeFileSync(path.join(cwd, 'yarn.lock'), '');
  assert.equal(packageManager.detectPackageManager(cwd, 'yarn@4.9.2'), 'yarn');
});

test('rejects conflicting or malformed package-manager evidence', (context) => {
  const cwd = temporaryProject(context);
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

  assert.throws(
    () => packageManager.detectPackageManager(cwd),
    /conflicting package manager/i,
  );
  assert.throws(
    () => packageManager.detectPackageManager(cwd, 'unknown@1.0.0'),
    /unsupported packageManager/i,
  );
});

test('builds exact dev dependency installs with lifecycle scripts disabled', () => {
  assert.deepEqual(packageManager.buildInstallCommand('npm', '1.2.3'), {
    file: 'npm',
    args: [
      'install',
      '--save-dev',
      '--save-exact',
      '--ignore-scripts',
      'diffwright@1.2.3',
    ],
    display:
      'npm install --save-dev --save-exact --ignore-scripts diffwright@1.2.3',
  });
  assert.deepEqual(packageManager.buildInstallCommand('pnpm', '1.2.3'), {
    file: 'pnpm',
    args: ['add', '--save-dev', '--save-exact', '--ignore-scripts', 'diffwright@1.2.3'],
    display:
      'pnpm add --save-dev --save-exact --ignore-scripts diffwright@1.2.3',
  });
  assert.deepEqual(
    packageManager.buildInstallCommand('yarn', '1.2.3', { yarnMajor: 4 }),
    {
      file: 'yarn',
      args: ['add', '--dev', '--exact', '--mode=skip-build', 'diffwright@1.2.3'],
      display: 'yarn add --dev --exact --mode=skip-build diffwright@1.2.3',
    },
  );
  assert.deepEqual(
    packageManager.buildInstallCommand('yarn', '1.2.3', { yarnMajor: 1 }),
    {
      file: 'yarn',
      args: ['add', '--dev', '--exact', '--ignore-scripts', 'diffwright@1.2.3'],
      display: 'yarn add --dev --exact --ignore-scripts diffwright@1.2.3',
    },
  );
  assert.deepEqual(packageManager.buildInstallCommand('bun', '1.2.3'), {
    file: 'bun',
    args: ['add', '--dev', '--exact', '--ignore-scripts', 'diffwright@1.2.3'],
    display: 'bun add --dev --exact --ignore-scripts diffwright@1.2.3',
  });
});

test('builds fixed argv project-script commands', () => {
  for (const manager of ['npm', 'pnpm', 'yarn', 'bun'] as const) {
    assert.deepEqual(packageManager.buildRunScriptCommand(manager, 'typecheck'), {
      file: manager,
      args: ['run', 'typecheck'],
      display: `${manager} run typecheck`,
    });
  }
  assert.throws(
    () => packageManager.buildRunScriptCommand('npm', 'bad script'),
    /unsafe script/i,
  );
});

test('builds package-manager-local version probes that cannot download a fallback', () => {
  assert.deepEqual(packageManager.buildLocalVersionCommand('npm'), {
    file: 'npm',
    args: ['exec', '--offline', '--', 'diffwright', '--version'],
    display: 'npm exec --offline -- diffwright --version',
  });
  assert.deepEqual(packageManager.buildLocalVersionCommand('pnpm'), {
    file: 'pnpm',
    args: ['exec', 'diffwright', '--version'],
    display: 'pnpm exec diffwright --version',
  });
  assert.deepEqual(packageManager.buildLocalVersionCommand('yarn'), {
    file: 'yarn',
    args: ['exec', '--', 'diffwright', '--version'],
    display: 'yarn exec -- diffwright --version',
  });
  assert.deepEqual(packageManager.buildLocalVersionCommand('bun'), {
    file: 'bunx',
    args: ['--no-install', 'diffwright', '--version'],
    display: 'bunx --no-install diffwright --version',
  });
});

test('Yarn Classic forwards dry-run through the generated delimiter-safe script', (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX executable fixture');
    return;
  }
  const yarnVersion = spawnSync('yarn', ['--version'], { encoding: 'utf8' });
  if (yarnVersion.error || yarnVersion.status !== 0) {
    context.skip('Yarn is not installed');
    return;
  }
  if (!yarnVersion.stdout.trim().startsWith('1.')) {
    context.skip('Yarn Classic is not installed');
    return;
  }
  const cwd = temporaryProject(context);
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    `${JSON.stringify({
      private: true,
      scripts: { commit: 'yarn exec -- diffwright commit' },
    })}\n`,
  );
  const binRoot = path.join(cwd, 'node_modules', '.bin');
  fs.mkdirSync(binRoot, { recursive: true });
  fs.writeFileSync(
    path.join(binRoot, 'diffwright'),
    '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n',
    { mode: 0o755 },
  );

  const result = spawnSync('yarn', ['run', 'commit', '--', '--dry-run'], {
    cwd,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\["commit","--dry-run"\]/);
});

test('verifies exact local Diffwright provenance without accepting stale installs', (context) => {
  const cwd = temporaryProject(context);
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    `${JSON.stringify({ devDependencies: { diffwright: '1.2.3' } })}\n`,
  );
  const installedRoot = path.join(cwd, 'node_modules', 'diffwright');
  fs.mkdirSync(path.join(installedRoot, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(installedRoot, 'package.json'),
    `${JSON.stringify({
      name: 'diffwright',
      version: '1.2.3',
      bin: { diffwright: 'bin/diffwright.js' },
    })}\n`,
  );
  fs.writeFileSync(path.join(installedRoot, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');

  assert.equal(
    packageManager.isExactLocalDiffwrightInstalled(cwd, '1.2.3'),
    true,
  );
  assert.equal(
    packageManager.isExactLocalDiffwrightInstalled(cwd, '1.2.2'),
    false,
  );
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    `${JSON.stringify({ devDependencies: { diffwright: '^1.2.3' } })}\n`,
  );
  assert.equal(
    packageManager.isExactLocalDiffwrightInstalled(cwd, '1.2.3'),
    false,
  );
  fs.symlinkSync(
    path.join(installedRoot, 'package.json'),
    path.join(installedRoot, 'package-link.json'),
  );
  assert.equal(
    packageManager.isExactLocalDiffwrightInstalled(cwd, '../unsafe'),
    false,
  );
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    `${JSON.stringify({ devDependencies: { diffwright: '1.2.3' } })}\n`,
  );
  fs.rmSync(path.join(cwd, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.pnp.cjs'), '// Yarn Plug\'n\'Play map\n');
  assert.equal(
    packageManager.isExactLocalDiffwrightInstalled(cwd, '1.2.3'),
    false,
  );
  assert.equal(packageManager.hasExactDiffwrightPin(cwd, '1.2.3'), true);
});

test('rejects a project node_modules root that resolves through a symlink', (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX symlink provenance fixture');
    return;
  }
  const cwd = temporaryProject(context);
  const externalModules = fs.mkdtempSync(
    path.join(os.tmpdir(), 'diffwright-external-modules-'),
  );
  context.after(() => fs.rmSync(externalModules, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    `${JSON.stringify({ devDependencies: { diffwright: '1.2.3' } })}\n`,
  );
  const installedRoot = path.join(externalModules, 'diffwright');
  fs.mkdirSync(path.join(installedRoot, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(installedRoot, 'package.json'),
    `${JSON.stringify({
      name: 'diffwright',
      version: '1.2.3',
      bin: { diffwright: 'bin/diffwright.js' },
    })}\n`,
  );
  fs.writeFileSync(
    path.join(installedRoot, 'bin', 'diffwright.js'),
    '#!/usr/bin/env node\n',
  );
  fs.symlinkSync(externalModules, path.join(cwd, 'node_modules'));

  assert.equal(
    packageManager.isExactLocalDiffwrightInstalled(cwd, '1.2.3'),
    false,
  );
});
