import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

interface RepositoryTitlePolicy {
  readonly allowedTypes: readonly string[];
  readonly scopeMode: 'optional' | 'forbidden';
  readonly allowedScopes?: readonly string[];
  readonly targetLength: number;
  readonly maximumLength: number;
}

interface TitleCheckDependencies {
  readonly loadPolicy: (revision: string) => {
    readonly policy: { readonly title: RepositoryTitlePolicy };
  };
  readonly expectedRepository: () => string;
  readonly log: (message: string) => void;
}

interface EventFileSystem {
  readonly constants: Pick<typeof fs.constants, 'O_NOFOLLOW' | 'O_RDONLY'>;
  openSync(path: string, flags: number): number;
  fstatSync(descriptor: number, options: { bigint: true }): fs.BigIntStats;
  readSync(
    descriptor: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): number;
  closeSync(descriptor: number): void;
}

type RunTitleCheck = (
  argv?: string[],
  dependencies?: Partial<TitleCheckDependencies>,
) => void;

type ReadEventFile = (
  eventPath: string,
  fileSystem?: EventFileSystem,
) => string;

const {
  readEventFile,
  runTitleCheck,
}: {
  readEventFile: ReadEventFile;
  runTitleCheck: RunTitleCheck;
} = require('../dist/title-check.js');
const { DEFAULT_REPOSITORY_POLICY } = require('../dist/repository-policy.js') as {
  DEFAULT_REPOSITORY_POLICY: {
    readonly title: RepositoryTitlePolicy;
  };
};

const BASE = 'b'.repeat(40);
const HEAD = 'a'.repeat(40);

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'opened',
    repository: { full_name: 'acme/project' },
    pull_request: {
      number: 20,
      title: 'feat(cli): validate pull-request titles',
      draft: false,
      base: {
        sha: BASE,
        ref: 'main',
        repo: { full_name: 'acme/project' },
      },
      head: {
        sha: HEAD,
        ref: 'codex/title-check',
        repo: { full_name: 'contributor/project' },
      },
    },
    ...overrides,
  };
}

function writeEvent(
  context: TestContext,
  value: Record<string, unknown> | Buffer,
): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diffwright-title-event-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const eventPath = path.join(directory, 'event.json');
  fs.writeFileSync(
    eventPath,
    Buffer.isBuffer(value) ? value : `${JSON.stringify(value)}\n`,
  );
  return eventPath;
}

function dependencies(logs: string[] = []): TitleCheckDependencies {
  return {
    loadPolicy: (revision: string) => {
      assert.equal(revision, BASE);
      return { policy: DEFAULT_REPOSITORY_POLICY };
    },
    expectedRepository: () => 'acme/project',
    log: (message: string) => logs.push(message),
  };
}

test('validates a pull-request event title against its exact base revision', (context) => {
  const logs: string[] = [];
  const eventPath = writeEvent(context, event());

  runTitleCheck(['--event-file', eventPath], dependencies(logs));

  assert.match(logs.join('\n'), /title is valid/i);
  assert.match(logs.join('\n'), new RegExp(BASE.slice(0, 12)));
  assert.doesNotMatch(logs.join('\n'), /validate pull-request titles/);
});

test('accepts Git-valid Unicode and plus signs in branch references', (context) => {
  const value = event();
  const pullRequest = value.pull_request as Record<string, unknown>;
  pullRequest.base = {
    ...(pullRequest.base as Record<string, unknown>),
    ref: 'release/été+candidate',
  };
  pullRequest.head = {
    ...(pullRequest.head as Record<string, unknown>),
    ref: 'codex/prüfen+title',
  };
  const eventPath = writeEvent(context, value);

  assert.doesNotThrow(() =>
    runTitleCheck(['--event-file', eventPath], dependencies()),
  );
});

test('uses base policy even when a feature policy could allow another scope', (context) => {
  const allowed = writeEvent(context, event());
  const basePolicy: RepositoryTitlePolicy = {
    ...DEFAULT_REPOSITORY_POLICY.title,
    allowedScopes: ['cli'],
  };
  const deps: TitleCheckDependencies = {
    loadPolicy: (revision: string) => {
      assert.equal(revision, BASE);
      return { policy: { title: basePolicy } };
    },
    expectedRepository: () => 'acme/project',
    log: () => undefined,
  };
  runTitleCheck(['--event-file', allowed], deps);

  const rejected = writeEvent(context, event({
    pull_request: {
      ...(event().pull_request as Record<string, unknown>),
      title: 'feat(attacker): weaken the base policy',
    },
  }));
  assert.throws(
    () => runTitleCheck(['--event-file', rejected], deps),
    /scope is not allowed/i,
  );
});

test('rejects wrong repositories and malformed selected event fields', (context) => {
  const cases = [
    event({ repository: { full_name: 'other/project' } }),
    event({ action: 'closed' }),
    event({ pull_request: null }),
    event({
      pull_request: {
        ...(event().pull_request as Record<string, unknown>),
        number: 0,
      },
    }),
    event({
      pull_request: {
        ...(event().pull_request as Record<string, unknown>),
        base: {
          sha: 'not-a-sha',
          ref: 'main',
          repo: { full_name: 'acme/project' },
        },
      },
    }),
  ];
  for (const value of cases) {
    const eventPath = writeEvent(context, value);
    assert.throws(
      () => runTitleCheck(['--event-file', eventPath], dependencies()),
      /pull-request event|repository/i,
    );
  }
});

test('rejects invalid titles without echoing attacker-controlled text', (context) => {
  const attackerTitle = 'feat(cli): invisible\u200fcredential-like-value';
  const eventPath = writeEvent(context, event({
    pull_request: {
      ...(event().pull_request as Record<string, unknown>),
      title: attackerTitle,
    },
  }));

  let message = '';
  try {
    runTitleCheck(['--event-file', eventPath], dependencies());
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /title/i);
  assert.equal(message.includes(attackerTitle), false);
});

test('fails closed for symlinked, hardlinked, oversized, and invalid UTF-8 events', (context) => {
  const source = writeEvent(context, event());
  const directory = path.dirname(source);
  const symlink = path.join(directory, 'symlink.json');
  fs.symlinkSync(source, symlink);
  assert.throws(
    () => runTitleCheck(['--event-file', symlink], dependencies()),
    /regular file/i,
  );

  const hardlink = path.join(directory, 'hardlink.json');
  fs.linkSync(source, hardlink);
  assert.throws(
    () => runTitleCheck(['--event-file', source], dependencies()),
    /regular file/i,
  );

  const oversized = writeEvent(context, Buffer.alloc(1024 * 1024 + 1, 0x20));
  assert.throws(
    () => runTitleCheck(['--event-file', oversized], dependencies()),
    /too large/i,
  );

  const invalidUtf8 = writeEvent(context, Buffer.from([0x7b, 0xff, 0x7d]));
  assert.throws(
    () => runTitleCheck(['--event-file', invalidUtf8], dependencies()),
    /UTF-8/i,
  );
});

test('bounded event reads reject growth and same-size replacement races', (context) => {
  const original = Buffer.from(`${JSON.stringify(event())}\n`);

  for (const replacement of [
    Buffer.concat([original, Buffer.from('x')]),
    Buffer.alloc(original.byteLength, 0x20),
  ]) {
    const eventPath = writeEvent(context, original);
    const originalStat = fs.statSync(eventPath);
    let beginningReads = 0;
    let maximumRequestedRead = 0;
    const fileSystem: EventFileSystem = {
      constants: fs.constants,
      openSync: fs.openSync,
      fstatSync: (descriptor, options) => fs.fstatSync(descriptor, options),
      readSync(descriptor, buffer, offset, length, position) {
        maximumRequestedRead = Math.max(maximumRequestedRead, length);
        if (position === 0) {
          beginningReads += 1;
          if (beginningReads === 2) {
            fs.writeFileSync(eventPath, replacement);
            fs.utimesSync(eventPath, originalStat.atime, originalStat.mtime);
          }
        }
        return fs.readSync(descriptor, buffer, offset, length, position);
      },
      closeSync: fs.closeSync,
    };

    assert.throws(
      () => readEventFile(eventPath, fileSystem),
      /changed while it was being read/i,
    );
    assert.ok(maximumRequestedRead <= 1024 * 1024 + 1);
  }
});
