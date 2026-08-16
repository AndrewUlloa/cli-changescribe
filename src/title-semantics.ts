import type {
  ChangeEvidenceItem,
  EvidenceBundle,
  EvidenceItem,
} from './change-evidence';

export const SEMANTIC_COMMIT_TYPES = Object.freeze([
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
] as const);

export type SemanticCommitType = (typeof SEMANTIC_COMMIT_TYPES)[number];

export interface SemanticTitleCandidate {
  readonly type: string;
  readonly scope?: string;
}

export interface TitleSemanticsOptions {
  readonly allowedScopes?: readonly string[];
}

export interface TitleSemanticsEvaluation {
  readonly allowedTypes: readonly SemanticCommitType[];
  readonly preferredType?: SemanticCommitType;
  readonly scope?: string;
}

type ChangeDomain =
  | 'build'
  | 'ci'
  | 'docs'
  | 'source'
  | 'test'
  | 'other';

const TYPE_SET = new Set<string>(SEMANTIC_COMMIT_TYPES);
const SCOPE_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/u;
const SAFE_PATH_RE =
  /^(?![a-z]:)(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))(?!.*[\\\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]).+$/iu;
const TEST_FILE_RE = /(?:^|[._-])(?:test|tests|spec)(?:[._-]|$)|\.snap$/iu;
const DOCUMENT_FILE_RE = /\.(?:md|mdx|markdown|rst|adoc)$/iu;
const SOURCE_FILE_RE =
  /\.(?:[cm]?[jt]sx?|c|cc|cpp|cxx|h|hh|hpp|hxx|cs|go|java|kt|kts|php|py|rb|rs|scala|swift|vue|svelte|sh|bash|zsh|fish)$/iu;
const BUILD_FILE_RE =
  /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|deno\.lock|cargo\.(?:toml|lock)|gemfile(?:\.lock)?|composer\.(?:json|lock)|pyproject\.toml|poetry\.lock|uv\.lock|go\.(?:mod|sum)|dockerfile|makefile|cmakelists\.txt)$/iu;
const BUILD_CONFIG_RE =
  /^(?:(?:ts|js)config(?:\.[^.]+)*\.json|(?:vite|webpack|rollup|esbuild|turbo|nx|babel)\.config\.[^.]+)$/iu;
const CI_BASENAME_RE =
  /^(?:\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|jenkinsfile)$/iu;
const INTENT_PATTERNS: Readonly<Record<
  Exclude<SemanticCommitType, 'build' | 'chore' | 'ci' | 'docs' | 'test'>,
  RegExp
>> = Object.freeze({
  feat:
    /\b(?:add(?:s|ed|ing)?|introduc(?:e|es|ed|ing)|enabl(?:e|es|ed|ing)|support(?:s|ed|ing)?)\b[^\n.!?]{0,96}\b(?:user-visible|capabilit(?:y|ies)|feature|command|flag|option|api|endpoint|workflow|behavior)\b|\bnew\b[^\n.!?]{0,64}\b(?:capabilit(?:y|ies)|feature|command|flag|option|api|endpoint)\b/iu,
  fix:
    /\b(?:bug|defect|regression|incorrect|broken|crash(?:es|ed|ing)?|fail(?:s|ed|ure|ing)?|fix(?:es|ed|ing)?|correct(?:s|ed|ing)?|repair(?:s|ed|ing)?|resolv(?:e|es|ed|ing))\b/iu,
  perf:
    /\b(?:benchmark(?:s|ed|ing)?|latency|throughput|performance|faster|speed(?:s|up)?|memory usage|allocation(?:s)?|optimi[sz](?:e|es|ed|ing|ation))\b/iu,
  refactor:
    /\b(?:refactor(?:s|ed|ing)?|restructur(?:e|es|ed|ing)|reorgani[sz](?:e|es|ed|ing)|internal-only|no behavior change|without changing behavior)\b/iu,
  revert:
    /\b(?:revert(?:s|ed|ing)?|roll(?:s|ed|ing)? back|restore(?:s|d|ing)? (?:the )?previous)\b/iu,
  style:
    /\b(?:format(?:s|ted|ting)?|formatting-only|style-only|whitespace-only)\b/iu,
});

const EXPLICIT_TYPE_CONSTRAINTS = new Set([
  'change-type',
  'commit-type',
]);
const SUPPORTING_DOMAINS = new Set<ChangeDomain>(['docs', 'test']);

export function evaluateTitleSemantics(
  evidence: EvidenceBundle,
  options: TitleSemanticsOptions = {},
): Readonly<TitleSemanticsEvaluation> {
  if (!evidence.coverage.complete) {
    throw new Error('Title semantics require complete evidence coverage.');
  }
  const changes = evidence.items.filter(
    (item): item is ChangeEvidenceItem => item.kind === 'change',
  );
  if (changes.length === 0) {
    throw new Error('Title semantics require change evidence.');
  }
  for (const change of changes) {
    assertSafeChange(change);
  }
  const scopes = validateScopes(options.allowedScopes);
  const domains = new Set(changes.map(changeDomain));
  const exclusiveType = correspondingOnlyType(domains);
  const allowedTypes = exclusiveType === undefined
    ? semanticChangeTypes(evidence, changes)
    : [exclusiveType];
  const scope = highConfidenceScope(changes, scopes);
  return deepFreeze({
    allowedTypes,
    ...(allowedTypes.length === 1
      ? { preferredType: allowedTypes[0] }
      : {}),
    ...(scope === undefined ? {} : { scope }),
  });
}

export function assertTitleSemantics(
  title: SemanticTitleCandidate,
  evidence: EvidenceBundle,
  options: TitleSemanticsOptions = {},
): Readonly<TitleSemanticsEvaluation> {
  const evaluation = evaluateTitleSemantics(evidence, options);
  if (!evaluation.allowedTypes.includes(title.type as SemanticCommitType)) {
    throw new Error('Conventional Commit type is not supported by the evidence.');
  }
  if (
    title.scope !== undefined &&
    (evaluation.scope === undefined || title.scope !== evaluation.scope)
  ) {
    throw new Error('Conventional Commit scope is not supported by the evidence.');
  }
  return evaluation;
}

function semanticChangeTypes(
  evidence: EvidenceBundle,
  changes: readonly ChangeEvidenceItem[],
): readonly SemanticCommitType[] {
  if (isFormattingOnly(changes)) {
    return Object.freeze(['style']);
  }
  const explicit = explicitTypes(evidence.items);
  const intents = evidence.items.filter((item) => item.kind === 'intent');
  const history = evidence.items.filter((item) => item.kind === 'history');
  const detected = new Set<SemanticCommitType>(explicit);
  for (const intent of intents) {
    for (const [type, pattern] of Object.entries(INTENT_PATTERNS) as Array<
      [keyof typeof INTENT_PATTERNS, RegExp]
    >) {
      if (pattern.test(intent.payload.text)) {
        detected.add(type);
      }
    }
  }
  if (
    history.some((item) =>
      /^(?:revert\b|revert:)/iu.test(item.payload.subject.trim()),
    )
  ) {
    detected.add('revert');
  }
  if (detected.has('perf') && !hasPerformanceEvidence(evidence)) {
    detected.delete('perf');
  }
  if (detected.has('style') && !isFormattingOnly(changes)) {
    detected.delete('style');
  }
  if (detected.has('refactor')) {
    if (
      detected.has('feat') ||
      detected.has('fix') ||
      detected.has('perf') ||
      detected.has('revert')
    ) {
      detected.delete('refactor');
    }
  }
  const ordered = SEMANTIC_COMMIT_TYPES.filter((type) => detected.has(type));
  return Object.freeze(ordered.length === 0 ? ['chore'] : ordered);
}

function explicitTypes(items: readonly EvidenceItem[]): Set<SemanticCommitType> {
  const result = new Set<SemanticCommitType>();
  for (const item of items) {
    if (
      item.kind !== 'constraint' ||
      !EXPLICIT_TYPE_CONSTRAINTS.has(item.payload.name) ||
      typeof item.payload.value !== 'string' ||
      !TYPE_SET.has(item.payload.value)
    ) {
      continue;
    }
    result.add(item.payload.value as SemanticCommitType);
  }
  return result;
}

function hasPerformanceEvidence(evidence: EvidenceBundle): boolean {
  return (
    evidence.items.some(
      (item) =>
        item.kind === 'intent' && INTENT_PATTERNS.perf.test(item.payload.text),
    ) ||
    evidence.receipts.some(
      (receipt) =>
        receipt.status === 'passed' &&
        /(?:^|[\s:/_-])bench(?:mark)?(?:$|[\s:/_-])/iu.test(
          receipt.command.display,
        ),
    )
  );
}

function correspondingOnlyType(
  domains: ReadonlySet<ChangeDomain>,
): 'build' | 'ci' | 'docs' | 'test' | undefined {
  if (domains.size !== 1) {
    return undefined;
  }
  const domain = [...domains][0];
  return domain === 'build' ||
    domain === 'ci' ||
    domain === 'docs' ||
    domain === 'test'
    ? domain
    : undefined;
}

function changeDomain(change: ChangeEvidenceItem): ChangeDomain {
  const path = change.payload.path.toLocaleLowerCase('en-US');
  const segments = path.split('/');
  const basename = segments.at(-1) ?? '';
  const stem = basename.replace(/\.[^.]+$/u, '');
  if (
    path.startsWith('.github/workflows/') ||
    path.startsWith('.circleci/') ||
    path.startsWith('.buildkite/') ||
    CI_BASENAME_RE.test(basename)
  ) {
    return 'ci';
  }
  if (
    segments.some((segment) =>
      ['test', 'tests', '__tests__', 'spec', 'specs', 'fixture', 'fixtures']
        .includes(segment),
    ) ||
    TEST_FILE_RE.test(basename)
  ) {
    return 'test';
  }
  if (
    segments.some((segment) =>
      ['doc', 'docs', 'documentation'].includes(segment),
    ) ||
    DOCUMENT_FILE_RE.test(basename) ||
    [
      'changelog',
      'contributing',
      'license',
      'notice',
      'plan',
      'readme',
      'security',
      'support',
    ].includes(stem)
  ) {
    return 'docs';
  }
  if (BUILD_FILE_RE.test(basename) || BUILD_CONFIG_RE.test(basename)) {
    return 'build';
  }
  if (SOURCE_FILE_RE.test(basename)) {
    return 'source';
  }
  return 'other';
}

function isFormattingOnly(changes: readonly ChangeEvidenceItem[]): boolean {
  const sourceChanges = changes.filter(
    (change) => changeDomain(change) === 'source',
  );
  return (
    sourceChanges.length > 0 &&
    sourceChanges.length === changes.length &&
    sourceChanges.every((change) =>
      change.payload.patch === null
        ? false
        : formattingOnlyPatch(change.payload.patch),
    )
  );
}

function formattingOnlyPatch(patch: string): boolean {
  const removed: string[] = [];
  const added: string[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }
    if (line.startsWith('-')) {
      removed.push(normalizeFormatting(line.slice(1)));
    } else if (line.startsWith('+')) {
      added.push(normalizeFormatting(line.slice(1)));
    }
  }
  return (
    removed.length > 0 &&
    added.length > 0 &&
    removed.length === added.length &&
    removed.sort().every((line, index) => line === added.sort()[index])
  );
}

function normalizeFormatting(value: string): string {
  return value.replace(/\s+/gu, '');
}

function highConfidenceScope(
  changes: readonly ChangeEvidenceItem[],
  allowedScopes: readonly string[],
): string | undefined {
  if (allowedScopes.length === 0) {
    return undefined;
  }
  const substantive = changes.filter(
    (change) => !SUPPORTING_DOMAINS.has(changeDomain(change)),
  );
  if (substantive.length === 0) {
    return undefined;
  }
  const matches = allowedScopes.filter((scope) =>
    substantive.every((change) => pathContainsScope(change.payload.path, scope)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function pathContainsScope(path: string, scope: string): boolean {
  const pathTokens = path
    .toLocaleLowerCase('en-US')
    .split(/[\/._-]+/u)
    .filter(Boolean);
  const scopeTokens = scope.split(/[\/._-]+/u).filter(Boolean);
  if (scopeTokens.length === 0 || scopeTokens.length > pathTokens.length) {
    return false;
  }
  return pathTokens.some((_token, index) =>
    scopeTokens.every(
      (scopeToken, offset) => pathTokens[index + offset] === scopeToken,
    ),
  );
}

function validateScopes(scopes: readonly string[] | undefined): readonly string[] {
  if (scopes === undefined) {
    return Object.freeze([]);
  }
  if (scopes.length === 0 || scopes.length > 128) {
    throw new Error('Title semantic scope policy is invalid.');
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const scope of scopes) {
    if (!SCOPE_RE.test(scope) || seen.has(scope)) {
      throw new Error('Title semantic scope policy is invalid.');
    }
    seen.add(scope);
    result.push(scope);
  }
  return Object.freeze(result);
}

function assertSafeChange(change: ChangeEvidenceItem): void {
  const path = change.payload.path;
  if (
    !SAFE_PATH_RE.test(path) ||
    path.split('/').some((segment) => segment.length === 0 || segment === '.')
  ) {
    throw new Error('Title semantics received invalid change evidence.');
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
