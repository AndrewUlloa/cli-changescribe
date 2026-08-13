const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const bin = path.resolve(__dirname, '..', 'bin', 'diffwright.js');
const { runCommit } = require('../dist/commit.js');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function createRepository(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-security-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  git(directory, ['init', '--quiet', '--initial-branch=main']);
  git(directory, ['config', 'user.email', 'diffwright@example.test']);
  git(directory, ['config', 'user.name', 'Diffwright Test']);
  fs.writeFileSync(path.join(directory, 'README.md'), '# fixture\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'initial']);
  git(directory, ['switch', '--quiet', '-c', 'feature']);
  fs.appendFileSync(path.join(directory, 'README.md'), 'change\n');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'feature change']);
  return directory;
}

test('PR base refs are passed to Git without shell evaluation', (context) => {
  const directory = createRepository(context);
  const marker = path.join(directory, 'injected');
  const maliciousBase = `main;touch ${marker}`;

  const result = spawnSync(bin, ['pr', '--dry-run', '--base', maliciousBase], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, CEREBRAS_API_KEY: 'test-key' },
  });

  assert.notEqual(result.status, null, result.stderr);
  assert.equal(fs.existsSync(marker), false);
});

test('PR dry-run inspects a valid range without API calls or output writes', (context) => {
  const directory = createRepository(context);
  const output = path.join(directory, 'summary.md');
  const headBefore = git(directory, ['rev-parse', 'HEAD']).trim();

  const result = spawnSync(
    bin,
    ['pr', '--dry-run', '--base', 'main', '--out', output],
    {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, CEREBRAS_API_KEY: 'test-key' },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run \(no API calls\)/);
  assert.match(result.stdout, /Provider: cerebras/);
  assert.match(result.stdout, /Model: gpt-oss-120b/);
  assert.equal(fs.existsSync(output), false);
  assert.equal(git(directory, ['rev-parse', 'HEAD']).trim(), headBefore);
});

test('commit dry-run treats staged filenames as data and never commits', async (context) => {
  const directory = createRepository(context);
  const previousDirectory = process.cwd();
  context.after(() => process.chdir(previousDirectory));
  process.chdir(directory);

  const marker = path.join(directory, 'injected');
  const maliciousFilename = 'change$(touch${IFS}injected).ts';
  fs.writeFileSync(path.join(directory, maliciousFilename), 'export {};\n');
  git(directory, ['add', maliciousFilename]);
  const headBefore = git(directory, ['rev-parse', 'HEAD']).trim();
  let completionCalls = 0;
  const fakeClient = {
    chat: {
      completions: {
        create: async () => {
          completionCalls += 1;
          return {
            choices: [
              {
                message: {
                  content:
                    'fix: prevent unsafe command parsing\n\n' +
                    '- change: pass untrusted values as process arguments\n' +
                    '- why: prevent shell evaluation\n' +
                    '- risk: low',
                },
              },
            ],
          };
        },
      },
    },
  };

  await runCommit(['--dry-run'], {
    createClient: () => ({
      client: fakeClient,
      provider: 'cerebras',
      defaultModel: 'test-model',
    }),
  });

  assert.equal(completionCalls, 1);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(git(directory, ['rev-parse', 'HEAD']).trim(), headBefore);
  assert.match(git(directory, ['status', '--porcelain']), /change\$\(touch/);
});
