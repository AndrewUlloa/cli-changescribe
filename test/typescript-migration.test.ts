import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(__dirname, '..');

interface PackageContract {
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
  assert.deepEqual(pkg.files, ['bin', 'dist', 'README.md', 'LICENSE']);
  assert.equal(typeof pkg.devDependencies.typescript, 'string');
  assert.equal(typeof pkg.devDependencies['@types/node'], 'string');
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
  const expectedModules = ['cli', 'commit', 'init', 'pr-summary', 'provider'];
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
