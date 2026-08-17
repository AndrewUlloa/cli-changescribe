import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseRepositoryPolicyContents,
  type IssueContextExpectation,
  type MergeStrategy,
  type PullRequestTemplatePreference,
  type ScopeMode,
} from './repository-policy';

export const MANAGED_BLOCK_START = '<!-- diffwright:workflow:start -->';
export const MANAGED_BLOCK_END = '<!-- diffwright:workflow:end -->';

export type SetupFileKind =
  | 'package-json'
  | 'environment'
  | 'repository-policy'
  | 'agent-document';
export type SemanticMutationKind =
  | 'package-script'
  | 'environment'
  | 'repository-policy'
  | 'managed-block';
export type SemanticMutationAction = 'added' | 'updated' | 'removed';

export interface SemanticMutation {
  readonly kind: SemanticMutationKind;
  readonly action: SemanticMutationAction;
  readonly name: string;
  readonly value?: string;
}

export interface TransformResult {
  readonly contents: string;
  readonly changed: boolean;
  readonly mutations: readonly Readonly<SemanticMutation>[];
}

export interface EnvSafetyChecks {
  isTracked(absolutePath: string): boolean;
  isIgnored(absolutePath: string): boolean;
}

export interface RepositoryPolicyPreferences {
  readonly scopeMode: ScopeMode;
  readonly allowedScopes?: readonly string[];
  readonly issueContext: IssueContextExpectation;
  readonly template: PullRequestTemplatePreference;
  readonly mergeStrategy: MergeStrategy;
  readonly deleteBranch: boolean;
}

export interface PlanSetupFileOptions {
  readonly path: string;
  readonly kind: SetupFileKind;
  readonly transform: (contents: string) => TransformResult;
  readonly envSafety?: EnvSafetyChecks;
}

export interface SetupFilePlan extends TransformResult {
  readonly path: string;
  readonly kind: SetupFileKind;
  readonly expectedHash: string | null;
  readonly expectedMode: number | null;
  readonly mode: number;
}

export interface ApplySetupFileOptions {
  readonly envSafety?: EnvSafetyChecks;
}

interface FileSnapshot {
  readonly contents: string;
  readonly hash: string | null;
  readonly mode: number | null;
}

interface LineToken {
  readonly body: string;
  readonly ending: string;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function freezeMutations(
  mutations: SemanticMutation[],
): readonly Readonly<SemanticMutation>[] {
  for (const mutation of mutations) {
    Object.freeze(mutation);
  }
  return Object.freeze(mutations);
}

function result(
  original: string,
  contents: string,
  mutations: SemanticMutation[],
): TransformResult {
  return Object.freeze({
    contents,
    changed: contents !== original,
    mutations: freezeMutations(mutations),
  });
}

function newlineFor(contents: string): string {
  const match = contents.match(/\r\n|\n|\r/);
  return match?.[0] ?? '\n';
}

function splitLines(contents: string): LineToken[] {
  const lines: LineToken[] = [];
  const endings = /\r\n|\n|\r/g;
  let start = 0;
  for (let match = endings.exec(contents); match; match = endings.exec(contents)) {
    lines.push({
      body: contents.slice(start, match.index),
      ending: match[0],
    });
    start = match.index + match[0].length;
  }
  if (start < contents.length) {
    lines.push({ body: contents.slice(start), ending: '' });
  }
  return lines;
}

function validName(value: string): boolean {
  return value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function transformPackageJsonScripts(
  contents: string,
  replacements: Readonly<Record<string, string | null>>,
): TransformResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('package.json must contain valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json must contain a JSON object.');
  }

  const manifest = parsed as Record<string, unknown>;
  const existingScripts = manifest.scripts;
  if (
    existingScripts !== undefined &&
    existingScripts !== null &&
    (typeof existingScripts !== 'object' || Array.isArray(existingScripts))
  ) {
    throw new Error('package.json scripts must contain a JSON object.');
  }
  const scripts = (existingScripts ?? {}) as Record<string, unknown>;
  const mutations: SemanticMutation[] = [];

  for (const [name, command] of Object.entries(replacements)) {
    if (!validName(name)) {
      throw new Error('A package script name is invalid.');
    }
    if (
      command !== null &&
      (command.length === 0 || /[\u0000-\u001f\u007f]/.test(command))
    ) {
      throw new Error(`Package script ${name} has an invalid command.`);
    }

    const hasExisting = Object.prototype.hasOwnProperty.call(scripts, name);
    const existing = scripts[name];
    if (command === null) {
      if (hasExisting) {
        delete scripts[name];
        mutations.push({ kind: 'package-script', action: 'removed', name });
      }
      continue;
    }
    if (existing === command) {
      continue;
    }
    scripts[name] = command;
    mutations.push({
      kind: 'package-script',
      action: hasExisting ? 'updated' : 'added',
      name,
      value: command,
    });
  }

  if (mutations.length === 0) {
    return result(contents, contents, []);
  }
  manifest.scripts = scripts;

  const indentationMatch = contents.match(/(?:^|\r\n|\n|\r)([ \t]+)"/);
  const indentation = indentationMatch?.[1] ?? '  ';
  const newline = newlineFor(contents);
  const hadFinalNewline = /(?:\r\n|\n|\r)$/.test(contents);
  let serialized = JSON.stringify(manifest, null, indentation);
  if (newline !== '\n') {
    serialized = serialized.replaceAll('\n', newline);
  }
  if (hadFinalNewline) {
    serialized += newline;
  }
  return result(contents, serialized, mutations);
}

function serializeEnvironmentValue(value: string, name: string): string {
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) {
    throw new Error(
      `Environment value for ${name} contains a control character or newline.`,
    );
  }
  if (/["\\]/.test(value)) {
    throw new Error(
      `Environment value for ${name} contains a quote or backslash that cannot be serialized safely.`,
    );
  }
  return JSON.stringify(value);
}

export function transformEnvLocal(
  contents: string,
  updates: Readonly<Record<string, string>>,
): TransformResult {
  const entries = Object.entries(updates);
  for (const [name, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error('An environment variable name is invalid.');
    }
    serializeEnvironmentValue(value, name);
  }

  const targetNames = new Set(entries.map(([name]) => name));
  const lines = splitLines(contents);
  const indexes = new Map<string, number[]>();
  const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
  lines.forEach((line, index) => {
    const name = line.body.match(assignment)?.[1];
    if (name && targetNames.has(name)) {
      const found = indexes.get(name) ?? [];
      found.push(index);
      indexes.set(name, found);
    }
  });

  for (const [name] of entries) {
    if ((indexes.get(name)?.length ?? 0) > 1) {
      throw new Error(`Refusing to update duplicate environment key ${name}.`);
    }
  }

  const mutations: SemanticMutation[] = [];
  const replacements = new Map<number, string>();
  const additions: string[] = [];
  for (const [name, value] of entries) {
    const serialized = `${name}=${serializeEnvironmentValue(value, name)}`;
    const index = indexes.get(name)?.[0];
    if (index === undefined) {
      additions.push(serialized);
      mutations.push({
        kind: 'environment',
        action: 'added',
        name,
        value: '[hidden]',
      });
      continue;
    }
    if (lines[index]?.body === serialized) {
      continue;
    }
    replacements.set(index, serialized);
    mutations.push({
      kind: 'environment',
      action: 'updated',
      name,
      value: '[hidden]',
    });
  }

  if (mutations.length === 0) {
    return result(contents, contents, []);
  }

  let transformed = lines
    .map((line, index) => `${replacements.get(index) ?? line.body}${line.ending}`)
    .join('');
  if (additions.length > 0) {
    const newline = newlineFor(contents);
    if (transformed.length > 0 && !/(?:\r\n|\n|\r)$/.test(transformed)) {
      transformed += newline;
    }
    transformed += `${additions.join(newline)}${newline}`;
  }
  return result(contents, transformed, mutations);
}

const REPOSITORY_POLICY_SCHEMA =
  'https://raw.githubusercontent.com/AndrewUlloa/diffwright/main/documentation/diffwrightrc.schema.json';

function sameStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function transformRepositoryPolicy(
  contents: string,
  preferences: Readonly<RepositoryPolicyPreferences>,
): TransformResult {
  let raw: Record<string, unknown>;
  let existingVersion: 1 | 2 | null = null;
  if (contents.length === 0) {
    raw = {
      $schema: REPOSITORY_POLICY_SCHEMA,
      version: 2,
    };
  } else {
    const existing = parseRepositoryPolicyContents(contents);
    existingVersion = existing.version;
    if (
      existing.version === 2 &&
      existing.title.scopeMode === preferences.scopeMode &&
      sameStrings(existing.title.allowedScopes, preferences.allowedScopes) &&
      existing.pullRequest.issueContext === preferences.issueContext &&
      existing.pullRequest.template === preferences.template &&
      existing.merge.strategy === preferences.mergeStrategy &&
      existing.merge.deleteBranch === preferences.deleteBranch
    ) {
      return result(contents, contents, []);
    }
    raw = JSON.parse(contents) as Record<string, unknown>;
    raw.version = 2;
  }

  const title =
    typeof raw.title === 'object' && raw.title !== null && !Array.isArray(raw.title)
      ? { ...(raw.title as Record<string, unknown>) }
      : {};
  title.scopeMode = preferences.scopeMode;
  if (preferences.allowedScopes === undefined) {
    delete title.allowedScopes;
  } else {
    title.allowedScopes = [...preferences.allowedScopes];
  }
  raw.title = title;
  raw.pullRequest = {
    issueContext: preferences.issueContext,
    template: preferences.template,
  };
  raw.merge = {
    strategy: preferences.mergeStrategy,
    deleteBranch: preferences.deleteBranch,
  };

  const newline = newlineFor(contents);
  const indentationMatch = contents.match(/(?:^|\r\n|\n|\r)([ \t]+)"/u);
  const indentation = indentationMatch?.[1] ?? '  ';
  let serialized = JSON.stringify(raw, null, indentation);
  if (newline !== '\n') {
    serialized = serialized.replaceAll('\n', newline);
  }
  serialized += newline;
  parseRepositoryPolicyContents(serialized);
  return result(contents, serialized, [
    {
      kind: 'repository-policy',
      action: existingVersion === null ? 'added' : 'updated',
      name: existingVersion === 1
        ? 'Diffwright repository policy v1 -> v2'
        : 'Diffwright repository policy v2',
    },
  ]);
}

function occurrenceCount(contents: string, needle: string): number {
  let count = 0;
  let start = 0;
  while (true) {
    const index = contents.indexOf(needle, start);
    if (index === -1) {
      return count;
    }
    count += 1;
    start = index + needle.length;
  }
}

function normalizeManagedBody(body: string, newline: string): string {
  if (body.includes('\0')) {
    throw new Error('Managed document body must not contain NUL bytes.');
  }
  if (body.includes(MANAGED_BLOCK_START) || body.includes(MANAGED_BLOCK_END)) {
    throw new Error('Managed document body must not contain managed markers.');
  }
  return body
    .replace(/^(?:\r\n|\n|\r)+|(?:\r\n|\n|\r)+$/g, '')
    .split(/\r\n|\n|\r/)
    .join(newline);
}

function appendSeparator(contents: string, newline: string): string {
  if (contents.length === 0) {
    return '';
  }
  if (contents.endsWith(`${newline}${newline}`)) {
    return '';
  }
  if (contents.endsWith(newline)) {
    return newline;
  }
  return `${newline}${newline}`;
}

export function transformManagedDocument(
  contents: string,
  body: string,
): TransformResult {
  const startCount = occurrenceCount(contents, MANAGED_BLOCK_START);
  const endCount = occurrenceCount(contents, MANAGED_BLOCK_END);
  const noMarkers = startCount === 0 && endCount === 0;
  if (!noMarkers && (startCount !== 1 || endCount !== 1)) {
    throw new Error('Managed document markers are malformed or duplicated.');
  }

  const newline = newlineFor(contents);
  const normalizedBody = normalizeManagedBody(body, newline);
  const block =
    `${MANAGED_BLOCK_START}${newline}${normalizedBody}${newline}` +
    MANAGED_BLOCK_END;

  if (noMarkers) {
    const transformed =
      contents + appendSeparator(contents, newline) + block + newline;
    return result(contents, transformed, [
      {
        kind: 'managed-block',
        action: 'added',
        name: 'Diffwright workflow',
      },
    ]);
  }

  const start = contents.indexOf(MANAGED_BLOCK_START);
  const end = contents.indexOf(MANAGED_BLOCK_END);
  if (start > end) {
    throw new Error('Managed document markers are malformed or out of order.');
  }
  const afterEnd = end + MANAGED_BLOCK_END.length;
  const transformed = contents.slice(0, start) + block + contents.slice(afterEnd);
  if (transformed === contents) {
    return result(contents, contents, []);
  }
  return result(contents, transformed, [
    {
      kind: 'managed-block',
      action: 'updated',
      name: 'Diffwright workflow',
    },
  ]);
}

function hash(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

function rejectUnsafeTarget(targetPath: string, stats: fs.Stats): void {
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to write symbolic link target: ${targetPath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Setup target must be a regular file: ${targetPath}`);
  }
  if (stats.nlink > 1) {
    throw new Error(`Refusing to write hard link target: ${targetPath}`);
  }
}

function readSnapshot(targetPath: string): FileSnapshot {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(targetPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { contents: '', hash: null, mode: null };
    }
    throw error;
  }

  rejectUnsafeTarget(targetPath, stats);
  const bytes = fs.readFileSync(targetPath);
  const contents = bytes.toString('utf8');
  if (!Buffer.from(contents, 'utf8').equals(bytes)) {
    throw new Error(`Setup target must contain valid UTF-8 text: ${targetPath}`);
  }
  return {
    contents,
    hash: hash(bytes),
    mode: stats.mode & 0o777,
  };
}

function assertEnvironmentSafe(
  targetPath: string,
  checks: EnvSafetyChecks | undefined,
): void {
  if (!checks) {
    throw new Error('Environment writes require tracked and ignored safety checks.');
  }
  if (checks.isTracked(targetPath)) {
    throw new Error(`Refusing to write tracked environment file: ${targetPath}`);
  }
  if (!checks.isIgnored(targetPath)) {
    throw new Error(`Environment file is not ignored: ${targetPath}`);
  }
}

function defaultMode(kind: SetupFileKind): number {
  return kind === 'environment' ? 0o600 : 0o644;
}

export function planSetupFile(options: PlanSetupFileOptions): SetupFilePlan {
  const targetPath = path.resolve(options.path);
  if (options.kind === 'environment') {
    assertEnvironmentSafe(targetPath, options.envSafety);
  }
  const snapshot = readSnapshot(targetPath);
  const transformed = options.transform(snapshot.contents);
  const mode = snapshot.mode ?? defaultMode(options.kind);
  return Object.freeze({
    path: targetPath,
    kind: options.kind,
    expectedHash: snapshot.hash,
    expectedMode: snapshot.mode,
    mode,
    contents: transformed.contents,
    changed: transformed.contents !== snapshot.contents,
    mutations: freezeMutations(
      transformed.mutations.map((mutation) => ({ ...mutation })),
    ),
  });
}

function assertPlanStillCurrent(plan: SetupFilePlan): void {
  const current = readSnapshot(plan.path);
  if (
    current.hash !== plan.expectedHash ||
    current.mode !== plan.expectedMode
  ) {
    throw new Error(`Setup target changed since it was planned: ${plan.path}`);
  }
}

export function applySetupFile(
  plan: SetupFilePlan,
  options: ApplySetupFileOptions = {},
): void {
  if (!plan.changed) {
    return;
  }
  if (plan.kind === 'environment') {
    assertEnvironmentSafe(plan.path, options.envSafety);
  }
  assertPlanStillCurrent(plan);

  const directory = path.dirname(plan.path);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(plan.path)}.diffwright-${process.pid}-${randomBytes(8).toString('hex')}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', plan.mode);
    fs.writeFileSync(descriptor, plan.contents, 'utf8');
    fs.fchmodSync(descriptor, plan.mode);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    if (plan.kind === 'environment') {
      assertEnvironmentSafe(plan.path, options.envSafety);
    }
    assertPlanStillCurrent(plan);
    fs.renameSync(temporaryPath, plan.path);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original failure.
      }
    }
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (errorCode(cleanupError) !== 'ENOENT') {
        // Preserve the original failure.
      }
    }
    throw error;
  }
}
