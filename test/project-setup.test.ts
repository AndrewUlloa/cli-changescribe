import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

interface ProjectManifest {
  name?: string;
  version?: string;
  bin?: Record<string, string>;
  packageManager?: string;
  scripts?: Record<string, string>;
}

interface ProjectDiscovery {
  manager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  defaultBranch: string;
  hasStaging: boolean;
  gates: string[];
  selfHosted: boolean;
}

interface ScriptPlan {
  scripts: Record<string, string>;
  effective: {
    commit: string;
    summary: string;
    featurePr: string;
    stagingPr: string | null;
    merge: string | null;
  };
  changes: Array<{ name: string; action: string }>;
}

interface CommandRunner {
  exec(file: string, args: readonly string[], options?: { cwd?: string }): string;
}

interface ProjectSetupModule {
  discoverScopeSuggestions(options: {
    cwd: string;
    runner: CommandRunner;
  }): readonly string[];
  discoverProject(options: {
    cwd: string;
    runner: CommandRunner;
    runningPackageRoot: string;
    runningVersion: string;
  }): ProjectDiscovery;
  buildScriptPlan(options: {
    manifest: ProjectManifest;
    manager: 'npm' | 'pnpm' | 'yarn' | 'bun';
    baseBranch: string;
    releaseBranch?: string;
    hasStaging: boolean;
    selectedGates: string[];
    selfHosted: boolean;
    mergeStrategy?: 'squash' | 'platform';
  }): ScriptPlan;
}

const setup: ProjectSetupModule = require('../dist/project-setup.js');

function fixture(
  context: test.TestContext,
  manifest: ProjectManifest,
): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-setup-'));
  context.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return cwd;
}

function gitRunner(responses: Readonly<Record<string, string>>): CommandRunner {
  return {
    exec(file, args) {
      assert.equal(file, 'git');
      const key = args.join(' ');
      const response = responses[key];
      if (response === undefined) {
        throw new Error(`missing fixture: ${key}`);
      }
      if (response.startsWith('ERROR:')) {
        throw new Error(response.slice('ERROR:'.length));
      }
      return response;
    },
  };
}

test('discovers a main-only npm repository and its gates', (context) => {
  const cwd = fixture(context, {
    name: 'consumer',
    scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'node --test', build: 'tsc' },
  });
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), '{}\n');
  const runner = gitRunner({
    'rev-parse --show-toplevel': `${cwd}\n`,
    'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main\n',
    'show-ref --verify --quiet refs/heads/staging': 'ERROR:not found',
    'show-ref --verify --quiet refs/remotes/origin/staging': 'ERROR:not found',
  });

  assert.deepEqual(
    setup.discoverProject({
      cwd,
      runner,
      runningPackageRoot: '/elsewhere/diffwright',
      runningVersion: '1.2.3',
    }),
    {
      manager: 'npm',
      defaultBranch: 'main',
      hasStaging: false,
      gates: ['lint', 'typecheck', 'test', 'build'],
      selfHosted: false,
    },
  );
});

test('recognizes the validated Diffwright checkout as self-hosted', (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: { build: 'tsc' },
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin/diffwright.js'), '#!/usr/bin/env node\n');
  const runner = gitRunner({
    'rev-parse --show-toplevel': `${cwd}\n`,
    'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main\n',
    'show-ref --verify --quiet refs/heads/staging': '',
  });

  assert.equal(
    setup.discoverProject({
      cwd,
      runner,
      runningPackageRoot: cwd,
      runningVersion: '1.2.3',
    }).selfHosted,
    true,
  );
});

test('falls back to main outside Git and detects master without origin HEAD', (context) => {
  const cwd = fixture(context, { name: 'consumer', scripts: {} });
  const noGit = gitRunner({});
  assert.equal(
    setup.discoverProject({
      cwd,
      runner: noGit,
      runningPackageRoot: '/elsewhere',
      runningVersion: '1.2.3',
    }).defaultBranch,
    'main',
  );

  const master = gitRunner({
    'rev-parse --show-toplevel': `${cwd}\n`,
    'symbolic-ref --short refs/remotes/origin/HEAD': 'ERROR:missing',
    'show-ref --verify --quiet refs/heads/main': 'ERROR:missing',
    'show-ref --verify --quiet refs/heads/master': '',
    'show-ref --verify --quiet refs/heads/staging': 'ERROR:missing',
    'show-ref --verify --quiet refs/remotes/origin/staging': 'ERROR:missing',
  });
  assert.equal(
    setup.discoverProject({
      cwd,
      runner: master,
      runningPackageRoot: '/elsewhere',
      runningVersion: '1.2.3',
    }).defaultBranch,
    'master',
  );
});

test('uses a remote-only origin main before the current feature branch', (context) => {
  const cwd = fixture(context, { name: 'consumer', scripts: {} });
  const runner = gitRunner({
    'rev-parse --show-toplevel': `${cwd}\n`,
    'symbolic-ref --short refs/remotes/origin/HEAD': 'ERROR:missing',
    'show-ref --verify --quiet refs/heads/main': 'ERROR:missing',
    'show-ref --verify --quiet refs/remotes/origin/main': '',
    'show-ref --verify --quiet refs/heads/staging': 'ERROR:missing',
    'show-ref --verify --quiet refs/remotes/origin/staging': 'ERROR:missing',
  });

  assert.equal(
    setup.discoverProject({
      cwd,
      runner,
      runningPackageRoot: '/elsewhere',
      runningVersion: '1.2.3',
    }).defaultBranch,
    'main',
  );
});

test('suggests only bounded high-confidence workspace, component, and history scopes', (context) => {
  const cwd = fixture(context, {
    name: 'consumer',
    scripts: {},
    workspaces: ['packages/*', 'apps/*'],
  } as ProjectManifest);
  for (const directory of ['packages/cli', 'packages/provider', 'apps/web', 'src/parser']) {
    fs.mkdirSync(path.join(cwd, directory), { recursive: true });
  }
  fs.mkdirSync(path.join(cwd, 'packages/.hidden'), { recursive: true });
  fs.symlinkSync(
    path.join(cwd, 'packages/cli'),
    path.join(cwd, 'packages/linked'),
  );
  const runner = gitRunner({
    'log -n 50 --format=%s':
      'feat(release): publish artifacts\nfix(cli): validate input\ninvalid subject\n',
  });

  assert.deepEqual(
    setup.discoverScopeSuggestions({ cwd, runner }),
    ['cli', 'parser', 'provider', 'release', 'web'],
  );
});

test('returns no scope suggestions for flat or unsafe project structure', (context) => {
  const cwd = fixture(context, {
    name: 'consumer',
    scripts: {},
    workspaces: ['../outside/*', '**/*', 'packages/nested/*'],
  } as ProjectManifest);
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'flat.ts'), 'export {};\n');

  assert.deepEqual(
    setup.discoverScopeSuggestions({ cwd, runner: gitRunner({}) }),
    [],
  );
});

test('builds gate-aware scripts for a main-only external project', () => {
  const manifest: ProjectManifest = {
    scripts: {
      lint: 'eslint .',
      test: 'node --test',
      commit: 'custom commit command',
    },
  };
  const plan = setup.buildScriptPlan({
    manifest,
    manager: 'npm',
    baseBranch: 'main',
    hasStaging: false,
    selectedGates: ['lint', 'test'],
    selfHosted: false,
  });

  assert.equal(plan.effective.commit, 'diffwright:commit');
  assert.equal(
    plan.scripts['diffwright:commit'],
    'npm run lint && npm run test && node ./node_modules/diffwright/bin/diffwright.js commit --all',
  );
  assert.equal(
    plan.scripts['feature:pr'],
    'node ./node_modules/diffwright/bin/diffwright.js pr --base main --create-pr --mode feature',
  );
  assert.equal(plan.effective.stagingPr, null);
  assert.equal(plan.scripts.commit, 'custom commit command');
});

test('builds explicit staging and self-hosted scripts', () => {
  const plan = setup.buildScriptPlan({
    manifest: { scripts: { build: 'tsc', commit: 'diffwright commit' } },
    manager: 'pnpm',
    baseBranch: 'staging',
    hasStaging: true,
    selectedGates: ['build'],
    selfHosted: true,
    mergeStrategy: 'squash',
  });

  assert.equal(
    plan.scripts.commit,
    'pnpm run build && node ./bin/diffwright.js commit --all',
  );
  assert.equal(
    plan.scripts['feature:pr'],
    'pnpm run build && node ./bin/diffwright.js pr --base staging --create-pr --mode feature',
  );
  assert.equal(
    plan.scripts['staging:pr'],
    'pnpm run build && node ./bin/diffwright.js pr --base main --create-pr --mode release',
  );
  assert.equal(
    plan.scripts['pr:merge'],
    'pnpm run build && node ./bin/diffwright.js merge',
  );
});

test('preserves custom merge scripts and removes only managed merge scripts', () => {
  const custom = setup.buildScriptPlan({
    manifest: { scripts: { 'pr:merge': 'custom merge command' } },
    manager: 'npm',
    baseBranch: 'main',
    hasStaging: false,
    selectedGates: [],
    selfHosted: false,
    mergeStrategy: 'platform',
  });
  assert.equal(custom.scripts['pr:merge'], 'custom merge command');
  assert.equal(custom.effective.merge, null);

  const managed = setup.buildScriptPlan({
    manifest: { scripts: { 'pr:merge': 'diffwright merge' } },
    manager: 'npm',
    baseBranch: 'main',
    hasStaging: false,
    selectedGates: [],
    selfHosted: false,
    mergeStrategy: 'platform',
  });
  assert.equal('pr:merge' in managed.scripts, false);
});

test('does not generate a release script when staging exists but is not selected', () => {
  const plan = setup.buildScriptPlan({
    manifest: {
      scripts: {
        'staging:pr': 'diffwright staging:pr',
      },
    },
    manager: 'npm',
    baseBranch: 'main',
    hasStaging: true,
    selectedGates: [],
    selfHosted: false,
  });

  assert.equal(plan.effective.stagingPr, null);
  assert.equal('staging:pr' in plan.scripts, false);
});

test('targets the detected release branch in a staging topology', () => {
  const plan = setup.buildScriptPlan({
    manifest: { scripts: {} },
    manager: 'npm',
    baseBranch: 'staging',
    releaseBranch: 'master',
    hasStaging: true,
    selectedGates: [],
    selfHosted: false,
  });

  assert.equal(
    plan.scripts['staging:pr'],
    'node ./node_modules/diffwright/bin/diffwright.js pr --base master --create-pr --mode release',
  );
});

test('Yarn scripts use the package-manager local executable resolver', () => {
  const plan = setup.buildScriptPlan({
    manifest: { scripts: {} },
    manager: 'yarn',
    baseBranch: 'main',
    hasStaging: false,
    selectedGates: [],
    selfHosted: false,
  });

  assert.equal(plan.scripts.commit, 'yarn exec -- diffwright commit --all');
  assert.equal(
    plan.scripts['feature:pr'],
    'yarn exec -- diffwright pr --base main --create-pr --mode feature',
  );
});

test('rejects unsafe branch text before embedding it in a script', () => {
  assert.throws(
    () => setup.buildScriptPlan({
      manifest: { scripts: {} },
      manager: 'npm',
      baseBranch: 'main; touch PWNED',
      hasStaging: false,
      selectedGates: [],
      selfHosted: false,
    }),
    /unsafe branch/i,
  );
});

test('migrates exact managed values and refuses a namespaced custom collision', () => {
  const migrated = setup.buildScriptPlan({
    manifest: {
      scripts: {
        commit: 'changescribe commit',
        'feature:pr': 'diffwright feature:pr',
        'staging:pr': 'diffwright staging:pr',
      },
    },
    manager: 'npm',
    baseBranch: 'main',
    hasStaging: false,
    selectedGates: [],
    selfHosted: false,
  });
  assert.equal(
    migrated.scripts.commit,
    'node ./node_modules/diffwright/bin/diffwright.js commit --all',
  );
  assert.equal(
    migrated.scripts['feature:pr'],
    'node ./node_modules/diffwright/bin/diffwright.js pr --base main --create-pr --mode feature',
  );
  assert.equal('staging:pr' in migrated.scripts, false);

  assert.throws(
    () => setup.buildScriptPlan({
      manifest: {
        scripts: {
          commit: 'custom',
          'diffwright:commit': 'another custom command',
        },
      },
      manager: 'npm',
      baseBranch: 'main',
      hasStaging: false,
      selectedGates: [],
      selfHosted: false,
    }),
    /diffwright:commit.*custom/i,
  );
});

test('updates strict previously generated gate and branch-aware script forms', () => {
  const plan = setup.buildScriptPlan({
    manifest: {
      scripts: {
        lint: 'eslint .',
        build: 'tsc',
        commit: 'npm run lint && diffwright commit',
        'feature:pr':
          'diffwright pr --base main --create-pr --yes --mode feature',
      },
    },
    manager: 'npm',
    baseBranch: 'staging',
    releaseBranch: 'main',
    hasStaging: true,
    selectedGates: ['build'],
    selfHosted: false,
  });

  assert.equal(plan.effective.commit, 'commit');
  assert.equal(
    plan.scripts.commit,
    'npm run build && node ./node_modules/diffwright/bin/diffwright.js commit --all',
  );
  assert.equal(
    plan.scripts['feature:pr'],
    'node ./node_modules/diffwright/bin/diffwright.js pr --base staging --create-pr --mode feature',
  );
});
