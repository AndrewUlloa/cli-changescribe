import {
  renderConventionalTitle,
  type ConventionalTitlePolicy,
  type RenderedPullRequest,
} from './artifact-renderer';
import type { Prompter } from './prompts';
import {
  reviewEditorialText,
  type EditorialPolicy,
} from './editorial-policy';

export const MAX_PR_BODY_BYTES = 64 * 1024;

export type PrReviewDecision = 'approve' | 'edit' | 'cancel';

export type PrReviewPrompter = Pick<Prompter, 'select'>;

export interface PrEditorAdapter {
  edit(artifact: RenderedPullRequest): Promise<RenderedPullRequest>;
}

export interface PrReviewOptions {
  readonly yes?: boolean;
  readonly knownSecrets?: readonly string[];
  readonly titlePolicy?: ConventionalTitlePolicy;
  readonly editorialPolicy?: Partial<EditorialPolicy>;
}

export interface PrReviewDependencies {
  readonly prompter?: PrReviewPrompter;
  readonly editor?: PrEditorAdapter;
}

export class PrReviewCancelledError extends Error {
  readonly code = 'pr_review_cancelled' as const;

  constructor(message = 'Pull-request review cancelled.') {
    super(message);
    this.name = 'PrReviewCancelledError';
  }
}

const CONVENTIONAL_TITLE_RE =
  /^(?<type>[a-z][a-z0-9-]{0,31})(?:\((?<scope>[a-z0-9][a-z0-9._/-]{0,63})\))?(?<breaking>!)?: (?<subject>.+)$/u;
const UNSAFE_BODY_CONTROL_RE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const UNSAFE_TITLE_CONTROL_RE =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const BARE_CARRIAGE_RETURN_RE = /\r(?!\n)/u;
const REVIEW_CHOICES = Object.freeze([
  Object.freeze({
    value: 'approve',
    label: 'Approve',
    description: 'Use this title and body.',
  }),
  Object.freeze({
    value: 'edit',
    label: 'Edit',
    description: 'Open the title and body for editing.',
  }),
  Object.freeze({
    value: 'cancel',
    label: 'Cancel',
    description: 'Stop without creating or updating a pull request.',
  }),
] as const);

function assertKnownSecretAbsent(
  artifact: RenderedPullRequest,
  knownSecrets: readonly string[],
): void {
  for (const secret of knownSecrets) {
    if (
      secret.length > 0 &&
      (artifact.title.includes(secret) || artifact.body.includes(secret))
    ) {
      throw new Error('Pull-request artifact contains a known secret.');
    }
  }
}

function assertValidUtf8(value: string, field: 'title' | 'body'): void {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.toString('utf8') !== value) {
    throw new Error(`Pull-request ${field} must contain valid UTF-8 text.`);
  }
}

function validateTitleWarnings(
  title: string,
  policy: ConventionalTitlePolicy,
): readonly string[] {
  assertValidUtf8(title, 'title');
  if (UNSAFE_TITLE_CONTROL_RE.test(title)) {
    throw new Error(
      'Pull-request title contains an unsupported control character.',
    );
  }
  const match = CONVENTIONAL_TITLE_RE.exec(title);
  const groups = match?.groups;
  if (
    groups === undefined ||
    groups.type === undefined ||
    groups.subject === undefined
  ) {
    throw new Error('Pull-request title must be a Conventional Commit title.');
  }
  const rendered = renderConventionalTitle(
    {
      type: groups.type,
      ...(groups.scope === undefined ? {} : { scope: groups.scope }),
      breaking: groups.breaking !== undefined,
      subject: groups.subject,
    },
    policy,
  );
  if (rendered.header !== title) {
    throw new Error('Pull-request title must be a Conventional Commit title.');
  }
  return rendered.warnings;
}

function assertSafeArtifact(
  artifact: RenderedPullRequest,
  options: PrReviewOptions,
): readonly string[] {
  if (
    typeof artifact !== 'object' ||
    artifact === null ||
    typeof artifact.title !== 'string' ||
    typeof artifact.body !== 'string'
  ) {
    throw new Error('Pull-request editor returned an invalid artifact.');
  }
  assertKnownSecretAbsent(artifact, options.knownSecrets ?? []);
  const titleWarnings = validateTitleWarnings(
    artifact.title,
    options.titlePolicy ?? {},
  );
  if (artifact.body.trim().length === 0) {
    throw new Error('Pull-request body must not be empty.');
  }
  assertValidUtf8(artifact.body, 'body');
  if (Buffer.byteLength(artifact.body, 'utf8') > MAX_PR_BODY_BYTES) {
    throw new Error('Pull-request body exceeds its size limit.');
  }
  if (
    UNSAFE_BODY_CONTROL_RE.test(artifact.body) ||
    BARE_CARRIAGE_RETURN_RE.test(artifact.body)
  ) {
    throw new Error('Pull-request body contains an unsupported control character.');
  }
  const editorialWarnings = reviewEditorialText(
    `${artifact.title}\n${artifact.body}`,
    options.editorialPolicy ?? {},
  ).warnings.map((warning) => `[${warning.code}] ${warning.message}`);
  return Object.freeze([...titleWarnings, ...editorialWarnings]);
}

function previewMessage(artifact: RenderedPullRequest): string {
  return [
    'Review the pull-request artifact:',
    '',
    'Title:',
    artifact.title,
    '',
    'Body:',
    artifact.body,
    ...(artifact.warnings.length === 0
      ? []
      : ['', 'Advisories:', ...artifact.warnings.map((warning) => `- ${warning}`)]),
  ].join('\n');
}

export async function reviewPullRequest(
  artifact: RenderedPullRequest,
  options: PrReviewOptions = {},
  dependencies: PrReviewDependencies = {},
): Promise<RenderedPullRequest> {
  const initialWarnings = assertSafeArtifact(artifact, options);
  const reviewed = Object.freeze({
    ...artifact,
    warnings: Object.freeze([...initialWarnings]),
  });
  if (options.yes === true) {
    return reviewed;
  }

  const prompter = dependencies.prompter;
  if (prompter === undefined) {
    throw new Error('Interactive pull-request review requires a prompter.');
  }

  let current = reviewed;
  for (;;) {
    const decision = await prompter.select(
      previewMessage(current),
      REVIEW_CHOICES,
      { defaultValue: 'approve' },
    );
    if (decision === 'approve') {
      return current;
    }
    if (decision === 'cancel') {
      throw new PrReviewCancelledError();
    }

    const editor = dependencies.editor;
    if (editor === undefined) {
      throw new Error('Editing a pull-request artifact requires an editor.');
    }
    const edited = await editor.edit(current);
    const warnings = assertSafeArtifact(edited, options);
    current = Object.freeze({
      ...edited,
      warnings: Object.freeze([...warnings]),
    });
  }
}
