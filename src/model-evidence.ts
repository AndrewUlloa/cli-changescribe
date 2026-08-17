import {
  createEvidenceBundle,
  type EvidenceBundle,
  type EvidenceItem,
} from './change-evidence';

/**
 * Build the complete, bounded evidence view sent to a model.
 *
 * Detailed change IDs retain every safe-to-egress added/deleted line and diff
 * header while dropping unchanged context. Earlier privacy transforms remain
 * authoritative: repository-policy patches stay metadata-only and configured
 * secrets are redacted at the provider boundary. Other change items are
 * accounted for by the deterministic change map and are not available to
 * support model-authored prose. Non-change evidence and authoritative receipts
 * remain unchanged.
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

function compactPatch(patch: string | null): string | null {
  if (patch === null) {
    return null;
  }
  return patch
    .split('\n')
    .filter((line) => line.length === 0 || !line.startsWith(' '))
    .join('\n');
}
