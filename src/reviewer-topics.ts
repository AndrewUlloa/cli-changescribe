import {
  classifyChangeEvidenceRole,
  type ArtifactDraft,
  type ArtifactSelectionPolicy,
} from './artifact-draft';
import type {
  EvidenceBundle,
  EvidenceItem,
  HistoryEvidenceItem,
} from './change-evidence';
import type { HistoryChangeAdjacency } from './git-evidence';

const MAX_REVIEWER_TOPICS = 6;
const MAX_HINT_GROUPS = 10_000;
const MAX_HINT_EDGES = 100_000;
const ID_RE = /^[a-z][a-z0-9-]{0,63}$/u;

export interface ReviewerTopicHint {
  readonly id: string;
  readonly historyEvidenceIds: readonly string[];
  readonly changeEvidenceIds: readonly string[];
}

export interface ReviewerTopicHints {
  readonly schemaVersion: 1;
  readonly hints: readonly ReviewerTopicHint[];
  readonly unlinkedChangeEvidenceIds: readonly string[];
  readonly targetProseTopicCount: number;
}

export interface ReviewerTopic {
  readonly id: string;
  readonly claimId: string;
  readonly changeEvidenceIds: readonly string[];
  readonly historyEvidenceIds: readonly string[];
}

export interface ReviewerTopicPlan {
  readonly schemaVersion: 1;
  readonly targetProseTopicCount: number;
  readonly topics: readonly ReviewerTopic[];
  readonly mapOnlyChangeEvidenceIds: readonly string[];
}

export class InvalidReviewerTopicHintsError extends Error {
  readonly code = 'invalid_reviewer_topic_hints';

  constructor() {
    super('Reviewer topic hints are invalid.');
    this.name = 'InvalidReviewerTopicHintsError';
  }
}

export class InvalidReviewerTopicPlanError extends Error {
  readonly code = 'invalid_reviewer_topic_plan';

  constructor() {
    super('Reviewer topic plan is invalid.');
    this.name = 'InvalidReviewerTopicPlanError';
  }
}

/**
 * Converts pinned Git adjacency into an ID-only planning hint. The evidence
 * order is authoritative for history chronology; caller-supplied adjacency
 * order and per-row change order do not affect the result.
 */
export function buildReviewerTopicHints(
  evidence: EvidenceBundle,
  historyAdjacency: readonly HistoryChangeAdjacency[],
  selectionPolicy: ArtifactSelectionPolicy = {},
): ReviewerTopicHints {
  try {
    const index = evidenceIndex(evidence, selectionPolicy);
    if (
      !Array.isArray(historyAdjacency) ||
      historyAdjacency.length !== index.histories.length ||
      historyAdjacency.length > MAX_HINT_GROUPS
    ) {
      throw new InvalidReviewerTopicHintsError();
    }

    const rowByHistoryId = new Map<string, HistoryChangeAdjacency>();
    let edgeCount = 0;
    for (const row of historyAdjacency) {
      if (
        !row ||
        !isId(row.historyId) ||
        !index.historyById.has(row.historyId) ||
        rowByHistoryId.has(row.historyId) ||
        !Array.isArray(row.changeEvidenceIds)
      ) {
        throw new InvalidReviewerTopicHintsError();
      }
      const seenChangeIds = new Set<string>();
      for (const changeId of row.changeEvidenceIds) {
        const item = index.itemById.get(changeId);
        if (
          !isId(changeId) ||
          item?.kind !== 'change' ||
          seenChangeIds.has(changeId)
        ) {
          throw new InvalidReviewerTopicHintsError();
        }
        seenChangeIds.add(changeId);
        edgeCount += 1;
        if (edgeCount > MAX_HINT_EDGES) {
          throw new InvalidReviewerTopicHintsError();
        }
      }
      rowByHistoryId.set(row.historyId, row);
    }

    const groupByChangeSet = new Map<
      string,
      { changeEvidenceIds: string[]; historyEvidenceIds: string[] }
    >();
    const linkedChangeIds = new Set<string>();
    for (const history of index.histories) {
      const row = rowByHistoryId.get(history.id);
      if (row === undefined) {
        throw new InvalidReviewerTopicHintsError();
      }
      const substantiveIds = row.changeEvidenceIds
        .filter((changeId) => index.substantiveIds.has(changeId))
        .slice()
        .sort(compareText);
      if (substantiveIds.length === 0) {
        continue;
      }
      const key = substantiveIds.join('\0');
      const group = groupByChangeSet.get(key);
      if (group === undefined) {
        groupByChangeSet.set(key, {
          changeEvidenceIds: substantiveIds,
          historyEvidenceIds: [history.id],
        });
      } else {
        group.historyEvidenceIds.push(history.id);
      }
      for (const changeId of substantiveIds) {
        linkedChangeIds.add(changeId);
      }
    }

    const hints = [...groupByChangeSet.values()].map((group, index) => ({
      id: `reviewer-topic-hint-${index + 1}`,
      historyEvidenceIds: group.historyEvidenceIds,
      changeEvidenceIds: group.changeEvidenceIds,
    }));
    const substantiveIds = [...index.substantiveIds].sort(compareText);
    const unlinkedChangeEvidenceIds = substantiveIds.filter(
      (changeId) => !linkedChangeIds.has(changeId),
    );
    return deepFreeze({
      schemaVersion: 1,
      hints,
      unlinkedChangeEvidenceIds,
      targetProseTopicCount: Math.min(
        MAX_REVIEWER_TOPICS,
        hints.length,
        substantiveIds.length,
      ),
    });
  } catch (error) {
    if (error instanceof InvalidReviewerTopicHintsError) {
      throw error;
    }
    throw new InvalidReviewerTopicHintsError();
  }
}

/**
 * Builds the local post-critic assignment. Topics are ordered by their claims
 * in the rendered Changes section. Unowned substantive changes are retained in
 * the deterministic map-only bucket rather than silently disappearing.
 */
export function buildReviewerTopicPlan(
  draft: Pick<ArtifactDraft, 'claims' | 'sections'>,
  hints: ReviewerTopicHints,
  evidence: EvidenceBundle,
  selectionPolicy: ArtifactSelectionPolicy = {},
): ReviewerTopicPlan {
  try {
    const index = evidenceIndex(evidence, selectionPolicy);
    const validatedHints = validateHints(hints, index);
    const orderedClaims = changesClaimsInRenderOrder(draft);
    if (index.substantiveIds.size === 0) {
      if (orderedClaims.length !== 0) {
        throw new InvalidReviewerTopicPlanError();
      }
      return deepFreeze({
        schemaVersion: 1,
        targetProseTopicCount: 0,
        topics: [],
        mapOnlyChangeEvidenceIds: [],
      });
    }

    if (orderedClaims.length > MAX_REVIEWER_TOPICS) {
      throw new InvalidReviewerTopicPlanError();
    }

    const ownedChangeIds = new Set<string>();
    const historyOrder = new Map(
      index.histories.map((history, historyIndex) => [history.id, historyIndex]),
    );
    const topics: ReviewerTopic[] = [];
    for (const claim of orderedClaims) {
      const claimEvidenceIds = uniqueClaimEvidenceIds(claim.evidenceIds, index);
      if (
        claimEvidenceIds.some((evidenceId) => {
          const item = index.itemById.get(evidenceId);
          return item?.kind === 'change' &&
            !index.substantiveIds.has(evidenceId);
        })
      ) {
        throw new InvalidReviewerTopicPlanError();
      }
      const changeEvidenceIds = claimEvidenceIds
        .filter((evidenceId) => index.substantiveIds.has(evidenceId))
        .sort(compareText);
      if (changeEvidenceIds.length === 0) {
        throw new InvalidReviewerTopicPlanError();
      }
      for (const changeId of changeEvidenceIds) {
        if (ownedChangeIds.has(changeId)) {
          throw new InvalidReviewerTopicPlanError();
        }
        ownedChangeIds.add(changeId);
      }

      const historyEvidenceIds = claimEvidenceIds
        .filter((evidenceId) => index.historyById.has(evidenceId))
        .sort(
          (left, right) =>
            (historyOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
              (historyOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
            compareText(left, right),
        );
      for (const historyId of historyEvidenceIds) {
        const hint = validatedHints.hintByHistoryId.get(historyId);
        if (
          hint === undefined ||
          !intersects(changeEvidenceIds, hint.changeEvidenceIds)
        ) {
          throw new InvalidReviewerTopicPlanError();
        }
      }

      topics.push({
        id: `reviewer-topic-${topics.length + 1}`,
        claimId: claim.id,
        changeEvidenceIds,
        historyEvidenceIds,
      });
    }

    if (
      maximumDistinctHintMatching(topics, validatedHints.hints) <
        validatedHints.target
    ) {
      throw new InvalidReviewerTopicPlanError();
    }

    const mapOnlyChangeEvidenceIds = [...index.substantiveIds]
      .filter((changeId) => !ownedChangeIds.has(changeId))
      .sort(compareText);
    if (
      ownedChangeIds.size + mapOnlyChangeEvidenceIds.length !==
      index.substantiveIds.size
    ) {
      throw new InvalidReviewerTopicPlanError();
    }
    return deepFreeze({
      schemaVersion: 1,
      targetProseTopicCount: validatedHints.target,
      topics,
      mapOnlyChangeEvidenceIds,
    });
  } catch (error) {
    if (error instanceof InvalidReviewerTopicPlanError) {
      throw error;
    }
    throw new InvalidReviewerTopicPlanError();
  }
}

interface EvidenceIndex {
  readonly itemById: ReadonlyMap<string, EvidenceItem>;
  readonly historyById: ReadonlyMap<string, HistoryEvidenceItem>;
  readonly histories: readonly HistoryEvidenceItem[];
  readonly substantiveIds: ReadonlySet<string>;
}

function evidenceIndex(
  evidence: EvidenceBundle,
  selectionPolicy: ArtifactSelectionPolicy,
): EvidenceIndex {
  if (!evidence || !Array.isArray(evidence.items)) {
    throw new Error('invalid evidence');
  }
  const itemById = new Map<string, EvidenceItem>();
  const histories: HistoryEvidenceItem[] = [];
  const substantiveIds = new Set<string>();
  for (const item of evidence.items) {
    if (!item || !isId(item.id) || itemById.has(item.id)) {
      throw new Error('invalid evidence');
    }
    itemById.set(item.id, item);
    if (item.kind === 'history') {
      histories.push(item);
    }
    if (
      item.kind === 'change' &&
      classifyChangeEvidenceRole(item, selectionPolicy) === 'substantive'
    ) {
      substantiveIds.add(item.id);
    }
  }
  return {
    itemById,
    historyById: new Map(histories.map((item) => [item.id, item])),
    histories,
    substantiveIds,
  };
}

interface ValidatedHints {
  readonly hints: readonly ReviewerTopicHint[];
  readonly hintByHistoryId: ReadonlyMap<string, ReviewerTopicHint>;
  readonly target: number;
}

function validateHints(
  value: ReviewerTopicHints,
  index: EvidenceIndex,
): ValidatedHints {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.hints) ||
    value.hints.length > MAX_HINT_GROUPS ||
    !Array.isArray(value.unlinkedChangeEvidenceIds) ||
    !Number.isSafeInteger(value.targetProseTopicCount) ||
    value.targetProseTopicCount < 0 ||
    value.targetProseTopicCount > MAX_REVIEWER_TOPICS
  ) {
    throw new InvalidReviewerTopicPlanError();
  }
  const hintByHistoryId = new Map<string, ReviewerTopicHint>();
  const seenHintIds = new Set<string>();
  const seenGroupKeys = new Set<string>();
  const linkedChangeIds = new Set<string>();
  let changeEdgeCount = 0;
  let historyMembershipCount = 0;
  for (const hint of value.hints) {
    if (
      !hint ||
      !isId(hint.id) ||
      seenHintIds.has(hint.id) ||
      !Array.isArray(hint.historyEvidenceIds) ||
      hint.historyEvidenceIds.length === 0 ||
      !Array.isArray(hint.changeEvidenceIds) ||
      hint.changeEvidenceIds.length === 0
    ) {
      throw new InvalidReviewerTopicPlanError();
    }
    seenHintIds.add(hint.id);
    const changeIds = new Set<string>();
    for (const changeId of hint.changeEvidenceIds) {
      if (
        !isId(changeId) ||
        !index.substantiveIds.has(changeId) ||
        changeIds.has(changeId)
      ) {
        throw new InvalidReviewerTopicPlanError();
      }
      changeIds.add(changeId);
      linkedChangeIds.add(changeId);
      changeEdgeCount += 1;
    }
    const groupKey = [...changeIds].sort(compareText).join('\0');
    if (seenGroupKeys.has(groupKey)) {
      throw new InvalidReviewerTopicPlanError();
    }
    seenGroupKeys.add(groupKey);
    const historyIds = new Set<string>();
    for (const historyId of hint.historyEvidenceIds) {
      if (
        !isId(historyId) ||
        !index.historyById.has(historyId) ||
        historyIds.has(historyId) ||
        hintByHistoryId.has(historyId)
      ) {
        throw new InvalidReviewerTopicPlanError();
      }
      historyIds.add(historyId);
      hintByHistoryId.set(historyId, hint);
      historyMembershipCount += 1;
    }
    if (
      changeEdgeCount > MAX_HINT_EDGES ||
      historyMembershipCount > MAX_HINT_GROUPS
    ) {
      throw new InvalidReviewerTopicPlanError();
    }
  }

  const unlinked = new Set<string>();
  for (const changeId of value.unlinkedChangeEvidenceIds) {
    if (
      !isId(changeId) ||
      !index.substantiveIds.has(changeId) ||
      linkedChangeIds.has(changeId) ||
      unlinked.has(changeId)
    ) {
      throw new InvalidReviewerTopicPlanError();
    }
    unlinked.add(changeId);
  }
  for (const changeId of index.substantiveIds) {
    if (!linkedChangeIds.has(changeId) && !unlinked.has(changeId)) {
      throw new InvalidReviewerTopicPlanError();
    }
  }
  const target = Math.min(
    MAX_REVIEWER_TOPICS,
    value.hints.length,
    index.substantiveIds.size,
  );
  if (value.targetProseTopicCount !== target) {
    throw new InvalidReviewerTopicPlanError();
  }
  return { hints: value.hints, hintByHistoryId, target };
}

function changesClaimsInRenderOrder(
  draft: Pick<ArtifactDraft, 'claims' | 'sections'>,
): readonly ArtifactDraft['claims'][number][] {
  if (!draft || !Array.isArray(draft.claims) || !Array.isArray(draft.sections)) {
    throw new InvalidReviewerTopicPlanError();
  }
  const claimsById = new Map<string, ArtifactDraft['claims'][number]>();
  for (const claim of draft.claims) {
    if (!claim || !isId(claim.id) || claimsById.has(claim.id)) {
      throw new InvalidReviewerTopicPlanError();
    }
    claimsById.set(claim.id, claim);
  }
  const seenSectionKinds = new Set<string>();
  const referencedClaimIds = new Set<string>();
  const ordered: ArtifactDraft['claims'][number][] = [];
  for (const section of draft.sections) {
    if (
      !section ||
      typeof section.kind !== 'string' ||
      seenSectionKinds.has(section.kind) ||
      !Array.isArray(section.claimIds)
    ) {
      throw new InvalidReviewerTopicPlanError();
    }
    seenSectionKinds.add(section.kind);
    for (const claimId of section.claimIds) {
      const claim = claimsById.get(claimId);
      if (!isId(claimId) || claim === undefined || referencedClaimIds.has(claimId)) {
        throw new InvalidReviewerTopicPlanError();
      }
      referencedClaimIds.add(claimId);
      if (section.kind !== 'changes' || claim.significance === 'primary') {
        continue;
      }
      if (claim.kind !== 'change') {
        throw new InvalidReviewerTopicPlanError();
      }
      if (claim.basis === 'inferred') {
        continue;
      }
      if (claim.basis !== 'observed') {
        throw new InvalidReviewerTopicPlanError();
      }
      ordered.push(claim);
    }
  }
  if (referencedClaimIds.size !== claimsById.size) {
    throw new InvalidReviewerTopicPlanError();
  }
  return ordered;
}

function uniqueClaimEvidenceIds(
  evidenceIds: readonly string[],
  index: EvidenceIndex,
): string[] {
  if (!Array.isArray(evidenceIds)) {
    throw new InvalidReviewerTopicPlanError();
  }
  const unique = new Set<string>();
  for (const evidenceId of evidenceIds) {
    if (!isId(evidenceId) || !index.itemById.has(evidenceId) || unique.has(evidenceId)) {
      throw new InvalidReviewerTopicPlanError();
    }
    unique.add(evidenceId);
  }
  return [...unique];
}

function maximumDistinctHintMatching(
  topics: readonly ReviewerTopic[],
  hints: readonly ReviewerTopicHint[],
): number {
  const matchedTopicByHint = new Array<number>(hints.length).fill(-1);
  let matched = 0;
  for (let topicIndex = 0; topicIndex < topics.length; topicIndex += 1) {
    const seenHints = new Set<number>();
    if (
      augmentTopicMatch(
        topicIndex,
        topics,
        hints,
        matchedTopicByHint,
        seenHints,
      )
    ) {
      matched += 1;
    }
  }
  return matched;
}

function augmentTopicMatch(
  topicIndex: number,
  topics: readonly ReviewerTopic[],
  hints: readonly ReviewerTopicHint[],
  matchedTopicByHint: number[],
  seenHints: Set<number>,
): boolean {
  const topic = topics[topicIndex];
  if (topic === undefined) {
    return false;
  }
  for (let hintIndex = 0; hintIndex < hints.length; hintIndex += 1) {
    if (seenHints.has(hintIndex)) {
      continue;
    }
    const hint = hints[hintIndex];
    if (
      hint === undefined ||
      !intersects(topic.historyEvidenceIds, hint.historyEvidenceIds) ||
      !intersects(topic.changeEvidenceIds, hint.changeEvidenceIds)
    ) {
      continue;
    }
    seenHints.add(hintIndex);
    const previousTopicIndex = matchedTopicByHint[hintIndex] ?? -1;
    if (
      previousTopicIndex === -1 ||
      augmentTopicMatch(
        previousTopicIndex,
        topics,
        hints,
        matchedTopicByHint,
        seenHints,
      )
    ) {
      matchedTopicByHint[hintIndex] = topicIndex;
      return true;
    }
  }
  return false;
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
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
