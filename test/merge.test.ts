import assert from 'node:assert/strict';
import test from 'node:test';

interface CommandCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly input?: string;
  readonly timeout?: number;
}
interface MergeDependencies {
  readonly runner: {
    exec(
      file: string,
      args: readonly string[],
      options?: { readonly input?: string; readonly timeout?: number },
    ): string;
  };
  readonly resolveRepository?: () => {
    readonly originUrl: string;
    readonly pushUrl: string;
    readonly ghRepo: string;
  };
  readonly assertRepositoryCurrent?: () => void;
  readonly loadPolicy?: (revision: string) => unknown;
  readonly confirm?: (message: string) => Promise<boolean>;
  readonly isInteractive: () => boolean;
  readonly log: (message: string) => void;
  readonly knownSecrets?: readonly string[];
  readonly loadKnownSecrets?: () => readonly string[];
}
type RunMerge = (
  argv?: string[],
  dependencies?: MergeDependencies,
) => Promise<void>;

const { runMerge }: { runMerge: RunMerge } = require('../dist/merge.js');
const { DEFAULT_REPOSITORY_POLICY } = require('../dist/repository-policy.js') as {
  DEFAULT_REPOSITORY_POLICY: unknown;
};

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const MERGE = 'c'.repeat(40);
const REPOSITORY = Object.freeze({
  originUrl: 'https://github.com/acme/project.git',
  pushUrl: 'git@github.com:acme/project.git',
  ghRepo: 'github.com/acme/project',
});

function validPr(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 20,
    title: 'feat(cli): validate reviewed pull requests',
    url: 'https://github.com/acme/project/pull/20',
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    baseRefName: 'main',
    baseRefOid: BASE,
    headRefName: 'codex/merge',
    headRefOid: HEAD,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    reviewRequests: [],
    latestReviews: [],
    autoMergeRequest: null,
    ...overrides,
  };
}

interface FixtureOptions {
  readonly firstPr?: Record<string, unknown>;
  readonly secondPr?: Record<string, unknown>;
  readonly checks?: readonly Record<string, unknown>[];
  readonly dirty?: boolean;
  readonly postcondition?: Record<string, unknown>;
  readonly mutationError?: boolean;
  readonly mutationResponse?: Record<string, unknown>;
  readonly mergeQueueEnabled?: boolean;
  readonly secondMergeQueueEnabled?: boolean;
  readonly repositoryError?: boolean;
  readonly remoteHead?: string;
  readonly secondChecks?: readonly Record<string, unknown>[];
  readonly pullRequestList?: readonly Record<string, unknown>[];
  readonly ghVersion?: string;
  readonly localInspectionError?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const calls: CommandCall[] = [];
  const logs: string[] = [];
  let fullViewCount = 0;
  let checksCount = 0;
  let mergeQueueCount = 0;
  const runner = {
    exec(
      file: string,
      args: readonly string[],
      commandOptions?: {
        readonly input?: string;
        readonly timeout?: number;
      },
    ): string {
      calls.push({
        file,
        args: [...args],
        ...(commandOptions?.input === undefined
          ? {}
          : { input: commandOptions.input }),
        ...(commandOptions?.timeout === undefined
          ? {}
          : { timeout: commandOptions.timeout }),
      });
      if (file === 'gh' && args[0] === '--version') {
        return options.ghVersion ?? 'gh version 2.95.0 (2026-08-13)\n';
      }
      if (file === 'git' && args[0] === 'symbolic-ref') return 'codex/merge\n';
      if (file === 'git' && args[0] === 'check-ref-format') return '';
      if (file === 'git' && args[0] === 'remote') {
        return args.includes('--push')
          ? `${REPOSITORY.pushUrl}\n`
          : `${REPOSITORY.originUrl}\n`;
      }
      if (file === 'git' && args[0] === 'status') {
        if (options.localInspectionError) throw new Error('gsk_local_secret');
        return options.dirty ? ' M file\0' : '';
      }
      if (file === 'git' && args[0] === 'rev-parse' && args[2] === 'HEAD^{commit}') {
        if (options.localInspectionError) throw new Error('gsk_local_secret');
        return `${HEAD}\n`;
      }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return `${process.cwd()}\n`;
      }
      if (file === 'git' && args[0] === 'rev-parse') return `${BASE}\n`;
      if (file === 'git' && args[0] === 'ls-tree') return '';
      if (file === 'git' && args[0] === 'cat-file') return '';
      if (file === 'git' && args[0] === 'ls-remote') {
        const reference = args.at(-1);
        return `${
          reference === 'refs/heads/main'
            ? BASE
            : options.remoteHead ?? HEAD
        }\t${reference}\n`;
      }
      if (file === 'gh' && args[1] === 'list') {
        return JSON.stringify(options.pullRequestList ?? [{ number: 20 }]);
      }
      if (
        file === 'gh' && args[1] === 'view' &&
        args.includes('number,title,url,state,isDraft,isCrossRepository,baseRefName,baseRefOid,headRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,reviewRequests,latestReviews,autoMergeRequest')
      ) {
        fullViewCount += 1;
        return JSON.stringify(
          fullViewCount === 1
            ? options.firstPr ?? validPr()
            : options.secondPr ?? options.firstPr ?? validPr(),
        );
      }
      if (file === 'gh' && args[1] === 'checks') {
        checksCount += 1;
        return JSON.stringify(
          checksCount > 1 && options.secondChecks !== undefined
            ? options.secondChecks
            : options.checks ?? [
          { bucket: 'pass', name: 'test', state: 'SUCCESS', workflow: 'CI' },
          { bucket: 'skipping', name: 'CodeRabbit', state: 'SKIPPED', workflow: '' },
        ]);
      }
      if (file === 'gh' && args[0] === 'api' && args.includes('graphql')) {
        mergeQueueCount += 1;
        return JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                isMergeQueueEnabled:
                  mergeQueueCount > 1 && options.secondMergeQueueEnabled !== undefined
                    ? options.secondMergeQueueEnabled
                    : options.mergeQueueEnabled ?? false,
                isInMergeQueue: false,
              },
            },
          },
        });
      }
      if (file === 'gh' && args[0] === 'api') {
        if (options.mutationError) throw new Error('secret remote failure');
        return JSON.stringify(options.mutationResponse ?? {
          sha: MERGE,
          merged: true,
          message: 'Pull Request successfully merged',
        });
      }
      if (file === 'gh' && args[1] === 'view' && args.includes('state,mergedAt,mergeCommit')) {
        return JSON.stringify(options.postcondition ?? {
          state: 'MERGED',
          mergedAt: '2026-08-16T12:00:00Z',
          mergeCommit: { oid: MERGE },
        });
      }
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`);
    },
  };
  const dependencies: MergeDependencies = {
    runner,
    resolveRepository: () => REPOSITORY,
    assertRepositoryCurrent: () => {
      if (options.repositoryError) throw new Error('changed origin');
    },
    loadPolicy: (revision: string) => ({
      policy: DEFAULT_REPOSITORY_POLICY,
      source: {
        kind: 'defaults',
        revisionSha: revision,
        path: '.diffwrightrc.json',
        digest: 'digest',
      },
    }),
    confirm: async () => true,
    isInteractive: () => true,
    knownSecrets: [],
    log: (message: string) => logs.push(message),
  };
  return { calls, logs, dependencies };
}

function mutationCalls(calls: readonly CommandCall[]): readonly CommandCall[] {
  return calls.filter(
    (call) => call.file === 'gh' && call.args[0] === 'api' && call.args.includes('PUT'),
  );
}

test('merge validates twice and performs one pinned squash mutation', async () => {
  const context = fixture();
  await runMerge(['--yes'], context.dependencies);
  assert.deepEqual(
    mutationCalls(context.calls),
    [{
      file: 'gh',
      args: [
        'api', '--hostname', 'github.com', '--method', 'PUT',
        'repos/acme/project/pulls/20/merge', '--input', '-',
      ],
      input: JSON.stringify({
        commit_title: 'feat(cli): validate reviewed pull requests',
        sha: HEAD,
        merge_method: 'squash',
      }),
      timeout: 60_000,
    }],
  );
  assert.equal(
    context.calls.filter((call) => call.file === 'gh' && call.args[1] === 'checks').length,
    2,
  );
  assert.match(context.logs.at(-1) ?? '', new RegExp(`Merged PR #20 as ${MERGE}`));
  assert.equal(
    context.calls.every((call) => call.timeout === 60_000),
    true,
  );
});

test('production repository and policy helpers inherit the merge timeout', async () => {
  const context = fixture();
  await runMerge(['--yes'], {
    ...context.dependencies,
    resolveRepository: undefined,
    assertRepositoryCurrent: undefined,
    loadPolicy: undefined,
  });
  const helperCalls = context.calls.filter(
    (call) =>
      call.file === 'git' &&
      (call.args[0] === 'remote' ||
        call.args[0] === 'ls-tree' ||
        (call.args[0] === 'rev-parse' && call.args[1] === '--show-toplevel')),
  );
  assert.equal(helperCalls.length > 0, true);
  assert.equal(
    helperCalls.every((call) => call.timeout === 60_000),
    true,
  );
});

test('merge requires a GitHub CLI version that supports structured check output', async () => {
  for (const ghVersion of [
    'gh version 2.49.9 (2024-10-01)\n',
    'unexpected version output\n',
  ]) {
    const context = fixture({ ghVersion });
    await assert.rejects(
      () => runMerge(['--yes'], context.dependencies),
      /GitHub CLI 2\.50\.0 or newer/u,
    );
    assert.equal(mutationCalls(context.calls).length, 0);
  }
});

test('local inspection failures are generic and do not echo subprocess output', async () => {
  const context = fixture({ localInspectionError: true });
  let message = '';
  try {
    await runMerge(['--yes'], context.dependencies);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /inspect the local working tree and head revision/i);
  assert.equal(message.includes('gsk_local_secret'), false);
  assert.equal(mutationCalls(context.calls).length, 0);
});

test('dry-run, cancellation, and headless invocation never mutate GitHub', async () => {
  const dryRun = fixture();
  await runMerge(['--dry-run'], dryRun.dependencies);
  assert.equal(mutationCalls(dryRun.calls).length, 0);
  assert.equal(
    dryRun.calls.some(
      (call) => call.file === 'git' && call.args[0] === 'fetch',
    ),
    false,
  );

  const cancelled = fixture();
  await runMerge([], { ...cancelled.dependencies, confirm: async () => false });
  assert.equal(mutationCalls(cancelled.calls).length, 0);

  const headless = fixture();
  await assert.rejects(
    () => runMerge([], { ...headless.dependencies, isInteractive: () => false }),
    /requires --yes/i,
  );
  assert.equal(mutationCalls(headless.calls).length, 0);
});

test('merge fails closed for dirty state, checks, reviews, and title policy', async () => {
  const cases: readonly [FixtureOptions, RegExp][] = [
    [{ dirty: true }, /clean working tree/i],
    [{ checks: [] }, /no reported checks/i],
    [{ checks: [{ bucket: 'fail', name: 'test', state: 'FAILURE', workflow: 'CI' }] }, /checks that are not complete and successful/i],
    [{ firstPr: validPr({ reviewRequests: [{ login: 'reviewer' }] }) }, /pending or requested review changes/i],
    [{ firstPr: validPr({ latestReviews: [{ state: 'CHANGES_REQUESTED' }] }) }, /pending or requested review changes/i],
    [{ firstPr: validPr({ reviewDecision: 'CHANGES_REQUESTED' }) }, /review decision/i],
    [{ firstPr: validPr({ mergeStateStatus: 'BLOCKED' }) }, /clean and mergeable/i],
    [{ firstPr: validPr({ state: 'CLOSED' }) }, /open, ready, and from this repository/i],
    [{ firstPr: validPr({ isDraft: true }) }, /open, ready, and from this repository/i],
    [{ firstPr: validPr({ isCrossRepository: true }) }, /open, ready, and from this repository/i],
    [{ firstPr: validPr({ autoMergeRequest: { enabledAt: 'now' } }) }, /automatic merge request/i],
    [{ remoteHead: 'd'.repeat(40) }, /local and remote feature branch/i],
    [{ pullRequestList: [] }, /exactly one open pull request/i],
    [{ pullRequestList: [{ number: 20 }, { number: 21 }] }, /exactly one open pull request/i],
    [{ firstPr: validPr({ title: 'Update the merge command' }) }, /valid Conventional Commit title/i],
  ];
  for (const [options, expected] of cases) {
    const context = fixture(options);
    await assert.rejects(() => runMerge(['--yes'], context.dependencies), expected);
    assert.equal(mutationCalls(context.calls).length, 0);
  }
});

test('reviewed state or repository drift after preview blocks mutation', async () => {
  const cases: readonly [FixtureOptions, RegExp][] = [
    [
      { secondPr: validPr({ title: 'feat(cli): validate merge state again' }) },
      /pull-request state changed after the merge preview/i,
    ],
    [
      { secondPr: validPr({ baseRefOid: 'd'.repeat(40) }) },
      /remote base branch changed during merge validation/i,
    ],
    [
      { secondChecks: [{ bucket: 'fail', name: 'test', state: 'FAILURE', workflow: 'CI' }] },
      /checks that are not complete and successful/i,
    ],
    [{ repositoryError: true }, /changed origin/i],
  ];
  for (const [options, expected] of cases) {
    const context = fixture(options);
    await assert.rejects(
      () => runMerge(['--yes'], context.dependencies),
      expected,
    );
    assert.equal(mutationCalls(context.calls).length, 0);
  }
});

test('queue and concurrent-merge no-op responses are rejected without claiming a squash', async () => {
  for (const message of [
    'Pull request was added to a merge queue',
    'Pull request is already merged',
  ]) {
    const context = fixture({
      mutationResponse: { sha: MERGE, merged: false, message },
    });
    await assert.rejects(
      () => runMerge(['--yes'], context.dependencies),
      /could not be confirmed.*inspect it before retrying/i,
    );
    assert.equal(mutationCalls(context.calls).length, 1);
    assert.equal(
      context.calls.some(
        (call) => call.file === 'gh' && call.args.includes('state,mergedAt,mergeCommit'),
      ),
      false,
    );
  }
});

test('merge queues are rejected before a privileged token could bypass them', async () => {
  const enabled = fixture({ mergeQueueEnabled: true });
  await assert.rejects(
    () => runMerge(['--yes'], enabled.dependencies),
    /uses a merge queue.*will not bypass/i,
  );
  assert.equal(mutationCalls(enabled.calls).length, 0);

  const enabledAfterPreview = fixture({ secondMergeQueueEnabled: true });
  await assert.rejects(
    () => runMerge(['--yes'], enabledAfterPreview.dependencies),
    /uses a merge queue.*will not bypass/i,
  );
  assert.equal(mutationCalls(enabledAfterPreview.calls).length, 0);
});

test('configured secrets are rejected before preview, argv, or mutation', async () => {
  const secret = 'gsk_sensitive_fixture_value';
  const context = fixture({ firstPr: validPr({ title: `fix: ${secret}` }) });
  let error = '';
  try {
    await runMerge(['--yes'], {
      ...context.dependencies,
      knownSecrets: [secret],
    });
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }
  assert.match(error, /configured secret/i);
  assert.equal(error.includes(secret), false);
  assert.equal(context.logs.join('\n').includes(secret), false);
  assert.equal(
    context.calls.some((call) => call.args.some((argument) => argument.includes(secret))),
    false,
  );
  assert.equal(mutationCalls(context.calls).length, 0);
});

test('configured-secret discovery fails closed before repository reads or preview', async () => {
  const secret = 'gsk_unreadable_fixture_value';
  const context = fixture();
  let error = '';
  try {
    await runMerge(['--yes'], {
      ...context.dependencies,
      knownSecrets: undefined,
      loadKnownSecrets: () => {
        throw new Error(secret);
      },
    });
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }
  assert.match(error, /could not safely load configured secrets/i);
  assert.equal(error.includes(secret), false);
  assert.deepEqual(context.calls, []);
  assert.deepEqual(context.logs, []);
});

test('an uncertain mutation or postcondition is never retried', async () => {
  for (const options of [
    { mutationError: true },
    { postcondition: { state: 'OPEN', mergedAt: null, mergeCommit: null } },
  ]) {
    const context = fixture(options);
    await assert.rejects(
      () => runMerge(['--yes'], context.dependencies),
      /could not be confirmed.*inspect it before retrying/i,
    );
    assert.equal(
      mutationCalls(context.calls).length,
      1,
    );
  }
});
