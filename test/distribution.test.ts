import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

interface FixturePackage {
  name: string;
  private?: boolean;
  scripts?: Record<string, string>;
}

interface PackFile {
  path: string;
  mode: number;
}

interface PackMetadata {
  filename: string;
  files: PackFile[];
}

interface PackedPackage {
  metadata: PackMetadata;
  tarball: string;
}

const repoRoot = path.resolve(__dirname, '..');
const bridgeRoot = path.join(repoRoot, 'compat', 'cli-changescribe');

function writePackage(
  directory: string,
  contents: FixturePackage = { name: 'fixture', private: true },
): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    `${JSON.stringify(contents, null, 2)}\n`,
  );
}

function packPackage(
  packageRoot: string,
  artifactDirectory: string,
  env: NodeJS.ProcessEnv,
): PackedPackage {
  const stdout = execFileSync(
    'npm',
    [
      'pack',
      '--json',
      '--ignore-scripts',
      '--silent',
      '--pack-destination',
      artifactDirectory,
    ],
    { cwd: packageRoot, encoding: 'utf8', env },
  );
  const result: PackMetadata[] = JSON.parse(stdout);
  assert.equal(result.length, 1);
  return {
    metadata: result[0],
    tarball: path.join(artifactDirectory, result[0].filename),
  };
}

function expectedDiffwrightFiles(): string[] {
  const files = [
    'CONTRIBUTING.md',
    'LICENSE',
    'README.md',
    'SECURITY.md',
    'SUPPORT.md',
    'bin/diffwright.js',
    'documentation/cli-reference.md',
    'documentation/providers.md',
    'documentation/troubleshooting.md',
    'package.json',
  ];
  for (const moduleName of [
    'arguments',
    'cli',
    'commit',
    'doctor',
    'init',
    'pr-summary',
    'provider',
    'runtime-config',
    'errors',
    'transport',
    'subprocess',
  ]) {
    files.push(`dist/${moduleName}.js`, `dist/${moduleName}.js.map`);
  }
  return files.sort();
}

function assertInitialized(packagePath: string): void {
  const fixturePackage: FixturePackage = JSON.parse(
    fs.readFileSync(packagePath, 'utf8'),
  );
  assert.deepEqual(fixturePackage.scripts, {
    commit: 'diffwright commit',
    'pr:summary': 'diffwright pr:summary',
    'feature:pr': 'diffwright feature:pr',
    'staging:pr': 'diffwright staging:pr',
  });
}

function helpBody(output: string): string {
  const start = output.indexOf('diffwright <command>');
  assert.notEqual(start, -1, `help marker missing from output:\n${output}`);
  return output.slice(start);
}

test('packed Diffwright and ChangeScribe install and execute end to end', (context) => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'diffwright-distribution-'),
  );
  context.after(() =>
    fs.rmSync(temporaryRoot, { recursive: true, force: true }),
  );

  const artifacts = path.join(temporaryRoot, 'artifacts');
  const installRoot = path.join(temporaryRoot, 'install');
  const diffwrightProject = path.join(temporaryRoot, 'diffwright-project');
  const bridgeProject = path.join(temporaryRoot, 'bridge-project');
  fs.mkdirSync(artifacts, { recursive: true });
  writePackage(installRoot);
  writePackage(diffwrightProject);
  writePackage(bridgeProject);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    npm_config_cache: path.join(temporaryRoot, 'npm-cache'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };
  delete env.npm_config_dry_run;
  delete env.NPM_CONFIG_DRY_RUN;

  const diffwright = packPackage(repoRoot, artifacts, env);
  const bridge = packPackage(bridgeRoot, artifacts, env);

  assert.deepEqual(
    diffwright.metadata.files.map((file) => file.path).sort(),
    expectedDiffwrightFiles(),
  );
  assert.deepEqual(
    bridge.metadata.files.map((file) => file.path).sort(),
    ['LICENSE', 'README.md', 'bin/changescribe.js', 'package.json'],
  );

  const packedBin = diffwright.metadata.files.find(
    (file) => file.path === 'bin/diffwright.js',
  );
  const packedBridgeBin = bridge.metadata.files.find(
    (file) => file.path === 'bin/changescribe.js',
  );
  assert.ok(packedBin);
  assert.ok(packedBridgeBin);
  assert.equal(packedBin.mode & 0o111, 0o111);
  assert.equal(packedBridgeBin.mode & 0o111, 0o111);

  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      diffwright.tarball,
      bridge.tarball,
    ],
    { cwd: installRoot, encoding: 'utf8', env },
  );

  const binDirectory = path.join(installRoot, 'node_modules', '.bin');
  const diffwrightBin = path.join(binDirectory, 'diffwright');
  const changescribeBin = path.join(binDirectory, 'changescribe');
  const diffwrightHelp = execFileSync(diffwrightBin, ['--help'], {
    cwd: installRoot,
    encoding: 'utf8',
    env,
  });
  const changescribeHelp = spawnSync(changescribeBin, ['--help'], {
    cwd: installRoot,
    encoding: 'utf8',
    env,
  });

  assert.match(diffwrightHelp, /diffwright <command>/);
  assert.equal(changescribeHelp.status, 0, changescribeHelp.stderr);
  assert.equal(helpBody(changescribeHelp.stdout), helpBody(diffwrightHelp));
  assert.match(changescribeHelp.stderr, /ChangeScribe has moved to Diffwright/);

  const installedManifest = JSON.parse(
    fs.readFileSync(
      path.join(installRoot, 'node_modules', 'diffwright', 'package.json'),
      'utf8',
    ),
  );
  assert.equal(installedManifest.version, '0.3.2');

  const bridgeResolution = require.resolve('diffwright/bin/diffwright.js', {
    paths: [path.join(installRoot, 'node_modules', 'cli-changescribe')],
  });
  const rootDiffwrightBin = path.join(
    installRoot,
    'node_modules',
    'diffwright',
    'bin',
    'diffwright.js',
  );
  assert.equal(
    fs.realpathSync(bridgeResolution),
    fs.realpathSync(rootDiffwrightBin),
  );
  assert.equal(
    fs.existsSync(
      path.join(
        installRoot,
        'node_modules',
        'cli-changescribe',
        'node_modules',
        'diffwright',
      ),
    ),
    false,
  );

  execFileSync(diffwrightBin, ['init'], {
    cwd: diffwrightProject,
    encoding: 'utf8',
    env,
  });
  assertInitialized(path.join(diffwrightProject, 'package.json'));

  execFileSync(changescribeBin, ['init'], {
    cwd: bridgeProject,
    encoding: 'utf8',
    env,
  });
  assertInitialized(path.join(bridgeProject, 'package.json'));

  const unknown = spawnSync(diffwrightBin, ['not-a-command'], {
    cwd: installRoot,
    encoding: 'utf8',
    env,
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown command/);
});
