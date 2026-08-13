import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

interface RuntimeConfig {
  values: Readonly<NodeJS.ProcessEnv>;
  sources: Readonly<Record<string, 'shell' | '.env.local'>>;
}

interface RuntimeConfigModule {
  CREDENTIAL_ENV_NAMES: readonly string[];
  loadRuntimeConfig(options: {
    cwd: string;
    shellEnv: NodeJS.ProcessEnv;
  }): RuntimeConfig;
  sanitizeChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
}

const runtimeConfig: RuntimeConfigModule = require('../dist/runtime-config.js');

test('loads cwd-specific .env.local without mutating process.env', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-env-'));
  fs.writeFileSync(
    path.join(cwd, '.env.local'),
    'CEREBRAS_API_KEY=file-key\nDIFFWRIGHT_MODEL=file-model\n',
    'utf8',
  );
  const before = { ...process.env };

  const loaded = runtimeConfig.loadRuntimeConfig({ cwd, shellEnv: {} });

  assert.equal(loaded.values.CEREBRAS_API_KEY, 'file-key');
  assert.equal(loaded.values.DIFFWRIGHT_MODEL, 'file-model');
  assert.equal(loaded.sources.CEREBRAS_API_KEY, '.env.local');
  assert.deepEqual({ ...process.env }, before);
});

test('shell values, including explicitly empty values, override .env.local', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-env-'));
  fs.writeFileSync(
    path.join(cwd, '.env.local'),
    'OPENROUTER_API_KEY=file-key\nDIFFWRIGHT_MODEL=file-model\n',
    'utf8',
  );

  const loaded = runtimeConfig.loadRuntimeConfig({
    cwd,
    shellEnv: { OPENROUTER_API_KEY: '', DIFFWRIGHT_MODEL: 'shell-model' },
  });

  assert.equal(loaded.values.OPENROUTER_API_KEY, '');
  assert.equal(loaded.values.DIFFWRIGHT_MODEL, 'shell-model');
  assert.equal(loaded.sources.OPENROUTER_API_KEY, 'shell');
  assert.equal(loaded.sources.DIFFWRIGHT_MODEL, 'shell');
});

test('missing .env.local produces shell-only configuration', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-env-'));
  const loaded = runtimeConfig.loadRuntimeConfig({
    cwd,
    shellEnv: { GROQ_API_KEY: 'shell-key' },
  });

  assert.equal(loaded.values.GROQ_API_KEY, 'shell-key');
  assert.equal(loaded.sources.GROQ_API_KEY, 'shell');
});

test('sanitized child environments strip every provider secret and preserve unrelated values', () => {
  const input: NodeJS.ProcessEnv = { KEEP_ME: 'yes' };
  for (const name of runtimeConfig.CREDENTIAL_ENV_NAMES) {
    input[name] = `${name}-secret`;
  }

  const sanitized = runtimeConfig.sanitizeChildEnvironment(input);

  assert.notEqual(sanitized, input);
  assert.equal(sanitized.KEEP_ME, 'yes');
  for (const name of runtimeConfig.CREDENTIAL_ENV_NAMES) {
    assert.equal(name in sanitized, false, name);
    assert.equal(input[name], `${name}-secret`);
  }
});
