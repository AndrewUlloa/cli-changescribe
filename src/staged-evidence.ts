import {
  createEvidenceBundle,
  type ChangeEvidenceItem,
  type ChangeStatus,
  type EvidenceBundle,
  type GitSnapshot,
} from './change-evidence';
import { defaultCommandRunner, type CommandRunner } from './subprocess';

const DEFAULT_MAX_PATCH_BYTES_PER_FILE = 1024 * 1024;
const DEFAULT_MAX_TOTAL_PATCH_BYTES = 4 * 1024 * 1024;
const MAX_SUPPORTED_PATCH_BYTES_PER_FILE = 2 * 1024 * 1024;
const MAX_SUPPORTED_TOTAL_PATCH_BYTES = 6 * 1024 * 1024;
const GIT_METADATA_BUFFER_BYTES = 10 * 1024 * 1024;
const PATCH_BUFFER_OVERHEAD_BYTES = 65_536;
const SHA_RE = /^[0-9a-f]{40,64}$/u;

export interface StagedEvidenceOptions {
  cwd?: string;
  maxPatchBytesPerFile?: number;
  maxTotalPatchBytes?: number;
}

export interface StagedGitSnapshot extends GitSnapshot {
  indexTreeSha: string;
}

export interface StagedEvidenceBundle
  extends Omit<EvidenceBundle, 'snapshot'> {
  readonly snapshot: Readonly<StagedGitSnapshot>;
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

export function collectStagedEvidence(
  options: StagedEvidenceOptions = {},
  runner: CommandRunner = defaultCommandRunner,
): StagedEvidenceBundle {
  const cwd = options.cwd ?? process.cwd();
  const maxPatchBytesPerFile = validateLimit(
    options.maxPatchBytesPerFile ?? DEFAULT_MAX_PATCH_BYTES_PER_FILE,
    'Per-file staged patch limit',
    MAX_SUPPORTED_PATCH_BYTES_PER_FILE,
  );
  const maxTotalPatchBytes = validateLimit(
    options.maxTotalPatchBytes ?? DEFAULT_MAX_TOTAL_PATCH_BYTES,
    'Total staged patch limit',
    MAX_SUPPORTED_TOTAL_PATCH_BYTES,
  );
  if (maxPatchBytesPerFile > maxTotalPatchBytes) {
    throw new Error(
      'Per-file staged patch limit cannot exceed the total staged patch limit.',
    );
  }

  const headSha = resolveHead(cwd, runner);
  const indexTreeSha = resolveIndexTree(cwd, runner);
  const diffArguments = buildDiffArguments(headSha, indexTreeSha);
  const changedPaths = parseNameStatus(
    runGit(
      [...diffArguments, '--name-status', '-z', '--'],
      cwd,
      runner,
      'Staged changed-path collection',
      GIT_METADATA_BUFFER_BYTES,
    ),
  );
  const counts = parseNumstat(
    runGit(
      [...diffArguments, '--numstat', '-z', '--'],
      cwd,
      runner,
      'Staged diff-stat collection',
      GIT_METADATA_BUFFER_BYTES,
    ),
  );

  const items: ChangeEvidenceItem[] = [];
  let totalPatchBytes = 0;
  for (const changedPath of changedPaths) {
    const status = mapStatus(changedPath.code);
    if (!status) {
      throw new Error(
        `Staged evidence contains unsupported status ${changedPath.code}.`,
      );
    }
    const pathCounts = counts.get(changedPath.path);
    if (!pathCounts) {
      throw new Error(
        `Staged diff statistics are unavailable for ${changedPath.path}.`,
      );
    }

    const patch = collectPatch(
      changedPath,
      headSha,
      indexTreeSha,
      cwd,
      runner,
      maxPatchBytesPerFile,
    );
    const patchBytes = Buffer.byteLength(patch);
    if (totalPatchBytes + patchBytes > maxTotalPatchBytes) {
      throw new Error(
        'Staged evidence exceeds the total patch limit. Split the commit or increase the configured limit.',
      );
    }
    totalPatchBytes += patchBytes;

    items.push({
      id: `change-${items.length + 1}`,
      kind: 'change',
      basis: 'observed',
      source: { kind: 'git-index', locator: changedPath.path },
      payload: {
        status,
        ...(changedPath.oldPath === undefined
          ? {}
          : { oldPath: changedPath.oldPath }),
        path: changedPath.path,
        additions: pathCounts.additions,
        deletions: pathCounts.deletions,
        binary: pathCounts.binary,
        patch,
      },
    });
  }

  if (counts.size !== changedPaths.length) {
    throw new Error(
      'Staged changed paths and diff statistics disagree. Retry the command.',
    );
  }

  assertSnapshotUnchanged(
    { headSha, indexTreeSha },
    cwd,
    runner,
    'while evidence was being collected',
  );

  const bundle = createEvidenceBundle({
    snapshot: { headSha },
    items,
    receipts: [],
    coverage: { complete: true, gaps: [] },
  });
  const stagedBundle: StagedEvidenceBundle = Object.freeze({
    ...bundle,
    snapshot: Object.freeze({ headSha, indexTreeSha }),
  });
  return stagedBundle;
}

export function assertStagedEvidenceSnapshotCurrent(
  snapshot: StagedGitSnapshot,
  cwd = process.cwd(),
  runner: CommandRunner = defaultCommandRunner,
): void {
  assertSnapshotUnchanged(snapshot, cwd, runner, 'after evidence collection');
}

function buildDiffArguments(
  headSha: string,
  indexTreeSha: string,
): readonly string[] {
  return [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '--find-renames',
    '--find-copies-harder',
    headSha,
    indexTreeSha,
  ];
}

function collectPatch(
  changedPath: ChangedPath,
  headSha: string,
  indexTreeSha: string,
  cwd: string,
  runner: CommandRunner,
  maxPatchBytesPerFile: number,
): string {
  const paths =
    changedPath.oldPath === undefined
      ? [changedPath.path]
      : [changedPath.oldPath, changedPath.path];
  const patch = runGit(
    [
      ...buildDiffArguments(headSha, indexTreeSha),
      '--binary',
      '--full-index',
      '--unified=3',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--',
      ...paths,
    ],
    cwd,
    runner,
    `Staged patch collection for ${changedPath.path}`,
    maxPatchBytesPerFile + PATCH_BUFFER_OVERHEAD_BYTES,
  );
  if (Buffer.byteLength(patch) > maxPatchBytesPerFile) {
    throw new Error(
      `Staged patch for ${changedPath.path} exceeds the per-file limit. Split the commit or increase the configured limit.`,
    );
  }
  if (patch.length === 0) {
    throw new Error(`Staged patch is unavailable for ${changedPath.path}.`);
  }
  return patch;
}

function assertSnapshotUnchanged(
  snapshot: Pick<StagedGitSnapshot, 'headSha' | 'indexTreeSha'>,
  cwd: string,
  runner: CommandRunner,
  timing: string,
): void {
  const currentHead = resolveHead(cwd, runner);
  if (currentHead !== snapshot.headSha) {
    throw new Error(
      `Repository HEAD changed ${timing}. Regenerate the artifact before mutation.`,
    );
  }
  const currentIndexTree = resolveIndexTree(cwd, runner);
  if (currentIndexTree !== snapshot.indexTreeSha) {
    throw new Error(
      `Repository index changed ${timing}. Regenerate the artifact before mutation.`,
    );
  }
}

function resolveHead(cwd: string, runner: CommandRunner): string {
  return resolveSha(
    runGit(
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      cwd,
      runner,
      'HEAD resolution',
      GIT_METADATA_BUFFER_BYTES,
    ),
    'HEAD',
  );
}

function resolveIndexTree(cwd: string, runner: CommandRunner): string {
  return resolveSha(
    runGit(
      ['write-tree'],
      cwd,
      runner,
      'Index tree resolution',
      GIT_METADATA_BUFFER_BYTES,
    ),
    'Index tree',
  );
}

function resolveSha(output: string, label: string): string {
  const sha = output.trim();
  if (!SHA_RE.test(sha)) {
    throw new Error(`${label} resolution returned an invalid Git object.`);
  }
  return sha;
}

function validateLimit(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function runGit(
  args: readonly string[],
  cwd: string,
  runner: CommandRunner,
  label: string,
  maxBuffer: number,
): string {
  try {
    return runner.exec('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer,
    });
  } catch {
    throw new Error(`${label} failed or exceeded its supported size.`);
  }
}

function parseNameStatus(output: string): ChangedPath[] {
  const fields = splitNullFields(output);
  const changes: ChangedPath[] = [];
  for (let index = 0; index < fields.length; ) {
    const code = fields[index++];
    if (!code) {
      throw new Error('Git returned an empty staged status.');
    }
    if (code.startsWith('R') || code.startsWith('C')) {
      const oldPath = fields[index++];
      const path = fields[index++];
      if (oldPath === undefined || path === undefined) {
        throw new Error('Git returned malformed staged rename or copy evidence.');
      }
      changes.push({ code, oldPath, path });
      continue;
    }
    const path = fields[index++];
    if (path === undefined) {
      throw new Error('Git returned malformed staged changed-path evidence.');
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
      throw new Error('Git returned an empty staged diff statistic.');
    }
    const firstTab = field.indexOf('\t');
    const secondTab = field.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      throw new Error('Git returned malformed staged diff statistics.');
    }
    const additionsText = field.slice(0, firstTab);
    const deletionsText = field.slice(firstTab + 1, secondTab);
    let path = field.slice(secondTab + 1);
    if (path.length === 0) {
      const oldPath = fields[index++];
      const newPath = fields[index++];
      if (oldPath === undefined || newPath === undefined) {
        throw new Error('Git returned malformed staged rename statistics.');
      }
      path = newPath;
    }
    const binary = additionsText === '-' || deletionsText === '-';
    if (binary && additionsText !== deletionsText) {
      throw new Error('Git returned inconsistent staged binary statistics.');
    }
    if (counts.has(path)) {
      throw new Error('Git returned duplicate staged diff statistics.');
    }
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
    throw new Error('Git returned an invalid staged diff count.');
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new Error('Git returned an unsupported staged diff count.');
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
