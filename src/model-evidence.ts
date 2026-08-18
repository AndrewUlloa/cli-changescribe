import {
  createEvidenceBundle,
  serializeEvidenceBundle,
  type EvidenceBundle,
  type EvidenceItem,
  type HistoryEvidenceItem,
} from './change-evidence';
import type {
  HistoryChangeAdjacency,
  PullRequestEvidenceSnapshot,
} from './git-evidence';
import { protectRepositoryPolicyEvidence } from './repository-policy';
import { redactSecretValues } from './runtime-config';

const HIGH_CONFIDENCE_CREDENTIAL_PATTERNS = Object.freeze([
  /(?:^|[^a-z0-9])gsk_[a-z0-9]{20,}(?:$|[^a-z0-9])/iu,
  /(?:^|[^a-z0-9])sk-proj-[a-z0-9_-]{20,}(?:$|[^a-z0-9_-])/iu,
  /(?:^|[^a-z0-9])sk-svcacct-[a-z0-9_-]{20,}(?:$|[^a-z0-9_-])/iu,
  /(?:^|[^a-z0-9])sk-ant-[a-z0-9_-]{20,}(?:$|[^a-z0-9_-])/iu,
  /(?:^|[^a-z0-9])sk-or-v1-[a-f0-9]{48,}(?:$|[^a-f0-9])/iu,
  /(?:^|[^a-z0-9])sk-[a-z0-9]{40,64}(?:$|[^a-z0-9])/iu,
  /(?:^|[^a-z0-9])gh[pousr]_[a-z0-9]{20,}(?:$|[^a-z0-9])/iu,
  /(?:^|[^a-z0-9_])github_pat_[a-z0-9_]{20,}(?:$|[^a-z0-9_])/iu,
  /(?:^|[^0-9A-Z])(?:AKIA|ASIA)[0-9A-Z]{16}(?:$|[^0-9A-Z])/u,
  /(?:^|[^0-9A-Za-z_-])AIza[0-9A-Za-z_-]{20,}(?:$|[^0-9A-Za-z_-])/u,
  /(?:^|[^a-z0-9])xox[a-z]-[a-z0-9-]{20,}(?:$|[^a-z0-9-])/iu,
  /(?:^|[^a-z0-9])npm_[a-z0-9]{36}(?:$|[^a-z0-9])/iu,
] as const);
const MAX_HISTORY_ADJACENCY_ROWS = 10_000;
const MAX_HISTORY_ADJACENCY_EDGES = 100_000;

export interface PullRequestModelEvidenceProjection {
  readonly evidence: EvidenceBundle;
  readonly historyAdjacency: readonly HistoryChangeAdjacency[];
  readonly historyTruncated: boolean;
}

/**
 * Build the complete, bounded evidence view sent to a model.
 *
 * Detailed change IDs retain every safe-to-egress added/deleted line and diff
 * header while dropping unchanged context. Earlier privacy transforms remain
 * authoritative: repository-policy patches stay metadata-only and configured
 * secrets are redacted at the provider boundary. Other change items are
 * accounted for by the deterministic change map and are not available to
 * support model-authored prose. History is excluded by default so its private
 * body cannot cross a provider boundary accidentally; the pull-request
 * snapshot projection below adds back only eligible, subject-only history.
 * Other non-change evidence and authoritative receipts remain unchanged.
 */
export function projectEvidenceForModel(
  evidence: EvidenceBundle,
  detailedChangeIds: readonly string[],
): EvidenceBundle {
  const detailed = new Set(detailedChangeIds);
  if (detailed.size !== detailedChangeIds.length) {
    throw new Error('Model evidence projection contains duplicate change ids.');
  }
  const found = new Set<string>();
  const items: EvidenceItem[] = [];
  for (const item of evidence.items) {
    if (item.kind === 'history') {
      continue;
    }
    if (item.kind !== 'change') {
      items.push(structuredClone(item));
      continue;
    }
    if (!detailed.has(item.id)) {
      continue;
    }
    found.add(item.id);
    items.push({
      ...structuredClone(item),
      payload: {
        ...structuredClone(item.payload),
        patch: compactPatch(item.payload.patch),
      },
    });
  }
  if (
    found.size !== detailed.size ||
    detailedChangeIds.some((id) => !found.has(id))
  ) {
    throw new Error('Model evidence projection references an unknown change id.');
  }
  return createEvidenceBundle({
    snapshot: { ...evidence.snapshot },
    items,
    receipts: evidence.receipts.map((receipt) => structuredClone(receipt)),
    coverage: {
      complete: evidence.coverage.complete,
      gaps: evidence.coverage.gaps.map((gap) => ({ ...gap })),
    },
  });
}

/**
 * Project a complete pull-request snapshot to the bounded provider view.
 *
 * Commit bodies stay local. Subjects cross the provider boundary only when
 * their commit remains adjacent to a detailed final change, does not touch
 * protected repository policy, and contains no unconfigured credential-like
 * value. The final diff remains authoritative: adjacency can organize detailed
 * changes, but cannot make a supporting or reverted change available to the
 * model.
 */
export function projectPullRequestEvidenceForModel(
  snapshot: PullRequestEvidenceSnapshot,
  detailedChangeIds: readonly string[],
  knownSecrets: readonly string[] = [],
): PullRequestModelEvidenceProjection {
  validateProjectionSecrets(knownSecrets);
  validateHistoryAdjacencyShape(snapshot);
  validateProjectionEvidence(snapshot.evidence);
  const protectedEvidence = protectRepositoryPolicyEvidence(snapshot.evidence);
  const protectedSnapshot: PullRequestEvidenceSnapshot = {
    evidence: protectedEvidence,
    historyAdjacency: snapshot.historyAdjacency,
    historyTruncated: snapshot.historyTruncated,
  };
  const validated = validateHistoryAdjacency(protectedSnapshot);
  const detailedEvidence = projectEvidenceForModel(
    protectedEvidence,
    detailedChangeIds,
  );
  const detailed = new Set(detailedChangeIds);
  const keptHistoryIds = new Set<string>();
  const keptHistorySubjects = new Map<string, string>();
  const historyAdjacency: HistoryChangeAdjacency[] = [];

  for (const entry of protectedSnapshot.historyAdjacency) {
    const touchesPolicy = entry.changeEvidenceIds.some((id) =>
      validated.protectedChangeIds.has(id)
    );
    if (touchesPolicy) {
      continue;
    }
    const projectedChangeIds = entry.changeEvidenceIds.filter((id) =>
      detailed.has(id)
    );
    if (projectedChangeIds.length === 0) {
      continue;
    }
    const history = validated.historyById.get(entry.historyId);
    if (history === undefined) {
      throw invalidHistoryAdjacency();
    }
    const subject = redactSecretValues(history.payload.subject, knownSecrets);
    assertCredentialSafeHistorySubject(subject);
    keptHistoryIds.add(entry.historyId);
    keptHistorySubjects.set(entry.historyId, subject);
    historyAdjacency.push(
      Object.freeze({
        historyId: entry.historyId,
        changeEvidenceIds: Object.freeze([...projectedChangeIds]),
      }),
    );
  }

  const projectedById = new Map(
    detailedEvidence.items.map((item) => [item.id, item]),
  );
  const items = protectedEvidence.items.flatMap<EvidenceItem>((item) => {
    if (item.kind === 'history') {
      const subject = keptHistorySubjects.get(item.id);
      if (!keptHistoryIds.has(item.id) || subject === undefined) {
        return [];
      }
      return [{
        ...structuredClone(item),
        payload: {
          ...structuredClone(item.payload),
          subject,
          body: '',
        },
      }];
    }
    const projected = projectedById.get(item.id);
    return projected === undefined ? [] : [structuredClone(projected)];
  });
  const evidence = createEvidenceBundle({
    snapshot: { ...detailedEvidence.snapshot },
    items,
    receipts: detailedEvidence.receipts.map((receipt) =>
      structuredClone(receipt)
    ),
    coverage: {
      complete: detailedEvidence.coverage.complete,
      gaps: detailedEvidence.coverage.gaps.map((gap) => ({ ...gap })),
    },
  });

  return Object.freeze({
    evidence,
    historyAdjacency: Object.freeze(historyAdjacency),
    historyTruncated: protectedSnapshot.historyTruncated,
  });
}

function validateProjectionSecrets(secrets: readonly string[]): void {
  if (
    !Array.isArray(secrets) ||
    secrets.some((secret) => typeof secret !== 'string')
  ) {
    throw new Error('Pull request model projection secret input is invalid.');
  }
}

function validateHistoryAdjacencyShape(
  snapshot: PullRequestEvidenceSnapshot,
): void {
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    typeof snapshot.historyTruncated !== 'boolean' ||
    !Array.isArray(snapshot.historyAdjacency) ||
    typeof snapshot.evidence !== 'object' ||
    snapshot.evidence === null ||
    !Array.isArray(snapshot.evidence.items)
  ) {
    throw invalidHistoryAdjacency();
  }
}

function validateProjectionEvidence(evidence: EvidenceBundle): void {
  try {
    serializeEvidenceBundle(evidence);
  } catch {
    throw new Error('Pull request model projection evidence input is invalid.');
  }
}

function validateHistoryAdjacency(snapshot: PullRequestEvidenceSnapshot): {
  readonly historyById: ReadonlyMap<string, HistoryEvidenceItem>;
  readonly protectedChangeIds: ReadonlySet<string>;
} {
  const historyById = new Map<string, HistoryEvidenceItem>();
  const changeIds = new Set<string>();
  const protectedChangeIds = new Set<string>();
  for (const item of snapshot.evidence.items) {
    if (item.kind === 'history') {
      historyById.set(item.id, item);
    }
    if (item.kind === 'change') {
      changeIds.add(item.id);
      if (item.source.kind === 'git-policy-metadata') {
        if (
          (item.payload.path !== '.diffwrightrc.json' &&
            item.payload.oldPath !== '.diffwrightrc.json') ||
          item.payload.patch !== null
        ) {
          throw new Error(
            'Pull request model projection has invalid policy protection.',
          );
        }
        protectedChangeIds.add(item.id);
      }
    }
  }

  if (snapshot.historyAdjacency.length > MAX_HISTORY_ADJACENCY_ROWS) {
    throw invalidHistoryAdjacency();
  }
  const seenHistoryIds = new Set<string>();
  let edgeCount = 0;
  for (const entry of snapshot.historyAdjacency) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.historyId !== 'string' ||
      !Array.isArray(entry.changeEvidenceIds) ||
      entry.changeEvidenceIds.some((id) => typeof id !== 'string') ||
      seenHistoryIds.has(entry.historyId) ||
      !historyById.has(entry.historyId)
    ) {
      throw invalidHistoryAdjacency();
    }
    seenHistoryIds.add(entry.historyId);
    edgeCount += entry.changeEvidenceIds.length;
    if (edgeCount > MAX_HISTORY_ADJACENCY_EDGES) {
      throw invalidHistoryAdjacency();
    }
    const seenChangeIds = new Set<string>();
    for (const changeId of entry.changeEvidenceIds) {
      if (seenChangeIds.has(changeId) || !changeIds.has(changeId)) {
        throw invalidHistoryAdjacency();
      }
      seenChangeIds.add(changeId);
    }
  }
  if (
    seenHistoryIds.size !== historyById.size ||
    [...historyById.keys()].some((id) => !seenHistoryIds.has(id))
  ) {
    throw invalidHistoryAdjacency();
  }
  return { historyById, protectedChangeIds };
}

function invalidHistoryAdjacency(): Error {
  return new Error('Pull request model projection has invalid history adjacency.');
}

function assertCredentialSafeHistorySubject(subject: string): void {
  if (HIGH_CONFIDENCE_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(subject))) {
    throw new Error('History subject contains a credential-like value.');
  }
}

function compactPatch(patch: string | null): string | null {
  if (patch === null) {
    return null;
  }
  return patch
    .split('\n')
    .filter((line) => line.length === 0 || !line.startsWith(' '))
    .join('\n');
}
