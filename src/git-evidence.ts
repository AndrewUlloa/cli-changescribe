import {
  createEvidenceBundle,
  type ChangeEvidenceItem,
  type ChangeStatus,
  type CoverageGap,
  type EvidenceBundle,
} from './change-evidence';
import { defaultCommandRunner, type CommandRunner } from './subprocess';

const DEFAULT_MAX_PATCH_CHARS_PER_FILE = 1024 * 1024;
const DEFAULT_MAX_TOTAL_PATCH_CHARS = 6 * 1024 * 1024;
const MAX_SUPPORTED_PATCH_CHARS_PER_FILE = 2 * 1024 * 1024;
const GIT_METADATA_BUFFER_BYTES = 10 * 1024 * 1024;

export interface PullRequestEvidenceOptions {
  baseBranch: string;
  cwd?: string;
  fetch?: boolean;
  maxPatchCharsPerFile?: number;
  maxTotalPatchChars?: number;
}

interface ChangedPath {
  code: string;
  oldPath?: string;
  path: string;
}

interface DiffCounts {
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export function collectPullRequestEvidence(
  options: PullRequestEvidenceOptions,
  runner: CommandRunner = defaultCommandRunner,
): EvidenceBundle {
  const cwd = options.cwd ?? process.cwd();
  const baseBranch = validateBaseBranch(options.baseBranch, cwd, runner);
  const maxPatchCharsPerFile = validateLimit(
    options.maxPatchCharsPerFile ?? DEFAULT_MAX_PATCH_CHARS_PER_FILE,
    'Per-file patch limit',
    MAX_SUPPORTED_PATCH_CHARS_PER_FILE,
  );
  const maxTotalPatchChars = validateLimit(
    options.maxTotalPatchChars ?? DEFAULT_MAX_TOTAL_PATCH_CHARS,
    'Total patch limit',
    DEFAULT_MAX_TOTAL_PATCH_CHARS,
  );

  if (options.fetch !== false) {
    tryFetchBase(baseBranch, cwd, runner);
  }

  const headSha = revParse('HEAD^{commit}', cwd, runner, 'HEAD');
  const { baseRef, baseSha } = resolveBase(baseBranch, cwd, runner);
  const mergeBaseSha = runGit(
    ['merge-base', baseSha, headSha],
    cwd,
    runner,
    'Merge-base resolution',
  ).trim();

  const changedPaths = parseNameStatus(
    runGit(
      [
        'diff',
        '--no-ext-diff',
        '--find-renames',
        '--name-status',
        '-z',
        mergeBaseSha,
        headSha,
        '--',
      ],
      cwd,
      runner,
      'Changed-path collection',
    ),
  );
  const counts = parseNumstat(
    runGit(
      [
        'diff',
        '--no-ext-diff',
        '--find-renames',
        '--numstat',
        '-z',
        mergeBaseSha,
        headSha,
        '--',
      ],
      cwd,
      runner,
      'Diff-stat collection',
    ),
  );

  const items: ChangeEvidenceItem[] = [];
  const gaps: CoverageGap[] = [];
  let collectedPatchChars = 0;

  for (const changedPath of changedPaths) {
    const status = mapStatus(changedPath.code);
    if (!status) {
      gaps.push({
        source: 'git-diff',
        reason: 'unsupported',
        locator: changedPath.path,
      });
      continue;
    }

    const pathCounts = counts.get(changedPath.path);
    if (!pathCounts) {
      gaps.push({
        source: 'git-numstat',
        reason: 'unavailable',
        locator: changedPath.path,
      });
    }

    const binary = pathCounts?.binary ?? false;
    let patch: string | null = null;
    if (binary) {
      gaps.push({
        source: 'git-patch',
        reason: 'binary',
        locator: changedPath.path,
      });
    } else {
      const result = collectPatch(
        changedPath,
        mergeBaseSha,
        headSha,
        cwd,
        runner,
      );
      if (result === null) {
        gaps.push({
          source: 'git-patch',
          reason: 'size-limit',
          locator: changedPath.path,
        });
      } else if (
        result.length > maxPatchCharsPerFile ||
        collectedPatchChars + result.length > maxTotalPatchChars
      ) {
        gaps.push({
          source: 'git-patch',
          reason: 'size-limit',
          locator: changedPath.path,
          omittedBytes: Buffer.byteLength(result),
        });
      } else {
        patch = result;
        collectedPatchChars += result.length;
      }
    }

    items.push({
      id: `change-${items.length + 1}`,
      kind: 'change',
      basis: 'observed',
      source: {
        kind: 'git-diff',
        locator: changedPath.path,
      },
      payload: {
        status,
        ...(changedPath.oldPath === undefined
          ? {}
          : { oldPath: changedPath.oldPath }),
        path: changedPath.path,
        additions: pathCounts?.additions ?? null,
        deletions: pathCounts?.deletions ?? null,
        binary,
        patch,
      },
    });
  }

  const currentHead = revParse('HEAD^{commit}', cwd, runner, 'HEAD');
  if (currentHead !== headSha) {
    throw new Error(
      'Repository HEAD changed while evidence was being collected. Retry the command.',
    );
  }

  return createEvidenceBundle({
    snapshot: { headSha, baseRef, baseSha, mergeBaseSha },
    items,
    receipts: [],
    coverage: { complete: gaps.length === 0, gaps },
  });
}

function validateBaseBranch(
  value: string,
  cwd: string,
  runner: CommandRunner,
): string {
  if (
    value.trim() !== value ||
    value.length === 0 ||
    value.startsWith('-') ||
    /[\s\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error('Base branch is invalid.');
  }
  try {
    runner.exec('git', ['check-ref-format', '--branch', value], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch {
    throw new Error('Base branch is invalid.');
  }
  return value;
}

function validateLimit(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function tryFetchBase(
  baseBranch: string,
  cwd: string,
  runner: CommandRunner,
): void {
  const refspec = `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`;
  try {
    runner.exec('git', ['fetch', '--quiet', '--no-tags', 'origin', refspec], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: GIT_METADATA_BUFFER_BYTES,
    });
  } catch {
    // Local-only and offline repositories can still use an existing pinned ref.
  }
}

function resolveBase(
  baseBranch: string,
  cwd: string,
  runner: CommandRunner,
): { baseRef: string; baseSha: string } {
  for (const baseRef of [
    `refs/remotes/origin/${baseBranch}`,
    `refs/heads/${baseBranch}`,
  ]) {
    try {
      return {
        baseRef,
        baseSha: revParse(`${baseRef}^{commit}`, cwd, runner, 'base'),
      };
    } catch {
      // Try the next exact ref. Never resolve the user's value as an option.
    }
  }
  throw new Error('The selected base branch could not be resolved.');
}

function revParse(
  revision: string,
  cwd: string,
  runner: CommandRunner,
  label: string,
): string {
  const sha = runGit(
    ['rev-parse', '--verify', revision],
    cwd,
    runner,
    `${label} resolution`,
  ).trim();
  if (!/^[0-9a-f]{40,64}$/u.test(sha)) {
    throw new Error(`${label} resolution returned an invalid commit.`);
  }
  return sha;
}

function runGit(
  args: readonly string[],
  cwd: string,
  runner: CommandRunner,
  label: string,
): string {
  try {
    return runner.exec('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: GIT_METADATA_BUFFER_BYTES,
    });
  } catch {
    throw new Error(`${label} failed.`);
  }
}

function collectPatch(
  changedPath: ChangedPath,
  mergeBaseSha: string,
  headSha: string,
  cwd: string,
  runner: CommandRunner,
): string | null {
  const paths =
    changedPath.oldPath === undefined
      ? [changedPath.path]
      : [changedPath.oldPath, changedPath.path];
  try {
    return runner.exec(
      'git',
      [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--find-renames',
        '--unified=3',
        mergeBaseSha,
        headSha,
        '--',
        ...paths,
      ],
      {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        maxBuffer: MAX_SUPPORTED_PATCH_CHARS_PER_FILE + 65_536,
      },
    );
  } catch {
    return null;
  }
}

function parseNameStatus(output: string): ChangedPath[] {
  const fields = splitNullFields(output);
  const changes: ChangedPath[] = [];
  for (let index = 0; index < fields.length; ) {
    const code = fields[index++];
    if (!code) {
      break;
    }
    if (code.startsWith('R') || code.startsWith('C')) {
      const oldPath = fields[index++];
      const path = fields[index++];
      if (oldPath === undefined || path === undefined) {
        throw new Error('Git returned malformed rename or copy evidence.');
      }
      changes.push({ code, oldPath, path });
      continue;
    }
    const path = fields[index++];
    if (path === undefined) {
      throw new Error('Git returned malformed changed-path evidence.');
    }
    changes.push({ code, path });
  }
  return changes;
}

function parseNumstat(output: string): Map<string, DiffCounts> {
  const fields = splitNullFields(output);
  const counts = new Map<string, DiffCounts>();
  for (let index = 0; index < fields.length; ) {
    const field = fields[index++];
    if (!field) {
      break;
    }
    const firstTab = field.indexOf('\t');
    const secondTab = field.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      throw new Error('Git returned malformed diff statistics.');
    }
    const additionsText = field.slice(0, firstTab);
    const deletionsText = field.slice(firstTab + 1, secondTab);
    let path = field.slice(secondTab + 1);
    if (path.length === 0) {
      const oldPath = fields[index++];
      const newPath = fields[index++];
      if (oldPath === undefined || newPath === undefined) {
        throw new Error('Git returned malformed rename statistics.');
      }
      path = newPath;
    }
    const binary = additionsText === '-' || deletionsText === '-';
    counts.set(path, {
      additions: binary ? null : parseCount(additionsText),
      deletions: binary ? null : parseCount(deletionsText),
      binary,
    });
  }
  return counts;
}

function parseCount(value: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error('Git returned an invalid diff count.');
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new Error('Git returned an unsupported diff count.');
  }
  return count;
}

function splitNullFields(output: string): string[] {
  const fields = output.split('\0');
  if (fields.at(-1) === '') {
    fields.pop();
  }
  return fields;
}

function mapStatus(code: string): ChangeStatus | null {
  switch (code.charAt(0)) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type-changed';
    default:
      return null;
  }
}
