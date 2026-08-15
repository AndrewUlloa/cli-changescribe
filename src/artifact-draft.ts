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

export interface ArtifactSectionDraft {
  kind: ArtifactSectionKind;
  claimIds: readonly string[];
}

export interface ArtifactTrailerDraft {
  token: string;
  value: string;
}

export interface ArtifactDraft {
  readonly schemaVersion: 1;
  readonly title: Readonly<ConventionalTitleDraft>;
  readonly claims: readonly DraftClaim[];
  readonly sections: readonly ArtifactSectionDraft[];
  readonly trailers: readonly ArtifactTrailerDraft[];
}

const MAX_DRAFT_CHARS = 256 * 1024;
const MAX_CLAIMS = 128;
const MAX_CLAIM_TEXT_CHARS = 8_192;
const MAX_SUBJECT_CHARS = 256;
const MAX_TRAILER_VALUE_CHARS = 8_192;
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

export function parseArtifactDraft(
  input: string,
  evidence: EvidenceBundle,
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

  const rawSections = boundedArray(root.sections, 'Artifact sections', 7);
  const sections = rawSections.map((value) => parseSection(value, claimIds));
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

  const rawTrailers = boundedArray(root.trailers, 'Artifact trailers', 64);
  const trailers = rawTrailers.map(parseTrailer);
  return deepFreeze({
    schemaVersion: 1,
    title,
    claims,
    sections,
    trailers,
  });
}

function parseTitle(value: unknown): ConventionalTitleDraft {
  const title = objectRecord(value, 'Artifact title');
  const allowedKeys = title.scope === undefined
    ? ['type', 'breaking', 'subject']
    : ['type', 'scope', 'breaking', 'subject'];
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
  return {
    type,
    ...(scope === undefined ? {} : { scope }),
    breaking: title.breaking,
    subject,
  };
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
  return {
    kind: section.kind as ArtifactSectionKind,
    claimIds: claimIdsForSection,
  };
}

function parseTrailer(value: unknown): ArtifactTrailerDraft {
  const trailer = objectRecord(value, 'Artifact trailer');
  requireExactKeys(trailer, ['token', 'value']);
  const token = boundedString(trailer.token, 'Artifact trailer token', 64);
  if (!TRAILER_TOKEN_RE.test(token)) {
    throw new Error('Artifact trailer token is invalid.');
  }
  const trailerValue = boundedString(
    trailer.value,
    'Artifact trailer value',
    MAX_TRAILER_VALUE_CHARS,
  );
  return { token, value: trailerValue };
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
