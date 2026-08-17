import type {
  ChangeEvidenceItem,
  ChangeStatus,
  EvidenceBundle,
} from './change-evidence';

export const CHANGE_MAP_CATEGORY_ORDER = Object.freeze([
  'implementation',
  'tests',
  'documentation',
  'configuration',
  'other',
] as const);

export type ChangeMapCategory =
  (typeof CHANGE_MAP_CATEGORY_ORDER)[number];

export interface ChangeMapCountSummary {
  /** The exact subtotal for files whose line count is known. */
  readonly value: number;
  /** True only when every file has a known count. */
  readonly complete: boolean;
  readonly unknownFiles: number;
}

export interface ChangeMapFile {
  readonly evidenceId: string;
  readonly category: ChangeMapCategory;
  readonly status: ChangeStatus;
  readonly path: string;
  readonly oldPath?: string;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly binary: boolean;
}

export interface ChangeMapGroup {
  readonly category: ChangeMapCategory;
  readonly fileCount: number;
  readonly additions: Readonly<ChangeMapCountSummary>;
  readonly deletions: Readonly<ChangeMapCountSummary>;
  readonly binaryFiles: number;
  readonly files: readonly Readonly<ChangeMapFile>[];
}

export interface ChangeMap {
  readonly fileCount: number;
  readonly additions: Readonly<ChangeMapCountSummary>;
  readonly deletions: Readonly<ChangeMapCountSummary>;
  readonly binaryFiles: number;
  readonly groups: readonly Readonly<ChangeMapGroup>[];
}

const UNSAFE_PATH_RE =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const TEST_FILE_RE = /(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/iu;
const SNAPSHOT_FILE_RE = /\.snap$/iu;
const DOCUMENT_FILE_RE = /\.(?:md|mdx|markdown|rst|adoc)$/iu;
const SOURCE_FILE_RE =
  /\.(?:[cm]?[jt]sx?|mts|cts|py|pyi|rb|php|java|kt|kts|swift|go|rs|c|cc|cpp|cxx|h|hh|hpp|hxx|cs|fs|fsx|scala|sh|bash|zsh|fish|ps1|sql|vue|svelte|astro|ex|exs|erl|hrl|clj|cljs|cljc|dart|lua|r|sol|zig)$/iu;
const CONFIG_FILE_RE =
  /(?:^|\/)(?:[^/]+\.)?(?:config|conf)\.(?:[cm]?[jt]s|json|ya?ml|toml)$/iu;
const LOCKFILE_RE =
  /^(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|deno\.lock|cargo\.lock|gemfile\.lock|composer\.lock|poetry\.lock|uv\.lock)$/iu;

const TEST_SEGMENTS = new Set([
  'test',
  'tests',
  '__tests__',
  'fixture',
  'fixtures',
  '__fixtures__',
  '__snapshots__',
]);
const DOCUMENTATION_SEGMENTS = new Set([
  'doc',
  'docs',
  'documentation',
  'spec',
  'specs',
]);
const CONFIGURATION_SEGMENTS = new Set([
  '.github',
  '.circleci',
  '.changeset',
]);
const IMPLEMENTATION_SEGMENTS = new Set([
  'src',
  'lib',
  'app',
  'apps',
  'package',
  'packages',
  'bin',
  'cmd',
  'script',
  'scripts',
  'server',
  'client',
  'api',
]);
const DOCUMENTATION_BASENAMES = new Set([
  'readme',
  'changelog',
  'contributing',
  'security',
  'support',
  'license',
  'notice',
  'authors',
  'code_of_conduct',
]);
const CONFIGURATION_BASENAMES = new Set([
  'package.json',
  'composer.json',
  'cargo.toml',
  'gemfile',
  'podfile',
  'go.mod',
  'go.sum',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'gradle.properties',
  'makefile',
  'dockerfile',
  'procfile',
  'justfile',
]);
const VALID_STATUSES = new Set<ChangeStatus>([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'type-changed',
]);

export function buildChangeMap(evidence: EvidenceBundle): ChangeMap {
  if (
    typeof evidence !== 'object' ||
    evidence === null ||
    !Array.isArray(Reflect.get(evidence, 'items'))
  ) {
    throw new Error('Change-map evidence is invalid.');
  }

  const seenIds = new Set<string>();
  const files = evidence.items
    .filter((item): item is ChangeEvidenceItem => item.kind === 'change')
    .map((item) => {
      validateChange(item, seenIds);
      return toChangeMapFile(item);
    });
  const groups = CHANGE_MAP_CATEGORY_ORDER.map((category) => {
    const categoryFiles = files
      .filter((file) => file.category === category)
      .sort(compareFiles);
    return summarizeGroup(category, categoryFiles);
  });
  const orderedFiles = groups.flatMap((group) => [...group.files]);

  return deepFreeze({
    fileCount: orderedFiles.length,
    additions: summarizeCounts(orderedFiles, 'additions'),
    deletions: summarizeCounts(orderedFiles, 'deletions'),
    binaryFiles: orderedFiles.filter((file) => file.binary).length,
    groups,
  });
}

function toChangeMapFile(item: ChangeEvidenceItem): ChangeMapFile {
  const category = classifyPath(item.payload.path);
  return {
    evidenceId: item.id,
    category,
    status: item.payload.status,
    path: item.payload.path,
    ...(item.payload.oldPath === undefined
      ? {}
      : { oldPath: item.payload.oldPath }),
    additions: item.payload.additions,
    deletions: item.payload.deletions,
    binary: item.payload.binary,
  };
}

function classifyPath(path: string): ChangeMapCategory {
  const lowerPath = path.toLocaleLowerCase('en-US');
  const segments = lowerPath.split('/');
  const basename = segments.at(-1) ?? '';
  const stem = basename.replace(/\.(?:md|mdx|markdown|rst|adoc)$/iu, '');

  if (segments.some((segment) => TEST_SEGMENTS.has(segment))) {
    return 'tests';
  }
  if (segments.some((segment) => DOCUMENTATION_SEGMENTS.has(segment))) {
    return 'documentation';
  }
  if (
    segments.some((segment) => CONFIGURATION_SEGMENTS.has(segment)) ||
    isConfigurationBasename(basename) ||
    CONFIG_FILE_RE.test(lowerPath) ||
    /\.(?:ya?ml|toml)$/iu.test(basename)
  ) {
    return 'configuration';
  }
  if (TEST_FILE_RE.test(lowerPath) || SNAPSHOT_FILE_RE.test(lowerPath)) {
    return 'tests';
  }
  if (
    DOCUMENT_FILE_RE.test(lowerPath) ||
    DOCUMENTATION_BASENAMES.has(stem)
  ) {
    return 'documentation';
  }
  if (
    segments.some((segment) => IMPLEMENTATION_SEGMENTS.has(segment)) ||
    SOURCE_FILE_RE.test(lowerPath)
  ) {
    return 'implementation';
  }
  return 'other';
}

function isConfigurationBasename(basename: string): boolean {
  return (
    CONFIGURATION_BASENAMES.has(basename) ||
    LOCKFILE_RE.test(basename) ||
    /^(?:ts|js)config(?:\.[^.]+)*\.json$/iu.test(basename) ||
    /^(?:eslint|prettier|stylelint|commitlint|lint-staged)(?:\.config)?\./iu
      .test(basename) ||
    /^(?:\.env(?:\..+)?|\.[a-z0-9][a-z0-9._-]*rc(?:\..+)?)$/iu
      .test(basename)
  );
}

function validateChange(
  item: ChangeEvidenceItem,
  seenIds: Set<string>,
): void {
  if (typeof item.id !== 'string' || item.id.length === 0) {
    throw new Error('Change-map evidence identifier is invalid.');
  }
  if (seenIds.has(item.id)) {
    throw new Error('Change-map evidence contains duplicate identifiers.');
  }
  seenIds.add(item.id);
  validatePath(item.payload.path, 'Change path');
  if (item.payload.oldPath !== undefined) {
    validatePath(item.payload.oldPath, 'Change old path');
  }
  if (!VALID_STATUSES.has(item.payload.status)) {
    throw new Error('Change-map status is invalid.');
  }
  validateCount(item.payload.additions);
  validateCount(item.payload.deletions);
  if (typeof item.payload.binary !== 'boolean') {
    throw new Error('Change-map binary metadata is invalid.');
  }
}

function validatePath(value: string, label: string): void {
  const segments = typeof value === 'string' ? value.split('/') : [];
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2_048 ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[a-z]:[/\\]/iu.test(value) ||
    value.includes('\\') ||
    segments.some(
      (segment) =>
        segment.length === 0 || segment === '.' || segment === '..',
    ) ||
    UNSAFE_PATH_RE.test(value)
  ) {
    throw new Error(`${label} is unsafe.`);
  }
}

function validateCount(value: number | null): void {
  if (
    value !== null &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error('Change-map line-count metadata is invalid.');
  }
}

function summarizeGroup(
  category: ChangeMapCategory,
  files: readonly ChangeMapFile[],
): ChangeMapGroup {
  return {
    category,
    fileCount: files.length,
    additions: summarizeCounts(files, 'additions'),
    deletions: summarizeCounts(files, 'deletions'),
    binaryFiles: files.filter((file) => file.binary).length,
    files: [...files],
  };
}

function summarizeCounts(
  files: readonly ChangeMapFile[],
  field: 'additions' | 'deletions',
): ChangeMapCountSummary {
  let value = 0;
  let unknownFiles = 0;
  for (const file of files) {
    const count = file[field];
    if (count === null) {
      unknownFiles += 1;
    } else {
      value += count;
    }
  }
  return {
    value,
    complete: unknownFiles === 0,
    unknownFiles,
  };
}

function compareFiles(left: ChangeMapFile, right: ChangeMapFile): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.oldPath ?? '', right.oldPath ?? '') ||
    compareText(left.evidenceId, right.evidenceId)
  );
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
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
