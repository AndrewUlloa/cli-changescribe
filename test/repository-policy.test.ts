import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

interface RepositoryPolicyModule {
  DEFAULT_REPOSITORY_POLICY: Readonly<Record<string, unknown>>;
  loadRepositoryPolicy(options?: {
    cwd?: string;
    revision?: string;
    runner?: {
      exec(
        file: string,
        args: readonly string[],
        options?: Record<string, unknown>,
      ): string;
    };
  }): {
    policy: {
      version: 1 | 2;
      title: {
        allowedTypes: readonly string[];
        scopeMode: 'optional' | 'required' | 'forbidden';
        allowedScopes?: readonly string[];
        targetLength: number;
        maximumLength: number;
      };
      editorial: {
        maxSentenceWords: number;
        duplicateClaimMinWords: number;
        vagueAbsolutes: readonly string[];
        terminologyGroups: readonly {
          name: string;
          terms: readonly string[];
        }[];
      };
      pullRequest?: {
        issueContext: 'optional' | 'recommended' | 'required';
        template: 'create' | 'preserve';
      };
      merge?: {
        strategy: 'squash' | 'platform';
        deleteBranch: boolean;
      };
    };
    source: {
      kind: 'defaults' | 'repository';
      revisionSha: string;
      path: '.diffwrightrc.json';
      digest: string;
    };
  };
  protectRepositoryPolicyEvidence(bundle: unknown): {
    items: readonly {
      source: { kind: string; locator: string };
      payload: { path: string; patch: string | null };
    }[];
  };
}

const repositoryPolicy: RepositoryPolicyModule =
  require('../dist/repository-policy.js');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Diffwright Policy Fixture',
      GIT_AUTHOR_EMAIL: 'policy@example.test',
      GIT_COMMITTER_NAME: 'Diffwright Policy Fixture',
      GIT_COMMITTER_EMAIL: 'policy@example.test',
    },
  });
}

function createRepository(context: TestContext): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'diffwright-policy-'),
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  git(directory, ['init', '--quiet', '--initial-branch=main']);
  fs.writeFileSync(path.join(directory, 'README.md'), '# fixture\n', 'utf8');
  git(directory, ['add', 'README.md']);
  git(directory, ['commit', '--quiet', '-m', 'chore: create fixture']);
  return directory;
}

function commitPolicy(
  directory: string,
  contents: string | Buffer,
  message = 'chore: configure policy',
): string {
  fs.writeFileSync(path.join(directory, '.diffwrightrc.json'), contents);
  git(directory, ['add', '.diffwrightrc.json']);
  git(directory, ['commit', '--quiet', '-m', message]);
  return git(directory, ['rev-parse', 'HEAD']).trim();
}

function policyJson(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ version: 1, ...overrides }, null, 2)}\n`;
}

test('a missing tracked policy resolves deeply frozen defaults at pinned HEAD', (context) => {
  const directory = createRepository(context);
  const result = repositoryPolicy.loadRepositoryPolicy({ cwd: directory });

  assert.equal(result.source.kind, 'defaults');
  assert.equal(result.source.path, '.diffwrightrc.json');
  assert.match(result.source.revisionSha, /^[0-9a-f]{40,64}$/u);
  assert.match(result.source.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(result.policy, repositoryPolicy.DEFAULT_REPOSITORY_POLICY);
  assert.deepEqual(Object.keys(result.policy), ['version', 'title', 'editorial']);
  assert.equal(
    result.source.digest,
    'sha256:aef83bfefd108b7dcb065cf8b5b40f7f5b708b84d1bf1112c7cf967e82c311c3',
  );
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.source), true);
  assert.equal(Object.isFrozen(result.policy), true);
  assert.equal(Object.isFrozen(result.policy.title.allowedTypes), true);
  assert.equal(Object.isFrozen(result.policy.editorial.vagueAbsolutes), true);
});

test('loads bounded version-2 workflow preferences with safe defaults', (context) => {
  const configuredDirectory = createRepository(context);
  commitPolicy(
    configuredDirectory,
    `${JSON.stringify({
      version: 2,
      title: {
        scopeMode: 'optional',
        allowedScopes: ['cli', 'release'],
      },
      pullRequest: {
        issueContext: 'required',
        template: 'preserve',
      },
      merge: {
        strategy: 'squash',
        deleteBranch: true,
      },
    }, null, 2)}\n`,
  );

  const configured = repositoryPolicy.loadRepositoryPolicy({
    cwd: configuredDirectory,
  });

  assert.equal(configured.policy.version, 2);
  assert.deepEqual(configured.policy.pullRequest, {
    issueContext: 'required',
    template: 'preserve',
  });
  assert.deepEqual(configured.policy.merge, {
    strategy: 'squash',
    deleteBranch: true,
  });
  assert.equal(Object.isFrozen(configured.policy.pullRequest), true);
  assert.equal(Object.isFrozen(configured.policy.merge), true);

  const defaultedDirectory = createRepository(context);
  commitPolicy(defaultedDirectory, '{"version":2}');
  const defaulted = repositoryPolicy.loadRepositoryPolicy({
    cwd: defaultedDirectory,
  });

  assert.deepEqual(defaulted.policy.pullRequest, {
    issueContext: 'recommended',
    template: 'create',
  });
  assert.deepEqual(defaulted.policy.merge, {
    strategy: 'squash',
    deleteBranch: false,
  });
});

test('version 2 rejects unsafe workflow preferences and safety-disabling fields', (context) => {
  const invalidDocuments = [
    { version: 2, pullRequest: { issueContext: 'off' } },
    { version: 2, pullRequest: { template: 'overwrite' } },
    { version: 2, merge: { strategy: 'rebase' } },
    { version: 2, merge: { strategy: 'platform', deleteBranch: true } },
    { version: 2, merge: { deleteBranch: 'yes' } },
    { version: 2, grounding: false },
    { version: 2, critic: false },
    { version: 2, coverage: 'off' },
    { version: 2, minimumClaims: 0 },
  ];

  for (const [index, document] of invalidDocuments.entries()) {
    const directory = createRepository(context);
    commitPolicy(
      directory,
      `${JSON.stringify(document)}\n`,
      `chore: add invalid version-2 policy ${index}`,
    );
    assert.throws(
      () => repositoryPolicy.loadRepositoryPolicy({ cwd: directory }),
      /Repository policy/i,
    );
  }
});

test('policy evidence protection removes version-2 workflow values before provider use', () => {
  const sentinel = 'gsk_version_2_policy_sentinel';
  const protectedBundle = repositoryPolicy.protectRepositoryPolicyEvidence({
    schemaVersion: 1,
    snapshot: { headSha: 'a'.repeat(40) },
    items: [
      {
        id: 'change-policy',
        kind: 'change',
        basis: 'observed',
        source: { kind: 'git-diff', locator: '.diffwrightrc.json' },
        payload: {
          status: 'modified',
          path: '.diffwrightrc.json',
          additions: 1,
          deletions: 1,
          binary: false,
          patch: `+{"version":2,"pullRequest":{"issueContext":"${sentinel}"}}`,
        },
      },
    ],
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });

  assert.equal(protectedBundle.items[0]?.source.kind, 'git-policy-metadata');
  assert.equal(protectedBundle.items[0]?.payload.patch, null);
  assert.doesNotMatch(JSON.stringify(protectedBundle), new RegExp(sentinel, 'u'));
});

test('loads all bounded data-only fields and replaces configured arrays', (context) => {
  const directory = createRepository(context);
  commitPolicy(
    directory,
    policyJson({
      $schema: 'https://example.test/diffwrightrc.schema.json',
      title: {
        additionalTypes: ['security'],
        scopeMode: 'optional',
        allowedScopes: ['cli', 'release'],
        targetLength: 48,
      },
      editorial: {
        maxSentenceWords: 22,
        duplicateClaimMinWords: 5,
        vagueAbsolutes: ['guarantees', 'always'],
        terminologyGroups: [
          { name: 'pull request', terms: ['pull request', 'PR'] },
        ],
      },
    }),
  );

  const result = repositoryPolicy.loadRepositoryPolicy({ cwd: directory });

  assert.equal(result.source.kind, 'repository');
  assert.match(result.source.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(result.policy.title, {
    allowedTypes: [
      'build',
      'chore',
      'ci',
      'docs',
      'feat',
      'fix',
      'perf',
      'refactor',
      'revert',
      'style',
      'test',
      'security',
    ],
    scopeMode: 'optional',
    allowedScopes: ['cli', 'release'],
    targetLength: 48,
    maximumLength: 72,
  });
  assert.deepEqual(result.policy.editorial.vagueAbsolutes, [
    'guarantees',
    'always',
  ]);
  assert.equal(Object.isFrozen(result.policy.title.allowedTypes), true);
  assert.equal(Object.isFrozen(result.policy.editorial.terminologyGroups[0]), true);
});

test('uses the requested full commit id instead of HEAD or working-tree bytes', (context) => {
  const directory = createRepository(context);
  const firstSha = commitPolicy(
    directory,
    policyJson({ title: { additionalTypes: ['security'] } }),
    'chore: add first policy',
  );
  commitPolicy(
    directory,
    policyJson({ title: { additionalTypes: ['ops'] } }),
    'chore: replace policy',
  );
  fs.writeFileSync(
    path.join(directory, '.diffwrightrc.json'),
    policyJson({ title: { additionalTypes: ['release'] } }),
    'utf8',
  );
  const nestedDirectory = path.join(directory, 'nested');
  fs.mkdirSync(nestedDirectory);

  const pinned = repositoryPolicy.loadRepositoryPolicy({
    cwd: nestedDirectory,
    revision: firstSha,
  });
  const head = repositoryPolicy.loadRepositoryPolicy({ cwd: directory });

  assert.equal(pinned.source.revisionSha, firstSha);
  assert.equal(pinned.policy.title.allowedTypes.at(-1), 'security');
  assert.equal(head.policy.title.allowedTypes.at(-1), 'ops');
});

test('rejects symlink policy entries, oversized blobs, and invalid UTF-8', (context) => {
  const symlinkRepository = createRepository(context);
  fs.symlinkSync('README.md', path.join(symlinkRepository, '.diffwrightrc.json'));
  git(symlinkRepository, ['add', '.diffwrightrc.json']);
  git(symlinkRepository, ['commit', '--quiet', '-m', 'chore: add policy link']);
  assert.throws(
    () => repositoryPolicy.loadRepositoryPolicy({ cwd: symlinkRepository }),
    /tracked regular file/i,
  );

  const oversizedRepository = createRepository(context);
  commitPolicy(
    oversizedRepository,
    Buffer.alloc(64 * 1024 + 1, 0x20),
  );
  assert.throws(
    () => repositoryPolicy.loadRepositoryPolicy({ cwd: oversizedRepository }),
    /too large/i,
  );

  const invalidUtf8Repository = createRepository(context);
  commitPolicy(
    invalidUtf8Repository,
    Buffer.concat([Buffer.from('{"version":1,"title":"'), Buffer.from([0xff]), Buffer.from('"}')]),
  );
  assert.throws(
    () => repositoryPolicy.loadRepositoryPolicy({ cwd: invalidUtf8Repository }),
    /UTF-8/i,
  );
});

test('strict JSON rejects duplicate keys, unknown fields, and unsafe strings without echoing them', (context) => {
  const invalidDocuments = [
    '{"version":1,"title":{"targetLength":50,"targetLength":40}}',
    '{"version":1,"unknown-secret-field":"gsk_policy_secret"}',
    '{"version":1,"title":{"unknown":"gsk_policy_secret"}}',
    '{"version":1,"editorial":{"vagueAbsolutes":["safe\\u202Eunsafe"]}}',
    '{"version":1,"editorial":{"vagueAbsolutes":["safe\\u061Cunsafe"]}}',
    '{"version":1,"editorial":{"vagueAbsolutes":["safe\\u200Funsafe"]}}',
    '{"version":1,"editorial":{"vagueAbsolutes":["\\ud800"]}}',
  ];

  for (const [index, document] of invalidDocuments.entries()) {
    const directory = createRepository(context);
    commitPolicy(directory, document, `chore: add invalid policy ${index}`);
    let caught: unknown;
    try {
      repositoryPolicy.loadRepositoryPolicy({ cwd: directory });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof Error);
    assert.doesNotMatch(caught.message, /gsk_policy_secret|unknown-secret-field/);
  }
});

test('rejects out-of-bounds grammar, ambiguous scopes, and unknown selection fields', (context) => {
  const invalidPolicies: Record<string, unknown>[] = [
    { title: { maximumLength: 80 } },
    { title: { targetLength: 73 } },
    { title: { scopeMode: 'forbidden', allowedScopes: ['cli'] } },
    { title: { additionalTypes: [] } },
    { title: { additionalTypes: ['fix'] } },
    { title: { scopeMode: 'required' } },
    { selection: { primaryPaths: ['../secret'] } },
    { selection: { primaryPaths: ['/absolute/**'] } },
    { selection: { supportingPaths: ['src/**'] } },
    { selection: { primaryPaths: ['src/[ab].ts'] } },
    { editorial: { maxSentenceWords: 101 } },
  ];

  for (const [index, invalid] of invalidPolicies.entries()) {
    const directory = createRepository(context);
    commitPolicy(
      directory,
      policyJson(invalid),
      `chore: add invalid bounded policy ${index}`,
    );
    assert.throws(
      () => repositoryPolicy.loadRepositoryPolicy({ cwd: directory }),
      /Repository policy/i,
    );
  }
});

test('uses fixed Git argv and turns child-process details into generic errors', (context) => {
  const directory = createRepository(context);
  const revisionSha = 'a'.repeat(40);
  const objectSha = 'b'.repeat(40);
  const contents = '{"version":1}';
  const calls: Array<{
    file: string;
    args: readonly string[];
    options?: Record<string, unknown>;
  }> = [];
  const outputs = [
    `${directory}\n`,
    `${revisionSha}\n`,
    `100644 blob ${objectSha}\t.diffwrightrc.json\0`,
    `${Buffer.byteLength(contents)}\n`,
    contents,
  ];
  const runner = {
    exec(
      file: string,
      args: readonly string[],
      options?: Record<string, unknown>,
    ): string {
      calls.push({ file, args, options });
      return outputs.shift() ?? '';
    },
  };

  const result = repositoryPolicy.loadRepositoryPolicy({ cwd: directory, runner });

  assert.equal(result.source.revisionSha, revisionSha);
  assert.equal(calls.every((call) => call.file === 'git'), true);
  assert.equal(calls.every((call) => call.options?.stdio === 'pipe'), true);
  assert.deepEqual(calls.map((call) => call.args[0]), [
    'rev-parse',
    'rev-parse',
    'ls-tree',
    'cat-file',
    'show',
  ]);
  assert.equal(
    calls.some((call) => Reflect.has(call.options ?? {}, 'shell')),
    false,
  );

  assert.throws(
    () =>
      repositoryPolicy.loadRepositoryPolicy({
        cwd: directory,
        runner: {
          exec() {
            throw new Error('gsk_child_process_secret');
          },
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      !error.message.includes('gsk_child_process_secret'),
  );
});
