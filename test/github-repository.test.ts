import assert from 'node:assert/strict';
import test from 'node:test';

interface Runner {
  exec(file: string, args: readonly string[]): string;
}

type Resolve = (runner: Runner) => {
  readonly originUrl: string;
  readonly pushUrl: string;
  readonly ghRepo: string;
};
type Parse = (url: string) => string;

const {
  parseGitHubRepository,
  resolveGitHubRepositoryIdentity,
}: {
  parseGitHubRepository: Parse;
  resolveGitHubRepositoryIdentity: Resolve;
} = require('../dist/github-repository.js');

test('GitHub repository URLs resolve to one canonical repository identity', () => {
  assert.equal(
    parseGitHubRepository('git@github.com:AndrewUlloa/diffwright.git'),
    'github.com/AndrewUlloa/diffwright',
  );
  assert.equal(
    parseGitHubRepository('https://github.com/AndrewUlloa/diffwright.git'),
    'github.com/AndrewUlloa/diffwright',
  );
  const calls: string[][] = [];
  const runner: Runner = {
    exec(file, args) {
      calls.push([file, ...args]);
      return args.includes('--push')
        ? 'git@github.com:AndrewUlloa/diffwright.git\n'
        : 'https://github.com/AndrewUlloa/diffwright.git\n';
    },
  };
  assert.deepEqual(resolveGitHubRepositoryIdentity(runner), {
    originUrl: 'https://github.com/AndrewUlloa/diffwright.git',
    pushUrl: 'git@github.com:AndrewUlloa/diffwright.git',
    ghRepo: 'github.com/AndrewUlloa/diffwright',
  });
  assert.deepEqual(calls, [
    ['git', 'remote', 'get-url', '--all', 'origin'],
    ['git', 'remote', 'get-url', '--push', '--all', 'origin'],
  ]);
});

test('repository identity rejects ambiguous, mismatched, and credential-bearing remotes', () => {
  for (const url of [
    'token@github.com:owner/repo.git',
    'https://token@github.com/owner/repo.git',
    'https://github.com:8443/owner/repo.git',
    'https://github.com/owner/repo/extra.git',
  ]) {
    assert.throws(() => parseGitHubRepository(url), /not a supported GitHub/i);
  }
  assert.throws(
    () => resolveGitHubRepositoryIdentity({
      exec(_file, args) {
        return args.includes('--push')
          ? 'git@github.com:other/repo.git\n'
          : 'git@github.com:owner/repo.git\n';
      },
    }),
    /push destination does not match/i,
  );
  assert.throws(
    () => resolveGitHubRepositoryIdentity({
      exec() {
        return 'git@github.com:owner/repo.git\ngit@github.com:owner/backup.git\n';
      },
    }),
    /exactly one fetch URL and one push URL/i,
  );
});
