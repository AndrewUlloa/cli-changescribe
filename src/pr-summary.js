const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('dotenv');
const Groq = require('groq-sdk').default;

config({ path: '.env.local' });

const DEFAULT_BASE = process.env.PR_SUMMARY_BASE || 'main';
const DEFAULT_OUT = process.env.PR_SUMMARY_OUT || '.pr-summaries/PR_SUMMARY.md';
const DEFAULT_MODEL =
  process.env.GROQ_PR_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const DEFAULT_LIMIT = Number.parseInt(
  process.env.PR_SUMMARY_LIMIT || '400',
  10
);
const DEFAULT_ISSUE = process.env.PR_SUMMARY_ISSUE || '';
const LARGE_BUFFER_SIZE = 10 * 1024 * 1024;
const BODY_TRUNCATION = 4000;
const CHUNK_SIZE_CHARS = 8000;
const NEWLINE_SPLIT_RE = /\r?\n/;

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

function paint(text, color) {
  return `${color}${text}${ui.reset}`;
}

function banner(branch, base) {
  const title = paint('PR SYNTHESIZER', ui.magenta);
  const line = paint('═'.repeat(36), ui.purple);
  const meta = `${paint('branch', ui.cyan)} ${branch}  ${paint(
    'base',
    ui.cyan
  )} ${base}`;
  return `${line}\n${title}\n${meta}\n${line}`;
}

function step(label) {
  process.stdout.write(`${paint('◆', ui.blue)} ${label}\n`);
}

function success(label) {
  process.stdout.write(`${paint('✓', ui.green)} ${label}\n`);
}

function warn(label) {
  process.stdout.write(`${paint('◷', ui.yellow)} ${label}\n`);
}

function fail(label) {
  process.stdout.write(`${paint('✕', ui.red)} ${label}\n`);
}

function runGit(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
  } catch (error) {
    throw new Error(`Git command failed: ${error.message}`);
  }
}

function collectCommits(baseRef, limit) {
  const range = `${baseRef}..HEAD`;
  let rawLog = '';
  try {
    rawLog = runGit(
      `git log ${range} --reverse --pretty=format:%H%x1f%s%x1f%b%x1e`
    );
  } catch (error) {
    if (error.message.includes('unknown revision')) {
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
      return { sha: sha.trim(), title: title.trim(), body };
    });

  if (Number.isFinite(limit) && limit > 0 && commits.length > limit) {
    return commits.slice(-limit);
  }

  return commits;
}

function tryFetchBase(baseBranch) {
  try {
    execSync(`git fetch origin ${baseBranch}`, {
      encoding: 'utf8',
      stdio: 'ignore',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    return true;
  } catch {
    return false;
  }
}

function resolveBaseRef(baseBranch) {
  try {
    execSync(`git show-ref --verify refs/remotes/origin/${baseBranch}`, {
      encoding: 'utf8',
      stdio: 'ignore',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    return `origin/${baseBranch}`;
  } catch {
    try {
      execSync(`git show-ref --verify refs/heads/${baseBranch}`, {
        encoding: 'utf8',
        stdio: 'ignore',
        maxBuffer: LARGE_BUFFER_SIZE,
      });
      return baseBranch;
    } catch {
      return baseBranch;
    }
  }
}

function chunkCommits(commits, maxChars) {
  const chunks = [];
  let current = [];
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

function serializeCommit(commit) {
  return `${commit.sha}\n${commit.title}\n${commit.body}\n---\n`;
}

async function createCompletionSafe(groq, messages, model, maxTokens) {
  try {
    return await groq.chat.completions.create({
      messages,
      model,
      temperature: 0.3,
      max_tokens: maxTokens,
    });
  } catch (error) {
    fail('Groq API error while creating completion');
    step(formatError(error));
    process.exit(1);
  }
}

function buildPass1Messages(commits, branch, base) {
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

function buildPass2Messages(commitsChunk) {
  const body = commitsChunk
    .map((commit) =>
      [
        `SHA: ${commit.sha}`,
        `Title: ${commit.title || '(no title)'}`,
        `Body:\n${commit.body || '(no body)'}`,
        '---',
      ].join('\n')
    )
    .join('\n');

  return [
    {
      role: 'system',
      content:
        'You are producing compact, high-signal summaries per commit: 2-3 bullets each (change, rationale, risk/test note). Flag any breaking changes or migrations.',
    },
    {
      role: 'user',
      content: [
        'Commits (oldest to newest):',
        body,
        '',
        'Return for each commit:',
        '- Title-aligned bullet: what changed + why.',
        '- Risk or test note if visible.',
        'Keep outputs brief; do not restate bodies.',
      ].join('\n'),
    },
  ];
}

function buildPass3Messages(
  pass2Summaries,
  branch,
  base,
  issue,
  pass1Text,
  commitTitles
) {
  return [
    {
      role: 'system',
      content:
        'You write PR summaries that are easy to review. Be concise, specific, and action-oriented. Do not include markdown fences.',
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
        '- Prefer bullets. Be thorough but not rambly.',
        '',
        `Issue hint: ${issue || '(not provided)'}`,
      ].join('\n'),
    },
  ];
}

function buildReleaseMessages(
  pass2Summaries,
  branch,
  base,
  issue,
  pass1Text,
  commitTitles
) {
  return [
    {
      role: 'system',
      content:
        'You write release PR summaries for QA to production. Be concise, concrete, and action-oriented. Do not include markdown fences.',
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
        '- Prefer bullets. Be thorough but not rambly.',
        '',
        `Issue hint: ${issue || '(not provided)'}`,
      ].join('\n'),
    },
  ];
}

function formatError(error) {
  const plain = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === 'response' && error.response) {
      plain.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers || undefined,
        data: error.response.data || undefined,
      };
    } else {
      try {
        plain[key] = error[key];
      } catch {
        // ignore
      }
    }
  }
  return safeStringify(plain);
}

function safeStringify(obj) {
  try {
    const seen = new WeakSet();
    return JSON.stringify(
      obj,
      (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return value;
      },
      2
    );
  } catch {
    try {
      return String(obj);
    } catch {
      return '[Unstringifiable]';
    }
  }
}

function formatCommitTitles(commits, limit) {
  const items = commits.slice(-limit).map((commit) => {
    const title = commit.title?.trim() || '(no title)';
    return `- ${title}`;
  });
  return items.join('\n');
}

function isUnknownSummary(summary, mode) {
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

function checkGhCli() {
  try {
    execSync('gh --version', { encoding: 'utf8', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkUncommittedChanges() {
  try {
    const status = execSync('git status --porcelain', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

function checkExistingPr(base, head) {
  try {
    // Check for open PRs from head to base
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
      // If gh command fails, assume no PR exists (might be auth issue, but we'll catch that later)
      return null;
    }

    const prs = JSON.parse(result.stdout || '[]');
    return prs.length > 0 ? prs[0] : null;
  } catch {
    // If parsing fails or command fails, assume no PR exists
    return null;
  }
}

function hasNpmScript(scriptName, cwd = process.cwd()) {
  try {
    const packagePath = path.join(cwd, 'package.json');
    const raw = fs.readFileSync(packagePath, 'utf8');
    const pkg = JSON.parse(raw);
    return Boolean(pkg?.scripts?.[scriptName]);
  } catch {
    return false;
  }
}

function extractPrTitle(summary, mode) {
  const targetSection = mode === 'release' ? 'release summary' : 'what change';
  // Try to extract a title from the summary
  const lines = summary.split('\n');
  let inChangesSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect the target section
    if (trimmed.toLowerCase().includes(targetSection)) {
      inChangesSection = true;
      continue;
    }

    // If we hit another section heading, stop looking
    if (inChangesSection && trimmed && trimmed.endsWith('?')) {
      break;
    }

    // If we're in the changes section, look for first bullet point
    if (inChangesSection && trimmed.startsWith('-')) {
      // Extract bullet content, clean it up
      const bullet = trimmed.slice(1).trim();
      // Remove markdown formatting and truncate
      const clean = bullet
        .replace(/`([^`]+)`/g, '$1') // Remove backticks
        .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold
        .replace(/\*([^*]+)\*/g, '$1') // Remove italic
        .slice(0, 100);
      if (clean.length > 10) {
        return clean;
      }
    }
  }

  // Fallback: use first commit title or branch name
  return null;
}

function createPrWithGh(base, branch, title, body) {
  try {
    // Ensure branch is pushed first
    step('Pushing branch to remote...');
    try {
      execSync(`git push -u origin ${branch}`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      success('Branch pushed to remote');
    } catch (error) {
      // Branch might already be pushed, check if it exists
      const remoteBranches = execSync('git branch -r', {
        encoding: 'utf8',
      });
      if (remoteBranches.includes(`origin/${branch}`)) {
        warn('Branch already exists on remote, skipping push');
      } else {
        throw error;
      }
    }

    // Create PR using gh CLI
    step('Creating PR with GitHub CLI...');
    const prTitle = title || branch;

    // Write body to temp file to avoid shell escaping issues
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

    // Add issue reference if provided via environment
    const issueEnv = process.env.PR_SUMMARY_ISSUE || '';
    if (issueEnv) {
      ghArgs.push('--issue', issueEnv);
    }

    // Use spawnSync for better argument handling
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

    // Cleanup temp file
    try {
      fs.unlinkSync(bodyFile);
    } catch {
      // ignore cleanup errors
    }

    success(`PR created: ${prUrl}`);
    return prUrl;
  } catch (error) {
    fail(`Failed to create PR: ${error.message}`);
    warn('You can create the PR manually using the generated summary file');
    throw error;
  }
}

function updatePrWithGh(prNumber, title, body) {
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
    fail(`Failed to update PR: ${error.message}`);
    warn('You can update the PR manually using the generated summary file');
    throw error;
  }
}

function parseArgs(argv) {
  const args = {
    base: DEFAULT_BASE,
    out: DEFAULT_OUT,
    limit: DEFAULT_LIMIT,
    dryRun: false,
    issue: DEFAULT_ISSUE,
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

async function main(argv) {
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === '') {
    fail('GROQ_API_KEY environment variable is required');
    step('Set it in .env.local: GROQ_API_KEY="your-key-here"');
    process.exit(1);
  }

  const args = parseArgs(argv);
  const branch = runGit('git branch --show-current').trim();
  const mode =
    args.mode ||
    (branch === 'staging' && args.base === 'main' ? 'release' : 'feature');
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  process.stdout.write(`${banner(branch, args.base)}\n`);

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
    return;
  }

  if (args.createPr && !checkGhCli()) {
    fail('GitHub CLI (gh) is required for --create-pr but not found');
    step('Install it: https://cli.github.com/');
    step('Then authenticate: gh auth login');
    process.exit(1);
  }

  // Safety checks before creating PR
  if (args.createPr) {
    // Run format as a last-minute verification step
    if (args.skipFormat) {
      warn('Skipping format step (flagged)');
    } else if (!hasNpmScript('format')) {
      warn('Skipping format step (no npm script named "format")');
    } else {
      step('Running npm run format before PR creation...');
      try {
        execSync('npm run format', { encoding: 'utf8', stdio: 'inherit' });
      } catch (_error) {
        fail('npm run format failed; fix formatting errors first.');
        process.exit(1);
      }
    }

    // Run tests as an extra verification step
    step('Running npm test before PR creation...');
    try {
      execSync('npm test', { encoding: 'utf8', stdio: 'inherit' });
    } catch (_error) {
      fail('npm test failed; fix test failures first.');
      process.exit(1);
    }

    // Run build as a final verification step
    step('Running npm run build before PR creation...');
    try {
      execSync('npm run build', { encoding: 'utf8', stdio: 'inherit' });
    } catch (_error) {
      fail('npm run build failed; fix build errors first.');
      process.exit(1);
    }

    // Check for uncommitted changes after formatting
    if (checkUncommittedChanges()) {
      fail('You have uncommitted changes; please commit them first.');
      step('Run: git add . && git commit -m "your message"');
      process.exit(1);
    }

    // Check for existing open PR
    const existingPr = checkExistingPr(args.base, branch);
    if (existingPr) {
      warn(`Found existing PR #${existingPr.number}: ${existingPr.title}`);
    }
  }

  step(`Collecting ${commits.length} commits from ${baseRef}..HEAD`);

  const pass1Messages = buildPass1Messages(commits, branch, baseRef);
  const pass1 = await createCompletionSafe(
    groq,
    pass1Messages,
    DEFAULT_MODEL,
    2048
  );
  const pass1Text = pass1?.choices?.[0]?.message?.content?.trim() || '';
  success('Pass 1 complete (5Cs snapshot)');

  const chunks = chunkCommits(commits, CHUNK_SIZE_CHARS);
  step(`Pass 2 across ${chunks.length} chunk(s)`);
  const pass2Outputs = [];
  for (const chunk of chunks) {
    const messages = buildPass2Messages(chunk);
    // biome-ignore lint/nursery/noAwaitInLoop: sequential LLM calls to avoid rate limits and keep output order predictable
    const completion = await createCompletionSafe(
      groq,
      messages,
      DEFAULT_MODEL,
      2048
    );
    const chunkText = completion?.choices?.[0]?.message?.content?.trim();
    if (chunkText) {
      pass2Outputs.push(chunkText);
    }
  }
  success('Pass 2 complete (per-commit condensation)');

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
    groq,
    pass3Messages,
    DEFAULT_MODEL,
    2048
  );
  let finalSummary = pass3?.choices?.[0]?.message?.content?.trim() || '';
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
      groq,
      retryMessages,
      DEFAULT_MODEL,
      2048
    );
    finalSummary =
      retry?.choices?.[0]?.message?.content?.trim() || finalSummary;
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

  // Ensure output directory exists
  const outDir = path.dirname(resolvedOut);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(resolvedOut, fullOutput, 'utf8');
  success(`PR summary written to ${resolvedOut}`);

  // Write a slim, PR-ready version without appendices to avoid GH body limits
  const finalOutPath = path.join(
    path.dirname(resolvedOut),
    `${path.basename(resolvedOut, path.extname(resolvedOut))}.final.md`
  );
  fs.writeFileSync(finalOutPath, prBlock, 'utf8');
  success(`PR-ready (slim) summary written to ${finalOutPath}`);

  // Also stash an autosave in tmp for debugging
  const tmpPath = path.join(
    os.tmpdir(),
    `pr-summary-${Date.now().toString()}-${path.basename(resolvedOut)}`
  );
  fs.writeFileSync(tmpPath, fullOutput, 'utf8');
  warn(`Backup copy saved to ${tmpPath}`);

  // Create PR if requested
  if (args.createPr) {
    const prTitle = extractPrTitle(finalSummary, mode) || branch;
    try {
      const existingPr = checkExistingPr(args.base, branch);
      if (existingPr) {
        updatePrWithGh(existingPr.number, prTitle, finalSummary);
      } else {
        createPrWithGh(args.base, branch, prTitle, finalSummary);
      }
    } catch (_error) {
      // Error already logged in createPrWithGh
      process.exit(1);
    }
  }
}

async function runPrSummary(argv = process.argv.slice(2)) {
  await main(argv);
}

if (require.main === module) {
  runPrSummary();
}

module.exports = { runPrSummary };
