export type EditorialWarningCode =
  | 'excessive-sentence-length'
  | 'vague-absolute'
  | 'duplicate-normalized-claim'
  | 'unstable-terminology';

export interface EditorialTerminologyGroup {
  readonly name: string;
  readonly terms: readonly string[];
}

export interface EditorialPolicy {
  readonly maxSentenceWords: number;
  readonly duplicateClaimMinWords: number;
  readonly vagueAbsolutes: readonly string[];
  readonly terminologyGroups: readonly EditorialTerminologyGroup[];
}

export interface EditorialWarning {
  readonly code: EditorialWarningCode;
  readonly severity: 'warning';
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly sentenceIndexes?: readonly number[];
  readonly terms?: readonly string[];
}

export interface EditorialReview {
  /** The exact input, returned to make the no-rewrite contract explicit. */
  readonly text: string;
  readonly warnings: readonly EditorialWarning[];
}

const DEFAULT_VAGUE_ABSOLUTES = Object.freeze([
  'always',
  'never',
  'every',
  'everyone',
  'everything',
  'no one',
  'nothing',
  'completely',
  'entirely',
  'guaranteed',
  'guarantees',
  'impossible',
  'perfect',
]);

const DEFAULT_TERMINOLOGY_GROUPS = Object.freeze(
  [] as EditorialTerminologyGroup[],
);

export const DEFAULT_EDITORIAL_POLICY: Readonly<EditorialPolicy> =
  Object.freeze({
    maxSentenceWords: 25,
    duplicateClaimMinWords: 4,
    vagueAbsolutes: DEFAULT_VAGUE_ABSOLUTES,
    terminologyGroups: DEFAULT_TERMINOLOGY_GROUPS,
  });

interface Sentence {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface TermOccurrence {
  readonly configuredTerm: string;
  readonly start: number;
  readonly end: number;
}

const PROTECTED_SPAN_RE = /https?:\/\/[^\s<>]+|`[^`\r\n]+`/gu;
const SENTENCE_RE = /[^.!?\n]+(?:[.!?]+(?=\s|$)|(?=\n|$))/gu;

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function uniqueNonemptyStrings(
  values: readonly string[],
  name: string,
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new TypeError(`${name} must not contain an empty value`);
    }
    const normalized = trimmed.toLocaleLowerCase('en-US');
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(trimmed);
    }
  }
  return Object.freeze(result);
}

function freezeTerminologyGroups(
  groups: readonly EditorialTerminologyGroup[],
): readonly EditorialTerminologyGroup[] {
  return Object.freeze(
    groups.map((group, index) => {
      const name = group.name.trim();
      if (!name) {
        throw new TypeError(
          `terminologyGroups[${index.toString()}].name must not be empty`,
        );
      }
      const terms = uniqueNonemptyStrings(
        group.terms,
        `terminologyGroups[${index.toString()}].terms`,
      );
      if (terms.length < 2) {
        throw new TypeError(
          `terminologyGroups[${index.toString()}].terms must contain at least two distinct terms`,
        );
      }
      return Object.freeze({ name, terms });
    }),
  );
}

/**
 * Resolve overrides against stable defaults and return a deeply frozen policy.
 */
export function createEditorialPolicy(
  overrides: Partial<EditorialPolicy> = {},
): Readonly<EditorialPolicy> {
  return Object.freeze({
    maxSentenceWords: positiveInteger(
      overrides.maxSentenceWords ??
        DEFAULT_EDITORIAL_POLICY.maxSentenceWords,
      'maxSentenceWords',
    ),
    duplicateClaimMinWords: positiveInteger(
      overrides.duplicateClaimMinWords ??
        DEFAULT_EDITORIAL_POLICY.duplicateClaimMinWords,
      'duplicateClaimMinWords',
    ),
    vagueAbsolutes: uniqueNonemptyStrings(
      overrides.vagueAbsolutes ?? DEFAULT_EDITORIAL_POLICY.vagueAbsolutes,
      'vagueAbsolutes',
    ),
    terminologyGroups: freezeTerminologyGroups(
      overrides.terminologyGroups ??
        DEFAULT_EDITORIAL_POLICY.terminologyGroups,
    ),
  });
}

function segmentSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  const segmentable = maskProtectedSpans(text);
  for (const match of segmentable.matchAll(SENTENCE_RE)) {
    const raw = match[0];
    const leadingWhitespace = raw.length - raw.trimStart().length;
    const trailingWhitespace = raw.length - raw.trimEnd().length;
    const start = (match.index ?? 0) + leadingWhitespace;
    const end = (match.index ?? 0) + raw.length - trailingWhitespace;
    if (end > start) {
      sentences.push({ text: text.slice(start, end), start, end });
    }
  }
  return sentences;
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/u)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

function maskProtectedSpans(text: string): string {
  return text.replace(PROTECTED_SPAN_RE, (value) => {
    if (value.startsWith('`')) {
      return ' '.repeat(value.length);
    }
    const punctuation = /[.!?]+$/u.exec(value)?.[0] ?? '';
    return `${' '.repeat(value.length - punctuation.length)}${punctuation}`;
  });
}

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termPattern(term: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapedPattern(term)}(?![\\p{L}\\p{N}_])`,
    'giu',
  );
}

function normalizeProtectedSpans(text: string): string {
  return text.replace(PROTECTED_SPAN_RE, (value) => {
    const codePoints = Array.from(value, (character) =>
      (character.codePointAt(0) ?? 0).toString(),
    );
    return ` protected_${codePoints.join('_')} `;
  });
}

function normalizeClaim(text: string): string {
  return normalizeProtectedSpans(text)
    .toLocaleLowerCase('en-US')
    .replace(/^\s*[-*]\s+/u, '')
    .replace(/[.,;:!?]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function freezeWarning(warning: EditorialWarning): EditorialWarning {
  const sentenceIndexes = warning.sentenceIndexes
    ? Object.freeze([...warning.sentenceIndexes])
    : undefined;
  const terms = warning.terms ? Object.freeze([...warning.terms]) : undefined;
  return Object.freeze({ ...warning, sentenceIndexes, terms });
}

function vagueAbsoluteWarnings(
  sentence: Sentence,
  policy: Readonly<EditorialPolicy>,
): EditorialWarning[] {
  const inspectable = maskProtectedSpans(sentence.text);
  const occurrences: Array<{
    term: string;
    start: number;
    end: number;
  }> = [];
  const termsSeen = new Set<string>();

  for (const term of policy.vagueAbsolutes) {
    const match = termPattern(term).exec(inspectable);
    if (!match) {
      continue;
    }
    const normalized = term.toLocaleLowerCase('en-US');
    if (termsSeen.has(normalized)) {
      continue;
    }
    termsSeen.add(normalized);
    occurrences.push({
      term: sentence.text.slice(match.index, match.index + match[0].length),
      start: sentence.start + match.index,
      end: sentence.start + match.index + match[0].length,
    });
  }

  occurrences.sort((left, right) => left.start - right.start);
  return occurrences.map((occurrence) => ({
    code: 'vague-absolute',
    severity: 'warning',
    message: `Potential vague absolute "${occurrence.term}"; verify the claim or qualify its scope.`,
    start: occurrence.start,
    end: occurrence.end,
  }));
}

function terminologyWarnings(
  text: string,
  policy: Readonly<EditorialPolicy>,
): EditorialWarning[] {
  const inspectable = maskProtectedSpans(text);
  const warnings: EditorialWarning[] = [];

  for (const group of policy.terminologyGroups) {
    const occurrences: TermOccurrence[] = [];
    for (const configuredTerm of group.terms) {
      const match = termPattern(configuredTerm).exec(inspectable);
      if (match) {
        occurrences.push({
          configuredTerm,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
    if (occurrences.length < 2) {
      continue;
    }
    occurrences.sort((left, right) => left.start - right.start);
    const terms = occurrences.map((occurrence) => occurrence.configuredTerm);
    const first = occurrences[0];
    if (!first) {
      continue;
    }
    warnings.push({
      code: 'unstable-terminology',
      severity: 'warning',
      message:
        `Potentially unstable terminology in "${group.name}": ` +
        `${terms.map((term) => `"${term}"`).join(' and ')} are both used; ` +
        'confirm they mean the same thing.',
      start: first.start,
      end: first.end,
      terms,
    });
  }

  return warnings;
}

/**
 * Review prose without rewriting it. Findings are advisory and deterministic.
 */
export function reviewEditorialText(
  text: string,
  overrides: Partial<EditorialPolicy> = {},
): EditorialReview {
  const policy = createEditorialPolicy(overrides);
  const sentences = segmentSentences(text);
  const warnings: EditorialWarning[] = [];
  const firstClaimByNormalization = new Map<string, number>();

  for (const [sentenceIndex, sentence] of sentences.entries()) {
    const wordCount = countWords(sentence.text);
    if (wordCount > policy.maxSentenceWords) {
      warnings.push({
        code: 'excessive-sentence-length',
        severity: 'warning',
        message:
          `Sentence has ${wordCount.toString()} words; the configured ` +
          `advisory limit is ${policy.maxSentenceWords.toString()}.`,
        start: sentence.start,
        end: sentence.end,
        sentenceIndexes: [sentenceIndex],
      });
    }

    warnings.push(...vagueAbsoluteWarnings(sentence, policy));

    if (wordCount >= policy.duplicateClaimMinWords) {
      const normalized = normalizeClaim(sentence.text);
      const firstSentenceIndex = firstClaimByNormalization.get(normalized);
      if (firstSentenceIndex !== undefined) {
        warnings.push({
          code: 'duplicate-normalized-claim',
          severity: 'warning',
          message:
            'Sentence repeats the normalized claim first made in sentence ' +
            `${(firstSentenceIndex + 1).toString()}.`,
          start: sentence.start,
          end: sentence.end,
          sentenceIndexes: [firstSentenceIndex, sentenceIndex],
        });
      } else if (normalized) {
        firstClaimByNormalization.set(normalized, sentenceIndex);
      }
    }
  }

  warnings.push(...terminologyWarnings(text, policy));
  const frozenWarnings = Object.freeze(warnings.map(freezeWarning));
  return Object.freeze({ text, warnings: frozenWarnings });
}
