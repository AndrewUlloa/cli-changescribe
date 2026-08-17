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
const currentVersion: string = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
).version;

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
    'CHANGELOG.md',
    'LICENSE',
    'NOTICE',
    'README.md',
    'SECURITY.md',
    'SUPPORT.md',
    'bin/diffwright.js',
    'documentation/cli-reference.md',
    'documentation/diffwrightrc.schema.json',
    'documentation/providers.md',
    'documentation/releases.md',
    'documentation/troubleshooting.md',
    'package.json',
  ];
  for (const moduleName of [
    'arguments',
    'artifact-draft',
    'artifact-critic',
    'artifact-completeness',
    'artifact-renderer',
    'change-evidence',
    'change-map',
    'cli',
    'commit',
    'context-evidence',
    'doctor',
    'editorial-policy',
    'gate-receipts',
    'git-evidence',
    'github-repository',
    'init',
    'merge',
    'model-evidence',
    'operation-timings',
    'package-manager',
    'project-setup',
    'prompts',
    'pr-summary',
    'pr-editor',
    'pr-review',
    'pr-workflow',
    'provider',
    'repository-policy',
    'runtime-config',
    'errors',
    'transport',
    'subprocess',
    'setup-files',
    'staged-evidence',
    'title-semantics',
    'title-check',
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
    commit: 'diffwright commit --all',
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
  assert.equal(installedManifest.version, currentVersion);

  const installManifestPath = path.join(installRoot, 'package.json');
  const installManifest = JSON.parse(
    fs.readFileSync(installManifestPath, 'utf8'),
  );
  installManifest.devDependencies = {
    ...(installManifest.devDependencies ?? {}),
    diffwright: installedManifest.version,
  };
  fs.writeFileSync(
    installManifestPath,
    `${JSON.stringify(installManifest, null, 2)}\n`,
  );

  execFileSync(
    diffwrightBin,
    [
      'init',
      '--yes',
      '--provider',
      'ollama',
      '--model',
      'llama3.2',
      '--agents',
      'none',
    ],
    { cwd: installRoot, encoding: 'utf8', env },
  );
  const guidedManifest: FixturePackage = JSON.parse(
    fs.readFileSync(installManifestPath, 'utf8'),
  );
  assert.equal(
    guidedManifest.scripts?.commit,
    'node ./node_modules/diffwright/bin/diffwright.js commit --all',
  );
  assert.equal(
    guidedManifest.scripts?.['feature:pr'],
    'node ./node_modules/diffwright/bin/diffwright.js pr --base main --create-pr --mode feature',
  );
  assert.equal(guidedManifest.scripts?.['staging:pr'], undefined);
  assert.equal(
    guidedManifest.scripts?.['pr:merge'],
    'node ./node_modules/diffwright/bin/diffwright.js merge',
  );
  const guidedPolicy = JSON.parse(
    fs.readFileSync(path.join(installRoot, '.diffwrightrc.json'), 'utf8'),
  );
  assert.equal(guidedPolicy.version, 2);
  assert.equal(guidedPolicy.title.allowedScopes, undefined);
  assert.equal(guidedPolicy.merge.strategy, 'squash');
  assert.match(
    fs.readFileSync(
      path.join(installRoot, '.github', 'pull_request_template.md'),
      'utf8',
    ),
    /## Summary[\s\S]*## Validation[\s\S]*## Context/u,
  );
  const localScriptHelp = execFileSync(
    'npm',
    ['run', 'commit', '--', '--help'],
    { cwd: installRoot, encoding: 'utf8', env },
  );
  assert.match(localScriptHelp, /Usage: diffwright commit/);

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
