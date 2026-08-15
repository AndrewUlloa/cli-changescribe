import {
  assertSupportedClaims,
  type DraftClaim,
  type EvidenceBundle,
} from './change-evidence';

export type ArtifactSectionKind =
  | 'summary'
  | 'changes'
  | 'rationale'
  | 'verification'
  | 'review-focus'
  | 'risks'
  | 'follow-ups';

export interface ConventionalTitleDraft {
  type: string;
  scope?: string;
  breaking: boolean;
  subject: string;
}

export interface ArtifactTitleDraft extends ConventionalTitleDraft {
  claimId: string;
}

export interface ArtifactSelectionPolicy {
  readonly supportingPaths?: readonly string[];
  readonly primaryPaths?: readonly string[];
}

export type ChangeEvidenceRole = 'substantive' | 'supporting';

export interface ArtifactSectionDraft {
  kind: ArtifactSectionKind;
  claimIds: readonly string[];
}

export interface ArtifactTrailerDraft {
  token: string;
  value: string;
  evidenceIds: readonly string[];
}

export interface ArtifactDraft {
  readonly schemaVersion: 1;
  readonly title: Readonly<ArtifactTitleDraft>;
  readonly claims: readonly DraftClaim[];
  readonly sections: readonly ArtifactSectionDraft[];
  readonly trailers: readonly ArtifactTrailerDraft[];
}

export const PRIMARY_GROUNDING_REPAIR_INSTRUCTION =
  'Repair category: primary-grounding. Replace the title and primary claim with the smallest conservative factual change supported by every cited evidence ID. Prefer one direct evidence ID. Omit optional claims and trailers.';

export const MINIMAL_ARTIFACT_REPAIR_INSTRUCTION =
  'For this repair, return only a title, one observed primary change claim, one Summary section containing that claim, and an empty trailers array. Omit scope and every optional claim.';

export function artifactRepairCategory(instruction: string): string {
  return /^Repair category: ([a-z-]+)\./u.exec(instruction)?.[1] ??
    'artifact-structure';
}

export function artifactRepairInstruction(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (
    /JSON|schema version|must be an object|bounded array|missing or unknown fields/iu
      .test(message)
  ) {
    return 'Repair category: json-shape. Return one complete JSON object with exactly the required fields and value types.';
  }
  if (/title|Conventional Commit|breaking-change/iu.test(message)) {
    return 'Repair category: title-policy. Correct the title grammar, title-to-primary-claim match, type, scope, breaking marker, and 72-character hard limit.';
  }
  if (/evidence|observed|provided|substantive|supporting/iu.test(message)) {
    return 'Repair category: evidence-grounding. Remove unsupported claims or cite only evidence IDs that directly support each remaining claim.';
  }
  if (/section|claim|primary|summary/iu.test(message)) {
    return 'Repair category: claim-structure. Use one observed primary change in the sole summary and assign every other claim to exactly one compatible section.';
  }
  if (/trailer/iu.test(message)) {
    return 'Repair category: trailer-structure. Remove unsupported trailers and keep only trailers backed by provided evidence.';
  }
  return 'Repair category: artifact-structure. Return the smallest valid draft that follows the exact required shape and omits optional unsupported content.';
}

const MAX_DRAFT_CHARS = 256 * 1024;
const MAX_CLAIMS = 128;
const MAX_CLAIM_TEXT_CHARS = 8_192;
const MAX_SUBJECT_CHARS = 256;
const MAX_TRAILER_VALUE_CHARS = 8_192;
const MAX_SELECTION_PATTERNS = 128;
const MAX_SELECTION_PATTERN_CHARS = 512;
const ID_RE = /^[a-z][a-z0-9-]{0,63}$/u;
const TYPE_RE = /^[a-z][a-z0-9-]{0,31}$/u;
const SCOPE_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/u;
const TRAILER_TOKEN_RE = /^(?:BREAKING CHANGE|[A-Za-z][A-Za-z0-9-]*)$/u;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const SECTION_KINDS = new Set<ArtifactSectionKind>([
  'summary',
  'changes',
  'rationale',
  'verification',
  'review-focus',
  'risks',
  'follow-ups',
]);
const CLAIM_KINDS = new Set<DraftClaim['kind']>([
  'change',
  'rationale',
  'verification',
  'risk',
  'review-focus',
  'follow-up',
]);
const CLAIM_BASES = new Set<DraftClaim['basis']>([
  'observed',
  'provided',
  'inferred',
]);
const CLAIM_SIGNIFICANCE = new Set<DraftClaim['significance']>([
  'primary',
  'supporting',
  'incidental',
]);
const SECTION_CLAIM_KINDS: Readonly<Record<ArtifactSectionKind, ReadonlySet<DraftClaim['kind']>>> = {
  summary: new Set(['change']),
  changes: new Set(['change']),
  rationale: new Set(['rationale']),
  verification: new Set(['verification']),
  'review-focus': new Set(['review-focus']),
  risks: new Set(['risk']),
  'follow-ups': new Set(['follow-up']),
};
const DEFAULT_SUPPORTING_PATHS = Object.freeze([
  'docs/**',
  'documentation/**',
  'spec/**',
  'specs/**',
  'test/**',
  'tests/**',
  'fixture/**',
  'fixtures/**',
  'README*',
  'CHANGELOG*',
  'CONTRIBUTING*',
  'SECURITY*',
  'SUPPORT*',
  'LICENSE*',
  'NOTICE*',
  '*.md',
  '*.mdx',
  '*.test.*',
  '*.spec.*',
  '*.snap',
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.snap',
  '**/__tests__/**',
  '**/__snapshots__/**',
  '**/fixture/**',
  '**/fixtures/**',
  'package.json',
  '**/package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'uv.lock',
  '**/package-lock.json',
  '**/npm-shrinkwrap.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/bun.lock',
  '**/bun.lockb',
  '**/deno.lock',
  '**/Cargo.lock',
  '**/Gemfile.lock',
  '**/composer.lock',
  '**/poetry.lock',
  '**/uv.lock',
]);

export function parseArtifactDraft(
  input: string,
  evidence: EvidenceBundle,
  selectionPolicy: ArtifactSelectionPolicy = {},
): ArtifactDraft {
  if (input.length === 0 || input.length > MAX_DRAFT_CHARS) {
    throw new Error('Artifact draft is empty or exceeds its size limit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Artifact draft is not valid JSON.');
  }
  const root = objectRecord(parsed, 'Artifact draft');
  requireExactKeys(root, [
    'schemaVersion',
    'title',
    'claims',
    'sections',
    'trailers',
  ]);
  if (root.schemaVersion !== 1) {
    throw new Error('Artifact draft schema version is unsupported.');
  }

  const title = parseTitle(root.title);
  const rawClaims = boundedArray(root.claims, 'Artifact claims', MAX_CLAIMS);
  const claims = rawClaims.map(parseClaim);
  const claimIds = new Set(claims.map((claim) => claim.id));
  if (claimIds.size !== claims.length) {
    throw new Error('Artifact draft contains duplicate claim ids.');
  }
  assertSupportedClaims(evidence, claims);
  if (
    title.breaking &&
    !evidence.items.some(
      (item) =>
        item.kind === 'constraint' &&
        item.payload.name === 'breaking-change' &&
        item.payload.value === true,
    )
  ) {
    throw new Error(
      'A breaking title requires an explicit breaking-change constraint.',
    );
  }
  const rawSections = boundedArray(root.sections, 'Artifact sections', 7);
  const claimKinds = new Map(claims.map((claim) => [claim.id, claim.kind]));
  const sections = rawSections.map((value) =>
    parseSection(value, claimIds, claimKinds),
  );
  const sectionKinds = new Set(sections.map((section) => section.kind));
  if (sectionKinds.size !== sections.length) {
    throw new Error('Artifact draft contains duplicate sections.');
  }
  const referencedClaims = sections.flatMap((section) => [...section.claimIds]);
  if (new Set(referencedClaims).size !== referencedClaims.length) {
    throw new Error('Artifact claim is referenced by more than one section.');
  }
  if (
    referencedClaims.length !== claims.length ||
    claims.some((claim) => !referencedClaims.includes(claim.id))
  ) {
    throw new Error('Every artifact claim must appear in exactly one section.');
  }
  assertPrimarySelection(
    title,
    claims,
    sections,
    evidence,
    selectionPolicy,
  );

  const rawTrailers = boundedArray(root.trailers, 'Artifact trailers', 64);
  const evidenceById = new Map(evidence.items.map((item) => [item.id, item]));
  const trailers = rawTrailers.map((value) =>
    parseTrailer(value, evidenceById),
  );
  return deepFreeze({
    schemaVersion: 1,
    title,
    claims,
    sections,
    trailers,
  });
}

function parseTitle(value: unknown): ArtifactTitleDraft {
  const title = objectRecord(value, 'Artifact title');
  const allowedKeys = title.scope === undefined
    ? ['type', 'breaking', 'subject', 'claimId']
    : ['type', 'scope', 'breaking', 'subject', 'claimId'];
  requireExactKeys(title, allowedKeys);
  const type = boundedString(title.type, 'Artifact title type', 32);
  if (!TYPE_RE.test(type)) {
    throw new Error('Artifact title type is invalid.');
  }
  const scope = title.scope === undefined
    ? undefined
    : boundedString(title.scope, 'Artifact title scope', 64);
  if (scope !== undefined && !SCOPE_RE.test(scope)) {
    throw new Error('Artifact title scope is invalid.');
  }
  if (typeof title.breaking !== 'boolean') {
    throw new Error('Artifact title breaking marker must be a boolean.');
  }
  const subject = boundedString(
    title.subject,
    'Artifact title subject',
    MAX_SUBJECT_CHARS,
  );
  const claimId = boundedString(title.claimId, 'Artifact title claim id', 64);
  if (!ID_RE.test(claimId)) {
    throw new Error('Artifact title claim id is invalid.');
  }
  return {
    type,
    ...(scope === undefined ? {} : { scope }),
    breaking: title.breaking,
    subject,
    claimId,
  };
}

function assertPrimarySelection(
  title: ArtifactTitleDraft,
  claims: readonly DraftClaim[],
  sections: readonly ArtifactSectionDraft[],
  evidence: EvidenceBundle,
  policy: ArtifactSelectionPolicy,
): void {
  const primaryClaims = claims.filter(
    (claim) => claim.significance === 'primary',
  );
  if (
    primaryClaims.length !== 1 ||
    primaryClaims[0]?.kind !== 'change' ||
    primaryClaims[0].basis !== 'observed'
  ) {
    throw new Error(
      'Artifact draft requires exactly one observed primary change claim.',
    );
  }
  const primary = primaryClaims[0];
  const summarySections = sections.filter((section) => section.kind === 'summary');
  if (
    summarySections.length !== 1 ||
    summarySections[0]?.claimIds.length !== 1 ||
    summarySections[0].claimIds[0] !== primary.id
  ) {
    throw new Error(
      'Artifact summary must contain only the observed primary change claim.',
    );
  }
  if (title.claimId !== primary.id) {
    throw new Error('Artifact title must reference the primary change claim.');
  }
  if (
    normalizeTitleAnchor(title.subject) !== normalizeTitleAnchor(primary.text)
  ) {
    throw new Error(
      'Artifact title subject must match the primary change claim.',
    );
  }

  const changes = evidence.items.filter(
    (item): item is Extract<EvidenceBundle['items'][number], { kind: 'change' }> =>
      item.kind === 'change',
  );
  const substantiveIds = new Set(
    changes
      .filter((item) => !isSupportingChange(item, policy))
      .map((item) => item.id),
  );
  const changeIds = new Set(changes.map((item) => item.id));
  if (primary.evidenceIds.some((evidenceId) => !changeIds.has(evidenceId))) {
    throw new Error(
      'Artifact primary change may cite only observed change evidence.',
    );
  }
  if (
    substantiveIds.size > 0 &&
    primary.evidenceIds.some((evidenceId) => !substantiveIds.has(evidenceId))
  ) {
    throw new Error(
      'Artifact primary change may cite only substantive change evidence when available.',
    );
  }
}

function normalizeTitleAnchor(value: string): string {
  return value.replace(/\.$/u, '');
}

function isSupportingChange(
  item: Extract<EvidenceBundle['items'][number], { kind: 'change' }>,
  policy: ArtifactSelectionPolicy,
): boolean {
  if (!isSupportingPath(item.payload.path, policy)) {
    return false;
  }
  return item.payload.oldPath === undefined ||
    isSupportingPath(item.payload.oldPath, policy);
}

export function classifyChangeEvidenceRole(
  item: Extract<EvidenceBundle['items'][number], { kind: 'change' }>,
  policy: ArtifactSelectionPolicy = {},
): ChangeEvidenceRole {
  return isSupportingChange(item, policy) ? 'supporting' : 'substantive';
}

export function eligiblePrimaryChangeEvidenceIds(
  evidence: EvidenceBundle,
  policy: ArtifactSelectionPolicy = {},
): readonly string[] {
  const changes = evidence.items.filter(
    (item): item is Extract<EvidenceBundle['items'][number], { kind: 'change' }> =>
      item.kind === 'change',
  );
  const substantive = changes.filter(
    (item) => classifyChangeEvidenceRole(item, policy) === 'substantive',
  );
  return Object.freeze(
    (substantive.length > 0 ? substantive : changes).map((item) => item.id),
  );
}

function isSupportingPath(
  path: string,
  policy: ArtifactSelectionPolicy,
): boolean {
  const primaryPaths = validateSelectionPatterns(
    policy.primaryPaths ?? [],
    'primary',
  );
  if (primaryPaths.some((pattern) => matchesGlob(path, pattern))) {
    return false;
  }
  const supportingPaths = validateSelectionPatterns(
    policy.supportingPaths ?? DEFAULT_SUPPORTING_PATHS,
    'supporting',
  );
  return supportingPaths.some((pattern) => matchesGlob(path, pattern));
}

function validateSelectionPatterns(
  patterns: readonly string[],
  label: string,
): readonly string[] {
  if (!Array.isArray(patterns) || patterns.length > MAX_SELECTION_PATTERNS) {
    throw new Error(`Artifact ${label} path policy is invalid.`);
  }
  for (const pattern of patterns) {
    if (
      typeof pattern !== 'string' ||
      pattern.length === 0 ||
      pattern.length > MAX_SELECTION_PATTERN_CHARS ||
      CONTROL_RE.test(pattern) ||
      pattern.startsWith('/') ||
      pattern.includes('\\')
    ) {
      throw new Error(`Artifact ${label} path policy is invalid.`);
    }
  }
  return patterns;
}

function matchesGlob(path: string, pattern: string): boolean {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character?.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&') ?? '';
    }
  }
  source += '$';
  return new RegExp(source, 'u').test(path);
}

function parseClaim(value: unknown): DraftClaim {
  const claim = objectRecord(value, 'Artifact claim');
  requireExactKeys(claim, [
    'id',
    'kind',
    'text',
    'evidenceIds',
    'basis',
    'significance',
  ]);
  const id = boundedString(claim.id, 'Artifact claim id', 64);
  if (!ID_RE.test(id)) {
    throw new Error('Artifact claim id is invalid.');
  }
  if (!CLAIM_KINDS.has(claim.kind as DraftClaim['kind'])) {
    throw new Error('Artifact claim kind is invalid.');
  }
  const kind = claim.kind as DraftClaim['kind'];
  const text = boundedString(
    claim.text,
    'Artifact claim text',
    MAX_CLAIM_TEXT_CHARS,
  );
  const evidenceIds = boundedArray(
    claim.evidenceIds,
    'Artifact claim evidence',
    64,
  ).map((evidenceId) => {
    const idValue = boundedString(evidenceId, 'Evidence reference', 64);
    if (!ID_RE.test(idValue)) {
      throw new Error('Evidence reference id is invalid.');
    }
    return idValue;
  });
  if (evidenceIds.length === 0 || new Set(evidenceIds).size !== evidenceIds.length) {
    throw new Error('Artifact claim evidence references are invalid.');
  }
  if (!CLAIM_BASES.has(claim.basis as DraftClaim['basis'])) {
    throw new Error('Artifact claim basis is invalid.');
  }
  if (
    !CLAIM_SIGNIFICANCE.has(
      claim.significance as DraftClaim['significance'],
    )
  ) {
    throw new Error('Artifact claim significance is invalid.');
  }
  return {
    id,
    kind,
    text,
    evidenceIds,
    basis: claim.basis as DraftClaim['basis'],
    significance: claim.significance as DraftClaim['significance'],
  };
}

function parseSection(
  value: unknown,
  claimIds: ReadonlySet<string>,
  claimKinds: ReadonlyMap<string, DraftClaim['kind']>,
): ArtifactSectionDraft {
  const section = objectRecord(value, 'Artifact section');
  requireExactKeys(section, ['kind', 'claimIds']);
  if (!SECTION_KINDS.has(section.kind as ArtifactSectionKind)) {
    throw new Error('Artifact section kind is invalid.');
  }
  const claimIdsForSection = boundedArray(
    section.claimIds,
    'Artifact section claims',
    MAX_CLAIMS,
  ).map((claimId) => {
    const id = boundedString(claimId, 'Artifact section claim id', 64);
    if (!claimIds.has(id)) {
      throw new Error('Artifact section references an unknown claim.');
    }
    return id;
  });
  if (new Set(claimIdsForSection).size !== claimIdsForSection.length) {
    throw new Error('Artifact section contains duplicate claim references.');
  }
  const kind = section.kind as ArtifactSectionKind;
  if (
    claimIdsForSection.some((claimId) => {
      const claimKind = claimKinds.get(claimId);
      return claimKind === undefined || !SECTION_CLAIM_KINDS[kind].has(claimKind);
    })
  ) {
    throw new Error('Artifact claim is assigned to an incompatible section.');
  }
  return {
    kind,
    claimIds: claimIdsForSection,
  };
}

function parseTrailer(
  value: unknown,
  evidenceById: ReadonlyMap<string, EvidenceBundle['items'][number]>,
): ArtifactTrailerDraft {
  const trailer = objectRecord(value, 'Artifact trailer');
  requireExactKeys(trailer, ['token', 'value', 'evidenceIds']);
  const token = boundedString(trailer.token, 'Artifact trailer token', 64);
  if (!TRAILER_TOKEN_RE.test(token)) {
    throw new Error('Artifact trailer token is invalid.');
  }
  const trailerValue = boundedString(
    trailer.value,
    'Artifact trailer value',
    MAX_TRAILER_VALUE_CHARS,
  );
  const trailerEvidenceIds = boundedArray(
    trailer.evidenceIds,
    'Artifact trailer evidence',
    64,
  ).map((evidenceId) => {
    const id = boundedString(evidenceId, 'Artifact trailer evidence id', 64);
    if (!ID_RE.test(id) || evidenceById.get(id)?.basis !== 'provided') {
      throw new Error('Artifact trailer evidence is invalid.');
    }
    return id;
  });
  if (
    trailerEvidenceIds.length === 0 ||
    new Set(trailerEvidenceIds).size !== trailerEvidenceIds.length
  ) {
    throw new Error('Artifact trailer evidence is invalid.');
  }
  return { token, value: trailerValue, evidenceIds: trailerEvidenceIds };
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedArray(
  value: unknown,
  label: string,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be a bounded array.`);
  }
  return value;
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maximum ||
    CONTROL_RE.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new Error('Artifact draft contains missing or unknown fields.');
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
