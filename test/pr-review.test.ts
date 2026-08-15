import assert from 'node:assert/strict';
import test from 'node:test';

type ReviewDecision = 'approve' | 'edit' | 'cancel';

interface RenderedPullRequest {
  readonly title: string;
  readonly body: string;
}

interface SelectChoice<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
}

interface SelectOptions<T extends string> {
  readonly defaultValue?: T;
}

interface ReviewPrompter {
  select<T extends string>(
    message: string,
    choices: readonly SelectChoice<T>[],
    options?: SelectOptions<T>,
  ): Promise<T>;
}

interface EditorAdapter {
  edit(artifact: RenderedPullRequest): Promise<RenderedPullRequest>;
}

interface ReviewModule {
  MAX_PR_BODY_BYTES: number;
  PrReviewCancelledError: new (message?: string) => Error & {
    readonly code: 'pr_review_cancelled';
  };
  reviewPullRequest(
    artifact: RenderedPullRequest,
    options: {
      readonly yes?: boolean;
      readonly knownSecrets?: readonly string[];
      readonly titlePolicy?: {
        readonly allowedTypes?: readonly string[];
        readonly targetLength?: number;
        readonly maximumLength?: number;
      };
    },
    dependencies?: {
      readonly prompter?: ReviewPrompter;
      readonly editor?: EditorAdapter;
    },
  ): Promise<RenderedPullRequest>;
}

const review: ReviewModule = require('../dist/pr-review.js');

const original: RenderedPullRequest = Object.freeze({
  title: 'fix(parser): handle empty tokens',
  body: '## Summary\n\n- Handle empty parser tokens.\n',
});

class FakePrompter implements ReviewPrompter {
  readonly previews: string[] = [];
  readonly choices: ReadonlyArray<readonly string[]> = [];

  constructor(private readonly decisions: ReviewDecision[]) {}

  async select<T extends string>(
    message: string,
    choices: readonly SelectChoice<T>[],
    options?: SelectOptions<T>,
  ): Promise<T> {
    this.previews.push(message);
    (this.choices as Array<readonly string[]>).push(
      choices.map((choice) => choice.value),
    );
    assert.equal(options?.defaultValue, 'approve');
    const decision = this.decisions.shift();
    assert.notEqual(decision, undefined, 'unexpected review prompt');
    return decision as T;
  }
}

test('--yes bypass returns the exact rendered artifact without prompting or editing', async () => {
  const prompter = new FakePrompter([]);
  let edits = 0;

  const result = await review.reviewPullRequest(
    original,
    { yes: true },
    {
      prompter,
      editor: {
        edit: async () => {
          edits += 1;
          return original;
        },
      },
    },
  );

  assert.equal(result, original);
  assert.equal(prompter.previews.length, 0);
  assert.equal(edits, 0);
});

test('interactive approval previews the exact title and body', async () => {
  const prompter = new FakePrompter(['approve']);

  const result = await review.reviewPullRequest(
    original,
    {},
    { prompter },
  );

  assert.equal(result, original);
  assert.equal(prompter.previews.length, 1);
  assert.match(prompter.previews[0] ?? '', /fix\(parser\): handle empty tokens/);
  assert.match(
    prompter.previews[0] ?? '',
    /## Summary\n\n- Handle empty parser tokens\./,
  );
  assert.deepEqual(prompter.choices[0], ['approve', 'edit', 'cancel']);
});

test('cancellation throws a typed error before the editor can run', async () => {
  const prompter = new FakePrompter(['cancel']);
  let edits = 0;

  await assert.rejects(
    review.reviewPullRequest(
      original,
      {},
      {
        prompter,
        editor: {
          edit: async () => {
            edits += 1;
            return original;
          },
        },
      },
    ),
    (error: unknown) =>
      error instanceof review.PrReviewCancelledError &&
      error.code === 'pr_review_cancelled',
  );
  assert.equal(edits, 0);
});

test('a valid edit is revalidated and previewed again before approval', async () => {
  const edited = Object.freeze({
    title: 'feat(cli)!: add guarded PR review',
    body: '## Summary\r\n\r\n- Add an explicit review step.\r\n',
  });
  const prompter = new FakePrompter(['edit', 'approve']);
  const seenByEditor: RenderedPullRequest[] = [];

  const result = await review.reviewPullRequest(
    original,
    {},
    {
      prompter,
      editor: {
        edit: async (artifact) => {
          seenByEditor.push(artifact);
          return edited;
        },
      },
    },
  );

  assert.deepEqual(seenByEditor, [original]);
  assert.deepEqual(result, edited);
  assert.equal(prompter.previews.length, 2);
  assert.match(prompter.previews[0] ?? '', /fix\(parser\)/);
  assert.doesNotMatch(prompter.previews[0] ?? '', /guarded PR review/);
  assert.match(prompter.previews[1] ?? '', /feat\(cli\)!: add guarded PR review/);
  assert.match(prompter.previews[1] ?? '', /explicit review step/);
});

test('invalid edited titles and bodies fail closed', async () => {
  const invalidArtifacts: Array<readonly [string, RenderedPullRequest, RegExp]> = [
    [
      'non-conventional title',
      { title: 'Add guarded review', body: original.body },
      /Conventional Commit title/i,
    ],
    [
      'overlong title',
      { title: `fix: ${'a'.repeat(68)}`, body: original.body },
      /72-character maximum/i,
    ],
    [
      'control character',
      { title: original.title, body: 'safe\n\u001b[31mspoofed' },
      /control character/i,
    ],
    [
      'bare carriage return',
      { title: original.title, body: 'safe\rspoofed' },
      /control character/i,
    ],
    [
      'invalid UTF-8 string',
      { title: original.title, body: 'invalid surrogate: \ud800' },
      /UTF-8/i,
    ],
    [
      'oversized body',
      { title: original.title, body: 'a'.repeat(review.MAX_PR_BODY_BYTES + 1) },
      /size limit/i,
    ],
  ];

  for (const [label, invalid, message] of invalidArtifacts) {
    const prompter = new FakePrompter(['edit']);
    await assert.rejects(
      review.reviewPullRequest(
        original,
        {},
        {
          prompter,
          editor: { edit: async () => invalid },
        },
      ),
      message,
      label,
    );
    assert.equal(prompter.previews.length, 1, label);
  }
});

test('edited artifacts containing a known secret are rejected without echoing it', async () => {
  const secret = 'gsk_review_secret_value';
  const prompter = new FakePrompter(['edit']);

  let caught: unknown;
  try {
    await review.reviewPullRequest(
      original,
      { knownSecrets: [secret] },
      {
        prompter,
        editor: {
          edit: async () => ({
            title: original.title,
            body: `## Summary\n\n- Accidentally expose ${secret}.\n`,
          }),
        },
      },
    );
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error);
  assert.match(caught.message, /known secret/i);
  assert.doesNotMatch(caught.message, new RegExp(secret));
  assert.doesNotMatch(prompter.previews.join('\n'), new RegExp(secret));
});
