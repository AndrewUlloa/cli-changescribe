import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

type SetupFileKind =
  | 'package-json'
  | 'environment'
  | 'repository-policy'
  | 'agent-document';

interface SemanticMutation {
  readonly kind:
    | 'package-script'
    | 'environment'
    | 'repository-policy'
    | 'managed-block';
  readonly action: 'added' | 'updated' | 'removed';
  readonly name: string;
  readonly value?: string;
}

interface TransformResult {
  readonly contents: string;
  readonly changed: boolean;
  readonly mutations: readonly SemanticMutation[];
}

interface EnvSafetyChecks {
  isTracked(absolutePath: string): boolean;
  isIgnored(absolutePath: string): boolean;
}

interface SetupFilePlan extends TransformResult {
  readonly path: string;
  readonly kind: SetupFileKind;
  readonly expectedHash: string | null;
  readonly expectedMode: number | null;
  readonly mode: number;
}

interface SetupFilesModule {
  MANAGED_BLOCK_START: string;
  MANAGED_BLOCK_END: string;
  transformPackageJsonScripts(
    contents: string,
    replacements: Readonly<Record<string, string | null>>,
  ): TransformResult;
  transformEnvLocal(
    contents: string,
    updates: Readonly<Record<string, string>>,
  ): TransformResult;
  transformRepositoryPolicy(
    contents: string,
    preferences: {
      scopeMode: 'optional' | 'forbidden';
      allowedScopes?: readonly string[];
      issueContext: 'optional' | 'recommended' | 'required';
      template: 'create' | 'preserve';
      mergeStrategy: 'squash' | 'platform';
      deleteBranch: boolean;
    },
  ): TransformResult;
  transformManagedDocument(contents: string, body: string): TransformResult;
  planSetupFile(options: {
    path: string;
    kind: SetupFileKind;
    transform(contents: string): TransformResult;
    envSafety?: EnvSafetyChecks;
    root?: string;
    createParent?: boolean;
  }): SetupFilePlan;
  applySetupFile(
    plan: SetupFilePlan,
    options?: { envSafety?: EnvSafetyChecks },
  ): void;
}

const setupFiles: SetupFilesModule = require('../dist/setup-files.js');

function temporaryDirectory(context: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-setup-files-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const safeEnv: EnvSafetyChecks = {
  isTracked: () => false,
  isIgnored: () => true,
};

test('package script transform replaces owned scripts and preserves unrelated keys', () => {
  const source = [
    '{',
    '  "name": "fixture",',
    '  "private": true,',
    '  "scripts": {',
    '    "lint": "eslint .",',
    '    "commit": "changescribe commit",',
    '    "staging:pr": "changescribe staging:pr"',
    '  },',
    '  "custom": { "keep": true }',
    '}',
    '',
  ].join('\r\n');

  const result = setupFiles.transformPackageJsonScripts(source, {
    commit: 'npm test && diffwright commit',
    'feature:pr': 'diffwright pr --base main --create-pr --mode feature',
    'staging:pr': null,
  });

  const parsed = JSON.parse(result.contents);
  assert.equal(parsed.name, 'fixture');
  assert.equal(parsed.private, true);
  assert.deepEqual(parsed.custom, { keep: true });
  assert.deepEqual(parsed.scripts, {
    lint: 'eslint .',
    commit: 'npm test && diffwright commit',
    'feature:pr': 'diffwright pr --base main --create-pr --mode feature',
  });
  assert.match(result.contents, /\r\n/);
  assert.equal(result.contents.endsWith('\r\n'), true);
  assert.deepEqual(result.mutations, [
    {
      kind: 'package-script',
      action: 'updated',
      name: 'commit',
      value: 'npm test && diffwright commit',
    },
    {
      kind: 'package-script',
      action: 'added',
      name: 'feature:pr',
      value: 'diffwright pr --base main --create-pr --mode feature',
    },
    {
      kind: 'package-script',
      action: 'removed',
      name: 'staging:pr',
    },
  ]);
});

test('package script transform is byte-stable when replacements are already present', () => {
  const source = '{\n\t"name": "fixture",\n\t"scripts": { "commit": "diffwright commit" }\n}';
  const result = setupFiles.transformPackageJsonScripts(source, {
    commit: 'diffwright commit',
    missing: null,
  });

  assert.equal(result.changed, false);
  assert.equal(result.contents, source);
  assert.deepEqual(result.mutations, []);
});

test('package script transform rejects malformed manifests, scripts, and replacement names', () => {
  assert.throws(
    () => setupFiles.transformPackageJsonScripts('[]\n', { commit: 'x' }),
    /JSON object/i,
  );
  assert.throws(
    () =>
      setupFiles.transformPackageJsonScripts(
        '{"scripts":"not-an-object"}\n',
        { commit: 'x' },
      ),
    /scripts.*object/i,
  );
  assert.throws(
    () => setupFiles.transformPackageJsonScripts('{}\n', { 'bad\nname': 'x' }),
    /script name/i,
  );
});

test('environment transform upserts target keys while preserving unrelated bytes and EOL', () => {
  const secret = 'sk-private-value';
  const source = '# keep this comment\r\nUNRELATED=value # keep inline\r\nDIFFWRIGHT_MODEL=old\r\n';
  const result = setupFiles.transformEnvLocal(source, {
    DIFFWRIGHT_PROVIDER: 'openai',
    DIFFWRIGHT_MODEL: 'gpt-5.4',
    OPENAI_API_KEY: secret,
  });

  assert.equal(
    result.contents,
    '# keep this comment\r\nUNRELATED=value # keep inline\r\nDIFFWRIGHT_MODEL="gpt-5.4"\r\n' +
      'DIFFWRIGHT_PROVIDER="openai"\r\nOPENAI_API_KEY="sk-private-value"\r\n',
  );
  assert.equal(result.changed, true);
  assert.deepEqual(result.mutations, [
    {
      kind: 'environment',
      action: 'added',
      name: 'DIFFWRIGHT_PROVIDER',
      value: '[hidden]',
    },
    {
      kind: 'environment',
      action: 'updated',
      name: 'DIFFWRIGHT_MODEL',
      value: '[hidden]',
    },
    {
      kind: 'environment',
      action: 'added',
      name: 'OPENAI_API_KEY',
      value: '[hidden]',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result.mutations), new RegExp(secret));
});

test('environment transform rejects duplicate target keys and invalid input values', () => {
  assert.throws(
    () =>
      setupFiles.transformEnvLocal(
        'DIFFWRIGHT_MODEL=one\nexport DIFFWRIGHT_MODEL=two\n',
        { DIFFWRIGHT_MODEL: 'three' },
      ),
    /duplicate.*DIFFWRIGHT_MODEL/i,
  );
  assert.throws(
    () => setupFiles.transformEnvLocal('', { 'BAD-KEY': 'value' }),
    /environment variable name/i,
  );
  assert.throws(
    () => setupFiles.transformEnvLocal('', { SAFE_KEY: 'line\nbreak' }),
    /SAFE_KEY.*control|SAFE_KEY.*newline/i,
  );
  assert.throws(
    () => setupFiles.transformEnvLocal('', { SAFE_KEY: 'nul\0byte' }),
    /SAFE_KEY.*control/i,
  );
  assert.throws(
    () => setupFiles.transformEnvLocal('', { SAFE_KEY: 'unsafe"quote' }),
    /SAFE_KEY.*quote|SAFE_KEY.*backslash/i,
  );
  assert.throws(
    () => setupFiles.transformEnvLocal('', { SAFE_KEY: 'unsafe\\slash' }),
    /SAFE_KEY.*quote|SAFE_KEY.*backslash/i,
  );
});

test('environment transform is byte-stable for canonical existing values', () => {
  const source = 'DIFFWRIGHT_PROVIDER="ollama"\n';
  const result = setupFiles.transformEnvLocal(source, {
    DIFFWRIGHT_PROVIDER: 'ollama',
  });

  assert.equal(result.changed, false);
  assert.equal(result.contents, source);
  assert.deepEqual(result.mutations, []);
});

test('creates, migrates, and idempotently preserves repository policy v2', () => {
  const preferences = {
    scopeMode: 'optional' as const,
    allowedScopes: ['cli', 'release'],
    issueContext: 'recommended' as const,
    template: 'create' as const,
    mergeStrategy: 'squash' as const,
    deleteBranch: false,
  };
  const created = setupFiles.transformRepositoryPolicy('', preferences);
  assert.equal(created.changed, true);
  assert.equal(created.mutations[0]?.action, 'added');
  assert.deepEqual(JSON.parse(created.contents), {
    $schema:
      'https://raw.githubusercontent.com/AndrewUlloa/diffwright/main/documentation/diffwrightrc.schema.json',
    version: 2,
    title: {
      scopeMode: 'optional',
      allowedScopes: ['cli', 'release'],
    },
    pullRequest: {
      issueContext: 'recommended',
      template: 'create',
    },
    merge: {
      strategy: 'squash',
      deleteBranch: false,
    },
  });

  const legacy = `${JSON.stringify({
    version: 1,
    title: { additionalTypes: ['security'], scopeMode: 'forbidden' },
    editorial: { maxSentenceWords: 20 },
  }, null, 2)}\n`;
  const migrated = setupFiles.transformRepositoryPolicy(legacy, preferences);
  const parsed = JSON.parse(migrated.contents);
  assert.equal(parsed.version, 2);
  assert.deepEqual(parsed.title.additionalTypes, ['security']);
  assert.equal(parsed.editorial.maxSentenceWords, 20);
  assert.match(migrated.mutations[0]?.name ?? '', /v1 -> v2/);

  const repeated = setupFiles.transformRepositoryPolicy(
    migrated.contents,
    preferences,
  );
  assert.equal(repeated.changed, false);
  assert.equal(repeated.contents, migrated.contents);
});

test('repository policy transform rejects unsafe preferences and malformed input', () => {
  assert.throws(
    () => setupFiles.transformRepositoryPolicy(
      '{"version":1,"version":2}',
      {
        scopeMode: 'optional',
        issueContext: 'optional',
        template: 'preserve',
        mergeStrategy: 'platform',
        deleteBranch: false,
      },
    ),
    /duplicate/i,
  );
  assert.throws(
    () => setupFiles.transformRepositoryPolicy('', {
      scopeMode: 'optional',
      issueContext: 'optional',
      template: 'preserve',
      mergeStrategy: 'platform',
      deleteBranch: true,
    }),
    /platform-managed/i,
  );
});

test('managed document transform adds and replaces one marker block without touching outside bytes', () => {
  const added = setupFiles.transformManagedDocument('Human content\r\n', '## Git Workflow\nUse Diffwright.');
  const expectedBlock =
    `${setupFiles.MANAGED_BLOCK_START}\r\n` +
    '## Git Workflow\r\nUse Diffwright.\r\n' +
    `${setupFiles.MANAGED_BLOCK_END}\r\n`;
  assert.equal(added.contents, `Human content\r\n\r\n${expectedBlock}`);
  assert.deepEqual(added.mutations, [
    {
      kind: 'managed-block',
      action: 'added',
      name: 'Diffwright workflow',
    },
  ]);

  const prefix = 'Before\n\n';
  const suffix = '\n\nAfter without final newline';
  const original =
    prefix +
    setupFiles.MANAGED_BLOCK_START +
    '\nold managed bytes\n' +
    setupFiles.MANAGED_BLOCK_END +
    suffix;
  const replaced = setupFiles.transformManagedDocument(original, 'new managed bytes');

  assert.equal(
    replaced.contents,
    prefix +
      setupFiles.MANAGED_BLOCK_START +
      '\nnew managed bytes\n' +
      setupFiles.MANAGED_BLOCK_END +
      suffix,
  );
  assert.equal(replaced.contents.startsWith(prefix), true);
  assert.equal(replaced.contents.endsWith(suffix), true);
  assert.deepEqual(replaced.mutations, [
    {
      kind: 'managed-block',
      action: 'updated',
      name: 'Diffwright workflow',
    },
  ]);
});

test('managed document transform rejects malformed, duplicate, or injected markers', () => {
  const start = setupFiles.MANAGED_BLOCK_START;
  const end = setupFiles.MANAGED_BLOCK_END;
  for (const source of [start, end, `${start}\nx\n${start}\ny\n${end}`, `${end}\n${start}`]) {
    assert.throws(
      () => setupFiles.transformManagedDocument(source, 'body'),
      /managed.*marker/i,
      source,
    );
  }
  assert.throws(
    () => setupFiles.transformManagedDocument('', `body\n${start}`),
    /must not contain.*marker/i,
  );
});

test('planning and applying rechecks hashes, preserves modes, and skips unchanged files', (context) => {
  const directory = temporaryDirectory(context);
  const packagePath = path.join(directory, 'package.json');
  fs.writeFileSync(packagePath, '{"scripts":{}}\n', { mode: 0o640 });
  fs.chmodSync(packagePath, 0o640);

  const plan = setupFiles.planSetupFile({
    path: packagePath,
    kind: 'package-json',
    transform: (contents) =>
      setupFiles.transformPackageJsonScripts(contents, {
        commit: 'diffwright commit',
      }),
  });
  const beforeInode = fs.statSync(packagePath).ino;
  setupFiles.applySetupFile(plan);
  assert.equal(JSON.parse(fs.readFileSync(packagePath, 'utf8')).scripts.commit, 'diffwright commit');
  assert.equal(fs.statSync(packagePath).mode & 0o777, 0o640);
  assert.notEqual(fs.statSync(packagePath).ino, beforeInode);

  const unchanged = setupFiles.planSetupFile({
    path: packagePath,
    kind: 'package-json',
    transform: (contents) =>
      setupFiles.transformPackageJsonScripts(contents, {
        commit: 'diffwright commit',
      }),
  });
  const unchangedInode = fs.statSync(packagePath).ino;
  setupFiles.applySetupFile(unchanged);
  assert.equal(unchanged.changed, false);
  assert.equal(fs.statSync(packagePath).ino, unchangedInode);

  const stale = setupFiles.planSetupFile({
    path: packagePath,
    kind: 'package-json',
    transform: (contents) =>
      setupFiles.transformPackageJsonScripts(contents, { next: 'value' }),
  });
  fs.writeFileSync(packagePath, '{"newer":true}\n');
  assert.throws(() => setupFiles.applySetupFile(stale), /changed since.*planned/i);
  assert.equal(fs.readFileSync(packagePath, 'utf8'), '{"newer":true}\n');
});

test('new environment and agent files receive restrictive/default modes', (context) => {
  const directory = temporaryDirectory(context);
  const envPath = path.join(directory, '.env.local');
  const agentPath = path.join(directory, 'AGENTS.md');

  const envPlan = setupFiles.planSetupFile({
    path: envPath,
    kind: 'environment',
    envSafety: safeEnv,
    transform: (contents) =>
      setupFiles.transformEnvLocal(contents, { OPENAI_API_KEY: 'private' }),
  });
  assert.doesNotMatch(JSON.stringify(envPlan.mutations), /private/);
  setupFiles.applySetupFile(envPlan, { envSafety: safeEnv });
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);

  const agentPlan = setupFiles.planSetupFile({
    path: agentPath,
    kind: 'agent-document',
    transform: (contents) =>
      setupFiles.transformManagedDocument(contents, 'Use Diffwright.'),
  });
  setupFiles.applySetupFile(agentPlan);
  assert.equal(fs.statSync(agentPath).mode & 0o777, 0o644);
});

test('planning rejects symlink, hardlink, special, tracked, and unignored targets', (context) => {
  const directory = temporaryDirectory(context);
  const sourcePath = path.join(directory, 'source');
  fs.writeFileSync(sourcePath, 'source');

  const symlinkPath = path.join(directory, 'link');
  fs.symlinkSync(sourcePath, symlinkPath);
  assert.throws(
    () =>
      setupFiles.planSetupFile({
        path: symlinkPath,
        kind: 'agent-document',
        transform: (contents) => setupFiles.transformManagedDocument(contents, 'body'),
      }),
    /symbolic link/i,
  );

  const hardlinkPath = path.join(directory, 'hardlink');
  fs.linkSync(sourcePath, hardlinkPath);
  assert.throws(
    () =>
      setupFiles.planSetupFile({
        path: hardlinkPath,
        kind: 'agent-document',
        transform: (contents) => setupFiles.transformManagedDocument(contents, 'body'),
      }),
    /hard link/i,
  );

  const directoryTarget = path.join(directory, 'directory-target');
  fs.mkdirSync(directoryTarget);
  assert.throws(
    () =>
      setupFiles.planSetupFile({
        path: directoryTarget,
        kind: 'agent-document',
        transform: (contents) => setupFiles.transformManagedDocument(contents, 'body'),
      }),
    /regular file/i,
  );

  const invalidUtf8Path = path.join(directory, 'invalid-utf8');
  fs.writeFileSync(invalidUtf8Path, Buffer.from([0xff, 0xfe]));
  assert.throws(
    () =>
      setupFiles.planSetupFile({
        path: invalidUtf8Path,
        kind: 'agent-document',
        transform: (contents) => setupFiles.transformManagedDocument(contents, 'body'),
      }),
    /UTF-8/i,
  );

  const envPath = path.join(directory, '.env.local');
  assert.throws(
    () =>
      setupFiles.planSetupFile({
        path: envPath,
        kind: 'environment',
        envSafety: { isTracked: () => true, isIgnored: () => true },
        transform: (contents) => setupFiles.transformEnvLocal(contents, { KEY: 'value' }),
      }),
    /tracked/i,
  );
  assert.throws(
    () =>
      setupFiles.planSetupFile({
        path: envPath,
        kind: 'environment',
        envSafety: { isTracked: () => false, isIgnored: () => false },
        transform: (contents) => setupFiles.transformEnvLocal(contents, { KEY: 'value' }),
      }),
    /not ignored/i,
  );
});

test('apply rechecks environment safety and removes its temporary file on failure', (context) => {
  const directory = temporaryDirectory(context);
  const envPath = path.join(directory, '.env.local');
  let trackedChecks = 0;
  const changingSafety: EnvSafetyChecks = {
    isTracked: () => {
      trackedChecks += 1;
      return trackedChecks >= 3;
    },
    isIgnored: () => true,
  };
  const plan = setupFiles.planSetupFile({
    path: envPath,
    kind: 'environment',
    envSafety: changingSafety,
    transform: (contents) => setupFiles.transformEnvLocal(contents, { SECRET: 'hidden' }),
  });

  assert.throws(
    () => setupFiles.applySetupFile(plan, { envSafety: changingSafety }),
    /tracked/i,
  );
  assert.equal(fs.existsSync(envPath), false);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('nested setup creates a missing safe parent only after apply', (context) => {
  const directory = temporaryDirectory(context);
  const target = path.join(directory, '.github', 'pull_request_template.md');
  const plan = setupFiles.planSetupFile({
    path: target,
    root: directory,
    createParent: true,
    kind: 'agent-document',
    transform: (contents) => setupFiles.transformManagedDocument(contents, '## Summary'),
  });

  assert.equal(fs.existsSync(path.dirname(target)), false);
  setupFiles.applySetupFile(plan);
  assert.equal(fs.statSync(path.dirname(target)).isDirectory(), true);
  assert.match(fs.readFileSync(target, 'utf8'), /## Summary/);
});

test('nested setup rejects symlinked and concurrently replaced parents', (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX directory identity fixture');
    return;
  }
  const directory = temporaryDirectory(context);
  const external = temporaryDirectory(context);
  const github = path.join(directory, '.github');
  const target = path.join(github, 'pull_request_template.md');
  fs.symlinkSync(external, github);
  assert.throws(
    () => setupFiles.planSetupFile({
      path: target,
      root: directory,
      createParent: true,
      kind: 'agent-document',
      transform: (contents) => setupFiles.transformManagedDocument(contents, '## Summary'),
    }),
    /parent directories must be real directories/i,
  );

  fs.unlinkSync(github);
  fs.mkdirSync(github);
  const plan = setupFiles.planSetupFile({
    path: target,
    root: directory,
    createParent: true,
    kind: 'agent-document',
    transform: (contents) => setupFiles.transformManagedDocument(contents, '## Summary'),
  });
  fs.renameSync(github, `${github}-original`);
  fs.mkdirSync(github);

  assert.throws(
    () => setupFiles.applySetupFile(plan),
    /parent directory changed/i,
  );
  assert.equal(fs.existsSync(target), false);
});
