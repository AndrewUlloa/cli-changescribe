import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(__dirname, '..');

interface PackageContract {
  version: string;
  license: string;
  scripts: Record<string, string>;
  files: string[];
  devDependencies: Record<string, string>;
}

interface TypeScriptConfig {
  extends?: string;
  compilerOptions: Record<string, unknown>;
  include: string[];
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

test('package defines a compiled TypeScript lifecycle', () => {
  const pkg = readJson<PackageContract>('package.json');

  assert.equal(pkg.scripts.build, 'tsc -p tsconfig.json');
  assert.equal(
    pkg.scripts.typecheck,
    'tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit',
  );
  assert.equal(pkg.scripts.prepack, 'npm run build');
  assert.match(pkg.scripts.test, /npm run build/);
  assert.deepEqual(pkg.files, [
    'bin',
    'dist',
    'documentation',
    'CHANGELOG.md',
    'README.md',
    'SECURITY.md',
    'SUPPORT.md',
    'CONTRIBUTING.md',
    'LICENSE',
    'NOTICE',
  ]);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(typeof pkg.devDependencies.typescript, 'string');
  assert.equal(typeof pkg.devDependencies['@types/node'], 'string');
});

test('Diffwright ships the complete Apache 2.0 license and attribution notice', () => {
  const license = fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8');
  const notice = fs.readFileSync(path.join(repoRoot, 'NOTICE'), 'utf8');
  const contributing = fs.readFileSync(
    path.join(repoRoot, 'CONTRIBUTING.md'),
    'utf8',
  );

  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(license, /3\. Grant of Patent License\./);
  assert.match(license, /4\. Redistribution\./);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
  assert.match(notice, /^Diffwright\nCopyright 2026 Andrew Ulloa\n/);
  assert.match(contributing, /Apache License 2\.0/);
});

test('compiler contract is strict CommonJS for Node 18', () => {
  const tsconfig = readJson<TypeScriptConfig>('tsconfig.json');

  assert.equal(tsconfig.compilerOptions.target, 'ES2022');
  assert.equal(tsconfig.compilerOptions.module, 'Node16');
  assert.equal(tsconfig.compilerOptions.moduleResolution, 'Node16');
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.noEmitOnError, true);
  assert.equal(tsconfig.compilerOptions.allowJs, undefined);
  assert.equal(tsconfig.compilerOptions.rootDir, 'src');
  assert.equal(tsconfig.compilerOptions.outDir, 'dist');
  assert.equal(tsconfig.compilerOptions.sourceMap, true);
  assert.equal(tsconfig.compilerOptions.inlineSources, true);
  assert.deepEqual(tsconfig.include, ['src/**/*.ts']);
});

test('all application sources are TypeScript and compiled output exists', () => {
  const expectedModules = [
    'arguments',
    'artifact-draft',
    'artifact-renderer',
    'change-evidence',
    'cli',
    'commit',
    'context-evidence',
    'doctor',
    'gate-receipts',
    'git-evidence',
    'init',
    'package-manager',
    'project-setup',
    'prompts',
    'pr-summary',
    'pr-workflow',
    'provider',
    'runtime-config',
    'errors',
    'transport',
    'subprocess',
    'setup-files',
    'staged-evidence',
  ];
  const sourceFiles = fs.readdirSync(path.join(repoRoot, 'src')).sort();

  assert.deepEqual(
    sourceFiles,
    expectedModules.map((name) => `${name}.ts`).sort(),
  );
  for (const name of expectedModules) {
    assert.equal(fs.existsSync(path.join(repoRoot, 'dist', `${name}.js`)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, 'dist', `${name}.js.map`)), true);
  }
});

test('stable executable is a CommonJS shim for compiled CLI output', () => {
  const binPath = path.join(repoRoot, 'bin', 'diffwright.js');
  const bin = fs.readFileSync(binPath, 'utf8');
  const mode = fs.statSync(binPath).mode & 0o777;

  assert.match(bin, /^#!\/usr\/bin\/env node\n/);
  assert.match(bin, /require\(['"]\.\.\/dist\/cli\.js['"]\)/);
  assert.equal(mode & 0o111, 0o111);
});

test('TypeScript application and test source contain no unsafe escapes', () => {
  if (!fs.existsSync(path.join(repoRoot, 'src'))) {
    assert.fail('src directory is missing');
  }

  const source = ['src', 'test']
    .flatMap((directory) =>
      fs
        .readdirSync(path.join(repoRoot, directory))
        .filter((file) => file.endsWith('.ts'))
        .map((file) =>
          fs.readFileSync(path.join(repoRoot, directory, file), 'utf8'),
        ),
    )
    .join('\n');

  assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/);
  assert.doesNotMatch(source, /\bas any\b/);
  assert.doesNotMatch(source, /:\s*any\b/);
});

test('CI verifies the supported Node release matrix', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'ci.yml'),
    'utf8',
  );

  assert.match(workflow, /node-version:\s*\[18\.x, 20\.x, 22\.x\]/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm publish --dry-run --tag next --json/);
});

test('release automation publishes one verified package with trusted provenance', () => {
  const pkg = readJson<PackageContract>('package.json');
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  const verifier = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'verify-release.mjs'),
    'utf8',
  );

  assert.match(workflow, /release:\s*\n\s+types: \[published\]/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /environment: npm/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node scripts\/verify-release\.mjs/);
  assert.match(workflow, /git merge-base --is-ancestor HEAD origin\/main/);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm audit --omit=dev/);
  assert.match(workflow, /npm audit signatures/);
  assert.match(workflow, /npm publish .*--access public/);
  assert.match(workflow, /npm publish "\.\/\$PACKAGE_FILE" --access public/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /overwrite: true/);
  assert.match(workflow, /needs: publish/);
  assert.match(workflow, /gh release upload/);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
  assert.doesNotMatch(
    workflow,
    /run: npm publish "\$\{\{ steps\.pack\.outputs\.package_file \}\}"/,
  );

  assert.match(verifier, /RELEASE_TAG/);
  assert.match(verifier, /package\.json/);
  assert.match(verifier, /package-lock\.json/);

  const valid = spawnSync(process.execPath, ['scripts/verify-release.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, RELEASE_TAG: `v${pkg.version}` },
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, new RegExp(`Verified Diffwright ${pkg.version.replaceAll('.', '\\.')}\\b`));

  const mismatch = spawnSync(process.execPath, ['scripts/verify-release.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, RELEASE_TAG: 'v999.0.0' },
  });
  assert.notEqual(mismatch.status, 0);
});

test('the complete test suite is strict compiled TypeScript', () => {
  const pkg = readJson<PackageContract>('package.json');
  const testConfig = readJson<TypeScriptConfig>('tsconfig.test.json');
  const testFiles = fs.readdirSync(path.join(repoRoot, 'test')).sort();
  const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');

  assert.equal(pkg.scripts['build:test'], 'tsc -p tsconfig.test.json');
  assert.match(pkg.scripts.typecheck, /tsc -p tsconfig\.test\.json --noEmit/);
  assert.equal(
    pkg.scripts.test,
    'npm run build && npm run build:test && node .test-dist/run-tests.js',
  );
  assert.equal(testConfig.extends, './tsconfig.json');
  assert.equal(testConfig.compilerOptions.rootDir, 'test');
  assert.equal(testConfig.compilerOptions.outDir, '.test-dist');
  assert.deepEqual(testConfig.include, ['test/**/*.ts']);
  assert.equal(testFiles.length > 0, true);
  assert.equal(testFiles.every((file) => file.endsWith('.ts')), true);
  assert.equal(testFiles.some((file) => file.endsWith('.test.ts')), true);
  assert.equal(testFiles.includes('run-tests.ts'), true);
  assert.match(gitignore, /^\.test-dist\/$/m);
});
