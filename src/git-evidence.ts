import { types as nodeTypes } from 'node:util';
import {
  createEvidenceBundle,
  type ChangeEvidenceItem,
  type ChangeStatus,
  type CoverageGap,
  type EvidenceBundle,
  type EvidenceItem,
  type HistoryEvidenceItem,
} from './change-evidence';
import { defaultCommandRunner, type CommandRunner } from './subprocess';

const DEFAULT_MAX_PATCH_CHARS_PER_FILE = 1024 * 1024;
const DEFAULT_MAX_TOTAL_PATCH_CHARS = 6 * 1024 * 1024;
const MAX_SUPPORTED_PATCH_CHARS_PER_FILE = 2 * 1024 * 1024;
const GIT_METADATA_BUFFER_BYTES = 10 * 1024 * 1024;
const MAX_HISTORY_COMMITS = 10_000;

export interface PullRequestEvidenceOptions {
  baseBranch: string;
  cwd?: string;
  fetch?: boolean;
  maxPatchCharsPerFile?: number;
  maxTotalPatchChars?: number;
  historyLimit?: number;
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

type PatchCollectionResult =
  | Readonly<{ kind: 'collected'; patch: string }>
  | Readonly<{
      kind: 'failed';
      reason: 'size-limit' | 'unavailable';
    }>;

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
  const historyLimit =
    options.historyLimit === undefined
      ? undefined
      : validateLimit(
          options.historyLimit,
          'History limit',
          MAX_HISTORY_COMMITS,
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

  const items: EvidenceItem[] = [];
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
      if (result.kind === 'failed') {
        gaps.push({
          source: 'git-patch',
          reason: result.reason,
          locator: changedPath.path,
        });
      } else if (
        result.patch.length > maxPatchCharsPerFile ||
        collectedPatchChars + result.patch.length > maxTotalPatchChars
      ) {
        gaps.push({
          source: 'git-patch',
          reason: 'size-limit',
          locator: changedPath.path,
          omittedBytes: Buffer.byteLength(result.patch),
        });
      } else {
        patch = result.patch;
        collectedPatchChars += result.patch.length;
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

  if (historyLimit !== undefined) {
    items.push(
      ...collectHistory(
        mergeBaseSha,
        headSha,
        historyLimit,
        cwd,
        runner,
      ),
    );
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

function collectHistory(
  mergeBaseSha: string,
  headSha: string,
  limit: number,
  cwd: string,
  runner: CommandRunner,
): HistoryEvidenceItem[] {
  const output = runGit(
    [
      'log',
      '--reverse',
      `--max-count=${limit}`,
      '--format=%H%x00%s%x00%b',
      '-z',
      `${mergeBaseSha}..${headSha}`,
      '--',
    ],
    cwd,
    runner,
    'Authored-history collection',
  );
  const fields = splitNullFields(output);
  if (fields.length % 3 !== 0) {
    throw new Error('Git returned malformed authored history.');
  }
  const history: HistoryEvidenceItem[] = [];
  for (let index = 0; index < fields.length; index += 3) {
    const sha = fields[index];
    const subject = fields[index + 1];
    const body = fields[index + 2];
    if (sha === undefined || subject === undefined || body === undefined) {
      throw new Error('Git returned malformed authored history.');
    }
    history.push({
      id: `history-${history.length + 1}`,
      kind: 'history',
      basis: 'provided',
      source: { kind: 'git-history', locator: sha },
      payload: { sha, subject, body },
    });
  }
  return history;
}

export function assertEvidenceSnapshotCurrent(
  snapshot: EvidenceBundle['snapshot'],
  cwd = process.cwd(),
  runner: CommandRunner = defaultCommandRunner,
): void {
  const currentHead = revParse('HEAD^{commit}', cwd, runner, 'HEAD');
  if (currentHead !== snapshot.headSha) {
    throw new Error(
      'Repository HEAD changed after evidence collection. Regenerate the artifact before mutation.',
    );
  }
  if (snapshot.baseRef !== undefined && snapshot.baseSha !== undefined) {
    const currentBase = revParse(
      `${snapshot.baseRef}^{commit}`,
      cwd,
      runner,
      'base',
    );
    if (currentBase !== snapshot.baseSha) {
      throw new Error(
        'Repository base changed after evidence collection. Regenerate the artifact before mutation.',
      );
    }
    if (snapshot.mergeBaseSha !== undefined) {
      const currentMergeBase = runGit(
        ['merge-base', currentBase, currentHead],
        cwd,
        runner,
        'Merge-base revalidation',
      ).trim();
      if (currentMergeBase !== snapshot.mergeBaseSha) {
        throw new Error(
          'Repository merge base changed after evidence collection. Regenerate the artifact before mutation.',
        );
      }
    }
  }
}

export function assertRemoteEvidenceBaseCurrent(
  snapshot: EvidenceBundle['snapshot'],
  baseBranch: string,
  cwd = process.cwd(),
  runner: CommandRunner = defaultCommandRunner,
): void {
  const validatedBase = validateBaseBranch(baseBranch, cwd, runner);
  if (snapshot.baseSha === undefined) {
    throw new Error(
      'Pull-request evidence did not pin a base commit before mutation.',
    );
  }
  const remoteRef = `refs/heads/${validatedBase}`;
  const remoteSha = remoteRefSha(
    remoteRef,
    cwd,
    runner,
    'Remote base is unavailable. Verify origin contains the selected base branch and retry.',
  );
  if (remoteSha !== snapshot.baseSha) {
    throw new Error(
      'Remote base changed after evidence collection. Regenerate the artifact before mutation.',
    );
  }
}

export function assertRemoteEvidenceHeadCurrent(
  snapshot: EvidenceBundle['snapshot'],
  headBranch: string,
  cwd = process.cwd(),
  runner: CommandRunner = defaultCommandRunner,
): void {
  const validatedHead = validateBaseBranch(headBranch, cwd, runner);
  const remoteSha = remoteRefSha(
    `refs/heads/${validatedHead}`,
    cwd,
    runner,
    'Remote feature branch is unavailable. Push the reviewed HEAD and retry.',
  );
  if (remoteSha !== snapshot.headSha) {
    throw new Error(
      'Remote feature branch does not match the reviewed evidence. Push the reviewed HEAD and retry.',
    );
  }
}

function remoteRefSha(
  remoteRef: string,
  cwd: string,
  runner: CommandRunner,
  unavailableMessage: string,
): string {
  let output: string;
  try {
    output = runner.exec(
      'git',
      ['ls-remote', '--exit-code', 'origin', remoteRef],
      {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        maxBuffer: GIT_METADATA_BUFFER_BYTES,
      },
    );
  } catch {
    throw new Error(unavailableMessage);
  }
  const match = /^(?<sha>[0-9a-f]{40,64})\t(?<ref>refs\/heads\/.+)\r?\n?$/u.exec(
    output,
  );
  if (
    match?.groups?.sha === undefined ||
    match.groups.ref !== remoteRef
  ) {
    throw new Error(unavailableMessage);
  }
  return match.groups.sha;
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
): PatchCollectionResult {
  const paths =
    changedPath.oldPath === undefined
      ? [changedPath.path]
      : [changedPath.oldPath, changedPath.path];
  try {
    const patch = runner.exec(
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
    return { kind: 'collected', patch };
  } catch (error) {
    return {
      kind: 'failed',
      reason: isNodeMaxBufferError(error) ? 'size-limit' : 'unavailable',
    };
  }
}

// Custom CommandRunner.exec implementations must retain native maxBuffer
// failures with code ENOBUFS and a syscall beginning with "spawnSync ". Both
// fields are required so unrelated ENOBUFS errors are never misclassified.
function isNodeMaxBufferError(error: unknown): boolean {
  if (!nodeTypes.isNativeError(error)) {
    return false;
  }
  const code = Reflect.get(error, 'code');
  const syscall = Reflect.get(error, 'syscall');
  return (
    code === 'ENOBUFS' &&
    typeof syscall === 'string' &&
    syscall.startsWith('spawnSync ')
  );
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
