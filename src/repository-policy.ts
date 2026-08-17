import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_EDITORIAL_POLICY,
  type EditorialPolicy,
  type EditorialTerminologyGroup,
} from './editorial-policy';
import {
  createEvidenceBundle,
  type EvidenceBundle,
} from './change-evidence';
import { defaultCommandRunner, type CommandRunner } from './subprocess';

export type { EditorialPolicy, EditorialTerminologyGroup } from './editorial-policy';

export type ScopeMode = 'optional' | 'forbidden';

export interface RepositoryTitlePolicy {
  readonly allowedTypes: readonly string[];
  readonly scopeMode: ScopeMode;
  readonly allowedScopes?: readonly string[];
  readonly targetLength: number;
  readonly maximumLength: number;
}

export interface RepositoryPolicyV1 {
  readonly version: 1;
  readonly title: Readonly<RepositoryTitlePolicy>;
  readonly editorial: Readonly<EditorialPolicy>;
}

export type IssueContextExpectation = 'optional' | 'recommended' | 'required';
export type PullRequestTemplatePreference = 'create' | 'preserve';
export type MergeStrategy = 'squash' | 'platform';

export interface RepositoryPullRequestPolicy {
  readonly issueContext: IssueContextExpectation;
  readonly template: PullRequestTemplatePreference;
}

export interface RepositoryMergePolicy {
  readonly strategy: MergeStrategy;
  readonly deleteBranch: boolean;
}

export interface RepositoryPolicyV2 {
  readonly version: 2;
  readonly title: Readonly<RepositoryTitlePolicy>;
  readonly editorial: Readonly<EditorialPolicy>;
  readonly pullRequest: Readonly<RepositoryPullRequestPolicy>;
  readonly merge: Readonly<RepositoryMergePolicy>;
}

export type RepositoryPolicy = RepositoryPolicyV1 | RepositoryPolicyV2;

export interface RepositoryPolicySource {
  readonly kind: 'defaults' | 'repository';
  readonly revisionSha: string;
  readonly path: '.diffwrightrc.json';
  readonly digest: string;
}

export interface LoadedRepositoryPolicy {
  readonly policy: Readonly<RepositoryPolicy>;
  readonly source: Readonly<RepositoryPolicySource>;
}

export interface LoadRepositoryPolicyOptions {
  readonly cwd?: string;
  /** HEAD or a full commit object id. Branch names are intentionally rejected. */
  readonly revision?: string;
  readonly runner?: Pick<CommandRunner, 'exec'>;
}

const POLICY_PATH = '.diffwrightrc.json' as const;
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_GIT_METADATA_BYTES = 16 * 1024;
const MAX_JSON_DEPTH = 16;
const MAX_TYPES = 32;
const MAX_SCOPES = 128;
const MAX_VAGUE_ABSOLUTES = 64;
const MAX_TERMINOLOGY_GROUPS = 32;
const MAX_TERMS_PER_GROUP = 16;
const MAX_TOKEN_CODE_POINTS = 80;
const MAX_JSON_STRING_CODE_POINTS = 2_048;
const TYPE_RE = /^[a-z][a-z0-9-]{0,31}$/u;
const SCOPE_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/u;
const SHA_RE = /^[0-9a-f]{40,64}$/u;
const UNSAFE_TEXT_RE =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

const STANDARD_TYPES = Object.freeze([
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
]);

const DEFAULT_TITLE_POLICY: Readonly<RepositoryTitlePolicy> = Object.freeze({
  allowedTypes: STANDARD_TYPES,
  scopeMode: 'optional',
  targetLength: 50,
  maximumLength: 72,
});

export const DEFAULT_REPOSITORY_POLICY: Readonly<RepositoryPolicyV1> =
  Object.freeze({
    version: 1,
    title: DEFAULT_TITLE_POLICY,
    editorial: DEFAULT_EDITORIAL_POLICY,
  });

export const DEFAULT_PULL_REQUEST_POLICY: Readonly<RepositoryPullRequestPolicy> =
  Object.freeze({
    issueContext: 'recommended',
    template: 'create',
  });

export const DEFAULT_MERGE_POLICY: Readonly<RepositoryMergePolicy> =
  Object.freeze({
    strategy: 'squash',
    deleteBranch: false,
  });

const DEFAULT_DIGEST = digest(
  JSON.stringify({ source: 'diffwright-defaults', version: 1 }),
);

type JsonRecord = Record<string, unknown>;

class StrictJsonParser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.input.length) {
      this.invalid();
    }
    return value;
  }

  private parseValue(depth: number): unknown {
    if (depth > MAX_JSON_DEPTH) {
      this.invalid();
    }
    const character = this.input[this.index];
    if (character === '{') {
      return this.parseObject(depth + 1);
    }
    if (character === '[') {
      return this.parseArray(depth + 1);
    }
    if (character === '"') {
      return this.parseString();
    }
    if (character === 't') {
      return this.parseLiteral('true', true);
    }
    if (character === 'f') {
      return this.parseLiteral('false', false);
    }
    if (character === 'n') {
      return this.parseLiteral('null', null);
    }
    return this.parseNumber();
  }

  private parseObject(depth: number): JsonRecord {
    this.index += 1;
    this.skipWhitespace();
    const value: JsonRecord = Object.create(null) as JsonRecord;
    const keys = new Set<string>();
    if (this.input[this.index] === '}') {
      this.index += 1;
      return value;
    }
    for (;;) {
      if (this.input[this.index] !== '"') {
        this.invalid();
      }
      const key = this.parseString();
      if (keys.has(key)) {
        throw new Error('Repository policy contains duplicate object keys.');
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.input[this.index] !== ':') {
        this.invalid();
      }
      this.index += 1;
      this.skipWhitespace();
      value[key] = this.parseValue(depth);
      this.skipWhitespace();
      const delimiter = this.input[this.index];
      if (delimiter === '}') {
        this.index += 1;
        return value;
      }
      if (delimiter !== ',') {
        this.invalid();
      }
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): unknown[] {
    this.index += 1;
    this.skipWhitespace();
    const value: unknown[] = [];
    if (this.input[this.index] === ']') {
      this.index += 1;
      return value;
    }
    for (;;) {
      value.push(this.parseValue(depth));
      this.skipWhitespace();
      const delimiter = this.input[this.index];
      if (delimiter === ']') {
        this.index += 1;
        return value;
      }
      if (delimiter !== ',') {
        this.invalid();
      }
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    this.index += 1;
    let value = '';
    for (;;) {
      const character = this.input[this.index];
      if (character === undefined) {
        this.invalid();
      }
      this.index += 1;
      if (character === '"') {
        assertSafeString(value, MAX_JSON_STRING_CODE_POINTS);
        return value;
      }
      if (character === '\\') {
        const escape = this.input[this.index];
        this.index += 1;
        if (escape === '"' || escape === '\\' || escape === '/') {
          value += escape;
        } else if (escape === 'b') {
          value += '\b';
        } else if (escape === 'f') {
          value += '\f';
        } else if (escape === 'n') {
          value += '\n';
        } else if (escape === 'r') {
          value += '\r';
        } else if (escape === 't') {
          value += '\t';
        } else if (escape === 'u') {
          const code = this.input.slice(this.index, this.index + 4);
          if (!/^[0-9a-fA-F]{4}$/u.test(code)) {
            this.invalid();
          }
          value += String.fromCharCode(Number.parseInt(code, 16));
          this.index += 4;
        } else {
          this.invalid();
        }
        continue;
      }
      if (character.charCodeAt(0) <= 0x1f) {
        this.invalid();
      }
      value += character;
    }
  }

  private parseLiteral<T>(token: string, value: T): T {
    if (this.input.slice(this.index, this.index + token.length) !== token) {
      this.invalid();
    }
    this.index += token.length;
    return value;
  }

  private parseNumber(): number {
    const remaining = this.input.slice(this.index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      remaining,
    );
    if (!match) {
      this.invalid();
    }
    const token = match[0];
    const value = Number(token);
    if (!Number.isFinite(value)) {
      this.invalid();
    }
    this.index += token.length;
    return value;
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.input[this.index] ?? '')) {
      const character = this.input[this.index];
      if (
        character !== ' ' &&
        character !== '\t' &&
        character !== '\n' &&
        character !== '\r'
      ) {
        this.invalid();
      }
      this.index += 1;
    }
  }

  private invalid(): never {
    throw new Error('Repository policy is not valid strict JSON.');
  }
}

export function loadRepositoryPolicy(
  options: LoadRepositoryPolicyOptions = {},
): LoadedRepositoryPolicy {
  const runner = options.runner ?? defaultCommandRunner;
  const cwd = options.cwd ?? process.cwd();
  const revision = validateRevision(options.revision ?? 'HEAD');
  const root = resolveRepositoryRoot(cwd, runner);
  const revisionSha = resolveRevision(revision, root, runner);
  const treeEntry = readTreeEntry(revisionSha, root, runner);
  if (treeEntry === null) {
    return freezeLoadedPolicy(
      DEFAULT_REPOSITORY_POLICY,
      source('defaults', revisionSha, DEFAULT_DIGEST),
    );
  }
  const size = readObjectSize(treeEntry.objectSha, root, runner);
  if (size <= 0 || size > MAX_CONFIG_BYTES) {
    throw new Error('Repository policy is missing, unsafe, or too large.');
  }
  const contents = readPolicyBlob(revisionSha, root, runner);
  if (
    contents.startsWith('\ufeff') ||
    contents.includes('\ufffd') ||
    Buffer.byteLength(contents, 'utf8') !== size
  ) {
    throw new Error('Repository policy must contain valid UTF-8 JSON.');
  }
  const policy = parseRepositoryPolicyContents(contents);
  return freezeLoadedPolicy(
    policy,
    source('repository', revisionSha, digest(contents)),
  );
}

export function parseRepositoryPolicyContents(
  contents: string,
): Readonly<RepositoryPolicy> {
  const size = Buffer.byteLength(contents, 'utf8');
  if (
    size <= 0 ||
    size > MAX_CONFIG_BYTES ||
    contents.startsWith('\ufeff') ||
    contents.includes('\ufffd') ||
    Buffer.from(contents, 'utf8').toString('utf8') !== contents
  ) {
    throw new Error('Repository policy must contain valid bounded UTF-8 JSON.');
  }
  return resolvePolicy(new StrictJsonParser(contents).parse());
}

export function protectRepositoryPolicyEvidence<T extends EvidenceBundle>(
  bundle: T,
): T {
  let changed = false;
  const items = bundle.items.map((item) => {
    if (
      item.kind !== 'change' ||
      (item.payload.path !== POLICY_PATH &&
        item.payload.oldPath !== POLICY_PATH)
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      source: {
        kind: 'git-policy-metadata',
        locator: item.source.locator,
      },
      payload: {
        ...item.payload,
        patch: null,
      },
    };
  });
  if (!changed) {
    return bundle;
  }
  return createEvidenceBundle({
    snapshot: bundle.snapshot,
    items,
    receipts: [...bundle.receipts],
    coverage: {
      complete: bundle.coverage.complete,
      gaps: [...bundle.coverage.gaps],
    },
  }) as T;
}

function resolvePolicy(value: unknown): Readonly<RepositoryPolicy> {
  const root = record(value, 'root');
  if (root.$schema !== undefined) {
    boundedString(root.$schema, '$schema', 2_048);
  }
  if (root.version === 1) {
    exactKeys(root, [
      '$schema',
      'version',
      'title',
      'editorial',
    ]);
    const title = resolveTitlePolicy(root.title);
    const editorial = resolveEditorialPolicy(root.editorial);
    return deepFreeze({ version: 1, title, editorial });
  }
  if (root.version !== 2) {
    throw new Error('Repository policy version must be 1 or 2.');
  }
  exactKeys(root, [
    '$schema',
    'version',
    'title',
    'editorial',
    'pullRequest',
    'merge',
  ]);
  const title = resolveTitlePolicy(root.title);
  const editorial = resolveEditorialPolicy(root.editorial);
  const pullRequest = resolvePullRequestPolicy(root.pullRequest);
  const merge = resolveMergePolicy(root.merge);
  return deepFreeze({ version: 2, title, editorial, pullRequest, merge });
}

function resolvePullRequestPolicy(
  value: unknown,
): Readonly<RepositoryPullRequestPolicy> {
  if (value === undefined) {
    return DEFAULT_PULL_REQUEST_POLICY;
  }
  const pullRequest = record(value, 'pullRequest');
  exactKeys(pullRequest, ['issueContext', 'template']);
  const issueContext = pullRequest.issueContext === undefined
    ? DEFAULT_PULL_REQUEST_POLICY.issueContext
    : issueContextExpectation(pullRequest.issueContext);
  const template = pullRequest.template === undefined
    ? DEFAULT_PULL_REQUEST_POLICY.template
    : pullRequestTemplatePreference(pullRequest.template);
  return deepFreeze({ issueContext, template });
}

function resolveMergePolicy(value: unknown): Readonly<RepositoryMergePolicy> {
  if (value === undefined) {
    return DEFAULT_MERGE_POLICY;
  }
  const merge = record(value, 'merge');
  exactKeys(merge, ['strategy', 'deleteBranch']);
  const strategy = merge.strategy === undefined
    ? DEFAULT_MERGE_POLICY.strategy
    : mergeStrategy(merge.strategy);
  const deleteBranch = merge.deleteBranch === undefined
    ? DEFAULT_MERGE_POLICY.deleteBranch
    : booleanValue(merge.deleteBranch, 'merge.deleteBranch');
  if (strategy === 'platform' && deleteBranch) {
    throw new Error(
      'Repository policy cannot delete branches with platform-managed merges.',
    );
  }
  return deepFreeze({ strategy, deleteBranch });
}

function resolveTitlePolicy(value: unknown): RepositoryTitlePolicy {
  if (value === undefined) {
    return DEFAULT_TITLE_POLICY;
  }
  const title = record(value, 'title');
  exactKeys(title, [
    'additionalTypes',
    'scopeMode',
    'allowedScopes',
    'targetLength',
  ]);
  const additionalTypes = title.additionalTypes === undefined
    ? []
    : tokenArray(title.additionalTypes, 'additionalTypes', MAX_TYPES, TYPE_RE);
  const standardTypeSet = new Set<string>(STANDARD_TYPES);
  if (additionalTypes.some((type) => standardTypeSet.has(type))) {
    throw new Error(
      'Repository policy additionalTypes must extend standard types.',
    );
  }
  const allowedTypes = Object.freeze([
    ...DEFAULT_TITLE_POLICY.allowedTypes,
    ...additionalTypes,
  ]);
  const scopeMode = title.scopeMode === undefined
    ? DEFAULT_TITLE_POLICY.scopeMode
    : scopeModeValue(title.scopeMode);
  const allowedScopes = title.allowedScopes === undefined
    ? undefined
    : tokenArray(title.allowedScopes, 'allowedScopes', MAX_SCOPES, SCOPE_RE);
  if (scopeMode === 'forbidden' && allowedScopes !== undefined) {
    throw new Error(
      'Repository policy forbids allowedScopes when scopeMode is forbidden.',
    );
  }
  const targetLength = title.targetLength === undefined
    ? DEFAULT_TITLE_POLICY.targetLength
    : boundedInteger(title.targetLength, 'targetLength', 1, 256);
  const maximumLength = DEFAULT_TITLE_POLICY.maximumLength;
  if (targetLength > maximumLength) {
    throw new Error(
      'Repository policy title targetLength must not exceed maximumLength.',
    );
  }
  return deepFreeze({
    allowedTypes,
    scopeMode,
    ...(allowedScopes === undefined ? {} : { allowedScopes }),
    targetLength,
    maximumLength,
  });
}

function resolveEditorialPolicy(value: unknown): Readonly<EditorialPolicy> {
  if (value === undefined) {
    return DEFAULT_EDITORIAL_POLICY;
  }
  const editorial = record(value, 'editorial');
  exactKeys(editorial, [
    'maxSentenceWords',
    'duplicateClaimMinWords',
    'vagueAbsolutes',
    'terminologyGroups',
  ]);
  const maxSentenceWords = editorial.maxSentenceWords === undefined
    ? DEFAULT_EDITORIAL_POLICY.maxSentenceWords
    : boundedInteger(editorial.maxSentenceWords, 'maxSentenceWords', 5, 100);
  const duplicateClaimMinWords =
    editorial.duplicateClaimMinWords === undefined
      ? DEFAULT_EDITORIAL_POLICY.duplicateClaimMinWords
      : boundedInteger(
          editorial.duplicateClaimMinWords,
          'duplicateClaimMinWords',
          2,
          100,
        );
  const vagueAbsolutes = editorial.vagueAbsolutes === undefined
    ? DEFAULT_EDITORIAL_POLICY.vagueAbsolutes
    : stringArray(
        editorial.vagueAbsolutes,
        'vagueAbsolutes',
        MAX_VAGUE_ABSOLUTES,
        MAX_TOKEN_CODE_POINTS,
      );
  const terminologyGroups = editorial.terminologyGroups === undefined
    ? DEFAULT_EDITORIAL_POLICY.terminologyGroups
    : terminologyGroupArray(editorial.terminologyGroups);
  return deepFreeze({
    maxSentenceWords,
    duplicateClaimMinWords,
    vagueAbsolutes,
    terminologyGroups,
  });
}

function terminologyGroupArray(value: unknown): readonly EditorialTerminologyGroup[] {
  const groups = array(value, 'terminologyGroups', MAX_TERMINOLOGY_GROUPS);
  const names = new Set<string>();
  return Object.freeze(
    groups.map((entry) => {
      const group = record(entry, 'terminology group');
      exactKeys(group, ['name', 'terms']);
      const name = boundedString(group.name, 'terminology group name', 64);
      const normalizedName = name.normalize('NFC').toLocaleLowerCase('en-US');
      if (names.has(normalizedName)) {
        throw new Error('Repository policy contains duplicate terminology groups.');
      }
      names.add(normalizedName);
      const terms = stringArray(
        group.terms,
        'terminology group terms',
        MAX_TERMS_PER_GROUP,
        MAX_TOKEN_CODE_POINTS,
      );
      if (terms.length < 2) {
        throw new Error(
          'Repository policy terminology groups require at least two terms.',
        );
      }
      return Object.freeze({ name, terms });
    }),
  );
}

function tokenArray(
  value: unknown,
  label: string,
  maximum: number,
  pattern: RegExp,
): readonly string[] {
  const values = array(value, label, maximum);
  if (values.length === 0) {
    throw new Error(`Repository policy ${label} must not be empty when present.`);
  }
  const result = values.map((entry) => {
    const token = boundedString(entry, label, 80);
    if (!pattern.test(token)) {
      throw new Error(`Repository policy ${label} contains an invalid token.`);
    }
    return token;
  });
  assertUnique(result, label);
  return Object.freeze(result);
}

function stringArray(
  value: unknown,
  label: string,
  maximum: number,
  maximumCodePoints: number,
): readonly string[] {
  const values = array(value, label, maximum);
  const result = values.map((entry) =>
    boundedString(entry, label, maximumCodePoints),
  );
  assertUnique(result, label, true);
  return Object.freeze(result);
}

function assertUnique(
  values: readonly string[],
  label: string,
  caseInsensitive = false,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = caseInsensitive
      ? value.normalize('NFC').toLocaleLowerCase('en-US')
      : value;
    if (seen.has(normalized)) {
      throw new Error(`Repository policy ${label} contains duplicate values.`);
    }
    seen.add(normalized);
  }
}

function array(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`Repository policy ${label} is invalid or too large.`);
  }
  return value;
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Repository policy ${label} must be an object.`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new Error('Repository policy contains an unknown field.');
  }
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new Error(`Repository policy ${label} must be a string.`);
  }
  assertSafeString(value, maximum);
  if (value.trim().length === 0) {
    throw new Error(`Repository policy ${label} must not be empty.`);
  }
  return value;
}

function assertSafeString(value: string, maximumCodePoints: number): void {
  if (
    Array.from(value).length > maximumCodePoints ||
    value.includes('\ufffd') ||
    Buffer.from(value, 'utf8').toString('utf8') !== value ||
    UNSAFE_TEXT_RE.test(value)
  ) {
    throw new Error('Repository policy contains unsafe or oversized text.');
  }
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`Repository policy ${label} is out of bounds.`);
  }
  return value;
}

function scopeModeValue(value: unknown): ScopeMode {
  if (value !== 'optional' && value !== 'forbidden') {
    throw new Error('Repository policy scopeMode is invalid.');
  }
  return value;
}

function issueContextExpectation(value: unknown): IssueContextExpectation {
  if (value !== 'optional' && value !== 'recommended' && value !== 'required') {
    throw new Error('Repository policy pullRequest.issueContext is invalid.');
  }
  return value;
}

function pullRequestTemplatePreference(
  value: unknown,
): PullRequestTemplatePreference {
  if (value !== 'create' && value !== 'preserve') {
    throw new Error('Repository policy pullRequest.template is invalid.');
  }
  return value;
}

function mergeStrategy(value: unknown): MergeStrategy {
  if (value !== 'squash' && value !== 'platform') {
    throw new Error('Repository policy merge.strategy is invalid.');
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Repository policy ${label} must be a boolean.`);
  }
  return value;
}

function validateRevision(revision: string): string {
  if (revision !== 'HEAD' && !SHA_RE.test(revision)) {
    throw new Error('Repository policy revision must be HEAD or a full commit id.');
  }
  return revision;
}

function resolveRepositoryRoot(
  cwd: string,
  runner: Pick<CommandRunner, 'exec'>,
): string {
  let output: string;
  try {
    output = runner.exec('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: MAX_GIT_METADATA_BYTES,
    });
  } catch {
    throw new Error('Repository policy requires a Git repository.');
  }
  const root = output.replace(/\r?\n$/u, '');
  if (
    !path.isAbsolute(root) ||
    root.length === 0 ||
    UNSAFE_TEXT_RE.test(root)
  ) {
    throw new Error('Repository policy Git root is invalid.');
  }
  try {
    return fs.realpathSync(root);
  } catch {
    throw new Error('Repository policy Git root is unavailable.');
  }
}

function resolveRevision(
  revision: string,
  cwd: string,
  runner: Pick<CommandRunner, 'exec'>,
): string {
  let sha: string;
  try {
    sha = runner.exec(
      'git',
      ['rev-parse', '--verify', `${revision}^{commit}`],
      {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        maxBuffer: MAX_GIT_METADATA_BYTES,
      },
    ).trim();
  } catch {
    throw new Error('Repository policy revision could not be resolved.');
  }
  if (!SHA_RE.test(sha)) {
    throw new Error('Repository policy revision returned an invalid commit id.');
  }
  return sha;
}

interface TreeEntry {
  readonly objectSha: string;
}

function readTreeEntry(
  revisionSha: string,
  cwd: string,
  runner: Pick<CommandRunner, 'exec'>,
): TreeEntry | null {
  let output: string;
  try {
    output = runner.exec(
      'git',
      ['ls-tree', '-z', '--full-tree', revisionSha, '--', POLICY_PATH],
      {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        maxBuffer: MAX_GIT_METADATA_BYTES,
      },
    );
  } catch {
    throw new Error('Repository policy tree entry could not be inspected.');
  }
  if (output.length === 0) {
    return null;
  }
  const fields = output.split('\0');
  if (fields.length !== 2 || fields[1] !== '') {
    throw new Error('Repository policy tree entry is invalid.');
  }
  const match =
    /^(?<mode>\d{6}) (?<type>[a-z]+) (?<object>[0-9a-f]{40,64})\t(?<path>.+)$/u.exec(
      fields[0] ?? '',
    );
  if (
    match?.groups?.mode === undefined ||
    match.groups.type === undefined ||
    match.groups.object === undefined ||
    match.groups.path === undefined ||
    (match.groups.mode !== '100644' && match.groups.mode !== '100755') ||
    match.groups.type !== 'blob' ||
    match.groups.path !== POLICY_PATH
  ) {
    throw new Error('Repository policy must be a tracked regular file.');
  }
  return { objectSha: match.groups.object };
}

function readObjectSize(
  objectSha: string,
  cwd: string,
  runner: Pick<CommandRunner, 'exec'>,
): number {
  let output: string;
  try {
    output = runner.exec('git', ['cat-file', '-s', objectSha], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 1_024,
    });
  } catch {
    throw new Error('Repository policy object could not be inspected.');
  }
  const size = Number(output.trim());
  if (!Number.isSafeInteger(size)) {
    throw new Error('Repository policy object size is invalid.');
  }
  return size;
}

function readPolicyBlob(
  revisionSha: string,
  cwd: string,
  runner: Pick<CommandRunner, 'exec'>,
): string {
  try {
    return runner.exec('git', ['show', `${revisionSha}:${POLICY_PATH}`], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: MAX_CONFIG_BYTES + 1,
    });
  } catch {
    throw new Error('Repository policy content could not be read.');
  }
}

function source(
  kind: RepositoryPolicySource['kind'],
  revisionSha: string,
  sourceDigest: string,
): RepositoryPolicySource {
  return Object.freeze({
    kind,
    revisionSha,
    path: POLICY_PATH,
    digest: sourceDigest,
  });
}

function freezeLoadedPolicy(
  policy: Readonly<RepositoryPolicy>,
  policySource: Readonly<RepositoryPolicySource>,
): LoadedRepositoryPolicy {
  return Object.freeze({ policy: deepFreeze(policy), source: policySource });
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(Reflect.get(value, key));
  }
  return Object.freeze(value);
}
