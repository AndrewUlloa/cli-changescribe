import fs from 'node:fs';
import path from 'node:path';
import type { IntentEvidenceItem } from './change-evidence';
import { redactSecretValues } from './runtime-config';

const MAX_CONTEXT_FILES = 8;
const MAX_CONTEXT_PATH_CHARS = 1_024;
const MAX_CONTEXT_BYTES_PER_FILE = 64 * 1024;
const MAX_CONTEXT_BYTES_TOTAL = 128 * 1024;
const PATH_CONTROL_RE = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const TEXT_CONTROL_RE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/u;

export interface ContextEvidenceOptions {
  cwd?: string;
  knownSecrets?: readonly string[];
}

export function loadContextEvidence(
  paths: readonly string[],
  options: ContextEvidenceOptions = {},
): readonly Readonly<IntentEvidenceItem>[] {
  if (paths.length > MAX_CONTEXT_FILES) {
    throw new Error('Too many context files were supplied.');
  }
  const root = resolveRoot(options.cwd ?? process.cwd());
  const seen = new Set<string>();
  const items: IntentEvidenceItem[] = [];
  let totalBytes = 0;

  for (const suppliedPath of paths) {
    const target = resolveTarget(root, suppliedPath);
    if (seen.has(target)) {
      throw new Error('A context file was supplied more than once.');
    }
    seen.add(target);
    const { contents, locator, bytes } = readStableRegularFile(
      root,
      target,
      suppliedPath,
    );
    totalBytes += bytes;
    if (totalBytes > MAX_CONTEXT_BYTES_TOTAL) {
      throw new Error('Context files exceed the total supported size.');
    }
    const text = redactSecretValues(
      contents,
      options.knownSecrets ?? [],
    );
    if (text.trim().length === 0 || TEXT_CONTROL_RE.test(text)) {
      throw new Error('A context file contains unsupported text.');
    }
    items.push({
      id: `context-${items.length + 1}`,
      kind: 'intent',
      basis: 'provided',
      source: { kind: 'context-file', locator },
      payload: { text },
    });
  }
  return deepFreeze(items);
}

function resolveRoot(cwd: string): string {
  try {
    const root = fs.realpathSync(cwd);
    if (!fs.statSync(root).isDirectory()) {
      throw new Error('not a directory');
    }
    return root;
  } catch {
    throw new Error('The context-file project root is unavailable.');
  }
}

function resolveTarget(root: string, suppliedPath: string): string {
  if (
    suppliedPath.length === 0 ||
    suppliedPath.length > MAX_CONTEXT_PATH_CHARS ||
    path.isAbsolute(suppliedPath) ||
    PATH_CONTROL_RE.test(suppliedPath)
  ) {
    throw new Error('A context file path is invalid.');
  }
  const target = path.resolve(root, suppliedPath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('A context file must stay inside the project root.');
  }
  return target;
}

function readStableRegularFile(
  root: string,
  target: string,
  suppliedPath: string,
): { contents: string; locator: string; bytes: number } {
  let descriptor: number | undefined;
  try {
    const before = fs.lstatSync(target);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size <= 0 ||
      before.size > MAX_CONTEXT_BYTES_PER_FILE
    ) {
      throw new Error('unsafe context target');
    }
    const realTarget = fs.realpathSync(target);
    if (
      realTarget !== target ||
      !realTarget.startsWith(`${root}${path.sep}`)
    ) {
      throw new Error('context target escaped');
    }
    const noFollow =
      typeof fs.constants.O_NOFOLLOW === 'number'
        ? fs.constants.O_NOFOLLOW
        : 0;
    descriptor = fs.openSync(
      target,
      fs.constants.O_RDONLY | noFollow,
    );
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      throw new Error('context target changed');
    }
    const buffer = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      buffer.length !== opened.size
    ) {
      throw new Error('context target changed during read');
    }
    let contents: string;
    try {
      contents = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new Error('context text is not UTF-8');
    }
    const locator = path
      .relative(root, target)
      .split(path.sep)
      .join('/');
    if (locator !== suppliedPath.split(path.sep).join('/')) {
      const normalized = path.normalize(suppliedPath);
      if (locator !== normalized.split(path.sep).join('/')) {
        throw new Error('context path is ambiguous');
      }
    }
    return { contents, locator, bytes: buffer.length };
  } catch {
    throw new Error('A context file is missing, unsafe, changed, or too large.');
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
  }
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
