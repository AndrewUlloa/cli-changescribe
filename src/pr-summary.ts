import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { resolveProvider, type ResolvedProvider } from './provider';
import {
  knownSecretValues,
  loadRuntimeConfig,
  redactSecretValues,
} from './runtime-config';
import { defaultCommandRunner } from './subprocess';
import { completeChat, type ParsedCompletion } from './transport';

const execFileSync = defaultCommandRunner.exec;
const spawnSync = defaultCommandRunner.spawn;

const LARGE_BUFFER_SIZE = 10 * 1024 * 1024;
const BODY_TRUNCATION = 4000;
const CHUNK_SIZE_CHARS = 20000;
const DIFF_PER_COMMIT_CHARS = 3000;
const NEWLINE_SPLIT_RE = /\r?\n/;

interface CommitRecord {
  sha: string;
  title: string;
  body: string;
  stat: string;
  diff: string;
}

interface PrArguments {
  base: string;
  out: string;
  limit: number;
  dryRun: boolean;
  issue: string;
  createPr: boolean;
  mode: string;
  skipFormat: boolean;
}

interface ExistingPr {
  number: number;
  title: string;
  url: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ui = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[38;2;0;255;255m',
  magenta: '\x1b[38;2;255;0;255m',
  purple: '\x1b[38;2;148;87;235m',
  blue: '\x1b[38;2;64;160;255m',
  green: '\x1b[38;2;64;255;186m',
  yellow: '\x1b[38;2;255;221;87m',
  red: '\x1b[38;2;255;99;132m',
};

function paint(text: string, color: string): string {
  return `${color}${text}${ui.reset}`;
}

function banner(branch: string, base: string, providerName: string): string {
  const title = paint('PR SYNTHESIZER', ui.magenta);
  const line = paint('═'.repeat(36), ui.purple);
  const meta = `${paint('branch', ui.cyan)} ${branch}  ${paint(
    'base',
    ui.cyan
  )} ${base}  ${paint('provider', ui.cyan)} ${providerName}`;
  return `${line}\n${title}\n${meta}\n${line}`;
}

function step(label: string): void {
  process.stdout.write(`${paint('◆', ui.blue)} ${label}\n`);
}

function success(label: string): void {
  process.stdout.write(`${paint('✓', ui.green)} ${label}\n`);
}

function warn(label: string): void {
  process.stdout.write(`${paint('◷', ui.yellow)} ${label}\n`);
}

function fail(label: string): void {
  process.stdout.write(`${paint('✕', ui.red)} ${label}\n`);
}

function runGit(args: string[]): string {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
  } catch (error) {
    throw new Error(`Git command failed: ${errorMessage(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Diff enrichment
// ---------------------------------------------------------------------------

function getCommitDiffInfo(
  sha: string,
  title: string,
): { stat: string; diff: string } {
  const isMerge = title.toLowerCase().startsWith('merge');

  try {
    // For merge commits, diff against the first parent to see what the merge introduced.
    // For normal commits, use git show which diffs against the single parent.
    const statArgs = isMerge
      ? ['diff', `${sha}^1..${sha}`, '--stat']
      : ['show', sha, '--stat', '--format='];
    const stat = execFileSync('git', statArgs, {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim();

    let diff = '';
    try {
      const diffArgs = isMerge
        ? ['diff', `${sha}^1..${sha}`, '-U3', '--diff-filter=ACMRT']
        : ['show', sha, '-U3', '--format=', '--diff-filter=ACMRT'];
      diff = execFileSync('git', diffArgs, {
        encoding: 'utf8',
        maxBuffer: LARGE_BUFFER_SIZE,
      });
      if (diff.length > DIFF_PER_COMMIT_CHARS) {
        diff = `${diff.slice(0, DIFF_PER_COMMIT_CHARS)}\n...[truncated]...`;
      }
    } catch {
      diff = '(diff unavailable)';
    }

    return { stat, diff };
  } catch {
    return { stat: '(unavailable)', diff: '' };
  }
}

// ---------------------------------------------------------------------------
// Commit collection
// ---------------------------------------------------------------------------

function collectCommits(baseRef: string, limit: number): CommitRecord[] {
  const range = `${baseRef}..HEAD`;
  let rawLog = '';
  try {
    rawLog = runGit([
      'log',
      range,
      '--reverse',
      '--pretty=format:%H%x1f%s%x1f%b%x1e',
    ]);
  } catch (error) {
    if (errorMessage(error).includes('unknown revision')) {
      throw new Error(
        `Base ref "${baseRef}" not found. Use --base to set a valid branch.`
      );
    }
    throw error;
  }

  if (!rawLog.trim()) {
    return [];
  }

  const commits = rawLog
    .split('\x1e')
    .filter(Boolean)
    .map((entry) => {
      const [sha = '', title = '', bodyRaw = ''] = entry.split('\x1f');
      const body = bodyRaw.trim().slice(0, BODY_TRUNCATION);
      return { sha: sha.trim(), title: title.trim(), body, stat: '', diff: '' };
    });

  if (Number.isFinite(limit) && limit > 0 && commits.length > limit) {
    return commits.slice(-limit);
  }

  return commits;
}

function enrichCommitsWithDiffs(commits: CommitRecord[]): void {
  step('Enriching commits with diff context...');
  for (const commit of commits) {
    const info = getCommitDiffInfo(commit.sha, commit.title);
    commit.stat = info.stat;
    commit.diff = info.diff;
  }
  success(`Enriched ${commits.length} commits with diffs`);
}

function tryFetchBase(baseBranch: string): boolean {
  try {
    execFileSync('git', ['fetch', 'origin', baseBranch], {
      encoding: 'utf8',
      stdio: 'ignore',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    return true;
  } catch {
    return false;
  }
}

function resolveBaseRef(baseBranch: string): string {
  try {
    execFileSync(
      'git',
      ['show-ref', '--verify', `refs/remotes/origin/${baseBranch}`],
      {
      encoding: 'utf8',
      stdio: 'ignore',
      maxBuffer: LARGE_BUFFER_SIZE,
      }
    );
    return `origin/${baseBranch}`;
  } catch {
    try {
      execFileSync(
        'git',
        ['show-ref', '--verify', `refs/heads/${baseBranch}`],
        {
        encoding: 'utf8',
        stdio: 'ignore',
        maxBuffer: LARGE_BUFFER_SIZE,
        }
      );
      return baseBranch;
    } catch {
      return baseBranch;
    }
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

function chunkCommits(
  commits: CommitRecord[],
  maxChars: number,
): CommitRecord[][] {
  const chunks: CommitRecord[][] = [];
  let current: CommitRecord[] = [];
  let currentSize = 0;

  for (const commit of commits) {
    const serialized = serializeCommit(commit);
    if (currentSize + serialized.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(commit);
    currentSize += serialized.length;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function serializeCommit(commit: CommitRecord): string {
  const parts = [commit.sha, commit.title, commit.body];
  if (commit.stat) {
    parts.push(commit.stat);
  }
  if (commit.diff) {
    parts.push(commit.diff);
  }
  parts.push('---');
  return `${parts.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// LLM helpers
// ---------------------------------------------------------------------------

async function createCompletionSafe(
  resolved: ResolvedProvider,
  messages: ChatCompletionMessageParam[],
  maxTokens: number,
  knownSecrets: readonly string[],
): Promise<ParsedCompletion> {
  return await completeChat(resolved, {
    messages: redactMessageSecrets(messages, knownSecrets),
    outputLimit: maxTokens,
    intent: 'workflow',
  });
}

function redactMessageSecrets(
  messages: ChatCompletionMessageParam[],
  secrets: readonly string[],
): ChatCompletionMessageParam[] {
  return messages.map((message) =>
    typeof message.content === 'string'
      ? {
          ...message,
          content: redactSecretValues(message.content, secrets),
        } as ChatCompletionMessageParam
      : message,
  );
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildPass1Messages(
  commits: CommitRecord[],
  branch: string,
  base: string,
): ChatCompletionMessageParam[] {
  const titles = commits
    .map((commit) => `- ${commit.title || '(no title)'}`)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        'You summarize commit headlines using a concise five-Cs style (Category, Context, Correctness, Contributions, Clarity). Keep it short and actionable.',
    },
    {
      role: 'user',
      content: [
        `Branch: ${branch}`,
        `Base: ${base}`,
        'Commit titles (oldest to newest):',
        titles || '(no commits)',
        '',
        'Return:',
        '- A 5Cs snapshot of the branch.',
        '- 1-2 bullet headlines per commit.',
      ].join('\n'),
    },
  ];
}

function buildPass2Messages(
  commitsChunk: CommitRecord[],
): ChatCompletionMessageParam[] {
  const body = commitsChunk
    .map((commit) => {
      const parts = [
        `SHA: ${commit.sha}`,
        `Title: ${commit.title || '(no title)'}`,
        `Body:\n${commit.body || '(no body)'}`,
      ];
      if (commit.stat) {
        parts.push(`Files changed:\n${commit.stat}`);
      }
      if (commit.diff) {
        parts.push(`Diff:\n${commit.diff}`);
      }
      parts.push('---');
      return parts.join('\n');
    })
    .join('\n');

  return [
    {
      role: 'system',
      content:
        'You are producing compact, high-signal summaries per commit. Use the diff and file stats to understand exactly what changed in the code. Produce 2-3 bullets each (change, rationale, risk/test note). Flag any breaking changes or migrations. IMPORTANT: Only reference technologies, frameworks, and patterns that are explicitly visible in the diff or file names. Do not infer or guess technologies that are not shown (e.g., do not mention GraphQL unless you see .graphql files or GraphQL client imports in the diff).',
    },
    {
      role: 'user',
      content: [
        'Commits (oldest to newest):',
        body,
        '',
        'Return for each commit:',
        '- Title-aligned bullet: what changed + why (use the diff to be specific about files and code patterns).',
        '- Risk or test note if visible in the diff.',
        'Keep outputs brief; do not restate bodies verbatim.',
      ].join('\n'),
    },
  ];
}

function buildPass3Messages(
  pass2Summaries: string[],
  branch: string,
  base: string,
  issue: string,
  pass1Text: string,
  commitTitles: string,
): ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content:
        'You write PR summaries that are easy to review. Be concise, specific, and action-oriented. Do not include markdown fences. Only reference technologies and patterns that appear in the commit summaries provided. Never fabricate or assume technologies not explicitly mentioned (e.g., do not mention GraphQL, Apollo, Relay, or similar unless the summaries explicitly reference them).',
    },
    {
      role: 'user',
      content: [
        `Branch: ${branch}`,
        `Base: ${base}`,
        '',
        'Inputs (condensed commit summaries):',
        pass2Summaries.join('\n\n') || '(not provided)',
        '',
        'Additional context (5Cs snapshot):',
        pass1Text || '(not provided)',
        '',
        'Commit titles:',
        commitTitles || '(not provided)',
        '',
        'Write a PR summary in this exact order (use these exact headings):',
        'What issue is this PR related to?',
        'What change does this PR add?',
        'How did you test your change?',
        'Anything you want reviewers to scrutinize?',
        'Other notes reviewers should know (risks + follow-ups)',
        '',
        'Rules:',
        '- If the issue is unknown, write: "Related: (not provided)".',
        '- If testing is unknown, write: "Testing: (not provided)".',
        '- Every commit must appear as its own bullet under "What change does this PR add?". Do not group commits under "miscellaneous" or similar catch-all labels.',
        '- Be thorough and specific. Reference actual file names, functions, and architectural changes.',
        '- Prefer bullets.',
        '',
        `Issue hint: ${issue || '(not provided)'}`,
      ].join('\n'),
    },
  ];
}

function buildReleaseMessages(
  pass2Summaries: string[],
  branch: string,
  base: string,
  issue: string,
  pass1Text: string,
  commitTitles: string,
): ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content:
        'You write release PR summaries for QA to production. Be concise, concrete, and action-oriented. Do not include markdown fences. Only reference technologies and patterns that appear in the commit summaries provided. Never fabricate or assume technologies not explicitly mentioned.',
    },
    {
      role: 'user',
      content: [
        `Branch: ${branch}`,
        `Base: ${base}`,
        '',
        'Inputs (condensed commit summaries):',
        pass2Summaries.join('\n\n') || '(not provided)',
        '',
        'Additional context (5Cs snapshot):',
        pass1Text || '(not provided)',
        '',
        'Commit titles:',
        commitTitles || '(not provided)',
        '',
        'Write a release PR summary in this exact order (use these exact headings):',
        'Release summary',
        'Notable user-facing changes',
        'Risk / breaking changes',
        'QA / verification',
        'Operational notes / rollout',
        'Follow-ups / TODOs',
        '',
        'Rules:',
        '- If unknown, write: "Unknown".',
        '- Every commit must appear as its own bullet. Do not group commits under catch-all labels like "miscellaneous".',
        '- Be thorough and specific. Reference actual changes from the commit summaries.',
        '- Prefer bullets.',
        '',
        `Issue hint: ${issue || '(not provided)'}`,
      ].join('\n'),
    },
  ];
}

function formatCommitTitles(commits: CommitRecord[], limit: number): string {
  const items = commits.slice(-limit).map((commit) => {
    const title = commit.title?.trim() || '(no title)';
    return `- ${title}`;
  });
  return items.join('\n');
}

function isUnknownSummary(summary: string, mode: string): boolean {
  const trimmed = summary.trim();
  if (!trimmed) {
    return true;
  }
  if (mode !== 'release') {
    return false;
  }
  const headings = [
    'Release summary',
    'Notable user-facing changes',
    'Risk / breaking changes',
    'QA / verification',
    'Operational notes / rollout',
    'Follow-ups / TODOs',
  ];
  const lines = trimmed.split(NEWLINE_SPLIT_RE);
  let unknownCount = 0;
  for (const heading of headings) {
    const headingIndex = lines.findIndex(
      (line) => line.trim().toLowerCase() === heading.toLowerCase()
    );
    if (headingIndex === -1) {
      return true;
    }
    let nextLine = '';
    for (let i = headingIndex + 1; i < lines.length; i += 1) {
      const candidate = lines[i].trim();
      if (candidate) {
        nextLine = candidate;
        break;
      }
    }
    if (nextLine.toLowerCase() === 'unknown') {
      unknownCount += 1;
    }
  }
  return unknownCount === headings.length;
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

function checkGhCli(): boolean {
  try {
    execFileSync('gh', ['--version'], { encoding: 'utf8', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkUncommittedChanges(): boolean {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

function checkExistingPr(base: string, head: string): ExistingPr | null {
  try {
    const result = spawnSync(
      'gh',
      [
        'pr',
        'list',
        '--base',
        base,
        '--head',
        `${head}`,
        '--state',
        'open',
        '--json',
        'number,title,url',
      ],
      {
        encoding: 'utf8',
        stdio: 'pipe',
      }
    );

    if (result.error || result.status !== 0) {
      return null;
    }

    const parsed: unknown = JSON.parse(result.stdout || '[]');
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    const first: unknown = parsed[0];
    if (
      typeof first !== 'object' ||
      first === null ||
      typeof Reflect.get(first, 'number') !== 'number' ||
      typeof Reflect.get(first, 'title') !== 'string' ||
      typeof Reflect.get(first, 'url') !== 'string'
    ) {
      return null;
    }
    return {
      number: Reflect.get(first, 'number'),
      title: Reflect.get(first, 'title'),
      url: Reflect.get(first, 'url'),
    };
  } catch {
    return null;
  }
}

function hasNpmScript(scriptName: string, cwd = process.cwd()): boolean {
  try {
    const packagePath = path.join(cwd, 'package.json');
    const raw = fs.readFileSync(packagePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }
    const scripts: unknown = Reflect.get(parsed, 'scripts');
    return Boolean(
      typeof scripts === 'object' &&
        scripts !== null &&
        Reflect.get(scripts, scriptName),
    );
  } catch {
    return false;
  }
}

function extractPrTitle(summary: string, mode: string): string | null {
  const targetSection = mode === 'release' ? 'release summary' : 'what change';
  const lines = summary.split('\n');
  let inChangesSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.toLowerCase().includes(targetSection)) {
      inChangesSection = true;
      continue;
    }

    if (inChangesSection && trimmed && trimmed.endsWith('?')) {
      break;
    }

    if (inChangesSection && trimmed.startsWith('-')) {
      const bullet = trimmed.slice(1).trim();
      const clean = bullet
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .slice(0, 100);
      if (clean.length > 10) {
        return clean;
      }
    }
  }

  return null;
}

function createPrWithGh(
  base: string,
  branch: string,
  title: string,
  body: string,
  issue: string,
): string {
  try {
    step('Pushing branch to remote...');
    try {
      execFileSync('git', ['push', '-u', 'origin', branch], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      success('Branch pushed to remote');
    } catch (error) {
      const remoteBranches = execFileSync('git', ['branch', '-r'], {
        encoding: 'utf8',
      });
      if (remoteBranches.includes(`origin/${branch}`)) {
        warn('Branch already exists on remote, skipping push');
      } else {
        throw error;
      }
    }

    step('Creating PR with GitHub CLI...');
    const prTitle = title || branch;

    const bodyFile = path.join(
      os.tmpdir(),
      `pr-body-${Date.now().toString()}.md`
    );
    fs.writeFileSync(bodyFile, body, 'utf8');

    const ghArgs = [
      'pr',
      'create',
      '--base',
      base,
      '--head',
      branch,
      '--title',
      prTitle,
      '--body-file',
      bodyFile,
    ];

    if (issue) {
      ghArgs.push('--issue', issue);
    }

    const result = spawnSync('gh', ghArgs, {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(
        `gh pr create failed: ${result.stderr || result.stdout || 'Unknown error'}`
      );
    }

    const prUrl = result.stdout.trim();

    try {
      fs.unlinkSync(bodyFile);
    } catch {
      // ignore cleanup errors
    }

    success(`PR created: ${prUrl}`);
    return prUrl;
  } catch (error) {
    fail(`Failed to create PR: ${errorMessage(error)}`);
    warn('You can create the PR manually using the generated summary file');
    throw error;
  }
}

function updatePrWithGh(
  prNumber: number,
  title: string,
  body: string,
): void {
  try {
    step(`Updating existing PR #${prNumber}...`);
    const bodyFile = path.join(
      os.tmpdir(),
      `pr-body-${Date.now().toString()}.md`
    );
    fs.writeFileSync(bodyFile, body, 'utf8');

    const args = ['pr', 'edit', String(prNumber), '--body-file', bodyFile];
    if (title) {
      args.push('--title', title);
    }

    const result = spawnSync('gh', args, {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(
        `gh pr edit failed: ${result.stderr || result.stdout || 'Unknown error'}`
      );
    }

    try {
      fs.unlinkSync(bodyFile);
    } catch {
      // ignore cleanup errors
    }

    success(`PR #${prNumber} updated`);
  } catch (error) {
    fail(`Failed to update PR: ${errorMessage(error)}`);
    warn('You can update the PR manually using the generated summary file');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): PrArguments {
  const args: PrArguments = {
    base: env.PR_SUMMARY_BASE || 'main',
    out: env.PR_SUMMARY_OUT || '.pr-summaries/PR_SUMMARY.md',
    limit: Number.parseInt(env.PR_SUMMARY_LIMIT || '400', 10),
    dryRun: false,
    issue: env.PR_SUMMARY_ISSUE || '',
    createPr: false,
    mode: '',
    skipFormat: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--base' && argv[i + 1]) {
      args.base = argv[i + 1];
      i += 1;
    } else if (current === '--out' && argv[i + 1]) {
      args.out = argv[i + 1];
      i += 1;
    } else if (current === '--limit' && argv[i + 1]) {
      args.limit = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (current === '--issue' && argv[i + 1]) {
      args.issue = argv[i + 1];
      i += 1;
    } else if (current === '--dry-run') {
      args.dryRun = true;
    } else if (current === '--create-pr') {
      args.createPr = true;
    } else if (current === '--skip-format' || current === '--no-format') {
      args.skipFormat = true;
    } else if (current === '--mode' && argv[i + 1]) {
      args.mode = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const runtime = loadRuntimeConfig();
  const knownSecrets = knownSecretValues(runtime.values);
  const resolved = resolveProvider({
    env: runtime.values,
    sources: runtime.sources,
    command: 'pr',
  });
  if (!resolved) {
    throw new Error(
      'No provider configured. Set DIFFWRIGHT_PROVIDER and its credential, or CEREBRAS_API_KEY/GROQ_API_KEY.',
    );
  }

  const { id: provider, model } = resolved.profile;

  const args = parseArgs(argv, runtime.values);
  const branch = runGit(['branch', '--show-current']).trim();
  const mode =
    args.mode ||
    (branch === 'staging' && args.base === 'main' ? 'release' : 'feature');

  process.stdout.write(`${banner(branch, args.base, provider)}\n`);

  const didFetch = tryFetchBase(args.base);
  if (!didFetch) {
    warn(`Could not fetch origin/${args.base}; using local refs`);
  }
  const baseRef = resolveBaseRef(args.base);
  const commits = collectCommits(baseRef, args.limit);
  if (commits.length === 0) {
    success(`No commits found in range ${baseRef}..HEAD`);
    return;
  }

  if (args.dryRun) {
    warn('Dry run (no API calls)');
    step(`Base: ${args.base}`);
    step(`Branch: ${branch}`);
    step(`Commits: ${commits.length}`);
    step(`Limit: ${args.limit}`);
    step(`Output: ${args.out}`);
    step(`Issue: ${args.issue || '(not provided)'}`);
    step(`Create PR: ${args.createPr ? 'yes' : 'no'}`);
    step(`Mode: ${mode}`);
    step(`Provider: ${provider}`);
    step(`Model: ${model}`);
    return;
  }

  if (args.createPr && !checkGhCli()) {
    throw new Error(
      'GitHub CLI (gh) is required for --create-pr. Install it from https://cli.github.com/ and run gh auth login.',
    );
  }

  // Safety checks before creating PR
  if (args.createPr) {
    if (args.skipFormat) {
      warn('Skipping format step (flagged)');
    } else if (!hasNpmScript('format')) {
      warn('Skipping format step (no npm script named "format")');
    } else {
      step('Running npm run format before PR creation...');
      try {
        execFileSync('npm', ['run', 'format'], {
          encoding: 'utf8',
          stdio: 'inherit',
        });
      } catch (_error) {
        throw new Error('npm run format failed; fix formatting errors first.');
      }
    }

    step('Running npm test before PR creation...');
    try {
      execFileSync('npm', ['test'], { encoding: 'utf8', stdio: 'inherit' });
    } catch (_error) {
      throw new Error('npm test failed; fix test failures first.');
    }

    step('Running npm run build before PR creation...');
    try {
      execFileSync('npm', ['run', 'build'], {
        encoding: 'utf8',
        stdio: 'inherit',
      });
    } catch (_error) {
      throw new Error('npm run build failed; fix build errors first.');
    }

    if (checkUncommittedChanges()) {
      throw new Error(
        'You have uncommitted changes; commit them before creating a PR.',
      );
    }

    const existingPr = checkExistingPr(args.base, branch);
    if (existingPr) {
      warn(`Found existing PR #${existingPr.number}: ${existingPr.title}`);
    }
  }

  step(`Collecting ${commits.length} commits from ${baseRef}..HEAD`);

  // Enrich commits with diff context for better LLM understanding
  enrichCommitsWithDiffs(commits);

  // Pass 1: 5Cs snapshot from titles only
  const pass1Messages = buildPass1Messages(commits, branch, baseRef);
  const pass1 = await createCompletionSafe(
    resolved,
    pass1Messages,
    2048,
    knownSecrets,
  );
  const pass1Text = redactSecretValues(pass1.content, knownSecrets).trim();
  success('Pass 1 complete (5Cs snapshot)');

  // Pass 2: per-commit condensation with diff context
  const chunks = chunkCommits(commits, CHUNK_SIZE_CHARS);
  step(`Pass 2 across ${chunks.length} chunk(s)`);
  const pass2Outputs: string[] = [];
  for (const chunk of chunks) {
    const messages = buildPass2Messages(chunk);
    // biome-ignore lint/nursery/noAwaitInLoop: sequential LLM calls to avoid rate limits and keep output order predictable
    const completion = await createCompletionSafe(
      resolved,
      messages,
      4096,
      knownSecrets,
    );
    const chunkText = redactSecretValues(
      completion.content,
      knownSecrets,
    ).trim();
    if (chunkText) {
      pass2Outputs.push(chunkText);
    }
  }
  success('Pass 2 complete (per-commit condensation)');

  // Pass 3: synthesize PR summary
  const pass3Messages =
    mode === 'release'
      ? buildReleaseMessages(
          pass2Outputs,
          branch,
          baseRef,
          args.issue,
          pass1Text,
          formatCommitTitles(commits, 40)
        )
      : buildPass3Messages(
          pass2Outputs,
          branch,
          baseRef,
          args.issue,
          pass1Text,
          formatCommitTitles(commits, 40)
        );
  const pass3 = await createCompletionSafe(
    resolved,
    pass3Messages,
    4096,
    knownSecrets,
  );
  let finalSummary = redactSecretValues(
    pass3.content,
    knownSecrets,
  ).trim();
  if (isUnknownSummary(finalSummary, mode)) {
    warn('Pass 3 summary returned Unknown; retrying with fallback context...');
    const retryMessages =
      mode === 'release'
        ? buildReleaseMessages(
            pass2Outputs.length > 0 ? pass2Outputs : ['(pass2 unavailable)'],
            branch,
            baseRef,
            args.issue,
            pass1Text || '(not provided)',
            formatCommitTitles(commits, 80)
          )
        : buildPass3Messages(
            pass2Outputs.length > 0 ? pass2Outputs : ['(pass2 unavailable)'],
            branch,
            baseRef,
            args.issue,
            pass1Text || '(not provided)',
            formatCommitTitles(commits, 80)
          );
    const retry = await createCompletionSafe(
      resolved,
      retryMessages,
      4096,
      knownSecrets,
    );
    finalSummary =
      redactSecretValues(retry.content, knownSecrets).trim() || finalSummary;
  }
  success('Pass 3 complete (PR synthesis)');

  const prBlock = [
    `PR Summary for ${branch} (base: ${baseRef})`,
    '',
    '--- PR Summary (paste into GitHub PR) ---',
    finalSummary,
  ].join('\n');

  const appendix = [
    '',
    '--- Pass 1 (5Cs snapshot) ---',
    pass1Text,
    '',
    '--- Pass 2 (per-commit condensed) ---',
    pass2Outputs.join('\n\n'),
  ].join('\n');

  const fullOutput = `${prBlock}\n${appendix}`;

  const resolvedOut = path.isAbsolute(args.out)
    ? args.out
    : path.join(process.cwd(), args.out);

  const outDir = path.dirname(resolvedOut);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(resolvedOut, fullOutput, 'utf8');
  success(`PR summary written to ${resolvedOut}`);

  const finalOutPath = path.join(
    path.dirname(resolvedOut),
    `${path.basename(resolvedOut, path.extname(resolvedOut))}.final.md`
  );
  fs.writeFileSync(finalOutPath, prBlock, 'utf8');
  success(`PR-ready (slim) summary written to ${finalOutPath}`);

  const tmpPath = path.join(
    os.tmpdir(),
    `pr-summary-${Date.now().toString()}-${path.basename(resolvedOut)}`
  );
  fs.writeFileSync(tmpPath, fullOutput, 'utf8');
  warn(`Backup copy saved to ${tmpPath}`);

  if (args.createPr) {
    const prTitle = extractPrTitle(finalSummary, mode) || branch;
    try {
      const existingPr = checkExistingPr(args.base, branch);
      if (existingPr) {
        updatePrWithGh(existingPr.number, prTitle, finalSummary);
      } else {
        createPrWithGh(args.base, branch, prTitle, finalSummary, args.issue);
      }
    } catch (error) {
      throw error;
    }
  }
}

export async function runPrSummary(
  argv = process.argv.slice(2),
): Promise<void> {
  await main(argv);
}
