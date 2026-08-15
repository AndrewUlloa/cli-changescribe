import type {
  ArtifactDraft,
  ArtifactSectionKind,
  ConventionalTitleDraft,
} from './artifact-draft';
import {
  selectRenderableClaims,
  type DraftClaim,
  type EvidenceBundle,
  type VerificationReceipt,
} from './change-evidence';
import {
  reviewEditorialText,
  type EditorialPolicy,
} from './editorial-policy';

export const STANDARD_COMMIT_TYPES = Object.freeze([
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

export interface ConventionalTitlePolicy {
  allowedTypes?: readonly string[];
  scopeMode?: 'optional' | 'required' | 'forbidden';
  allowedScopes?: readonly string[];
  targetLength?: number;
  maximumLength?: number;
}

export interface RenderedTitle {
  readonly header: string;
  readonly warnings: readonly string[];
}

export interface RenderedPullRequest {
  readonly title: string;
  readonly body: string;
  readonly warnings: readonly string[];
}

export interface RenderedCommit {
  readonly title: string;
  readonly message: string;
  readonly warnings: readonly string[];
}

const SECTION_ORDER: readonly ArtifactSectionKind[] = [
  'summary',
  'changes',
  'rationale',
  'verification',
  'review-focus',
  'risks',
  'follow-ups',
];
const SECTION_HEADINGS: Readonly<Record<ArtifactSectionKind, string>> = {
  summary: 'Summary',
  changes: 'Changes',
  rationale: 'Why',
  verification: 'Verification',
  'review-focus': 'Review focus',
  risks: 'Risks',
  'follow-ups': 'Follow-ups',
};
const TYPE_RE = /^[a-z][a-z0-9-]{0,31}$/u;
const SCOPE_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/u;
const CONTROL_OR_LINE_RE =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

export function renderConventionalTitle(
  draft: ConventionalTitleDraft,
  policy: ConventionalTitlePolicy = {},
): RenderedTitle {
  const allowedTypes = new Set(
    policy.allowedTypes ?? STANDARD_COMMIT_TYPES,
  );
  if (
    allowedTypes.size === 0 ||
    [...allowedTypes].some((type) => !TYPE_RE.test(type))
  ) {
    throw new Error('Conventional Commit type policy is invalid.');
  }
  const scopeMode = policy.scopeMode ?? 'optional';
  if (
    scopeMode !== 'optional' &&
    scopeMode !== 'required' &&
    scopeMode !== 'forbidden'
  ) {
    throw new Error('Conventional Commit scope policy is invalid.');
  }
  const allowedScopes = policy.allowedScopes === undefined
    ? undefined
    : new Set(policy.allowedScopes);
  if (
    (allowedScopes !== undefined &&
      (allowedScopes.size === 0 ||
        [...allowedScopes].some((scope) => !SCOPE_RE.test(scope)))) ||
    (scopeMode === 'forbidden' && allowedScopes !== undefined)
  ) {
    throw new Error('Conventional Commit scope policy is invalid.');
  }
  const targetLength = policy.targetLength ?? 50;
  const maximumLength = policy.maximumLength ?? 72;
  validateLengths(targetLength, maximumLength);
  if (!TYPE_RE.test(draft.type) || !allowedTypes.has(draft.type)) {
    throw new Error('Conventional Commit type is not allowed.');
  }
  if (draft.scope !== undefined && !SCOPE_RE.test(draft.scope)) {
    throw new Error('Conventional Commit scope is invalid.');
  }
  let scope = draft.scope;
  if (scopeMode === 'forbidden') {
    scope = undefined;
  }
  if (
    scope !== undefined &&
    allowedScopes !== undefined &&
    !allowedScopes.has(scope)
  ) {
    if (scopeMode === 'required') {
      throw new Error(
        'Conventional Commit scope is not allowed by repository policy.',
      );
    }
    scope = undefined;
  }
  if (scopeMode === 'required' && scope === undefined) {
    throw new Error('Conventional Commit scope is required by repository policy.');
  }
  if (
    draft.subject.trim() !== draft.subject ||
    draft.subject.length === 0 ||
    CONTROL_OR_LINE_RE.test(draft.subject) ||
    Buffer.from(draft.subject, 'utf8').toString('utf8') !== draft.subject
  ) {
    throw new Error('Conventional Commit subject is invalid.');
  }
  if (draft.subject.endsWith('.')) {
    throw new Error('Conventional Commit subject must not end with a period.');
  }

  const header = `${draft.type}${
    scope === undefined ? '' : `(${scope})`
  }${draft.breaking ? '!' : ''}: ${draft.subject}`;
  if (header.length > maximumLength) {
    throw new Error(
      `Conventional Commit header exceeds the ${maximumLength}-character maximum.`,
    );
  }
  const warnings =
    header.length > targetLength
      ? [`Header exceeds the ${targetLength}-character target.`]
      : [];
  return Object.freeze({
    header,
    warnings: Object.freeze(warnings),
  });
}

export function renderPullRequestArtifact(
  draft: ArtifactDraft,
  evidence: EvidenceBundle,
  policy: ConventionalTitlePolicy = {},
  editorialPolicy: Partial<EditorialPolicy> = {},
): RenderedPullRequest {
  if (!evidence.coverage.complete) {
    throw new Error(
      'Pull-request evidence is incomplete. Resolve the reported coverage gaps and retry.',
    );
  }
  const renderedTitle = renderConventionalTitle(draft.title, policy);
  const renderable = selectRenderableClaims(evidence, draft.claims);
  const renderableById = new Map(renderable.map((claim) => [claim.id, claim]));
  const sectionsByKind = new Map(
    draft.sections.map((section) => [section.kind, section]),
  );
  const bodySections: string[] = [];

  for (const kind of SECTION_ORDER) {
    const lines =
      kind === 'verification'
        ? renderVerificationReceipts(evidence.receipts)
        : renderClaimSection(
            sectionsByKind.get(kind)?.claimIds ?? [],
            renderableById,
          );
    if (lines.length > 0) {
      bodySections.push(`## ${SECTION_HEADINGS[kind]}\n\n${lines.join('\n')}`);
    }
  }

  if (bodySections.length === 0) {
    throw new Error('Pull-request draft has no supported content to render.');
  }
  const body = `${bodySections.join('\n\n')}\n`;
  const editorialWarnings = reviewEditorialText(
    `${renderedTitle.header}\n${body}`,
    editorialPolicy,
  ).warnings.map((warning) => `[${warning.code}] ${warning.message}`);
  return Object.freeze({
    title: renderedTitle.header,
    body,
    warnings: Object.freeze([
      ...renderedTitle.warnings,
      ...editorialWarnings,
    ]),
  });
}

export function renderCommitArtifact(
  draft: ArtifactDraft,
  evidence: EvidenceBundle,
  policy: ConventionalTitlePolicy = {},
  editorialPolicy: Partial<EditorialPolicy> = {},
): RenderedCommit {
  if (!evidence.coverage.complete) {
    throw new Error(
      'Commit evidence is incomplete. Split the change or resolve the reported coverage gaps and retry.',
    );
  }
  const renderedTitle = renderConventionalTitle(draft.title, policy);
  const renderable = selectRenderableClaims(evidence, draft.claims);
  const renderableById = new Map(renderable.map((claim) => [claim.id, claim]));
  const sectionsByKind = new Map(
    draft.sections.map((section) => [section.kind, section]),
  );
  const bodyBlocks: string[] = [];

  const changeClaims = ['summary', 'changes']
    .flatMap(
      (kind) => sectionsByKind.get(kind as ArtifactSectionKind)?.claimIds ?? [],
    )
    .map((claimId) => renderableById.get(claimId))
    .filter(
      (claim): claim is DraftClaim =>
        claim !== undefined && claim.significance !== 'primary',
    );
  if (changeClaims.length === 1) {
    bodyBlocks.push(wrapParagraph(changeClaims[0].text));
  } else if (changeClaims.length > 1) {
    bodyBlocks.push(
      changeClaims
        .map((claim) => wrapParagraph(claim.text, '- ', '  '))
        .join('\n'),
    );
  }

  for (const claim of sectionClaims(
    sectionsByKind,
    renderableById,
    'rationale',
  )) {
    bodyBlocks.push(wrapParagraph(claim.text));
  }

  const passedReceipts =
    (sectionsByKind.get('verification')?.claimIds.length ?? 0) > 0
      ? evidence.receipts.filter((receipt) => receipt.status === 'passed')
      : [];
  if (passedReceipts.length > 0) {
    bodyBlocks.push(
      passedReceipts
        .map((receipt) =>
          wrapParagraph(`Verified: ${receipt.command.display}`),
        )
        .join('\n'),
    );
  }

  for (const claim of sectionClaims(
    sectionsByKind,
    renderableById,
    'risks',
  )) {
    bodyBlocks.push(wrapParagraph(`Risk: ${claim.text}`));
  }
  for (const claim of sectionClaims(
    sectionsByKind,
    renderableById,
    'follow-ups',
  )) {
    bodyBlocks.push(wrapParagraph(`Follow-up: ${claim.text}`));
  }

  const trailerBlock = draft.trailers
    .map((trailer) => wrapParagraph(`${trailer.token}: ${trailer.value}`))
    .join('\n');
  const message = [
    renderedTitle.header,
    ...bodyBlocks,
    ...(trailerBlock.length === 0 ? [] : [trailerBlock]),
  ].join('\n\n');
  const editorialWarnings = reviewEditorialText(
    message,
    editorialPolicy,
  ).warnings.map((warning) => `[${warning.code}] ${warning.message}`);
  return Object.freeze({
    title: renderedTitle.header,
    message,
    warnings: Object.freeze([
      ...renderedTitle.warnings,
      ...editorialWarnings,
    ]),
  });
}

function sectionClaims(
  sectionsByKind: ReadonlyMap<ArtifactSectionKind, ArtifactDraft['sections'][number]>,
  renderableById: ReadonlyMap<string, DraftClaim>,
  kind: ArtifactSectionKind,
): DraftClaim[] {
  return (sectionsByKind.get(kind)?.claimIds ?? []).flatMap((claimId) => {
    const claim = renderableById.get(claimId);
    return claim === undefined ? [] : [claim];
  });
}

function wrapParagraph(
  text: string,
  firstPrefix = '',
  continuationPrefix = '',
  width = 72,
): string {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) {
    return firstPrefix.trimEnd();
  }
  const lines: string[] = [];
  let prefix = firstPrefix;
  let line = prefix;
  for (const word of words) {
    const separator = line.length === prefix.length ? '' : ' ';
    if (
      line.length > prefix.length &&
      line.length + separator.length + word.length > width
    ) {
      lines.push(line);
      prefix = continuationPrefix;
      line = `${prefix}${word}`;
    } else {
      line += `${separator}${word}`;
    }
  }
  lines.push(line);
  return lines.join('\n');
}

function renderClaimSection(
  claimIds: readonly string[],
  renderableById: ReadonlyMap<string, DraftClaim>,
): string[] {
  return claimIds.flatMap((claimId) => {
    const claim = renderableById.get(claimId);
    return claim === undefined ? [] : [`- ${claim.text}`];
  });
}

function renderVerificationReceipts(
  receipts: readonly VerificationReceipt[],
): string[] {
  return receipts.map((receipt) => {
    if (receipt.status === 'passed') {
      return `- Passed: \`${receipt.command.display}\``;
    }
    if (receipt.status === 'failed') {
      return `- Failed (exit ${String(receipt.exitCode)}): \`${receipt.command.display}\``;
    }
    return `- Skipped: \`${receipt.command.display}\``;
  });
}

function validateLengths(target: number, maximum: number): void {
  if (
    !Number.isSafeInteger(target) ||
    !Number.isSafeInteger(maximum) ||
    target <= 0 ||
    maximum < target ||
    maximum > 256
  ) {
    throw new Error('Conventional Commit length policy is invalid.');
  }
}
