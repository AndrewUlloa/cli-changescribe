export type EvidenceBasis = 'observed' | 'provided' | 'inferred';

export type EvidenceKind =
  | 'change'
  | 'intent'
  | 'verification'
  | 'constraint'
  | 'history';

export type ClaimKind =
  | 'change'
  | 'problem'
  | 'rationale'
  | 'verification'
  | 'compatibility'
  | 'risk'
  | 'review-focus'
  | 'non-goal'
  | 'follow-up';

export type ChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed';

export interface EvidenceSource {
  kind: string;
  locator: string;
}

export interface ChangeEvidenceItem {
  id: string;
  kind: 'change';
  basis: 'observed';
  source: EvidenceSource;
  payload: {
    status: ChangeStatus;
    oldPath?: string;
    path: string;
    additions: number | null;
    deletions: number | null;
    binary: boolean;
    patch: string | null;
  };
}

export interface IntentEvidenceItem {
  id: string;
  kind: 'intent';
  basis: 'provided';
  source: EvidenceSource;
  payload: { text: string };
}

export interface VerificationEvidenceItem {
  id: string;
  kind: 'verification';
  basis: 'observed';
  source: EvidenceSource;
  payload: { receiptId: string };
}

export type ConstraintValue =
  | string
  | number
  | boolean
  | null
  | readonly string[];

export interface ConstraintEvidenceItem {
  id: string;
  kind: 'constraint';
  basis: 'provided';
  source: EvidenceSource;
  payload: { name: string; value: ConstraintValue };
}

export interface HistoryEvidenceItem {
  id: string;
  kind: 'history';
  basis: 'provided';
  source: EvidenceSource;
  payload: { sha: string; subject: string; body: string };
}

export type EvidenceItem =
  | ChangeEvidenceItem
  | IntentEvidenceItem
  | VerificationEvidenceItem
  | ConstraintEvidenceItem
  | HistoryEvidenceItem;

export interface GitSnapshot {
  headSha: string;
  baseRef?: string;
  baseSha?: string;
  mergeBaseSha?: string;
}

export type CoverageGapReason =
  | 'size-limit'
  | 'binary'
  | 'unavailable'
  | 'unsupported';

export interface CoverageGap {
  source: string;
  reason: CoverageGapReason;
  locator?: string;
  omittedBytes?: number;
}

export interface VerificationReceipt {
  id: string;
  command: {
    file: string;
    args: readonly string[];
    display: string;
  };
  status: 'passed' | 'failed' | 'skipped';
  exitCode: number | null;
  durationMs: number;
  source: 'diffwright' | 'external';
  result?: Readonly<{
    type: 'test-summary';
    tests: number;
    passed: number;
    failed: number;
    skipped: number;
    cancelled: number;
    todo: number;
  }>;
  limitation?: 'output-unrecognized';
  skipReason?: 'not-configured' | 'user-requested';
}

export interface EvidenceBundleInput {
  snapshot: GitSnapshot;
  items: EvidenceItem[];
  receipts: VerificationReceipt[];
  coverage: { complete: boolean; gaps: CoverageGap[] };
}

export interface EvidenceBundle {
  readonly schemaVersion: 1;
  readonly snapshot: Readonly<GitSnapshot>;
  readonly items: readonly EvidenceItem[];
  readonly receipts: readonly VerificationReceipt[];
  readonly coverage: Readonly<{
    complete: boolean;
    gaps: readonly CoverageGap[];
  }>;
}

export interface DraftClaim {
  id: string;
  kind: ClaimKind;
  text: string;
  evidenceIds: readonly string[];
  basis: EvidenceBasis;
  significance: 'primary' | 'supporting' | 'incidental';
}

const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SOURCE_KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
const SHA_RE = /^[0-9a-f]{40,64}$/;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const UNIVERSAL_RE = /\b(?:all|always|every|guarantees?|eliminates?)\b/iu;
const FLAG_RE = /--[a-z0-9][a-z0-9-]*/giu;
const MAX_LOCATOR_CHARS = 2_048;
const MAX_TEXT_CHARS = 65_536;
const MAX_PATCH_CHARS = 2 * 1024 * 1024;
const MAX_BUNDLE_CHARS = 8 * 1024 * 1024;
const MAX_CONSTRAINT_ARRAY_ITEMS = 256;

export function createEvidenceBundle(
  input: EvidenceBundleInput,
): EvidenceBundle {
  const clone = structuredClone(input);
  const bundle: EvidenceBundle = {
    schemaVersion: 1,
    snapshot: clone.snapshot,
    items: clone.items,
    receipts: clone.receipts,
    coverage: clone.coverage,
  };
  validateEvidenceBundle(bundle);
  const serializedLength = JSON.stringify(bundle).length;
  if (serializedLength > MAX_BUNDLE_CHARS) {
    throw new Error('Evidence bundle exceeds the supported size limit.');
  }
  return deepFreeze(bundle);
}

export function serializeEvidenceBundle(bundle: EvidenceBundle): string {
  validateEvidenceBundle(bundle);
  return JSON.stringify(bundle);
}

export function createVerificationReceipt(
  input: VerificationReceipt,
): VerificationReceipt {
  const receipt = structuredClone(input);
  validateReceipt(receipt);
  return deepFreeze(receipt);
}

export function assertSupportedClaims(
  bundle: EvidenceBundle,
  claims: readonly DraftClaim[],
): void {
  validateEvidenceBundle(bundle);
  const evidenceById = new Map(bundle.items.map((item) => [item.id, item]));
  const receiptsById = new Map(
    bundle.receipts.map((receipt) => [receipt.id, receipt]),
  );
  const claimIds = new Set<string>();

  for (const claim of claims) {
    validateId(claim.id, 'claim');
    if (claimIds.has(claim.id)) {
      throw new Error('Duplicate claim id.');
    }
    claimIds.add(claim.id);
    validateText(claim.text, `Claim ${claim.id}`, MAX_TEXT_CHARS);
    if (claim.evidenceIds.length === 0) {
      throw new Error(`Claim ${claim.id} has no evidence references.`);
    }

    const cited: EvidenceItem[] = [];
    for (const evidenceId of claim.evidenceIds) {
      validateId(evidenceId, 'evidence reference');
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        throw new Error('Claim references unknown evidence id.');
      }
      cited.push(evidence);
    }

    validateClaimBasis(claim, cited);
    validateClaimKind(claim, cited, receiptsById);
    if (!bundle.coverage.complete && UNIVERSAL_RE.test(claim.text)) {
      throw new Error(
        `Claim ${claim.id} is a universal claim that requires complete coverage.`,
      );
    }
    validateClaimFlags(claim, cited);
  }
}

export function selectRenderableClaims(
  bundle: EvidenceBundle,
  claims: readonly DraftClaim[],
): readonly DraftClaim[] {
  assertSupportedClaims(bundle, claims);
  return claims.filter((claim) => claim.basis !== 'inferred');
}

function validateEvidenceBundle(bundle: EvidenceBundle): void {
  validateSha(bundle.snapshot.headSha, 'head');
  if (bundle.snapshot.baseSha !== undefined) {
    validateSha(bundle.snapshot.baseSha, 'base');
  }
  if (bundle.snapshot.mergeBaseSha !== undefined) {
    validateSha(bundle.snapshot.mergeBaseSha, 'merge base');
  }
  if (bundle.snapshot.baseRef !== undefined) {
    validateText(bundle.snapshot.baseRef, 'Base ref', MAX_LOCATOR_CHARS);
  }

  if (bundle.coverage.complete && bundle.coverage.gaps.length > 0) {
    throw new Error('Complete coverage cannot contain gaps.');
  }
  if (!bundle.coverage.complete && bundle.coverage.gaps.length === 0) {
    throw new Error('Incomplete coverage must describe at least one gap.');
  }
  for (const gap of bundle.coverage.gaps) {
    validateText(gap.source, 'Coverage gap source', MAX_LOCATOR_CHARS);
    if (gap.locator !== undefined) {
      validateText(gap.locator, 'Coverage gap locator', MAX_LOCATOR_CHARS);
    }
    if (
      gap.omittedBytes !== undefined &&
      (!Number.isSafeInteger(gap.omittedBytes) || gap.omittedBytes < 0)
    ) {
      throw new Error('Coverage gap omittedBytes must be a safe nonnegative integer.');
    }
  }

  const receiptIds = new Set<string>();
  for (const receipt of bundle.receipts) {
    validateReceipt(receipt);
    if (receiptIds.has(receipt.id)) {
      throw new Error(`Duplicate receipt id: ${receipt.id}`);
    }
    receiptIds.add(receipt.id);
  }

  const evidenceIds = new Set<string>();
  for (const item of bundle.items) {
    validateEvidenceItem(item, receiptIds);
    if (evidenceIds.has(item.id)) {
      throw new Error(`Duplicate evidence id: ${item.id}`);
    }
    evidenceIds.add(item.id);
  }
}

function validateEvidenceItem(
  item: EvidenceItem,
  receiptIds: ReadonlySet<string>,
): void {
  validateId(item.id, 'evidence');
  validateSource(item.source);

  if (item.kind === 'change') {
    validateText(item.payload.path, 'Change path', MAX_LOCATOR_CHARS);
    if (item.payload.oldPath !== undefined) {
      validateText(item.payload.oldPath, 'Change old path', MAX_LOCATOR_CHARS);
    }
    if (
      (item.payload.status === 'renamed' || item.payload.status === 'copied') &&
      item.payload.oldPath === undefined
    ) {
      throw new Error(`${item.payload.status} evidence requires an old path.`);
    }
    validateCount(item.payload.additions, 'Change additions');
    validateCount(item.payload.deletions, 'Change deletions');
    if (item.payload.patch !== null) {
      validateText(item.payload.patch, 'Change patch', MAX_PATCH_CHARS, true);
    }
    return;
  }

  if (item.kind === 'intent') {
    validateText(item.payload.text, 'Intent text', MAX_TEXT_CHARS);
    return;
  }

  if (item.kind === 'verification') {
    validateId(item.payload.receiptId, 'receipt');
    if (!receiptIds.has(item.payload.receiptId)) {
      throw new Error(
        `Verification evidence ${item.id} references unknown receipt: ${item.payload.receiptId}`,
      );
    }
    return;
  }

  if (item.kind === 'constraint') {
    validateText(item.payload.name, 'Constraint name', 128);
    validateConstraintValue(item.payload.value);
    return;
  }

  validateSha(item.payload.sha, 'history');
  validateText(item.payload.subject, 'History subject', 1_024);
  validateText(item.payload.body, 'History body', MAX_TEXT_CHARS, true);
}

function validateReceipt(receipt: VerificationReceipt): void {
  const allowedReceiptKeys = new Set([
    'id',
    'command',
    'status',
    'exitCode',
    'durationMs',
    'source',
    'result',
    'limitation',
    'skipReason',
  ]);
  if (Object.keys(receipt).some((key) => !allowedReceiptKeys.has(key))) {
    throw new Error('Receipt contains unsupported fields.');
  }
  if (
    Object.keys(receipt.command).length !== 3 ||
    !['file', 'args', 'display'].every((key) =>
      Object.hasOwn(receipt.command, key)
    )
  ) {
    throw new Error('Receipt command has an invalid shape.');
  }
  validateId(receipt.id, 'receipt');
  validateText(receipt.command.file, 'Receipt executable', MAX_LOCATOR_CHARS);
  validateText(receipt.command.display, 'Receipt display', MAX_LOCATOR_CHARS);
  for (const argument of receipt.command.args) {
    validateText(argument, 'Receipt argument', MAX_LOCATOR_CHARS, true);
  }
  if (!Number.isFinite(receipt.durationMs) || receipt.durationMs < 0) {
    throw new Error('Receipt duration must be a nonnegative finite number.');
  }
  if (!['passed', 'failed', 'skipped'].includes(receipt.status)) {
    throw new Error('Receipt status is invalid.');
  }
  if (receipt.source !== 'diffwright' && receipt.source !== 'external') {
    throw new Error('Receipt source is invalid.');
  }
  if (receipt.status === 'passed' && receipt.exitCode !== 0) {
    throw new Error('Passed receipt must have exit code 0.');
  }
  if (
    receipt.status === 'failed' &&
    (receipt.exitCode === null || receipt.exitCode === 0)
  ) {
    throw new Error('Failed receipt must have a nonzero exit code.');
  }
  if (receipt.status === 'skipped' && receipt.exitCode !== null) {
    throw new Error('Skipped receipt must not have an exit code.');
  }
  if (
    receipt.status === 'skipped' &&
    receipt.skipReason !== 'not-configured' &&
    receipt.skipReason !== 'user-requested'
  ) {
    throw new Error('Skipped receipt requires a typed reason.');
  }
  if (receipt.status !== 'skipped' && receipt.skipReason !== undefined) {
    throw new Error('Only skipped receipts may include a skip reason.');
  }
  if (receipt.result !== undefined) {
    const result = receipt.result;
    if (
      Object.keys(result).length !== 7 ||
      ![
        'type',
        'tests',
        'passed',
        'failed',
        'skipped',
        'cancelled',
        'todo',
      ].every((key) => Object.hasOwn(result, key))
    ) {
      throw new Error('Receipt test summary has an invalid shape.');
    }
    const counts = [
      result.tests,
      result.passed,
      result.failed,
      result.skipped,
      result.cancelled,
      result.todo,
    ];
    if (
      result.type !== 'test-summary' ||
      counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
      result.tests !==
        result.passed + result.failed + result.skipped + result.cancelled + result.todo
    ) {
      throw new Error('Receipt test summary is invalid.');
    }
    if (
      receipt.status === 'passed' &&
      (result.failed > 0 || result.cancelled > 0)
    ) {
      throw new Error('Passed receipt cannot report failed or cancelled tests.');
    }
  }
  if (
    receipt.limitation !== undefined &&
    receipt.limitation !== 'output-unrecognized'
  ) {
    throw new Error('Receipt limitation is invalid.');
  }
  if (receipt.result !== undefined && receipt.limitation !== undefined) {
    throw new Error('Receipt cannot contain both a result and a limitation.');
  }
  if (
    receipt.status === 'skipped' &&
    (receipt.result !== undefined || receipt.limitation !== undefined)
  ) {
    throw new Error('Skipped receipt cannot contain a result or limitation.');
  }
}

function validateClaimBasis(
  claim: DraftClaim,
  cited: readonly EvidenceItem[],
): void {
  if (
    claim.basis === 'observed' &&
    !cited.some((evidence) => evidence.basis === 'observed')
  ) {
    throw new Error(`Claim ${claim.id} has no observed evidence.`);
  }
  if (
    claim.basis === 'provided' &&
    !cited.some((evidence) => evidence.basis === 'provided')
  ) {
    throw new Error(`Claim ${claim.id} has no provided evidence.`);
  }
}

function validateClaimKind(
  claim: DraftClaim,
  cited: readonly EvidenceItem[],
  receiptsById: ReadonlyMap<string, VerificationReceipt>,
): void {
  const hasAuthoredIntent = cited.some(
    (evidence) =>
      evidence.kind === 'intent' ||
      (evidence.kind === 'history' && evidence.payload.body.trim().length > 0),
  );
  if (
    claim.kind === 'change' &&
    !cited.some((evidence) => evidence.kind === 'change')
  ) {
    throw new Error(`Change claim ${claim.id} requires change evidence.`);
  }
  if (
    claim.kind === 'problem' &&
    (claim.basis !== 'provided' || !hasAuthoredIntent)
  ) {
    throw new Error(
      `Problem claim ${claim.id} requires provided intent evidence.`,
    );
  }
  if (
    claim.kind === 'rationale' &&
    (claim.basis !== 'provided' || !hasAuthoredIntent)
  ) {
    throw new Error(
      `Rationale claim ${claim.id} requires provided intent evidence.`,
    );
  }
  if (
    claim.kind === 'compatibility' &&
    (claim.basis !== 'provided' ||
      !cited.some(
        (evidence) =>
          evidence.kind === 'intent' ||
          (evidence.kind === 'constraint' &&
            (evidence.payload.name === 'compatibility' ||
              evidence.payload.name === 'preserved-behavior')),
      ))
  ) {
    throw new Error(
      `Compatibility claim ${claim.id} requires provided intent or compatibility constraint evidence.`,
    );
  }
  if (
    claim.kind === 'non-goal' &&
    (claim.basis !== 'provided' ||
      !cited.some(
        (evidence) =>
          evidence.kind === 'intent' ||
          (evidence.kind === 'constraint' &&
            evidence.payload.name === 'non-goal'),
      ))
  ) {
    throw new Error(
      `Non-goal claim ${claim.id} requires provided intent or non-goal constraint evidence.`,
    );
  }
  if (claim.kind === 'verification') {
    const passed = cited.some((evidence) => {
      if (evidence.kind !== 'verification') {
        return false;
      }
      return receiptsById.get(evidence.payload.receiptId)?.status === 'passed';
    });
    if (!passed) {
      throw new Error(
        `Verification claim ${claim.id} requires a passed receipt.`,
      );
    }
  }
  if (
    claim.kind === 'follow-up' &&
    (claim.basis !== 'provided' || !hasAuthoredIntent)
  ) {
    throw new Error(`Follow-up claim ${claim.id} requires provided intent.`);
  }
  if (
    claim.kind === 'risk' &&
    claim.basis !== 'inferred' &&
    (claim.basis !== 'provided' || !hasAuthoredIntent)
  ) {
    throw new Error(`Risk claim ${claim.id} requires provided intent.`);
  }
}

function validateClaimFlags(
  claim: DraftClaim,
  cited: readonly EvidenceItem[],
): void {
  const flags = claim.text.match(FLAG_RE) ?? [];
  if (flags.length === 0) {
    return;
  }
  const citedText = cited.map(evidenceSearchText).join('\n');
  for (const flag of flags) {
    if (!citedText.includes(flag)) {
      throw new Error(
        `Claim ${claim.id} identifier is absent from cited evidence.`,
      );
    }
  }
}

function evidenceSearchText(item: EvidenceItem): string {
  if (item.kind === 'change') {
    return [item.payload.oldPath, item.payload.path, item.payload.patch]
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
  }
  if (item.kind === 'intent') {
    return item.payload.text;
  }
  if (item.kind === 'constraint') {
    return `${item.payload.name}\n${JSON.stringify(item.payload.value)}`;
  }
  if (item.kind === 'history') {
    return `${item.payload.subject}\n${item.payload.body}`;
  }
  return item.source.locator;
}

function validateSource(source: EvidenceSource): void {
  if (!SOURCE_KIND_RE.test(source.kind)) {
    throw new Error('Evidence source kind is invalid.');
  }
  validateText(source.locator, 'Evidence source locator', MAX_LOCATOR_CHARS);
}

function validateId(id: string, label: string): void {
  if (!ID_RE.test(id)) {
    throw new Error(`${label} id is invalid.`);
  }
}

function validateSha(sha: string, label: string): void {
  if (!SHA_RE.test(sha)) {
    throw new Error(`${label} SHA is invalid.`);
  }
}

function validateCount(value: number | null, label: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be null or a safe nonnegative integer.`);
  }
}

function validateConstraintValue(value: ConstraintValue): void {
  if (typeof value === 'string') {
    validateText(value, 'Constraint value', MAX_TEXT_CHARS, true);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Constraint value number must be finite.');
    }
    return;
  }
  if (typeof value === 'boolean' || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_CONSTRAINT_ARRAY_ITEMS) {
      throw new Error('Constraint value array exceeds its supported size.');
    }
    for (const item of value) {
      if (typeof item !== 'string') {
        throw new Error('Constraint value array item must be a string.');
      }
      validateText(
        item,
        'Constraint value array item',
        MAX_TEXT_CHARS,
        true,
      );
    }
    return;
  }
  throw new Error('Constraint value type is invalid.');
}

function validateText(
  value: string,
  label: string,
  maximum: number,
  allowEmpty = false,
): void {
  if ((!allowEmpty && value.trim().length === 0) || value.length > maximum) {
    throw new Error(`${label} is empty or exceeds its supported size.`);
  }
  if (CONTROL_RE.test(value)) {
    throw new Error(`${label} contains unsupported control characters.`);
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
