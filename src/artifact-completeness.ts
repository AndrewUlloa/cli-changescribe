import {
  classifyChangeEvidenceRole,
  type ArtifactDraft,
  type ArtifactSelectionPolicy,
} from './artifact-draft';
import type {
  ChangeEvidenceItem,
  EvidenceBundle,
} from './change-evidence';

export const SUBSTANTIVE_COVERAGE_REPAIR_INSTRUCTION =
  'Repair category: substantive-coverage. Return one complete full draft from the original evidence. Add conservative observed change claims until every substantive change evidence ID is cited by at least one change claim. Preserve supported detail and do not return a minimal primary-only artifact.';

export interface ArtifactCompletenessReport {
  readonly complete: boolean;
  readonly requiredEvidenceIds: readonly string[];
  readonly coveredEvidenceIds: readonly string[];
  readonly missingEvidenceIds: readonly string[];
}

export interface ArtifactNarrativeBreadthReport {
  readonly complete: boolean;
  readonly requiredClaimCount: number;
  readonly maximumEvidenceIdsPerClaim: number;
  readonly detailClaimIds: readonly string[];
  readonly coveredEvidenceIds: readonly string[];
  readonly missingEvidenceIds: readonly string[];
  readonly overbroadClaimIds: readonly string[];
}

export class IncompleteArtifactCoverageError extends Error {
  readonly code = 'incomplete_artifact_coverage';

  constructor() {
    super('Pull-request artifact does not cover every substantive change.');
    this.name = 'IncompleteArtifactCoverageError';
  }
}

export class IncompleteArtifactNarrativeError extends Error {
  readonly code = 'incomplete_artifact_narrative';

  constructor() {
    super('Pull-request artifact needs more grounded change detail.');
    this.name = 'IncompleteArtifactNarrativeError';
  }
}

/**
 * Evaluates a draft after critic filtering. Callers own that ordering: this
 * helper deliberately counts only claims present in the supplied draft.
 */
export function evaluateArtifactCompleteness(
  draft: Pick<ArtifactDraft, 'claims'>,
  evidence: EvidenceBundle,
  selectionPolicy: ArtifactSelectionPolicy = {},
): ArtifactCompletenessReport {
  const requiredEvidenceIds = substantiveChangeEvidenceIds(
    evidence,
    selectionPolicy,
  );
  const required = new Set(requiredEvidenceIds);
  const covered = new Set<string>();

  for (const claim of draft.claims) {
    if (claim.kind !== 'change' || claim.basis !== 'observed') {
      continue;
    }
    for (const evidenceId of claim.evidenceIds) {
      if (required.has(evidenceId)) {
        covered.add(evidenceId);
      }
    }
  }

  const coveredEvidenceIds = [...covered].sort(compareText);
  const missingEvidenceIds = requiredEvidenceIds.filter(
    (evidenceId) => !covered.has(evidenceId),
  );
  return deepFreeze({
    complete: missingEvidenceIds.length === 0,
    requiredEvidenceIds,
    coveredEvidenceIds,
    missingEvidenceIds,
  });
}

export function substantiveChangeEvidenceIds(
  evidence: EvidenceBundle,
  selectionPolicy: ArtifactSelectionPolicy = {},
): readonly string[] {
  return Object.freeze(
    evidence.items
      .filter((item): item is ChangeEvidenceItem => item.kind === 'change')
      .filter(
        (item) =>
          classifyChangeEvidenceRole(item, selectionPolicy) === 'substantive',
      )
      .map((item) => item.id)
      .sort(compareText),
  );
}

export function evaluateArtifactNarrativeBreadth(
  draft: Pick<ArtifactDraft, 'claims'>,
  evidence: EvidenceBundle,
  selectionPolicy: ArtifactSelectionPolicy = {},
): ArtifactNarrativeBreadthReport {
  const requiredEvidenceIds = substantiveChangeEvidenceIds(
    evidence,
    selectionPolicy,
  );
  const required = new Set(requiredEvidenceIds);
  const requiredClaimCount =
    requiredEvidenceIds.length < 4
      ? 0
      : Math.min(6, Math.ceil(Math.sqrt(requiredEvidenceIds.length)));
  const maximumEvidenceIdsPerClaim =
    requiredClaimCount === 0
      ? 0
      : Math.ceil(requiredEvidenceIds.length / requiredClaimCount) + 1;

  if (requiredClaimCount === 0) {
    return deepFreeze({
      complete: true,
      requiredClaimCount,
      maximumEvidenceIdsPerClaim,
      detailClaimIds: [],
      coveredEvidenceIds: [],
      missingEvidenceIds: [],
      overbroadClaimIds: [],
    });
  }

  const detailClaimIds: string[] = [];
  const overbroadClaimIds: string[] = [];
  const covered = new Set<string>();
  for (const claim of draft.claims) {
    if (
      claim.kind !== 'change' ||
      claim.basis !== 'observed' ||
      claim.significance === 'primary'
    ) {
      continue;
    }
    const substantiveIds = [...new Set(
      claim.evidenceIds.filter((evidenceId) => required.has(evidenceId)),
    )];
    if (substantiveIds.length === 0) {
      continue;
    }
    if (substantiveIds.length > maximumEvidenceIdsPerClaim) {
      overbroadClaimIds.push(claim.id);
      continue;
    }
    detailClaimIds.push(claim.id);
    for (const evidenceId of substantiveIds) {
      covered.add(evidenceId);
    }
  }

  detailClaimIds.sort(compareText);
  overbroadClaimIds.sort(compareText);
  const coveredEvidenceIds = [...covered].sort(compareText);
  const missingEvidenceIds = requiredEvidenceIds.filter(
    (evidenceId) => !covered.has(evidenceId),
  );
  return deepFreeze({
    complete:
      detailClaimIds.length >= requiredClaimCount &&
      missingEvidenceIds.length === 0 &&
      overbroadClaimIds.length === 0,
    requiredClaimCount,
    maximumEvidenceIdsPerClaim,
    detailClaimIds,
    coveredEvidenceIds,
    missingEvidenceIds,
    overbroadClaimIds,
  });
}

export function assertArtifactCompleteness(
  draft: Pick<ArtifactDraft, 'claims'>,
  evidence: EvidenceBundle,
  selectionPolicy: ArtifactSelectionPolicy = {},
): void {
  if (!evaluateArtifactCompleteness(draft, evidence, selectionPolicy).complete) {
    throw new IncompleteArtifactCoverageError();
  }
}

export function assertArtifactNarrativeBreadth(
  draft: Pick<ArtifactDraft, 'claims'>,
  evidence: EvidenceBundle,
  selectionPolicy: ArtifactSelectionPolicy = {},
): void {
  if (
    !evaluateArtifactNarrativeBreadth(draft, evidence, selectionPolicy).complete
  ) {
    throw new IncompleteArtifactNarrativeError();
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
