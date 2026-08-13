import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

interface CommandRunner {
  exec(file: string, args: readonly string[], options?: { cwd?: string }): string;
  spawn(
    file: string,
    args: readonly string[],
    options?: { cwd?: string; stdio?: 'pipe' | 'ignore' | 'inherit' },
  ): { status: number | null; stdout: string; stderr: string; error?: Error };
}

interface SubprocessModule {
  createCommandRunner(env: NodeJS.ProcessEnv): CommandRunner;
}

const subprocess: SubprocessModule = require('../dist/subprocess.js');
const repoRoot = path.resolve(__dirname, '..');

test('command runner strips credentials from child processes', () => {
  const runner = subprocess.createCommandRunner({
    PATH: process.env.PATH,
    KEEP_ME: 'visible',
    OPENAI_API_KEY: 'openai-secret',
    CEREBRAS_API_KEY: 'cerebras-secret',
    DIFFWRIGHT_API_KEY: 'custom-secret',
  });
  const output = runner.exec(process.execPath, [
    '-e',
    "process.stdout.write(JSON.stringify({keep:process.env.KEEP_ME,openai:process.env.OPENAI_API_KEY,cerebras:process.env.CEREBRAS_API_KEY,custom:process.env.DIFFWRIGHT_API_KEY}))",
  ]);

  assert.deepEqual(JSON.parse(output), { keep: 'visible' });
});

test('command runner strips credentials from spawned child processes', () => {
  const runner = subprocess.createCommandRunner({
    PATH: process.env.PATH,
    KEEP_ME: 'visible',
    VERCEL_OIDC_TOKEN: 'oidc-secret',
    GROQ_API_KEY: 'groq-secret',
  });
  const result = runner.spawn(process.execPath, [
    '-e',
    "process.stdout.write(JSON.stringify({keep:process.env.KEEP_ME,oidc:process.env.VERCEL_OIDC_TOKEN,groq:process.env.GROQ_API_KEY}))",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { keep: 'visible' });
});

test('subprocess module is the only application source importing child_process', () => {
  const offenders = fs
    .readdirSync(path.join(repoRoot, 'src'))
    .filter((filename) => filename.endsWith('.ts') && filename !== 'subprocess.ts')
    .filter((filename) =>
      fs
        .readFileSync(path.join(repoRoot, 'src', filename), 'utf8')
        .includes("node:child_process"),
    );

  assert.deepEqual(offenders, []);
});

test('the CLI is the only shipped command boundary', () => {
  const offenders = fs
    .readdirSync(path.join(repoRoot, 'src'))
    .filter((filename) => filename.endsWith('.ts') && filename !== 'cli.ts')
    .filter((filename) =>
      fs
        .readFileSync(path.join(repoRoot, 'src', filename), 'utf8')
        .includes('require.main'),
    );

  assert.deepEqual(offenders, []);
});
