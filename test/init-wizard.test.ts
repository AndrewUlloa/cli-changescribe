import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

type SpawnResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  output: Array<string | null>;
  pid: number;
  stdout: string;
  stderr: string;
};

interface CommandRunner {
  exec(file: string, args: readonly string[], options?: { cwd?: string }): string;
  spawn(
    file: string,
    args: readonly string[],
    options?: { cwd?: string },
  ): SpawnResult;
}

interface Prompter {
  input(message: string, options?: { defaultValue?: string }): Promise<string>;
  select<T extends string>(
    message: string,
    choices: ReadonlyArray<{ value: T }>,
    options?: { defaultValue?: T },
  ): Promise<T>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  secret(message: string): Promise<string>;
  close(): void;
}

interface InitDependencies {
  cwd: string;
  inputIsTTY: boolean;
  outputIsTTY: boolean;
  env: NodeJS.ProcessEnv;
  runner: CommandRunner;
  prompter?: Prompter;
  runningPackageRoot: string;
  runningVersion: string;
  runDoctor(args: string[]): Promise<void>;
  runResolvedDoctor?(
    resolved: { readonly profile: { readonly baseURL: string } },
    live: boolean,
  ): Promise<void>;
  log(message: string): void;
  warn(message: string): void;
}

interface InitModule {
  runInit(argv?: string[], dependencies?: InitDependencies): Promise<void>;
}

const init: InitModule = require('../dist/init.js');

function fixture(
  context: test.TestContext,
  manifest: Record<string, unknown>,
): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-wizard-'));
  context.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return cwd;
}

function successfulSpawn(): SpawnResult {
  return {
    status: 0,
    signal: null,
    output: [null, '', ''],
    pid: 1,
    stdout: '',
    stderr: '',
  };
}

function gitRunner(options: {
  cwd: string;
  exec?: (file: string, args: readonly string[]) => string;
  trackingError?: boolean;
  hasStaging?: boolean;
  spawn?: (file: string, args: readonly string[]) => SpawnResult;
}): CommandRunner {
  return {
    exec(file, args) {
      if (file !== 'git') {
        if (options.exec) return options.exec(file, args);
        throw new Error(`Unexpected executable: ${file}`);
      }
      assert.equal(file, 'git');
      const command = args.join(' ');
      if (command === 'rev-parse --show-toplevel') return `${options.cwd}\n`;
      if (command === 'symbolic-ref --short refs/remotes/origin/HEAD') {
        return 'origin/main\n';
      }
      if (command === 'show-ref --verify --quiet refs/heads/staging') {
        if (options.hasStaging) return '';
        throw new Error('missing');
      }
      if (command === 'show-ref --verify --quiet refs/remotes/origin/staging') {
        throw new Error('missing');
      }
      if (command === 'ls-files -- .env.local') {
        if (options.trackingError) throw new Error('Git tracking check failed');
        return '';
      }
      if (command === 'check-ignore --no-index --quiet .env.local') return '';
      if (command === 'check-ref-format --branch main') return 'main\n';
      throw new Error(`Unexpected command: ${command}`);
    },
    spawn(file, args) {
      return options.spawn?.(file, args) ?? successfulSpawn();
    },
  };
}

class FakePrompter implements Prompter {
  closed = false;
  readonly inputDefaults: Array<string | undefined> = [];
  private confirmationIndex = 0;
  constructor(
    readonly inputs: string[],
    readonly selections: string[],
    readonly confirmations: boolean[],
    readonly secrets: string[] = [],
    readonly onConfirm?: (message: string, index: number) => void,
  ) {}

  async input(
    _message: string,
    options: { defaultValue?: string } = {},
  ): Promise<string> {
    this.inputDefaults.push(options.defaultValue);
    const answer = this.inputs.shift();
    assert.notEqual(answer, undefined, 'unexpected input prompt');
    return answer as string;
  }

  async select<T extends string>(): Promise<T> {
    const answer = this.selections.shift();
    assert.notEqual(answer, undefined, 'unexpected select prompt');
    return answer as T;
  }

  async confirm(message: string): Promise<boolean> {
    this.onConfirm?.(message, this.confirmationIndex);
    this.confirmationIndex += 1;
    const answer = this.confirmations.shift();
    assert.notEqual(answer, undefined, 'unexpected confirm prompt');
    return answer as boolean;
  }

  async secret(): Promise<string> {
    const answer = this.secrets.shift();
    assert.notEqual(answer, undefined, 'unexpected secret prompt');
    return answer as string;
  }

  close(): void {
    this.closed = true;
  }
}

test('--yes configures a validated self-host without a stale global or self-dependency', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: { test: 'node --test', build: 'tsc' },
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.env.local\n');
  const doctorCalls: string[][] = [];
  const output: string[] = [];

  await init.runInit(
    [
      '--yes',
      '--provider',
      'ollama',
      '--model',
      'llama3.2',
      '--base',
      'main',
      '--agents',
      'claude',
    ],
    {
      cwd,
      inputIsTTY: false,
      outputIsTTY: false,
      env: {},
      runner: gitRunner({ cwd }),
      runningPackageRoot: cwd,
      runningVersion: '1.2.3',
      runDoctor: async (args) => { doctorCalls.push(args); },
      log: (message) => output.push(message),
      warn: (message) => output.push(message),
    },
  );

  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  assert.equal(manifest.devDependencies, undefined);
  assert.equal(
    manifest.scripts.commit,
    'npm run test && npm run build && node ./bin/diffwright.js commit --all',
  );
  assert.equal(
    manifest.scripts['feature:pr'],
    'npm run build && node ./bin/diffwright.js pr --base main --create-pr --mode feature',
  );
  assert.equal(manifest.scripts['staging:pr'], undefined);
  assert.match(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8'), /npm run commit/);
  assert.match(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8'), /npm run feature:pr/);
  assert.match(
    fs.readFileSync(path.join(cwd, '.env.local'), 'utf8'),
    /DIFFWRIGHT_PROVIDER="ollama"/,
  );
  assert.deepEqual(doctorCalls, [[]]);
  assert.match(output.join('\n'), /Setup complete/);
});

test('--dry-run renders a redacted external install plan and writes nothing', async (context) => {
  const original = `${JSON.stringify({
    name: 'consumer',
    scripts: { test: 'node --test' },
  }, null, 2)}\n`;
  const cwd = fixture(context, JSON.parse(original));
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), '{}\n');
  const output: string[] = [];
  let spawnCount = 0;
  let doctorCount = 0;
  const secret = 'groq-super-secret-value';

  await init.runInit(
    [
      '--dry-run',
      '--provider',
      'groq',
      '--model',
      'openai/gpt-oss-120b',
      '--base',
      'main',
      '--agents',
      'codex',
      '--credential-source',
      'existing',
    ],
    {
      cwd,
      inputIsTTY: false,
      outputIsTTY: false,
      env: { GROQ_API_KEY: secret },
      runner: gitRunner({
        cwd,
        exec: (file, args) => {
          assert.equal(file, 'npm');
          assert.deepEqual(args, [
            'exec',
            '--offline',
            '--',
            'diffwright',
            '--version',
          ]);
          return '1.2.3\n';
        },
        spawn: () => {
          spawnCount += 1;
          return successfulSpawn();
        },
      }),
      runningPackageRoot: '/installed/diffwright',
      runningVersion: '1.2.3',
      runDoctor: async () => { doctorCount += 1; },
      log: (message) => output.push(message),
      warn: (message) => output.push(message),
    },
  );

  assert.equal(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(cwd, '.env.local')), false);
  assert.equal(fs.existsSync(path.join(cwd, 'AGENTS.md')), false);
  assert.equal(spawnCount, 0);
  assert.equal(doctorCount, 0);
  assert.match(output.join('\n'), /npm install .*diffwright@1\.2\.3/);
  assert.doesNotMatch(output.join('\n'), new RegExp(secret));
});

test('--yes pins and verifies the exact running package before writing external scripts', async (context) => {
  const cwd = fixture(context, {
    name: 'consumer',
    scripts: { test: 'node --test' },
  });
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.env.local\n');
  const secret = 'existing-groq-credential';
  const installs: Array<{ file: string; args: readonly string[] }> = [];
  const runner = gitRunner({
    cwd,
    exec: (file, args) => {
      assert.equal(file, process.execPath);
      assert.deepEqual(args, [
        path.join(cwd, 'node_modules', 'diffwright', 'bin', 'diffwright.js'),
        '--version',
      ]);
      return '1.2.3\n';
    },
    spawn: (file, args) => {
      installs.push({ file, args: [...args] });
      const manifestPath = path.join(cwd, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.devDependencies = { diffwright: '1.2.3' };
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
      fs.writeFileSync(
        path.join(installedRoot, 'bin', 'diffwright.js'),
        '#!/usr/bin/env node\n',
      );
      return successfulSpawn();
    },
  });
  let doctorCount = 0;

  await init.runInit(
    [
      '--yes',
      '--provider',
      'groq',
      '--model',
      'openai/gpt-oss-120b',
      '--credential-source',
      'existing',
    ],
    {
      cwd,
      inputIsTTY: false,
      outputIsTTY: false,
      env: { GROQ_API_KEY: secret },
      runner,
      runningPackageRoot: '/npx/cache/diffwright',
      runningVersion: '1.2.3',
      runDoctor: async () => { doctorCount += 1; },
      log: () => undefined,
      warn: () => undefined,
    },
  );

  assert.deepEqual(installs, [{
    file: 'npm',
    args: [
      'install',
      '--save-dev',
      '--save-exact',
      '--ignore-scripts',
      'diffwright@1.2.3',
    ],
  }]);
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  assert.equal(manifest.devDependencies.diffwright, '1.2.3');
  assert.equal(
    manifest.scripts.commit,
    'npm run test && node ./node_modules/diffwright/bin/diffwright.js commit --all',
  );
  assert.equal(doctorCount, 1);
});

test('post-install planning failure reports manifest and lockfile state accurately', async (context) => {
  const cwd = fixture(context, { name: 'consumer', scripts: {} });
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), '{}\n');
  const runner = gitRunner({
    cwd,
    exec: (file, args) => {
      assert.equal(file, process.execPath);
      assert.deepEqual(args, [
        path.join(cwd, 'node_modules', 'diffwright', 'bin', 'diffwright.js'),
        '--version',
      ]);
      return '1.2.3\n';
    },
    spawn: () => {
      const manifestPath = path.join(cwd, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.devDependencies = { diffwright: '1.2.3' };
      manifest.scripts.commit = 'concurrent custom command';
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
      fs.writeFileSync(
        path.join(installedRoot, 'bin', 'diffwright.js'),
        '#!/usr/bin/env node\n',
      );
      return successfulSpawn();
    },
  });

  await assert.rejects(
    init.runInit(
      ['--yes', '--provider', 'ollama', '--model', 'llama3.2'],
      {
        cwd,
        inputIsTTY: false,
        outputIsTTY: false,
        env: {},
        runner,
        runningPackageRoot: '/npx/cache/diffwright',
        runningVersion: '1.2.3',
        runDoctor: async () => undefined,
        log: () => undefined,
        warn: () => undefined,
      },
    ),
    /exact dependency install completed.*may have updated package\.json.*no Diffwright workflow transforms were applied/i,
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  assert.equal(manifest.devDependencies.diffwright, '1.2.3');
  assert.equal(manifest.scripts.commit, 'concurrent custom command');
  assert.equal(fs.existsSync(path.join(cwd, '.env.local')), false);
});

test('a package-bin symlink escaping within node_modules is rejected as provenance', async (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX symlink provenance fixture');
    return;
  }
  const cwd = fixture(context, {
    name: 'consumer',
    devDependencies: { diffwright: '1.2.3' },
    scripts: {},
  });
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), '{}\n');
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
  const escapedBin = path.join(cwd, 'node_modules', 'other-diffwright.js');
  fs.writeFileSync(escapedBin, '#!/usr/bin/env node\n');
  fs.symlinkSync(
    path.relative(path.join(installedRoot, 'bin'), escapedBin),
    path.join(installedRoot, 'bin', 'diffwright.js'),
  );
  const output: string[] = [];

  await init.runInit(
    ['--dry-run', '--provider', 'ollama', '--model', 'llama3.2'],
    {
      cwd,
      inputIsTTY: false,
      outputIsTTY: false,
      env: {},
      runner: gitRunner({ cwd }),
      runningPackageRoot: '/npx/cache/diffwright',
      runningVersion: '1.2.3',
      runDoctor: async () => undefined,
      log: (message) => output.push(message),
      warn: (message) => output.push(message),
    },
  );

  assert.match(output.join('\n'), /npm install .*diffwright@1\.2\.3/);
});

test('Yarn PnP verifies and generates the same delimiter-safe local command', async (context) => {
  const cwd = fixture(context, {
    name: 'consumer',
    packageManager: 'yarn@3.8.7',
    devDependencies: { diffwright: '1.2.3' },
    scripts: {},
  });
  fs.writeFileSync(path.join(cwd, 'yarn.lock'), '');
  fs.writeFileSync(path.join(cwd, '.pnp.cjs'), '// fixture map\n');
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.env.local\n');
  let spawnCount = 0;

  await init.runInit(
    ['--yes', '--provider', 'ollama', '--model', 'llama3.2'],
    {
      cwd,
      inputIsTTY: false,
      outputIsTTY: false,
      env: {},
      runner: gitRunner({
        cwd,
        exec: (file, args) => {
          assert.equal(file, 'yarn');
          assert.deepEqual(args, [
            'exec',
            '--',
            'diffwright',
            '--version',
          ]);
          return '1.2.3\n';
        },
        spawn: () => {
          spawnCount += 1;
          return successfulSpawn();
        },
      }),
      runningPackageRoot: '/npx/cache/diffwright',
      runningVersion: '1.2.3',
      runDoctor: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
    },
  );

  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts.commit, 'yarn exec -- diffwright commit --all');
  assert.equal(
    manifest.scripts['feature:pr'],
    'yarn exec -- diffwright pr --base main --create-pr --mode feature',
  );
  assert.equal(spawnCount, 0);
});

test('Yarn Classic dry-run previews the lifecycle-safe Yarn 1 install command', async (context) => {
  const cwd = fixture(context, {
    name: 'consumer',
    packageManager: 'yarn@1.22.22',
    scripts: {},
  });
  fs.writeFileSync(path.join(cwd, 'yarn.lock'), '');
  const output: string[] = [];

  await init.runInit(
    [
      '--dry-run',
      '--provider',
      'ollama',
      '--model',
      'llama3.2',
    ],
    {
      cwd,
      inputIsTTY: false,
      outputIsTTY: false,
      env: {},
      runner: gitRunner({ cwd }),
      runningPackageRoot: '/npx/cache/diffwright',
      runningVersion: '1.2.3',
      runDoctor: async () => undefined,
      log: (message) => output.push(message),
      warn: (message) => output.push(message),
    },
  );

  assert.match(
    output.join('\n'),
    /yarn add --dev --exact --ignore-scripts diffwright@1\.2\.3/,
  );
  assert.doesNotMatch(output.join('\n'), /mode=skip-build/);
});

test('refuses to install Diffwright into an unvalidated package named diffwright', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');

  await assert.rejects(
    init.runInit(
      ['--yes', '--provider', 'ollama', '--model', 'llama3.2'],
      {
        cwd,
        inputIsTTY: false,
        outputIsTTY: false,
        env: {},
        runner: gitRunner({ cwd }),
        runningPackageRoot: '/npx/cache/diffwright',
        runningVersion: '1.2.3',
        runDoctor: async () => undefined,
        log: () => undefined,
        warn: () => undefined,
      },
    ),
    /refusing to add a self-dependency/i,
  );
});

test('fails closed when Git cannot verify whether .env.local is tracked', async (context) => {
  const original = `${JSON.stringify({
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  }, null, 2)}\n`;
  const cwd = fixture(context, JSON.parse(original));
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');

  await assert.rejects(
    init.runInit(
      ['--yes', '--provider', 'ollama', '--model', 'llama3.2'],
      {
        cwd,
        inputIsTTY: false,
        outputIsTTY: false,
        env: {},
        runner: gitRunner({ cwd, trackingError: true }),
        runningPackageRoot: cwd,
        runningVersion: '1.2.3',
        runDoctor: async () => undefined,
        log: () => undefined,
        warn: () => undefined,
      },
    ),
    /unable to verify whether \.env\.local is tracked/i,
  );
  assert.equal(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'), original);
});

test('a staging branch does not add release workflow when main is selected', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.env.local\n');

  await init.runInit(
    [
      '--yes',
      '--provider',
      'ollama',
      '--model',
      'llama3.2',
      '--base',
      'main',
      '--agents',
      'claude',
    ],
    {
      cwd,
      inputIsTTY: false,
      outputIsTTY: false,
      env: {},
      runner: gitRunner({ cwd, hasStaging: true }),
      runningPackageRoot: cwd,
      runningVersion: '1.2.3',
      runDoctor: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
    },
  );

  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts['staging:pr'], undefined);
  assert.doesNotMatch(
    fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8'),
    /promote staging/i,
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8'),
    /repository has no staging branch/i,
  );
});

test('declining the interactive preview leaves the project byte-identical', async (context) => {
  const original = `${JSON.stringify({
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: { build: 'tsc' },
  }, null, 2)}\n`;
  const cwd = fixture(context, JSON.parse(original));
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  const prompter = new FakePrompter(
    ['llama3.2', 'main'],
    ['ollama', 'none'],
    [true, false],
  );

  await init.runInit([], {
    cwd,
    inputIsTTY: true,
    outputIsTTY: true,
    env: {},
    runner: gitRunner({ cwd }),
    prompter,
    runningPackageRoot: cwd,
    runningVersion: '1.2.3',
    runDoctor: async () => { assert.fail('doctor must not run after cancellation'); },
    log: () => undefined,
    warn: () => undefined,
  });

  assert.equal(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(cwd, '.env.local')), false);
  assert.equal(prompter.closed, true);
});

test('interactive credential setup writes mode 0600 and never includes the key in output', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: { build: 'tsc' },
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.env.local\n');
  const secret = 'not-visible-in-preview-or-errors';
  const prompter = new FakePrompter(
    ['openai/test-model', 'main'],
    ['groq', 'file', 'both'],
    [true, true, false],
    [secret],
  );
  const output: string[] = [];
  let doctorCount = 0;

  await init.runInit([], {
    cwd,
    inputIsTTY: true,
    outputIsTTY: true,
    env: {},
    runner: gitRunner({ cwd }),
    prompter,
    runningPackageRoot: cwd,
    runningVersion: '1.2.3',
    runDoctor: async () => { doctorCount += 1; },
    log: (message) => output.push(message),
    warn: (message) => output.push(message),
  });

  const envPath = path.join(cwd, '.env.local');
  assert.match(fs.readFileSync(envPath, 'utf8'), /GROQ_API_KEY=/);
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(cwd, 'CLAUDE.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'AGENTS.md')), true);
  assert.match(
    fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8'),
    /^# Claude Instructions\n\n<!-- diffwright:workflow:start -->/,
  );
  assert.match(
    fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8'),
    /^# Codex Agent Instructions\n\n<!-- diffwright:workflow:start -->/,
  );
  assert.doesNotMatch(output.join('\n'), new RegExp(secret));
  assert.equal(doctorCount, 1);
});

test('headless setup preserves a valid legacy Groq model override', async (context) => {
  const cwd = fixture(context, { name: 'consumer', scripts: {} });
  const original = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8');
  const output: string[] = [];

  await init.runInit(['--dry-run'], {
    cwd,
    inputIsTTY: false,
    outputIsTTY: false,
    env: {
      GROQ_API_KEY: 'legacy-secret',
      GROQ_MODEL: 'legacy/groq-model',
    },
    runner: gitRunner({ cwd }),
    runningPackageRoot: '/npx/cache/diffwright',
    runningVersion: '1.2.3',
    runDoctor: async () => undefined,
    log: (message) => output.push(message),
    warn: (message) => output.push(message),
  });

  assert.match(output.join('\n'), /Model: legacy\/groq-model/);
  assert.equal(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'), original);
});

test('switching providers does not reuse the previous provider model', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  const prompter = new FakePrompter(
    ['openai/new-model', 'main'],
    ['openai', 'later', 'none'],
    [false],
  );

  await init.runInit([], {
    cwd,
    inputIsTTY: true,
    outputIsTTY: true,
    env: {
      GROQ_API_KEY: 'existing-groq-secret',
      GROQ_MODEL: 'groq/old-model',
    },
    runner: gitRunner({ cwd }),
    prompter,
    runningPackageRoot: cwd,
    runningVersion: '1.2.3',
    runDoctor: async () => undefined,
    log: () => undefined,
    warn: () => undefined,
  });

  assert.equal(prompter.inputDefaults[0], undefined);
  assert.notEqual(prompter.inputDefaults[0], 'groq/old-model');
});

test('an agent-file edit after preview is preserved instead of overwritten', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.env.local\n');
  const claudePath = path.join(cwd, 'CLAUDE.md');
  const prompter = new FakePrompter(
    ['llama3.2', 'main'],
    ['ollama', 'claude'],
    [true, false],
    [],
    (message) => {
      if (message === 'Apply this setup?') {
        fs.writeFileSync(claudePath, '# Concurrent user instructions\n');
      }
    },
  );

  await init.runInit([], {
    cwd,
    inputIsTTY: true,
    outputIsTTY: true,
    env: {},
    runner: gitRunner({ cwd }),
    prompter,
    runningPackageRoot: cwd,
    runningVersion: '1.2.3',
    runDoctor: async () => undefined,
    log: () => undefined,
    warn: () => undefined,
  });

  const contents = fs.readFileSync(claudePath, 'utf8');
  assert.match(contents, /^# Concurrent user instructions\n/);
  assert.match(contents, /<!-- diffwright:workflow:start -->/);
});

test('a wildcard negation is followed by a final project-local env ignore rule', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.env.local\n!*.local\n');

  await init.runInit(
    ['--yes', '--provider', 'ollama', '--model', 'llama3.2'],
    {
      cwd,
      inputIsTTY: false,
      outputIsTTY: false,
      env: {},
      runner: gitRunner({ cwd }),
      runningPackageRoot: cwd,
      runningVersion: '1.2.3',
      runDoctor: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
    },
  );

  assert.match(
    fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8'),
    /!\*\.local\n\.env\.local\n$/,
  );
});

test('unrelated rules after .env.local do not cause a duplicate ignore entry', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  const ignorePath = path.join(cwd, '.gitignore');
  const originalIgnore = '.env.local\n.DS_Store\n';
  fs.writeFileSync(ignorePath, originalIgnore);

  await init.runInit(
    ['--yes', '--provider', 'ollama', '--model', 'llama3.2'],
    {
      cwd,
      inputIsTTY: false,
      outputIsTTY: false,
      env: {},
      runner: gitRunner({ cwd }),
      runningPackageRoot: cwd,
      runningVersion: '1.2.3',
      runDoctor: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
    },
  );

  assert.equal(fs.readFileSync(ignorePath, 'utf8'), originalIgnore);
});

test('a no-Git wildcard negation added after preview cannot expose .env.local', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  const ignorePath = path.join(cwd, '.gitignore');
  fs.writeFileSync(ignorePath, '.env.local\n');
  const prompter = new FakePrompter(
    ['llama3.2', 'main'],
    ['ollama', 'none'],
    [true, false],
    [],
    (message) => {
      if (message === 'Apply this setup?') {
        fs.appendFileSync(ignorePath, '!*.local\n');
      }
    },
  );
  const noGitRunner: CommandRunner = {
    exec() {
      throw new Error('not a Git repository');
    },
    spawn() {
      return successfulSpawn();
    },
  };

  await init.runInit([], {
    cwd,
    inputIsTTY: true,
    outputIsTTY: true,
    env: {},
    runner: noGitRunner,
    prompter,
    runningPackageRoot: cwd,
    runningVersion: '1.2.3',
    runDoctor: async () => undefined,
    log: () => undefined,
    warn: () => undefined,
  });

  assert.match(
    fs.readFileSync(ignorePath, 'utf8'),
    /!\*\.local\n\.env\.local\n$/,
  );
  assert.equal(fs.existsSync(path.join(cwd, '.env.local')), true);
});

test('shell configuration conflicts stop before preview consent or writes', async (context) => {
  const original = `${JSON.stringify({
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  }, null, 2)}\n`;
  const cwd = fixture(context, JSON.parse(original));
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');

  await assert.rejects(
    init.runInit(
      ['--yes', '--provider', 'ollama', '--model', 'llama3.2'],
      {
        cwd,
        inputIsTTY: false,
        outputIsTTY: false,
        env: {
          DIFFWRIGHT_PROVIDER: 'groq',
          DIFFWRIGHT_MODEL: 'groq/old-model',
        },
        runner: gitRunner({ cwd }),
        runningPackageRoot: cwd,
        runningVersion: '1.2.3',
        runDoctor: async () => undefined,
        log: () => undefined,
        warn: () => undefined,
      },
    ),
    /Shell DIFFWRIGHT_PROVIDER, DIFFWRIGHT_MODEL overrides.*no files were changed/i,
  );
  assert.equal(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(cwd, '.env.local')), false);
});

test('configure later applies nonsecret setup but reports that setup is incomplete', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  const prompter = new FakePrompter(
    ['openai/test-model', 'main'],
    ['openai', 'later', 'none'],
    [true],
  );
  const output: string[] = [];

  await init.runInit([], {
    cwd,
    inputIsTTY: true,
    outputIsTTY: true,
    env: {},
    runner: gitRunner({ cwd }),
    prompter,
    runningPackageRoot: cwd,
    runningVersion: '1.2.3',
    runDoctor: async () => { assert.fail('doctor must wait for a credential'); },
    log: (message) => output.push(message),
    warn: (message) => output.push(message),
  });

  const environment = fs.readFileSync(path.join(cwd, '.env.local'), 'utf8');
  assert.match(environment, /DIFFWRIGHT_PROVIDER="openai"/);
  assert.doesNotMatch(environment, /OPENAI_API_KEY/);
  assert.match(output.join('\n'), /not ready until the credential and offline doctor succeed/i);
  assert.doesNotMatch(output.join('\n'), /Setup complete/);
});

test('offline doctor failure reports that setup files were already applied', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');

  await assert.rejects(
    init.runInit(
      ['--yes', '--provider', 'ollama', '--model', 'llama3.2'],
      {
        cwd,
        inputIsTTY: false,
        outputIsTTY: false,
        env: {},
        runner: gitRunner({ cwd }),
        runningPackageRoot: cwd,
        runningVersion: '1.2.3',
        runDoctor: async () => { throw new Error('offline fixture failure'); },
        log: () => undefined,
        warn: () => undefined,
      },
    ),
    /Setup files were applied, but offline doctor failed: offline fixture failure/,
  );
  assert.equal(fs.existsSync(path.join(cwd, '.env.local')), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  assert.equal(typeof manifest.scripts.commit, 'string');
});

test('--live stays interactive and reports a post-offline live failure distinctly', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  const prompter = new FakePrompter(
    ['llama3.2', 'main'],
    ['ollama', 'none'],
    [true],
  );
  const doctorCalls: string[][] = [];

  await assert.rejects(
    init.runInit(['--live'], {
      cwd,
      inputIsTTY: true,
      outputIsTTY: true,
      env: {},
      runner: gitRunner({ cwd }),
      prompter,
      runningPackageRoot: cwd,
      runningVersion: '1.2.3',
      runDoctor: async (args) => {
        doctorCalls.push(args);
        if (args.includes('--live')) throw new Error('live fixture failure');
      },
      log: () => undefined,
      warn: () => undefined,
    }),
    /Setup files were applied and offline doctor passed, but live doctor failed: live fixture failure/,
  );
  assert.deepEqual(doctorCalls, [[], ['--live']]);
  assert.equal(prompter.closed, true);
});

test('offline and live doctor reuse the exact provider destination that received consent', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.env.local\n');
  const prompter = new FakePrompter(
    ['custom/model', 'https://api.example.com/v1', 'main'],
    ['custom', 'file', 'none'],
    [true, true],
    ['custom-provider-secret'],
  );
  const resolvedCalls: Array<{
    resolved: { readonly profile: { readonly baseURL: string } };
    live: boolean;
  }> = [];

  await init.runInit([], {
    cwd,
    inputIsTTY: true,
    outputIsTTY: true,
    env: {},
    runner: gitRunner({ cwd }),
    prompter,
    runningPackageRoot: cwd,
    runningVersion: '1.2.3',
    runDoctor: async () => undefined,
    runResolvedDoctor: async (resolved, live) => {
      resolvedCalls.push({ resolved, live });
      if (!live) {
        fs.writeFileSync(
          path.join(cwd, '.env.local'),
          'DIFFWRIGHT_PROVIDER="custom"\n' +
            'DIFFWRIGHT_MODEL="custom/model"\n' +
            'DIFFWRIGHT_BASE_URL="https://evil.example/v1"\n' +
            'DIFFWRIGHT_API_KEY="custom-provider-secret"\n',
        );
      }
    },
    log: () => undefined,
    warn: () => undefined,
  });

  assert.equal(resolvedCalls.length, 2);
  assert.strictEqual(resolvedCalls[0]?.resolved, resolvedCalls[1]?.resolved);
  assert.equal(resolvedCalls[0]?.resolved.profile.baseURL, 'https://api.example.com/v1');
  assert.deepEqual(resolvedCalls.map(({ live }) => live), [false, true]);
});

test('a second identical setup run preserves content and mtimes', async (context) => {
  const cwd = fixture(context, {
    name: 'diffwright',
    version: '1.2.3',
    bin: { diffwright: 'bin/diffwright.js' },
    scripts: {},
  });
  fs.mkdirSync(path.join(cwd, 'bin'));
  fs.writeFileSync(path.join(cwd, 'bin', 'diffwright.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.env.local\n');
  const dependencies: InitDependencies = {
    cwd,
    inputIsTTY: false,
    outputIsTTY: false,
    env: {},
    runner: gitRunner({ cwd }),
    runningPackageRoot: cwd,
    runningVersion: '1.2.3',
    runDoctor: async () => undefined,
    log: () => undefined,
    warn: () => undefined,
  };
  const argv = [
    '--yes',
    '--provider',
    'ollama',
    '--model',
    'llama3.2',
    '--agents',
    'claude',
  ];

  await init.runInit(argv, dependencies);
  const targets = ['package.json', '.gitignore', '.env.local', 'CLAUDE.md']
    .map((name) => path.join(cwd, name));
  const first = targets.map((filename) => ({
    contents: fs.readFileSync(filename, 'utf8'),
    mtimeNs: fs.statSync(filename, { bigint: true }).mtimeNs,
  }));

  await init.runInit(argv, dependencies);

  for (const [index, filename] of targets.entries()) {
    assert.equal(fs.readFileSync(filename, 'utf8'), first[index]?.contents);
    assert.equal(
      fs.statSync(filename, { bigint: true }).mtimeNs,
      first[index]?.mtimeNs,
    );
  }
});
