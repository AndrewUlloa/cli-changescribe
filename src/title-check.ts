import fs from 'node:fs';
import path from 'node:path';
import { validateTitleCheckArguments } from './arguments';
import {
  parseConventionalTitle,
  renderConventionalTitle,
} from './artifact-renderer';
import { resolveGitHubRepositoryIdentity } from './github-repository';
import {
  loadRepositoryPolicy,
  type LoadedRepositoryPolicy,
} from './repository-policy';

const MAX_EVENT_BYTES = 1024 * 1024;
const SHA_RE = /^[0-9a-f]{40,64}$/u;
const REPOSITORY_RE =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const UNSAFE_TEXT_RE =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const SUPPORTED_ACTIONS = new Set([
  'opened',
  'edited',
  'synchronize',
  'reopened',
  'ready_for_review',
]);

interface SelectedPullRequestEvent {
  readonly repository: string;
  readonly baseSha: string;
  readonly title: string;
}

export interface TitleCheckDependencies {
  readonly loadPolicy?: (revision: string) => LoadedRepositoryPolicy;
  readonly expectedRepository?: () => string;
  readonly log?: (message: string) => void;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Pull-request event contains invalid selected fields.');
  }
  return value as Record<string, unknown>;
}

function safeString(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    UNSAFE_TEXT_RE.test(value) ||
    Buffer.from(value, 'utf8').toString('utf8') !== value
  ) {
    throw new Error('Pull-request event contains invalid selected fields.');
  }
  return value;
}

function repositoryName(value: unknown): string {
  const name = safeString(value, 256);
  if (!REPOSITORY_RE.test(name)) {
    throw new Error('Pull-request event contains an invalid repository.');
  }
  return name;
}

function titleString(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    UNSAFE_TEXT_RE.test(value) ||
    Buffer.from(value, 'utf8').toString('utf8') !== value
  ) {
    throw new Error('Pull-request event title is invalid.');
  }
  return value;
}

function revision(value: unknown): string {
  const valueString = safeString(value, 64);
  if (!SHA_RE.test(valueString)) {
    throw new Error('Pull-request event contains an invalid base revision.');
  }
  return valueString;
}

function selectedRepository(value: unknown): string {
  return repositoryName(record(value).full_name);
}

function parseSelectedEvent(contents: string): SelectedPullRequestEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    throw new Error('Pull-request event contains invalid JSON.');
  }
  const root = record(parsed);
  const action = safeString(root.action, 64);
  if (!SUPPORTED_ACTIONS.has(action)) {
    throw new Error('Pull-request event action is not supported.');
  }
  const repository = selectedRepository(root.repository);
  const pullRequest = record(root.pull_request);
  if (
    !Number.isSafeInteger(pullRequest.number) ||
    (pullRequest.number as number) <= 0 ||
    typeof pullRequest.draft !== 'boolean'
  ) {
    throw new Error('Pull-request event contains invalid selected fields.');
  }
  const title = titleString(pullRequest.title);
  const base = record(pullRequest.base);
  const head = record(pullRequest.head);
  const baseSha = revision(base.sha);
  revision(head.sha);
  const baseRepository = selectedRepository(base.repo);
  if (head.repo !== null && head.repo !== undefined) {
    selectedRepository(head.repo);
  }
  if (
    repository.toLocaleLowerCase('en-US') !==
    baseRepository.toLocaleLowerCase('en-US')
  ) {
    throw new Error('Pull-request event repository does not match its base repository.');
  }
  return Object.freeze({ repository, baseSha, title });
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

function readBounded(
  descriptor: number,
  expectedSize: number,
  fileSystem: EventFileSystem,
): Buffer {
  const buffer = Buffer.alloc(expectedSize + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const read = fileSystem.readSync(
      descriptor,
      buffer,
      offset,
      buffer.byteLength - offset,
      offset,
    );
    if (read === 0) {
      break;
    }
    offset += read;
  }
  return buffer.subarray(0, offset);
}

export function readEventFile(
  eventPath: string,
  fileSystem: EventFileSystem = fs,
): string {
  let descriptor: number | undefined;
  try {
    const resolved = path.resolve(eventPath);
    descriptor = fileSystem.openSync(
      resolved,
      fileSystem.constants.O_RDONLY | fileSystem.constants.O_NOFOLLOW,
    );
    const before = fileSystem.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      throw new Error('Pull-request event must be a regular file.');
    }
    if (before.size > BigInt(MAX_EVENT_BYTES)) {
      throw new Error('Pull-request event is too large.');
    }
    const expectedSize = Number(before.size);
    const first = readBounded(descriptor, expectedSize, fileSystem);
    const middle = fileSystem.fstatSync(descriptor, { bigint: true });
    const second = readBounded(descriptor, expectedSize, fileSystem);
    const after = fileSystem.fstatSync(descriptor, { bigint: true });
    if (
      !middle.isFile() ||
      !after.isFile() ||
      middle.nlink !== 1n ||
      after.nlink !== 1n ||
      first.byteLength !== expectedSize ||
      second.byteLength !== expectedSize ||
      !first.equals(second) ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      before.dev !== middle.dev ||
      before.ino !== middle.ino ||
      before.size !== middle.size ||
      before.mtimeNs !== middle.mtimeNs ||
      before.ctimeNs !== middle.ctimeNs
    ) {
      throw new Error('Pull-request event changed while it was being read.');
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(first);
    } catch {
      throw new Error('Pull-request event must contain valid UTF-8.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Pull-request event')) {
      throw error;
    }
    throw new Error('Pull-request event must be a readable regular file.');
  } finally {
    if (descriptor !== undefined) {
      fileSystem.closeSync(descriptor);
    }
  }
}

function defaultExpectedRepository(): string {
  const segments = resolveGitHubRepositoryIdentity().ghRepo.split('/');
  if (segments.length !== 3 || !segments[1] || !segments[2]) {
    throw new Error('Local GitHub repository identity is invalid.');
  }
  return `${segments[1]}/${segments[2]}`;
}

export function runTitleCheck(
  argv: string[] = [],
  dependencies: TitleCheckDependencies = {},
): void {
  validateTitleCheckArguments(argv);
  const eventPath = argv[argv.indexOf('--event-file') + 1];
  if (eventPath === undefined) {
    throw new Error('Title check requires an event file.');
  }
  const selected = parseSelectedEvent(readEventFile(eventPath));
  const expectedRepository =
    (dependencies.expectedRepository ?? defaultExpectedRepository)();
  if (
    repositoryName(expectedRepository).toLocaleLowerCase('en-US') !==
    selected.repository.toLocaleLowerCase('en-US')
  ) {
    throw new Error('Pull-request event does not match the local repository.');
  }
  const loaded = (dependencies.loadPolicy ??
    ((baseSha: string) => loadRepositoryPolicy({ revision: baseSha })))(
    selected.baseSha,
  );
  const title = parseConventionalTitle(selected.title, loaded.policy.title);
  const rendered = renderConventionalTitle(title, loaded.policy.title);
  const log = dependencies.log ?? console.log;
  for (const warning of rendered.warnings) {
    log(`Warning: ${warning}`);
  }
  log(
    `Pull-request title is valid under base revision ${selected.baseSha.slice(0, 12)}.`,
  );
}
