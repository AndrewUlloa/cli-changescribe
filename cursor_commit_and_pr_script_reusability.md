# Commit and PR script reusability
_Exported on 1/19/2026 at 21:38:00 EST from Cursor (2.3.2)_

---

**User**

lets review the @scripts/generate-commit-message.js @scripts/generate-pr-summary.js and tell me what it does. 

I want to see if we can publish this as a separate github repo so then i can reinstall it into other repos with an npm install 

---

**Cursor**

Here’s what each script does today and how it works, based on the files you shared.

## What the scripts do

### `scripts/generate-commit-message.js`
- Stages all changes if nothing is staged, then collects a summary plus a bounded diff (truncates if huge).
- Builds a structured prompt (summary, files changed, stats, per‑file diffs, and a truncated full diff).
- Calls Groq (`openai/gpt-oss-120b`) to generate a Conventional Commit message.
- Parses the model output to extract a valid `type(scope): subject` title and optional bullet body.
- Commits with that message and **pushes to origin** automatically.

Notable behavior:
- Requires `GROQ_API_KEY` in `.env.local`.
- If model output is noisy, it tries to recover the commit title from either `content` or `reasoning`.
- Uses `git add .`, `git commit -F`, and `git push origin <branch>`.

### `scripts/generate-pr-summary.js`
- Builds a PR summary from the commit history between a base (default `main`) and `HEAD`.
- Uses a 3‑pass Groq flow:
  1. Summarize commit titles with a 5‑Cs snapshot.
  2. Produce per‑commit condensed bullets (change + why + risk/test note).
  3. Generate a PR summary with fixed headings (feature/release mode).
- Writes output to `.pr-summaries/PR_SUMMARY.md` and a slimmer `*.final.md`.
- Optional `--create-pr` flow will:
  - Run `npm run format`, `npm test`, `npm run build`
  - Ensure no uncommitted changes
  - Create or update a GitHub PR via `gh`

Notable behavior:
- Requires `GROQ_API_KEY` in `.env.local`.
- Supports `--base`, `--out`, `--limit`, `--issue`, `--dry-run`, `--create-pr`, `--mode`.
- Uses `gh` if PR creation is requested.

## Publishing as a separate npm repo

Yes, both scripts are already shaped like a CLI tool. To publish and install in other repos via `npm install`, you’d typically:
- Move these into a new repo with a `package.json` + `bin` entry.
- Decide on a CLI name (e.g. `commit-gen` / `pr-summarizer` or a single CLI with subcommands).
- Add minimal docs + `.env` guidance.
- Ensure dependencies are captured (`groq-sdk`, `dotenv`).
- Optionally add flags for “don’t auto-push” or “don’t auto-stage” if you want safer defaults.

If you want, I can turn this into a publishable npm CLI repo structure and wire up `bin` commands.

---

**User**

i want more detail on the @scripts/generate-pr-summary.js , what model is it using? also for the @scripts/generate-commit-message.js how is the commit message structured, is it different than the pr message, how is it different? which one is better? I'm really happy with the way our pr's are structured. 

---

**Cursor**

Here’s a deeper breakdown of `scripts/generate-pr-summary.js`, plus how it differs from `scripts/generate-commit-message.js` and which is “better.”

## `generate-pr-summary.js` details
**Model used**
- It uses Groq with model **`openai/gpt-oss-120b`** by default.
- Exact default is built from env:
  - `GROQ_PR_MODEL` → `GROQ_MODEL` → fallback **`openai/gpt-oss-120b`**.

**How the summary is structured**
- It runs **3 passes**:
  1. **Pass 1**: 5‑Cs snapshot + 1–2 bullet headlines per commit (titles only).
  2. **Pass 2**: per‑commit 2–3 bullets (change + why + risk/test).
  3. **Pass 3**: final PR summary with fixed headings.
- Headings are strict and ordered:
  - `What issue is this PR related to?`
  - `What change does this PR add?`
  - `How did you test your change?`
  - `Anything you want reviewers to scrutinize?`
  - `Other notes reviewers should know (risks + follow-ups)`
- It writes a full file plus a `.final.md` “PR‑ready” version.

## `generate-commit-message.js` structure
**Model used**
- Also uses Groq with **`openai/gpt-oss-120b`** (hard‑coded in this file).

**Commit message structure**
- It enforces **Conventional Commit format**:
  - `type(scope): subject`
  - Optional body as **bullet lines**.
- Accepts either the model’s `content` or its `reasoning`, then extracts the first valid Conventional Commit line.
- The body is only bullets it can find anywhere in the output.

## How it differs from PR message
- **Purpose**:
  - Commit: short, **single‑line** title + optional bullets.
  - PR summary: **structured multi‑section narrative**.
- **Constraints**:
  - Commit requires `type(scope): subject` and ≤50 chars in prompt.
  - PR summary follows fixed headings and more context (tests, risks, scrutiny).
- **Content input**:
  - Commit uses staged diff + file snippets.
  - PR summary uses **commit history**, not the diff.
- **Output shape**:
  - Commit output is designed to be “git‑commit friendly”.
  - PR output is designed to be “reviewer friendly”.

## Which is better?
They solve **different jobs**, so “better” depends on the goal:
- **PR summary is better for reviews** (context, tests, risks, and scrutiny sections).
- **Commit message is better for git history** (short, standardized, searchable).

Given you’re happy with the PR structure, that makes sense—the PR script is explicitly designed to produce that consistent, structured format. If you want commit messages to feel more like your PRs, you could optionally extend the commit script to add a consistent body format (e.g., 2–3 bullets for “change + why + risk”).

---

**User**

i would love a consistent body format for commits. 

especially figuring out what type of commit it is also. lets talk about it. 

---

**Cursor**

Totally. Here’s a concrete proposal for a **consistent commit body format** and a **type inference strategy** that stays compatible with your PR structure (high‑signal, reviewer‑friendly), without bloating commit history.

## Proposal: Commit body template
Keep the Conventional Commit title, add a fixed 3‑bullet body:

- `change:` what changed (1 bullet, compact)
- `why:` rationale or context
- `risk:` risks / tests / unknowns (or `risk: none` / `testing: (not provided)`)

Example:
```
feat(auth): add convex token refresh

- change: refresh tokens when session is stale and user is active
- why: reduce forced logouts after long inactive sessions
- risk: tests not provided
```

This aligns closely with your PR structure (change / why / risk/test), just compact.

## Proposal: Commit type inference
We can infer the Conventional Commit type from the diff + filenames + keywords:

- `feat`: new behavior / new paths / new UI
- `fix`: bug fixes, error handling, null/undefined safety
- `refactor`: moving code, renames, structure changes with same behavior
- `perf`: caching, memoization, faster algorithms
- `docs`: docs or comments only
- `test`: tests only
- `style`: formatting, lint, no logic changes
- `chore`: tooling, build, deps, scripts, CI
- `ci`: pipeline/config changes
- `build`: build system changes
- `revert`: revert commits

We can make the model **choose from this list**, and fall back to a heuristic if it doesn’t comply.

---

If you want, I can implement this in `scripts/generate-commit-message.js` so it:
- forces that body template,
- infers the type more reliably,
- and produces commit messages that “feel” like your PR summaries.

If that sounds good, tell me if you prefer:
- **`risk` vs `testing`** in the third bullet (or both),
- **short** (3 bullets) vs **long** (5‑Cs style) body,
- and whether we should **auto‑stage** and **auto‑push** (still current behavior).

```plaintext
feat(auth): add convex token refresh

- change: refresh tokens when session is stale and user is active
- why: reduce forced logouts after long inactive sessions
- risk: tests not provided
```

---

**User**

lets use this also as our guide, add this context as well 

Commit message guide

Spark icon
Page Summary
Commit messages
Clear commit messages make pull requests easier to review, and release notes easier to generate. The Blockly project uses conventional commits to help with this.

Each commit should have the format:


<type>: <description>

[optional body]

[optional footer(s)]
Note that the core Blockly repo has a commit linter to help enforce this. If your pull request has multiple commits, the linter will check the title. If it has a single commit, it will check that commit. It is best if both your individual commits and the pull request title follow these guidelines.

Type
The type must be non-empty, and all lower case. The following is a list of accepted types.

chore: For commits that complete routine/automated tasks such as upgrading dependencies.

deprecate: For commits that deprecate functionality.

feat: For commits that add new functionality to Blockly.

fix: For commits that fix bugs/errors in Blockly.

release: For commits that relate to the release of a new version.

Breaking changes
Commits that make breaking changes should append a ! after the type of the commit. Breaking changes are changes that may break developers using Blockly in their apps, causing them to have to do extra work.

For example: none fix!: return type of workspace.paste

Breaking changes could have any of the above valid types.

Description
The description must be non-empty, and must be under 256 characters.

Body
The body is optional. If it is provided there should be a blank line between it and the description. It must be broken into lines of no more than 256 characters.

Note that usually, it is advisable to put this kind of information in your pull request description, in addition to/rather than directly in the commit.

Footer
The footer is optional. If it is provided there should be a blank line between it and the body. It must be broken into lines of no more than 256 characters.

Fixing non-conventional commits
If you did not use conventional commits when making your modifications, there are two options for fixing the messages depending on how many commits you have:

If your pull request has multiple commits, edit the pull request title to conform to the requirements. When the pull request is merged, your other commits will be squashed so that the title becomes the commit message.

If your pull request has a single commit, amend your commit message using git commit --amend, then force push your changes to your fork of Blockly. This will automatically updated any open pull requests associated with this branch. git push --force origin my-branch.



---

**Cursor**

```javascript
#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('dotenv');
const Groq = require('groq-sdk').default;

// Load environment variables from .env.local
config({ path: '.env.local' });

// Regex patterns for cleaning commit messages
const OPENING_CODE_BLOCK_REGEX = /^```[\s\S]*?\n/;
const CLOSING_CODE_BLOCK_REGEX = /\n```$/;
const NEWLINE_SPLIT_RE = /\r?\n/;
const BULLET_LINE_RE = /^[-*]\s+/;
const CODE_FILE_EXTENSION_RE = /\.(ts|tsx|js|jsx|css|json|md)$/;

/**
 * Analyze all code changes comprehensively for AI review
 */
function analyzeAllChanges() {
  console.log('🔍 Analyzing all code changes...');

  // Use larger buffer for git commands that may produce large output
  const LARGE_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

  // Check if there are any changes to analyze
  let gitStatus;
  try {
    gitStatus = execSync('git status --porcelain', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    if (!gitStatus.trim()) {
      return { hasChanges: false };
    }
  } catch (error) {
    throw new Error(`Failed to get git status: ${error.message}`);
  }

  // Stage all changes if nothing is staged
  let gitDiff = execSync('git diff --staged --name-status', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  });
  if (!gitDiff.trim()) {
    console.log('📝 Staging all changes for analysis...');
    execSync('git add .', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    gitDiff = execSync('git diff --staged --name-status', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
  }

  // Get list of modified files first (needed for other operations)
  const modifiedFiles = execSync('git diff --staged --name-only', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  // Try to get detailed diff, but handle buffer overflow gracefully
  let detailedDiff = '';
  try {
    // Use minimal context (U3) and limit to text files to reduce size
    detailedDiff = execSync('git diff --staged -U3 --diff-filter=ACMRT', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    // Truncate if still too large (keep first 5MB)
    if (detailedDiff.length > 5 * 1024 * 1024) {
      detailedDiff = `${detailedDiff.slice(0, 5 * 1024 * 1024)}\n...[truncated due to size]...`;
    }
  } catch (error) {
    if (
      error.message.includes('ENOBUFS') ||
      error.message.includes('maxBuffer')
    ) {
      console.log('⚠️  Diff too large, using summary only');
      // Fallback: get diff stats only
      detailedDiff =
        'Diff too large to include. See file changes summary above.';
    } else {
      throw error;
    }
  }

  // Get comprehensive change information
  const changes = {
    // Summary of file changes
    fileChanges: gitDiff,

    // Detailed code diff (may be truncated or empty if too large)
    detailedDiff,

    // List of modified files
    modifiedFiles,

    // Get diff stats (additions/deletions)
    diffStats: execSync('git diff --staged --stat', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }),

    // Get commit info context
    lastCommit: execSync('git log -1 --oneline', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),

    // Branch information
    currentBranch: execSync('git branch --show-current', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),
  };

  // Analyze each modified file individually for better context
  const fileAnalysis = [];
  for (const file of changes.modifiedFiles.slice(0, 10)) {
    // Limit to 10 files and skip binary/large files
    const fileType = getFileType(file);
    if (fileType === 'Code' && !CODE_FILE_EXTENSION_RE.test(file)) {
      continue; // Skip non-code files
    }

    try {
      const fileDiff = execSync(`git diff --staged -U3 -- "${file}"`, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024, // 1MB per file
      });
      fileAnalysis.push({
        file,
        changes: fileDiff.slice(0, 2000), // Limit per file for API
        type: fileType,
      });
    } catch (error) {
      if (
        error.message.includes('ENOBUFS') ||
        error.message.includes('maxBuffer')
      ) {
        // File too large, skip it
        continue;
      }
      console.error(`⚠️  Failed to analyze file ${file}:`, error.message);
    }
  }

  return {
    hasChanges: true,
    summary: {
      totalFiles: changes.modifiedFiles.length,
      stats: changes.diffStats,
      branch: changes.currentBranch,
      lastCommit: changes.lastCommit,
    },
    fileChanges: changes.fileChanges,
    detailedDiff: changes.detailedDiff,
    fileAnalysis,
  };
}

/**
 * Determine file type for better AI analysis
 */
function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const typeMap = {
    tsx: 'React TypeScript Component',
    ts: 'TypeScript',
    jsx: 'React JavaScript Component',
    js: 'JavaScript',
    css: 'Stylesheet',
    json: 'Configuration',
    md: 'Documentation',
    yml: 'Configuration',
    yaml: 'Configuration',
  };
  return typeMap[ext] || 'Code';
}

/**
 * Generate an AI-powered commit message based on git changes
 */
async function generateCommitMessage() {
  try {
    // Check if GROQ_API_KEY is set
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === '') {
      console.error('❌ GROQ_API_KEY environment variable is required');
      console.log('💡 Get your API key from: https://console.groq.com/keys');
      console.log('💡 Set it in .env.local file: GROQ_API_KEY="your-key-here"');
      process.exit(1);
    }

    // Initialize Groq client
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // Get comprehensive analysis of all changes
    let changeAnalysis;
    try {
      changeAnalysis = analyzeAllChanges();
    } catch (error) {
      console.error('❌ Failed to analyze changes:', error.message);
      process.exit(1);
    }

    if (!changeAnalysis.hasChanges) {
      console.log('✅ No changes to commit');
      return;
    }

    console.log('🤖 Generating commit message with AI...');

    // Generate commit message using Groq with comprehensive analysis
    const completion = await createCompletionSafe(
      groq,
      buildChatMessages(changeAnalysis),
      'openai/gpt-oss-120b'
    );

    const rawContent = completion?.choices?.[0]?.message?.content
      ?.trim()
      .replace(OPENING_CODE_BLOCK_REGEX, '') // Remove opening code block
      .replace(CLOSING_CODE_BLOCK_REGEX, '') // Remove closing code block
      .trim();

    // Some models put useful text in a nonstandard `reasoning` field
    const reasoning =
      completion?.choices?.[0]?.message?.reasoning?.toString?.().trim?.() ?? '';

    // Build a robust Conventional Commit from either content or reasoning
    const built = buildConventionalCommit(rawContent || '', reasoning || '');

    if (!built) {
      logCompletionFailureAndExit(completion);
    }

    console.log(`✨ Generated commit message: "${built.title}"`);

    // Write full commit message to a temporary file to avoid shell quoting issues
    const tmpFile = path.join(
      os.tmpdir(),
      `commit-msg-${Date.now().toString()}.txt`
    );
    const fullMessage = `${built.title}${built.body ? `\n\n${built.body}` : ''}`;
    fs.writeFileSync(tmpFile, fullMessage, 'utf8');

    // Commit using -F to read message from file
    try {
      execSync(`git commit -F "${tmpFile}"`, { encoding: 'utf8' });
      console.log('✅ Changes committed successfully');
    } catch (error) {
      console.error('❌ Failed to commit changes:', error.message);
      process.exit(1);
    }
    // Cleanup temp file (best-effort)
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }

    // Push to remote
    try {
      const currentBranch = execSync('git branch --show-current', {
        encoding: 'utf8',
      }).trim();
      execSync(`git push origin ${currentBranch}`, { encoding: 'utf8' });
      console.log(`🚀 Changes pushed to origin/${currentBranch}`);
    } catch (error) {
      console.error('❌ Failed to push changes:', error.message);
      console.log('💡 You may need to push manually with: git push');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error generating commit message:');
    console.error(formatError(error));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  generateCommitMessage();
}

module.exports = { generateCommitMessage };

// --- helpers ---------------------------------------------------------------

async function createCompletionSafe(groq, messages, model) {
  try {
    return await groq.chat.completions.create({
      messages,
      model,
      temperature: 0.3,
      max_tokens: 16_384,
      reasoning_effort: 'high',
    });
  } catch (error) {
    console.error('❌ Groq API error while creating completion');
    console.error(formatError(error));
    process.exit(1);
  }
}

function buildChatMessages(changeAnalysis) {
  const filesBlock = changeAnalysis.fileAnalysis
    .map((file) => `### ${file.file} (${file.type})\n${file.changes}`)
    .join('\n\n');

  // Estimate token count: ~4 characters per token, leave room for system prompt and other content
  // Target: ~6000 tokens max for user content (leaving ~2000 for system prompt and overhead)
  const MAX_USER_CONTENT_CHARS = 24_000; // ~6000 tokens

  // Build user content
  const summarySection =
    'Summary:\n' +
    `- Modified ${changeAnalysis.summary.totalFiles} files\n` +
    `- Branch: ${changeAnalysis.summary.branch}\n` +
    `- Previous commit: ${changeAnalysis.summary.lastCommit}\n\n`;

  const filesSection = `Files:\n${changeAnalysis.fileChanges}\n\n`;
  const statsSection = `Stats:\n${changeAnalysis.summary.stats}\n\n`;
  const detailsSection = `Details:\n${filesBlock}\n\n`;

  // Calculate remaining space for diff
  const usedChars =
    summarySection.length +
    filesSection.length +
    statsSection.length +
    detailsSection.length;
  const diffMaxChars = Math.max(0, MAX_USER_CONTENT_CHARS - usedChars - 500); // 500 char buffer

  const diffSection =
    diffMaxChars > 0
      ? `Full diff (truncated):\n${changeAnalysis.detailedDiff.slice(0, diffMaxChars)}\n`
      : '';

  const userContent =
    'Analyze these changes and produce a single conventional commit:\n\n' +
    summarySection +
    filesSection +
    statsSection +
    detailsSection +
    diffSection;

  return [
    {
      role: 'system',
      content:
        'You are an AI assistant tasked with generating a git commit message based on the staged code changes provided below. Follow these rules.\n\n' +
        'Commit message format: <type>: <description>\n' +
        'Types (lowercase, required): chore, deprecate, feat, fix, release\n' +
        'Breaking changes: append ! after the type (e.g., fix!: ...)\n' +
        'Description: required, under 256 characters, imperative mood, no trailing period\n' +
        'Body: optional, but if present use exactly three bullets in this order:\n' +
        '- change: ...\n' +
        '- why: ...\n' +
        '- risk: ...\n' +
        'Body lines must be under 256 characters each.\n' +
        'Do not include a scope.\n' +
        'Output only the final commit text, no markdown or code fences.',
    },
    {
      role: 'user',
      content: userContent,
    },
  ];
}

function logCompletionFailureAndExit(completion) {
  console.error(
    '❌ Failed to generate commit message. Raw completion payload:'
  );
  const raw = safeStringify(completion);
  console.error(
    raw.length > 10_000 ? `${raw.slice(0, 10_000)}\n...[truncated]...` : raw
  );
  if (completion?.usage) {
    console.error('Usage:', safeStringify(completion.usage));
  }
  if (completion?.choices) {
    console.error(
      'Choices meta:',
      safeStringify(
        completion.choices.map((c) => ({
          finish_reason: c.finish_reason,
          index: c.index,
        }))
      )
    );
  }
  process.exit(1);
}

// Extract a Conventional Commit from possibly noisy model output
const TITLE_RE =
  /^(?<type>chore|deprecate|feat|fix|release)(?<breaking>!)?:\s*(?<subject>.+)$/gim;

function buildConventionalCommit(content, reasoning) {
  const text = sanitizeText([content, reasoning].filter(Boolean).join('\n'));
  if (!text.trim()) {
    return null;
  }

  let titleMatch = null;
  for (const m of text.matchAll(TITLE_RE)) {
    if (m?.groups?.subject) {
      titleMatch = m;
      break;
    }
  }

  if (!titleMatch) {
    return null;
  }

  const { type } = titleMatch.groups;
  const breaking = titleMatch.groups.breaking ? '!' : '';
  let subject = titleMatch.groups.subject.trim();
  subject = stripWrappingQuotes(subject);
  subject = clampLine(subject, 256);

  const title = `${type}${breaking}: ${subject}`;

  const body = buildStructuredBody(text);

  return { title, body };
}

function sanitizeText(s) {
  if (!s) {
    return '';
  }
  return s
    .replace(OPENING_CODE_BLOCK_REGEX, '')
    .replace(CLOSING_CODE_BLOCK_REGEX, '')
    .replace(/`/g, '') // remove inline backticks to prevent shell substitutions in logs
    .trim();
}

function stripWrappingQuotes(s) {
  if (!s) {
    return s;
  }
  // remove wrapping single or double quotes if present
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function buildStructuredBody(text) {
  const lines = text.split(NEWLINE_SPLIT_RE);
  const extracted = {
    change: '',
    why: '',
    risk: '',
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const withoutBullet = BULLET_LINE_RE.test(trimmed)
      ? trimmed.replace(BULLET_LINE_RE, '')
      : trimmed;
    const lower = withoutBullet.toLowerCase();
    if (lower.startsWith('change:')) {
      extracted.change = withoutBullet.slice('change:'.length).trim();
    } else if (lower.startsWith('why:')) {
      extracted.why = withoutBullet.slice('why:'.length).trim();
    } else if (lower.startsWith('risk:')) {
      extracted.risk = withoutBullet.slice('risk:'.length).trim();
    } else if (lower.startsWith('testing:') && !extracted.risk) {
      extracted.risk = `testing: ${withoutBullet.slice('testing:'.length).trim()}`;
    }
  }

  const change = extracted.change || '(not provided)';
  const why = extracted.why || '(not provided)';
  const risk = extracted.risk || '(not provided)';

  return [
    `- change: ${clampLine(change, 256)}`,
    `- why: ${clampLine(why, 256)}`,
    `- risk: ${clampLine(risk, 256)}`,
  ].join('\n');
}

function clampLine(line, maxLength) {
  if (line.length <= maxLength) {
    return line;
  }
  const slice = line.slice(0, Math.max(0, maxLength - 3));
  return `${slice}...`;
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
    // Fallback to best-effort string conversion when JSON serialization fails
    try {
      return String(obj);
    } catch {
      return '[Unstringifiable]';
    }
  }
}

function formatError(error) {
  // Try to include as much structured information as possible
  const plain = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    // include standard fields: name, message, stack, cause, status, code, response
    // avoid huge nested response bodies without control
    if (key === 'response' && error.response) {
      plain.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers || undefined,
        data: error.response.data || undefined,
      };
    } else {
      try {
        // Copy other enumerable properties safely
        // eslint-disable-next-line no-param-reassign
        plain[key] = error[key];
      } catch {
        // ignore non-readable props
      }
    }
  }
  return safeStringify(plain);
}

```

I updated `scripts/generate-commit-message.js` to follow the guide you pasted and to enforce a consistent commit body format.

What changed
- Enforces format `<type>: <description>` with **no scope**.
- Allowed types: `chore`, `deprecate`, `feat`, `fix`, `release`.
- Supports breaking changes by appending `!` (e.g. `fix!: ...`).
- Description is clamped to **≤256 chars**.
- Body is always **three bullets**, in order:
  - `change: ...`
  - `why: ...`
  - `risk: ...`
- Each body line is clamped to **≤256 chars**.
- If the model doesn’t provide a bullet, it fills with `(not provided)`.

You can see the new body shaping logic here:

```360:430:scripts/generate-commit-message.js
const TITLE_RE =
  /^(?<type>chore|deprecate|feat|fix|release)(?<breaking>!)?:\s*(?<subject>.+)$/gim;

// ...snip...

function buildStructuredBody(text) {
  const lines = text.split(NEWLINE_SPLIT_RE);
  const extracted = {
    change: '',
    why: '',
    risk: '',
  };

  // ...snip...

  return [
    `- change: ${clampLine(change, 256)}`,
    `- why: ${clampLine(why, 256)}`,
    `- risk: ${clampLine(risk, 256)}`,
  ].join('\n');
}
```

If you want, I can also:
- make the script **refuse** to commit if the model doesn’t provide those three bullets (instead of backfilling),
- add a `--strict` mode,
- or align commit bullets to match your PR headings more closely (e.g. “testing” vs “risk”).

```javascript
const TITLE_RE =
  /^(?<type>chore|deprecate|feat|fix|release)(?<breaking>!)?:\s*(?<subject>.+)$/gim;

// ...snip...

function buildStructuredBody(text) {
  const lines = text.split(NEWLINE_SPLIT_RE);
  const extracted = {
    change: '',
    why: '',
    risk: '',
  };

  // ...snip...

  return [
    `- change: ${clampLine(change, 256)}`,
    `- why: ${clampLine(why, 256)}`,
    `- risk: ${clampLine(risk, 256)}`,
  ].join('\n');
}
```

---

**User**

i don't want the clamp, if its going to act as a cutoff, how can you ensure things aren't just getting cut off 

---

**Cursor**

```javascript
#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('dotenv');
const Groq = require('groq-sdk').default;

// Load environment variables from .env.local
config({ path: '.env.local' });

// Regex patterns for cleaning commit messages
const OPENING_CODE_BLOCK_REGEX = /^```[\s\S]*?\n/;
const CLOSING_CODE_BLOCK_REGEX = /\n```$/;
const NEWLINE_SPLIT_RE = /\r?\n/;
const BULLET_LINE_RE = /^[-*]\s+/;
const CODE_FILE_EXTENSION_RE = /\.(ts|tsx|js|jsx|css|json|md)$/;

/**
 * Analyze all code changes comprehensively for AI review
 */
function analyzeAllChanges() {
  console.log('🔍 Analyzing all code changes...');

  // Use larger buffer for git commands that may produce large output
  const LARGE_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

  // Check if there are any changes to analyze
  let gitStatus;
  try {
    gitStatus = execSync('git status --porcelain', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    if (!gitStatus.trim()) {
      return { hasChanges: false };
    }
  } catch (error) {
    throw new Error(`Failed to get git status: ${error.message}`);
  }

  // Stage all changes if nothing is staged
  let gitDiff = execSync('git diff --staged --name-status', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  });
  if (!gitDiff.trim()) {
    console.log('📝 Staging all changes for analysis...');
    execSync('git add .', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    gitDiff = execSync('git diff --staged --name-status', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
  }

  // Get list of modified files first (needed for other operations)
  const modifiedFiles = execSync('git diff --staged --name-only', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  // Try to get detailed diff, but handle buffer overflow gracefully
  let detailedDiff = '';
  try {
    // Use minimal context (U3) and limit to text files to reduce size
    detailedDiff = execSync('git diff --staged -U3 --diff-filter=ACMRT', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    // Truncate if still too large (keep first 5MB)
    if (detailedDiff.length > 5 * 1024 * 1024) {
      detailedDiff = `${detailedDiff.slice(0, 5 * 1024 * 1024)}\n...[truncated due to size]...`;
    }
  } catch (error) {
    if (
      error.message.includes('ENOBUFS') ||
      error.message.includes('maxBuffer')
    ) {
      console.log('⚠️  Diff too large, using summary only');
      // Fallback: get diff stats only
      detailedDiff =
        'Diff too large to include. See file changes summary above.';
    } else {
      throw error;
    }
  }

  // Get comprehensive change information
  const changes = {
    // Summary of file changes
    fileChanges: gitDiff,

    // Detailed code diff (may be truncated or empty if too large)
    detailedDiff,

    // List of modified files
    modifiedFiles,

    // Get diff stats (additions/deletions)
    diffStats: execSync('git diff --staged --stat', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }),

    // Get commit info context
    lastCommit: execSync('git log -1 --oneline', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),

    // Branch information
    currentBranch: execSync('git branch --show-current', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),
  };

  // Analyze each modified file individually for better context
  const fileAnalysis = [];
  for (const file of changes.modifiedFiles.slice(0, 10)) {
    // Limit to 10 files and skip binary/large files
    const fileType = getFileType(file);
    if (fileType === 'Code' && !CODE_FILE_EXTENSION_RE.test(file)) {
      continue; // Skip non-code files
    }

    try {
      const fileDiff = execSync(`git diff --staged -U3 -- "${file}"`, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024, // 1MB per file
      });
      fileAnalysis.push({
        file,
        changes: fileDiff.slice(0, 2000), // Limit per file for API
        type: fileType,
      });
    } catch (error) {
      if (
        error.message.includes('ENOBUFS') ||
        error.message.includes('maxBuffer')
      ) {
        // File too large, skip it
        continue;
      }
      console.error(`⚠️  Failed to analyze file ${file}:`, error.message);
    }
  }

  return {
    hasChanges: true,
    summary: {
      totalFiles: changes.modifiedFiles.length,
      stats: changes.diffStats,
      branch: changes.currentBranch,
      lastCommit: changes.lastCommit,
    },
    fileChanges: changes.fileChanges,
    detailedDiff: changes.detailedDiff,
    fileAnalysis,
  };
}

/**
 * Determine file type for better AI analysis
 */
function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const typeMap = {
    tsx: 'React TypeScript Component',
    ts: 'TypeScript',
    jsx: 'React JavaScript Component',
    js: 'JavaScript',
    css: 'Stylesheet',
    json: 'Configuration',
    md: 'Documentation',
    yml: 'Configuration',
    yaml: 'Configuration',
  };
  return typeMap[ext] || 'Code';
}

/**
 * Generate an AI-powered commit message based on git changes
 */
async function generateCommitMessage() {
  try {
    // Check if GROQ_API_KEY is set
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === '') {
      console.error('❌ GROQ_API_KEY environment variable is required');
      console.log('💡 Get your API key from: https://console.groq.com/keys');
      console.log('💡 Set it in .env.local file: GROQ_API_KEY="your-key-here"');
      process.exit(1);
    }

    // Initialize Groq client
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // Get comprehensive analysis of all changes
    let changeAnalysis;
    try {
      changeAnalysis = analyzeAllChanges();
    } catch (error) {
      console.error('❌ Failed to analyze changes:', error.message);
      process.exit(1);
    }

    if (!changeAnalysis.hasChanges) {
      console.log('✅ No changes to commit');
      return;
    }

    console.log('🤖 Generating commit message with AI...');

    // Generate commit message using Groq with comprehensive analysis
    const completion = await createCompletionSafe(
      groq,
      buildChatMessages(changeAnalysis),
      'openai/gpt-oss-120b'
    );

    const rawContent = completion?.choices?.[0]?.message?.content
      ?.trim()
      .replace(OPENING_CODE_BLOCK_REGEX, '') // Remove opening code block
      .replace(CLOSING_CODE_BLOCK_REGEX, '') // Remove closing code block
      .trim();

    // Some models put useful text in a nonstandard `reasoning` field
    const reasoning =
      completion?.choices?.[0]?.message?.reasoning?.toString?.().trim?.() ?? '';

    // Build a robust Conventional Commit from either content or reasoning
    let built = buildConventionalCommit(rawContent || '', reasoning || '');

    if (!built) {
      logCompletionFailureAndExit(completion);
    }

    const violations = findCommitViolations(built);
    if (violations.length > 0) {
      const repairCompletion = await createCompletionSafe(
        groq,
        buildRepairMessages(rawContent || '', reasoning || '', built, violations),
        'openai/gpt-oss-120b'
      );
      const repairedContent = repairCompletion?.choices?.[0]?.message?.content
        ?.trim()
        .replace(OPENING_CODE_BLOCK_REGEX, '')
        .replace(CLOSING_CODE_BLOCK_REGEX, '')
        .trim();
      const repairedReasoning =
        repairCompletion?.choices?.[0]?.message?.reasoning
          ?.toString?.()
          .trim?.() ?? '';
      built = buildConventionalCommit(repairedContent || '', repairedReasoning || '');
      if (!built) {
        logCompletionFailureAndExit(repairCompletion);
      }
      const remaining = findCommitViolations(built);
      if (remaining.length > 0) {
        console.error(
          `❌ Commit message failed validation: ${remaining.join('; ')}`
        );
        process.exit(1);
      }
    }

    console.log(`✨ Generated commit message: "${built.title}"`);

    // Write full commit message to a temporary file to avoid shell quoting issues
    const tmpFile = path.join(
      os.tmpdir(),
      `commit-msg-${Date.now().toString()}.txt`
    );
    const fullMessage = `${built.title}${built.body ? `\n\n${built.body}` : ''}`;
    fs.writeFileSync(tmpFile, fullMessage, 'utf8');

    // Commit using -F to read message from file
    try {
      execSync(`git commit -F "${tmpFile}"`, { encoding: 'utf8' });
      console.log('✅ Changes committed successfully');
    } catch (error) {
      console.error('❌ Failed to commit changes:', error.message);
      process.exit(1);
    }
    // Cleanup temp file (best-effort)
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }

    // Push to remote
    try {
      const currentBranch = execSync('git branch --show-current', {
        encoding: 'utf8',
      }).trim();
      execSync(`git push origin ${currentBranch}`, { encoding: 'utf8' });
      console.log(`🚀 Changes pushed to origin/${currentBranch}`);
    } catch (error) {
      console.error('❌ Failed to push changes:', error.message);
      console.log('💡 You may need to push manually with: git push');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error generating commit message:');
    console.error(formatError(error));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  generateCommitMessage();
}

module.exports = { generateCommitMessage };

// --- helpers ---------------------------------------------------------------

async function createCompletionSafe(groq, messages, model) {
  try {
    return await groq.chat.completions.create({
      messages,
      model,
      temperature: 0.3,
      max_tokens: 16_384,
      reasoning_effort: 'high',
    });
  } catch (error) {
    console.error('❌ Groq API error while creating completion');
    console.error(formatError(error));
    process.exit(1);
  }
}

function buildChatMessages(changeAnalysis) {
  const filesBlock = changeAnalysis.fileAnalysis
    .map((file) => `### ${file.file} (${file.type})\n${file.changes}`)
    .join('\n\n');

  // Estimate token count: ~4 characters per token, leave room for system prompt and other content
  // Target: ~6000 tokens max for user content (leaving ~2000 for system prompt and overhead)
  const MAX_USER_CONTENT_CHARS = 24_000; // ~6000 tokens

  // Build user content
  const summarySection =
    'Summary:\n' +
    `- Modified ${changeAnalysis.summary.totalFiles} files\n` +
    `- Branch: ${changeAnalysis.summary.branch}\n` +
    `- Previous commit: ${changeAnalysis.summary.lastCommit}\n\n`;

  const filesSection = `Files:\n${changeAnalysis.fileChanges}\n\n`;
  const statsSection = `Stats:\n${changeAnalysis.summary.stats}\n\n`;
  const detailsSection = `Details:\n${filesBlock}\n\n`;

  // Calculate remaining space for diff
  const usedChars =
    summarySection.length +
    filesSection.length +
    statsSection.length +
    detailsSection.length;
  const diffMaxChars = Math.max(0, MAX_USER_CONTENT_CHARS - usedChars - 500); // 500 char buffer

  const diffSection =
    diffMaxChars > 0
      ? `Full diff (truncated):\n${changeAnalysis.detailedDiff.slice(0, diffMaxChars)}\n`
      : '';

  const userContent =
    'Analyze these changes and produce a single conventional commit:\n\n' +
    summarySection +
    filesSection +
    statsSection +
    detailsSection +
    diffSection;

  return [
    {
      role: 'system',
      content:
        'You are an AI assistant tasked with generating a git commit message based on the staged code changes provided below. Follow these rules.\n\n' +
        'Commit message format: <type>: <description>\n' +
        'Types (lowercase, required): chore, deprecate, feat, fix, release\n' +
        'Breaking changes: append ! after the type (e.g., fix!: ...)\n' +
        'Description: required, under 256 characters, imperative mood, no trailing period\n' +
        'Body: optional, but if present use exactly three bullets in this order:\n' +
        '- change: ...\n' +
        '- why: ...\n' +
        '- risk: ...\n' +
        'Body lines must be under 256 characters each.\n' +
        'Do not include a scope.\n' +
        'Output only the final commit text, no markdown or code fences.',
    },
    {
      role: 'user',
      content: userContent,
    },
  ];
}

function logCompletionFailureAndExit(completion) {
  console.error(
    '❌ Failed to generate commit message. Raw completion payload:'
  );
  const raw = safeStringify(completion);
  console.error(
    raw.length > 10_000 ? `${raw.slice(0, 10_000)}\n...[truncated]...` : raw
  );
  if (completion?.usage) {
    console.error('Usage:', safeStringify(completion.usage));
  }
  if (completion?.choices) {
    console.error(
      'Choices meta:',
      safeStringify(
        completion.choices.map((c) => ({
          finish_reason: c.finish_reason,
          index: c.index,
        }))
      )
    );
  }
  process.exit(1);
}

// Extract a Conventional Commit from possibly noisy model output
const TITLE_RE =
  /^(?<type>chore|deprecate|feat|fix|release)(?<breaking>!)?:\s*(?<subject>.+)$/gim;

function buildConventionalCommit(content, reasoning) {
  const text = sanitizeText([content, reasoning].filter(Boolean).join('\n'));
  if (!text.trim()) {
    return null;
  }

  let titleMatch = null;
  for (const m of text.matchAll(TITLE_RE)) {
    if (m?.groups?.subject) {
      titleMatch = m;
      break;
    }
  }

  if (!titleMatch) {
    return null;
  }

  const { type } = titleMatch.groups;
  const breaking = titleMatch.groups.breaking ? '!' : '';
  let subject = titleMatch.groups.subject.trim();
  subject = stripWrappingQuotes(subject);

  const title = `${type}${breaking}: ${subject}`;

  const body = buildStructuredBody(text);

  return { title, body };
}

function sanitizeText(s) {
  if (!s) {
    return '';
  }
  return s
    .replace(OPENING_CODE_BLOCK_REGEX, '')
    .replace(CLOSING_CODE_BLOCK_REGEX, '')
    .replace(/`/g, '') // remove inline backticks to prevent shell substitutions in logs
    .trim();
}

function stripWrappingQuotes(s) {
  if (!s) {
    return s;
  }
  // remove wrapping single or double quotes if present
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function buildStructuredBody(text) {
  const lines = text.split(NEWLINE_SPLIT_RE);
  const extracted = {
    change: '',
    why: '',
    risk: '',
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const withoutBullet = BULLET_LINE_RE.test(trimmed)
      ? trimmed.replace(BULLET_LINE_RE, '')
      : trimmed;
    const lower = withoutBullet.toLowerCase();
    if (lower.startsWith('change:')) {
      extracted.change = withoutBullet.slice('change:'.length).trim();
    } else if (lower.startsWith('why:')) {
      extracted.why = withoutBullet.slice('why:'.length).trim();
    } else if (lower.startsWith('risk:')) {
      extracted.risk = withoutBullet.slice('risk:'.length).trim();
    } else if (lower.startsWith('testing:') && !extracted.risk) {
      extracted.risk = `testing: ${withoutBullet.slice('testing:'.length).trim()}`;
    }
  }

  const change = extracted.change || '(not provided)';
  const why = extracted.why || '(not provided)';
  const risk = extracted.risk || '(not provided)';

  return [
    `- change: ${change}`,
    `- why: ${why}`,
    `- risk: ${risk}`,
  ].join('\n');
}

function buildRepairMessages(content, reasoning, built, violations) {
  const issueList = violations.map((v) => `- ${v}`).join('\n');
  const raw = sanitizeText([content, reasoning].filter(Boolean).join('\n'));
  return [
    {
      role: 'system',
      content:
        'You fix commit messages to match these rules exactly.\n\n' +
        'Commit message format: <type>: <description>\n' +
        'Types (lowercase, required): chore, deprecate, feat, fix, release\n' +
        'Breaking changes: append ! after the type (e.g., fix!: ...)\n' +
        'Description: required, under 256 characters, imperative mood, no trailing period\n' +
        'Body: optional, but if present use exactly three bullets in this order:\n' +
        '- change: ...\n' +
        '- why: ...\n' +
        '- risk: ...\n' +
        'Body lines must be under 256 characters each.\n' +
        'Do not include a scope.\n' +
        'Output only the final commit text, no markdown or code fences.',
    },
    {
      role: 'user',
      content: [
        'Violations:',
        issueList,
        '',
        'Current commit:',
        built.title + (built.body ? `\n\n${built.body}` : ''),
        '',
        'Original model output (for context):',
        raw || '(not provided)',
      ].join('\n'),
    },
  ];
}

function findCommitViolations(built) {
  const violations = [];
  const title = built.title || '';
  if (!title) {
    violations.push('title is missing');
  }
  if (title.length > 256) {
    violations.push('title exceeds 256 characters');
  }
  if (!/^(chore|deprecate|feat|fix|release)!?:\s+/.test(title)) {
    violations.push('title does not match required type format');
  }
  if (title.includes('(')) {
    violations.push('title includes a scope');
  }
  const subject = title.split(':').slice(1).join(':').trim();
  if (!subject) {
    violations.push('description is empty');
  }
  if (subject.endsWith('.')) {
    violations.push('description ends with a period');
  }

  if (built.body) {
    const lines = built.body.split(NEWLINE_SPLIT_RE).filter(Boolean);
    if (lines.length !== 3) {
      violations.push('body must have exactly three bullets');
    }
    for (const line of lines) {
      if (line.length > 256) {
        violations.push('body line exceeds 256 characters');
        break;
      }
      if (!line.startsWith('- change:') && !line.startsWith('- why:') && !line.startsWith('- risk:')) {
        violations.push('body bullets must be change/why/risk in order');
        break;
      }
    }
  }

  return violations;
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
    // Fallback to best-effort string conversion when JSON serialization fails
    try {
      return String(obj);
    } catch {
      return '[Unstringifiable]';
    }
  }
}

function formatError(error) {
  // Try to include as much structured information as possible
  const plain = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    // include standard fields: name, message, stack, cause, status, code, response
    // avoid huge nested response bodies without control
    if (key === 'response' && error.response) {
      plain.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers || undefined,
        data: error.response.data || undefined,
      };
    } else {
      try {
        // Copy other enumerable properties safely
        // eslint-disable-next-line no-param-reassign
        plain[key] = error[key];
      } catch {
        // ignore non-readable props
      }
    }
  }
  return safeStringify(plain);
}

```

I removed the cutoff behavior and replaced it with **validation + repair** so nothing gets silently truncated.

Now the flow is:
- Generate a commit message normally.
- **Validate** it against your rules (type, no scope, ≤256 chars, body bullets, etc.).
- If it fails, the script **asks the model to fix it** without truncating.
- If it still fails, the script **exits with an error** rather than cutting anything off.

So we never clamp. We either get a compliant message or we fail loudly.

If you want, I can also:
- show the violations in a clearer multi‑line format,
- add a `--strict` flag to always fail instead of repair,
- or include the violation list in the final error output.

Want any of those?

---

**User**

show the violations in a clearer multi‑line format. 

can you show me a sample without committing of the current changes we have so i can see the output.

---

**Cursor**

```javascript
#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('dotenv');
const Groq = require('groq-sdk').default;

// Load environment variables from .env.local
config({ path: '.env.local' });

// Regex patterns for cleaning commit messages
const OPENING_CODE_BLOCK_REGEX = /^```[\s\S]*?\n/;
const CLOSING_CODE_BLOCK_REGEX = /\n```$/;
const NEWLINE_SPLIT_RE = /\r?\n/;
const BULLET_LINE_RE = /^[-*]\s+/;
const CODE_FILE_EXTENSION_RE = /\.(ts|tsx|js|jsx|css|json|md)$/;

/**
 * Analyze all code changes comprehensively for AI review
 */
function analyzeAllChanges() {
  console.log('🔍 Analyzing all code changes...');

  // Use larger buffer for git commands that may produce large output
  const LARGE_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

  // Check if there are any changes to analyze
  let gitStatus;
  try {
    gitStatus = execSync('git status --porcelain', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    if (!gitStatus.trim()) {
      return { hasChanges: false };
    }
  } catch (error) {
    throw new Error(`Failed to get git status: ${error.message}`);
  }

  // Stage all changes if nothing is staged
  let gitDiff = execSync('git diff --staged --name-status', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  });
  if (!gitDiff.trim()) {
    console.log('📝 Staging all changes for analysis...');
    execSync('git add .', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    gitDiff = execSync('git diff --staged --name-status', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
  }

  // Get list of modified files first (needed for other operations)
  const modifiedFiles = execSync('git diff --staged --name-only', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  // Try to get detailed diff, but handle buffer overflow gracefully
  let detailedDiff = '';
  try {
    // Use minimal context (U3) and limit to text files to reduce size
    detailedDiff = execSync('git diff --staged -U3 --diff-filter=ACMRT', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    // Truncate if still too large (keep first 5MB)
    if (detailedDiff.length > 5 * 1024 * 1024) {
      detailedDiff = `${detailedDiff.slice(0, 5 * 1024 * 1024)}\n...[truncated due to size]...`;
    }
  } catch (error) {
    if (
      error.message.includes('ENOBUFS') ||
      error.message.includes('maxBuffer')
    ) {
      console.log('⚠️  Diff too large, using summary only');
      // Fallback: get diff stats only
      detailedDiff =
        'Diff too large to include. See file changes summary above.';
    } else {
      throw error;
    }
  }

  // Get comprehensive change information
  const changes = {
    // Summary of file changes
    fileChanges: gitDiff,

    // Detailed code diff (may be truncated or empty if too large)
    detailedDiff,

    // List of modified files
    modifiedFiles,

    // Get diff stats (additions/deletions)
    diffStats: execSync('git diff --staged --stat', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }),

    // Get commit info context
    lastCommit: execSync('git log -1 --oneline', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),

    // Branch information
    currentBranch: execSync('git branch --show-current', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),
  };

  // Analyze each modified file individually for better context
  const fileAnalysis = [];
  for (const file of changes.modifiedFiles.slice(0, 10)) {
    // Limit to 10 files and skip binary/large files
    const fileType = getFileType(file);
    if (fileType === 'Code' && !CODE_FILE_EXTENSION_RE.test(file)) {
      continue; // Skip non-code files
    }

    try {
      const fileDiff = execSync(`git diff --staged -U3 -- "${file}"`, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024, // 1MB per file
      });
      fileAnalysis.push({
        file,
        changes: fileDiff.slice(0, 2000), // Limit per file for API
        type: fileType,
      });
    } catch (error) {
      if (
        error.message.includes('ENOBUFS') ||
        error.message.includes('maxBuffer')
      ) {
        // File too large, skip it
        continue;
      }
      console.error(`⚠️  Failed to analyze file ${file}:`, error.message);
    }
  }

  return {
    hasChanges: true,
    summary: {
      totalFiles: changes.modifiedFiles.length,
      stats: changes.diffStats,
      branch: changes.currentBranch,
      lastCommit: changes.lastCommit,
    },
    fileChanges: changes.fileChanges,
    detailedDiff: changes.detailedDiff,
    fileAnalysis,
  };
}

/**
 * Determine file type for better AI analysis
 */
function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const typeMap = {
    tsx: 'React TypeScript Component',
    ts: 'TypeScript',
    jsx: 'React JavaScript Component',
    js: 'JavaScript',
    css: 'Stylesheet',
    json: 'Configuration',
    md: 'Documentation',
    yml: 'Configuration',
    yaml: 'Configuration',
  };
  return typeMap[ext] || 'Code';
}

/**
 * Generate an AI-powered commit message based on git changes
 */
async function generateCommitMessage() {
  try {
    const isDryRun = process.argv.includes('--dry-run');
    // Check if GROQ_API_KEY is set
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === '') {
      console.error('❌ GROQ_API_KEY environment variable is required');
      console.log('💡 Get your API key from: https://console.groq.com/keys');
      console.log('💡 Set it in .env.local file: GROQ_API_KEY="your-key-here"');
      process.exit(1);
    }

    // Initialize Groq client
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // Get comprehensive analysis of all changes
    let changeAnalysis;
    try {
      changeAnalysis = analyzeAllChanges();
    } catch (error) {
      console.error('❌ Failed to analyze changes:', error.message);
      process.exit(1);
    }

    if (!changeAnalysis.hasChanges) {
      console.log('✅ No changes to commit');
      return;
    }

    console.log('🤖 Generating commit message with AI...');

    // Generate commit message using Groq with comprehensive analysis
    const completion = await createCompletionSafe(
      groq,
      buildChatMessages(changeAnalysis),
      'openai/gpt-oss-120b'
    );

    const rawContent = completion?.choices?.[0]?.message?.content
      ?.trim()
      .replace(OPENING_CODE_BLOCK_REGEX, '') // Remove opening code block
      .replace(CLOSING_CODE_BLOCK_REGEX, '') // Remove closing code block
      .trim();

    // Some models put useful text in a nonstandard `reasoning` field
    const reasoning =
      completion?.choices?.[0]?.message?.reasoning?.toString?.().trim?.() ?? '';

    // Build a robust Conventional Commit from either content or reasoning
    let built = buildConventionalCommit(rawContent || '', reasoning || '');

    if (!built) {
      logCompletionFailureAndExit(completion);
    }

    const violations = findCommitViolations(built);
    if (violations.length > 0) {
      const repairCompletion = await createCompletionSafe(
        groq,
        buildRepairMessages(rawContent || '', reasoning || '', built, violations),
        'openai/gpt-oss-120b'
      );
      const repairedContent = repairCompletion?.choices?.[0]?.message?.content
        ?.trim()
        .replace(OPENING_CODE_BLOCK_REGEX, '')
        .replace(CLOSING_CODE_BLOCK_REGEX, '')
        .trim();
      const repairedReasoning =
        repairCompletion?.choices?.[0]?.message?.reasoning
          ?.toString?.()
          .trim?.() ?? '';
      built = buildConventionalCommit(repairedContent || '', repairedReasoning || '');
      if (!built) {
        logCompletionFailureAndExit(repairCompletion);
      }
      const remaining = findCommitViolations(built);
      if (remaining.length > 0) {
        console.error('❌ Commit message failed validation:');
        console.error(formatViolations(remaining));
        process.exit(1);
      }
    }

    console.log(`✨ Generated commit message: "${built.title}"`);
    if (isDryRun) {
      const preview = `${built.title}${built.body ? `\n\n${built.body}` : ''}`;
      console.log('\n--- Commit message preview (dry run) ---');
      console.log(preview);
      return;
    }

    // Write full commit message to a temporary file to avoid shell quoting issues
    const tmpFile = path.join(
      os.tmpdir(),
      `commit-msg-${Date.now().toString()}.txt`
    );
    const fullMessage = `${built.title}${built.body ? `\n\n${built.body}` : ''}`;
    fs.writeFileSync(tmpFile, fullMessage, 'utf8');

    // Commit using -F to read message from file
    try {
      execSync(`git commit -F "${tmpFile}"`, { encoding: 'utf8' });
      console.log('✅ Changes committed successfully');
    } catch (error) {
      console.error('❌ Failed to commit changes:', error.message);
      process.exit(1);
    }
    // Cleanup temp file (best-effort)
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }

    // Push to remote
    try {
      const currentBranch = execSync('git branch --show-current', {
        encoding: 'utf8',
      }).trim();
      execSync(`git push origin ${currentBranch}`, { encoding: 'utf8' });
      console.log(`🚀 Changes pushed to origin/${currentBranch}`);
    } catch (error) {
      console.error('❌ Failed to push changes:', error.message);
      console.log('💡 You may need to push manually with: git push');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error generating commit message:');
    console.error(formatError(error));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  generateCommitMessage();
}

module.exports = { generateCommitMessage };

// --- helpers ---------------------------------------------------------------

async function createCompletionSafe(groq, messages, model) {
  try {
    return await groq.chat.completions.create({
      messages,
      model,
      temperature: 0.3,
      max_tokens: 16_384,
      reasoning_effort: 'high',
    });
  } catch (error) {
    console.error('❌ Groq API error while creating completion');
    console.error(formatError(error));
    process.exit(1);
  }
}

function buildChatMessages(changeAnalysis) {
  const filesBlock = changeAnalysis.fileAnalysis
    .map((file) => `### ${file.file} (${file.type})\n${file.changes}`)
    .join('\n\n');

  // Estimate token count: ~4 characters per token, leave room for system prompt and other content
  // Target: ~6000 tokens max for user content (leaving ~2000 for system prompt and overhead)
  const MAX_USER_CONTENT_CHARS = 24_000; // ~6000 tokens

  // Build user content
  const summarySection =
    'Summary:\n' +
    `- Modified ${changeAnalysis.summary.totalFiles} files\n` +
    `- Branch: ${changeAnalysis.summary.branch}\n` +
    `- Previous commit: ${changeAnalysis.summary.lastCommit}\n\n`;

  const filesSection = `Files:\n${changeAnalysis.fileChanges}\n\n`;
  const statsSection = `Stats:\n${changeAnalysis.summary.stats}\n\n`;
  const detailsSection = `Details:\n${filesBlock}\n\n`;

  // Calculate remaining space for diff
  const usedChars =
    summarySection.length +
    filesSection.length +
    statsSection.length +
    detailsSection.length;
  const diffMaxChars = Math.max(0, MAX_USER_CONTENT_CHARS - usedChars - 500); // 500 char buffer

  const diffSection =
    diffMaxChars > 0
      ? `Full diff (truncated):\n${changeAnalysis.detailedDiff.slice(0, diffMaxChars)}\n`
      : '';

  const userContent =
    'Analyze these changes and produce a single conventional commit:\n\n' +
    summarySection +
    filesSection +
    statsSection +
    detailsSection +
    diffSection;

  return [
    {
      role: 'system',
      content:
        'You are an AI assistant tasked with generating a git commit message based on the staged code changes provided below. Follow these rules.\n\n' +
        'Commit message format: <type>: <description>\n' +
        'Types (lowercase, required): chore, deprecate, feat, fix, release\n' +
        'Breaking changes: append ! after the type (e.g., fix!: ...)\n' +
        'Description: required, under 256 characters, imperative mood, no trailing period\n' +
        'Body: optional, but if present use exactly three bullets in this order:\n' +
        '- change: ...\n' +
        '- why: ...\n' +
        '- risk: ...\n' +
        'Body lines must be under 256 characters each.\n' +
        'Do not include a scope.\n' +
        'Output only the final commit text, no markdown or code fences.',
    },
    {
      role: 'user',
      content: userContent,
    },
  ];
}

function logCompletionFailureAndExit(completion) {
  console.error(
    '❌ Failed to generate commit message. Raw completion payload:'
  );
  const raw = safeStringify(completion);
  console.error(
    raw.length > 10_000 ? `${raw.slice(0, 10_000)}\n...[truncated]...` : raw
  );
  if (completion?.usage) {
    console.error('Usage:', safeStringify(completion.usage));
  }
  if (completion?.choices) {
    console.error(
      'Choices meta:',
      safeStringify(
        completion.choices.map((c) => ({
          finish_reason: c.finish_reason,
          index: c.index,
        }))
      )
    );
  }
  process.exit(1);
}

// Extract a Conventional Commit from possibly noisy model output
const TITLE_RE =
  /^(?<type>chore|deprecate|feat|fix|release)(?<breaking>!)?:\s*(?<subject>.+)$/gim;

function buildConventionalCommit(content, reasoning) {
  const text = sanitizeText([content, reasoning].filter(Boolean).join('\n'));
  if (!text.trim()) {
    return null;
  }

  let titleMatch = null;
  for (const m of text.matchAll(TITLE_RE)) {
    if (m?.groups?.subject) {
      titleMatch = m;
      break;
    }
  }

  if (!titleMatch) {
    return null;
  }

  const { type } = titleMatch.groups;
  const breaking = titleMatch.groups.breaking ? '!' : '';
  let subject = titleMatch.groups.subject.trim();
  subject = stripWrappingQuotes(subject);

  const title = `${type}${breaking}: ${subject}`;

  const body = buildStructuredBody(text);

  return { title, body };
}

function sanitizeText(s) {
  if (!s) {
    return '';
  }
  return s
    .replace(OPENING_CODE_BLOCK_REGEX, '')
    .replace(CLOSING_CODE_BLOCK_REGEX, '')
    .replace(/`/g, '') // remove inline backticks to prevent shell substitutions in logs
    .trim();
}

function stripWrappingQuotes(s) {
  if (!s) {
    return s;
  }
  // remove wrapping single or double quotes if present
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function buildStructuredBody(text) {
  const lines = text.split(NEWLINE_SPLIT_RE);
  const extracted = {
    change: '',
    why: '',
    risk: '',
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const withoutBullet = BULLET_LINE_RE.test(trimmed)
      ? trimmed.replace(BULLET_LINE_RE, '')
      : trimmed;
    const lower = withoutBullet.toLowerCase();
    if (lower.startsWith('change:')) {
      extracted.change = withoutBullet.slice('change:'.length).trim();
    } else if (lower.startsWith('why:')) {
      extracted.why = withoutBullet.slice('why:'.length).trim();
    } else if (lower.startsWith('risk:')) {
      extracted.risk = withoutBullet.slice('risk:'.length).trim();
    } else if (lower.startsWith('testing:') && !extracted.risk) {
      extracted.risk = `testing: ${withoutBullet.slice('testing:'.length).trim()}`;
    }
  }

  const change = extracted.change || '(not provided)';
  const why = extracted.why || '(not provided)';
  const risk = extracted.risk || '(not provided)';

  return [
    `- change: ${change}`,
    `- why: ${why}`,
    `- risk: ${risk}`,
  ].join('\n');
}

function buildRepairMessages(content, reasoning, built, violations) {
  const issueList = violations.map((v) => `- ${v}`).join('\n');
  const raw = sanitizeText([content, reasoning].filter(Boolean).join('\n'));
  return [
    {
      role: 'system',
      content:
        'You fix commit messages to match these rules exactly.\n\n' +
        'Commit message format: <type>: <description>\n' +
        'Types (lowercase, required): chore, deprecate, feat, fix, release\n' +
        'Breaking changes: append ! after the type (e.g., fix!: ...)\n' +
        'Description: required, under 256 characters, imperative mood, no trailing period\n' +
        'Body: optional, but if present use exactly three bullets in this order:\n' +
        '- change: ...\n' +
        '- why: ...\n' +
        '- risk: ...\n' +
        'Body lines must be under 256 characters each.\n' +
        'Do not include a scope.\n' +
        'Output only the final commit text, no markdown or code fences.',
    },
    {
      role: 'user',
      content: [
        'Violations:',
        issueList,
        '',
        'Current commit:',
        built.title + (built.body ? `\n\n${built.body}` : ''),
        '',
        'Original model output (for context):',
        raw || '(not provided)',
      ].join('\n'),
    },
  ];
}

function findCommitViolations(built) {
  const violations = [];
  const title = built.title || '';
  if (!title) {
    violations.push('title is missing');
  }
  if (title.length > 256) {
    violations.push('title exceeds 256 characters');
  }
  if (!/^(chore|deprecate|feat|fix|release)!?:\s+/.test(title)) {
    violations.push('title does not match required type format');
  }
  if (title.includes('(')) {
    violations.push('title includes a scope');
  }
  const subject = title.split(':').slice(1).join(':').trim();
  if (!subject) {
    violations.push('description is empty');
  }
  if (subject.endsWith('.')) {
    violations.push('description ends with a period');
  }

  if (built.body) {
    const lines = built.body.split(NEWLINE_SPLIT_RE).filter(Boolean);
    if (lines.length !== 3) {
      violations.push('body must have exactly three bullets');
    }
    const expectedPrefixes = ['- change:', '- why:', '- risk:'];
    for (const [index, line] of lines.entries()) {
      if (line.length > 256) {
        violations.push('body line exceeds 256 characters');
        break;
      }
      const expected = expectedPrefixes[index];
      if (!expected || !line.startsWith(expected)) {
        violations.push('body bullets must be change/why/risk in order');
        break;
      }
    }
  }

  return violations;
}

function formatViolations(violations) {
  return violations.map((violation) => `- ${violation}`).join('\n');
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
    // Fallback to best-effort string conversion when JSON serialization fails
    try {
      return String(obj);
    } catch {
      return '[Unstringifiable]';
    }
  }
}

function formatError(error) {
  // Try to include as much structured information as possible
  const plain = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    // include standard fields: name, message, stack, cause, status, code, response
    // avoid huge nested response bodies without control
    if (key === 'response' && error.response) {
      plain.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers || undefined,
        data: error.response.data || undefined,
      };
    } else {
      try {
        // Copy other enumerable properties safely
        // eslint-disable-next-line no-param-reassign
        plain[key] = error[key];
      } catch {
        // ignore non-readable props
      }
    }
  }
  return safeStringify(plain);
}

```

Updated the violations output to be a clear multi‑line list and added a `--dry-run` mode. Dry run prints the full commit message and exits without committing or pushing.

Here’s the **dry‑run preview for your current changes** (no commit made):

```
feat: add commit validation, repair flow, and dry-run preview

- change: implement validation, repair, and dry-run support in generate-commit-message script
- why: ensure generated commit messages follow strict conventional format and allow preview without committing
- risk: added complexity may introduce bugs in LLM repair logic and affect existing workflows
```

If you want, I can also add a `--no-stage` flag so dry runs don’t stage files automatically.

```plaintext
feat: add commit validation, repair flow, and dry-run preview

- change: implement validation, repair, and dry-run support in generate-commit-message script
- why: ensure generated commit messages follow strict conventional format and allow preview without committing
- risk: added complexity may introduce bugs in LLM repair logic and affect existing workflows
```

---

**User**

what are we missing from the below?

Commit message guide

Spark icon
Page Summary
Commit messages
Clear commit messages make pull requests easier to review, and release notes easier to generate. The Blockly project uses conventional commits to help with this.

Each commit should have the format:


<type>: <description>

[optional body]

[optional footer(s)]
Note that the core Blockly repo has a commit linter to help enforce this. If your pull request has multiple commits, the linter will check the title. If it has a single commit, it will check that commit. It is best if both your individual commits and the pull request title follow these guidelines.

Type
The type must be non-empty, and all lower case. The following is a list of accepted types.

chore: For commits that complete routine/automated tasks such as upgrading dependencies.

deprecate: For commits that deprecate functionality.

feat: For commits that add new functionality to Blockly.

fix: For commits that fix bugs/errors in Blockly.

release: For commits that relate to the release of a new version.

Breaking changes
Commits that make breaking changes should append a ! after the type of the commit. Breaking changes are changes that may break developers using Blockly in their apps, causing them to have to do extra work.

For example: none fix!: return type of workspace.paste

Breaking changes could have any of the above valid types.

Description
The description must be non-empty, and must be under 256 characters.

Body
The body is optional. If it is provided there should be a blank line between it and the description. It must be broken into lines of no more than 256 characters.

Note that usually, it is advisable to put this kind of information in your pull request description, in addition to/rather than directly in the commit.

Footer
The footer is optional. If it is provided there should be a blank line between it and the body. It must be broken into lines of no more than 256 characters.

Fixing non-conventional commits
If you did not use conventional commits when making your modifications, there are two options for fixing the messages depending on how many commits you have:

If your pull request has multiple commits, edit the pull request title to conform to the requirements. When the pull request is merged, your other commits will be squashed so that the title becomes the commit message.

If your pull request has a single commit, amend your commit message using git commit --amend, then force push your changes to your fork of Blockly. This will automatically updated any open pull requests associated with this branch. git push --force origin my-branch.



---

**Cursor**

Here’s what we’re still missing vs that guide:

- **Optional body**: we currently always emit a body (three bullets). The guide says the body is optional.
- **Footer support**: we don’t generate or validate footers at all.
- **Footer separation rules**: no handling of the required blank line between body and footer.
- **Body flexibility**: the guide allows any body text; we enforce a strict 3‑bullet `change/why/risk` template.

Everything else is aligned: allowed types, lowercase, optional `!` breaking, description ≤256 chars, line length ≤256, blank line between title and body (we already add that).

---

**User**

lets have a hybrid of our current structure + the missing parts 

---

**Cursor**

```javascript
#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('dotenv');
const Groq = require('groq-sdk').default;

// Load environment variables from .env.local
config({ path: '.env.local' });

// Regex patterns for cleaning commit messages
const OPENING_CODE_BLOCK_REGEX = /^```[\s\S]*?\n/;
const CLOSING_CODE_BLOCK_REGEX = /\n```$/;
const NEWLINE_SPLIT_RE = /\r?\n/;
const BULLET_LINE_RE = /^[-*]\s+/;
const CODE_FILE_EXTENSION_RE = /\.(ts|tsx|js|jsx|css|json|md)$/;

/**
 * Analyze all code changes comprehensively for AI review
 */
function analyzeAllChanges() {
  console.log('🔍 Analyzing all code changes...');

  // Use larger buffer for git commands that may produce large output
  const LARGE_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

  // Check if there are any changes to analyze
  let gitStatus;
  try {
    gitStatus = execSync('git status --porcelain', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    if (!gitStatus.trim()) {
      return { hasChanges: false };
    }
  } catch (error) {
    throw new Error(`Failed to get git status: ${error.message}`);
  }

  // Stage all changes if nothing is staged
  let gitDiff = execSync('git diff --staged --name-status', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  });
  if (!gitDiff.trim()) {
    console.log('📝 Staging all changes for analysis...');
    execSync('git add .', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    gitDiff = execSync('git diff --staged --name-status', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
  }

  // Get list of modified files first (needed for other operations)
  const modifiedFiles = execSync('git diff --staged --name-only', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  // Try to get detailed diff, but handle buffer overflow gracefully
  let detailedDiff = '';
  try {
    // Use minimal context (U3) and limit to text files to reduce size
    detailedDiff = execSync('git diff --staged -U3 --diff-filter=ACMRT', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    // Truncate if still too large (keep first 5MB)
    if (detailedDiff.length > 5 * 1024 * 1024) {
      detailedDiff = `${detailedDiff.slice(0, 5 * 1024 * 1024)}\n...[truncated due to size]...`;
    }
  } catch (error) {
    if (
      error.message.includes('ENOBUFS') ||
      error.message.includes('maxBuffer')
    ) {
      console.log('⚠️  Diff too large, using summary only');
      // Fallback: get diff stats only
      detailedDiff =
        'Diff too large to include. See file changes summary above.';
    } else {
      throw error;
    }
  }

  // Get comprehensive change information
  const changes = {
    // Summary of file changes
    fileChanges: gitDiff,

    // Detailed code diff (may be truncated or empty if too large)
    detailedDiff,

    // List of modified files
    modifiedFiles,

    // Get diff stats (additions/deletions)
    diffStats: execSync('git diff --staged --stat', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }),

    // Get commit info context
    lastCommit: execSync('git log -1 --oneline', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),

    // Branch information
    currentBranch: execSync('git branch --show-current', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),
  };

  // Analyze each modified file individually for better context
  const fileAnalysis = [];
  for (const file of changes.modifiedFiles.slice(0, 10)) {
    // Limit to 10 files and skip binary/large files
    const fileType = getFileType(file);
    if (fileType === 'Code' && !CODE_FILE_EXTENSION_RE.test(file)) {
      continue; // Skip non-code files
    }

    try {
      const fileDiff = execSync(`git diff --staged -U3 -- "${file}"`, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024, // 1MB per file
      });
      fileAnalysis.push({
        file,
        changes: fileDiff.slice(0, 2000), // Limit per file for API
        type: fileType,
      });
    } catch (error) {
      if (
        error.message.includes('ENOBUFS') ||
        error.message.includes('maxBuffer')
      ) {
        // File too large, skip it
        continue;
      }
      console.error(`⚠️  Failed to analyze file ${file}:`, error.message);
    }
  }

  return {
    hasChanges: true,
    summary: {
      totalFiles: changes.modifiedFiles.length,
      stats: changes.diffStats,
      branch: changes.currentBranch,
      lastCommit: changes.lastCommit,
    },
    fileChanges: changes.fileChanges,
    detailedDiff: changes.detailedDiff,
    fileAnalysis,
  };
}

/**
 * Determine file type for better AI analysis
 */
function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const typeMap = {
    tsx: 'React TypeScript Component',
    ts: 'TypeScript',
    jsx: 'React JavaScript Component',
    js: 'JavaScript',
    css: 'Stylesheet',
    json: 'Configuration',
    md: 'Documentation',
    yml: 'Configuration',
    yaml: 'Configuration',
  };
  return typeMap[ext] || 'Code';
}

/**
 * Generate an AI-powered commit message based on git changes
 */
async function generateCommitMessage() {
  try {
    const isDryRun = process.argv.includes('--dry-run');
    // Check if GROQ_API_KEY is set
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === '') {
      console.error('❌ GROQ_API_KEY environment variable is required');
      console.log('💡 Get your API key from: https://console.groq.com/keys');
      console.log('💡 Set it in .env.local file: GROQ_API_KEY="your-key-here"');
      process.exit(1);
    }

    // Initialize Groq client
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // Get comprehensive analysis of all changes
    let changeAnalysis;
    try {
      changeAnalysis = analyzeAllChanges();
    } catch (error) {
      console.error('❌ Failed to analyze changes:', error.message);
      process.exit(1);
    }

    if (!changeAnalysis.hasChanges) {
      console.log('✅ No changes to commit');
      return;
    }

    console.log('🤖 Generating commit message with AI...');

    // Generate commit message using Groq with comprehensive analysis
    const completion = await createCompletionSafe(
      groq,
      buildChatMessages(changeAnalysis),
      'openai/gpt-oss-120b'
    );

    const rawContent = completion?.choices?.[0]?.message?.content
      ?.trim()
      .replace(OPENING_CODE_BLOCK_REGEX, '') // Remove opening code block
      .replace(CLOSING_CODE_BLOCK_REGEX, '') // Remove closing code block
      .trim();

    // Some models put useful text in a nonstandard `reasoning` field
    const reasoning =
      completion?.choices?.[0]?.message?.reasoning?.toString?.().trim?.() ?? '';

    // Build a robust Conventional Commit from either content or reasoning
    let built = buildConventionalCommit(rawContent || '', reasoning || '');

    if (!built) {
      logCompletionFailureAndExit(completion);
    }

    const violations = findCommitViolations(built);
    if (violations.length > 0) {
      const repairCompletion = await createCompletionSafe(
        groq,
        buildRepairMessages(rawContent || '', reasoning || '', built, violations),
        'openai/gpt-oss-120b'
      );
      const repairedContent = repairCompletion?.choices?.[0]?.message?.content
        ?.trim()
        .replace(OPENING_CODE_BLOCK_REGEX, '')
        .replace(CLOSING_CODE_BLOCK_REGEX, '')
        .trim();
      const repairedReasoning =
        repairCompletion?.choices?.[0]?.message?.reasoning
          ?.toString?.()
          .trim?.() ?? '';
      built = buildConventionalCommit(repairedContent || '', repairedReasoning || '');
      if (!built) {
        logCompletionFailureAndExit(repairCompletion);
      }
      const remaining = findCommitViolations(built);
      if (remaining.length > 0) {
        console.error('❌ Commit message failed validation:');
        console.error(formatViolations(remaining));
        process.exit(1);
      }
    }

    console.log(`✨ Generated commit message: "${built.title}"`);
    if (isDryRun) {
      const preview = buildFullMessage(built);
      console.log('\n--- Commit message preview (dry run) ---');
      console.log(preview);
      return;
    }

    // Write full commit message to a temporary file to avoid shell quoting issues
    const tmpFile = path.join(
      os.tmpdir(),
      `commit-msg-${Date.now().toString()}.txt`
    );
    const fullMessage = buildFullMessage(built);
    fs.writeFileSync(tmpFile, fullMessage, 'utf8');

    // Commit using -F to read message from file
    try {
      execSync(`git commit -F "${tmpFile}"`, { encoding: 'utf8' });
      console.log('✅ Changes committed successfully');
    } catch (error) {
      console.error('❌ Failed to commit changes:', error.message);
      process.exit(1);
    }
    // Cleanup temp file (best-effort)
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }

    // Push to remote
    try {
      const currentBranch = execSync('git branch --show-current', {
        encoding: 'utf8',
      }).trim();
      execSync(`git push origin ${currentBranch}`, { encoding: 'utf8' });
      console.log(`🚀 Changes pushed to origin/${currentBranch}`);
    } catch (error) {
      console.error('❌ Failed to push changes:', error.message);
      console.log('💡 You may need to push manually with: git push');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error generating commit message:');
    console.error(formatError(error));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  generateCommitMessage();
}

module.exports = { generateCommitMessage };

// --- helpers ---------------------------------------------------------------

async function createCompletionSafe(groq, messages, model) {
  try {
    return await groq.chat.completions.create({
      messages,
      model,
      temperature: 0.3,
      max_tokens: 16_384,
      reasoning_effort: 'high',
    });
  } catch (error) {
    console.error('❌ Groq API error while creating completion');
    console.error(formatError(error));
    process.exit(1);
  }
}

function buildChatMessages(changeAnalysis) {
  const filesBlock = changeAnalysis.fileAnalysis
    .map((file) => `### ${file.file} (${file.type})\n${file.changes}`)
    .join('\n\n');

  // Estimate token count: ~4 characters per token, leave room for system prompt and other content
  // Target: ~6000 tokens max for user content (leaving ~2000 for system prompt and overhead)
  const MAX_USER_CONTENT_CHARS = 24_000; // ~6000 tokens

  // Build user content
  const summarySection =
    'Summary:\n' +
    `- Modified ${changeAnalysis.summary.totalFiles} files\n` +
    `- Branch: ${changeAnalysis.summary.branch}\n` +
    `- Previous commit: ${changeAnalysis.summary.lastCommit}\n\n`;

  const filesSection = `Files:\n${changeAnalysis.fileChanges}\n\n`;
  const statsSection = `Stats:\n${changeAnalysis.summary.stats}\n\n`;
  const detailsSection = `Details:\n${filesBlock}\n\n`;

  // Calculate remaining space for diff
  const usedChars =
    summarySection.length +
    filesSection.length +
    statsSection.length +
    detailsSection.length;
  const diffMaxChars = Math.max(0, MAX_USER_CONTENT_CHARS - usedChars - 500); // 500 char buffer

  const diffSection =
    diffMaxChars > 0
      ? `Full diff (truncated):\n${changeAnalysis.detailedDiff.slice(0, diffMaxChars)}\n`
      : '';

  const userContent =
    'Analyze these changes and produce a single conventional commit:\n\n' +
    summarySection +
    filesSection +
    statsSection +
    detailsSection +
    diffSection;

  return [
    {
      role: 'system',
      content:
        'You are an AI assistant tasked with generating a git commit message based on the staged code changes provided below. Follow these rules.\n\n' +
        'Commit message format: <type>: <description>\n' +
        'Types (lowercase, required): chore, deprecate, feat, fix, release\n' +
        'Breaking changes: append ! after the type (e.g., fix!: ...)\n' +
        'Description: required, under 256 characters, imperative mood, no trailing period\n' +
        'Body: optional. If present, use exactly three bullets in this order:\n' +
        '- change: ...\n' +
        '- why: ...\n' +
        '- risk: ...\n' +
        'Body lines must be under 256 characters each.\n' +
        'Footer: optional lines after a blank line following the body. Each line must be under 256 characters.\n' +
        'Do not include a scope.\n' +
        'Output only the final commit text, no markdown or code fences.',
    },
    {
      role: 'user',
      content: userContent,
    },
  ];
}

function logCompletionFailureAndExit(completion) {
  console.error(
    '❌ Failed to generate commit message. Raw completion payload:'
  );
  const raw = safeStringify(completion);
  console.error(
    raw.length > 10_000 ? `${raw.slice(0, 10_000)}\n...[truncated]...` : raw
  );
  if (completion?.usage) {
    console.error('Usage:', safeStringify(completion.usage));
  }
  if (completion?.choices) {
    console.error(
      'Choices meta:',
      safeStringify(
        completion.choices.map((c) => ({
          finish_reason: c.finish_reason,
          index: c.index,
        }))
      )
    );
  }
  process.exit(1);
}

// Extract a Conventional Commit from possibly noisy model output
const TITLE_RE =
  /^(?<type>chore|deprecate|feat|fix|release)(?<breaking>!)?:\s*(?<subject>.+)$/gim;

function buildConventionalCommit(content, reasoning) {
  const text = sanitizeText([content, reasoning].filter(Boolean).join('\n'));
  if (!text.trim()) {
    return null;
  }

  let titleMatch = null;
  for (const m of text.matchAll(TITLE_RE)) {
    if (m?.groups?.subject) {
      titleMatch = m;
      break;
    }
  }

  if (!titleMatch) {
    return null;
  }

  const { type } = titleMatch.groups;
  const breaking = titleMatch.groups.breaking ? '!' : '';
  let subject = titleMatch.groups.subject.trim();
  subject = stripWrappingQuotes(subject);

  const title = `${type}${breaking}: ${subject}`;

  const body = buildStructuredBody(text);

  return { title, body };
}

function sanitizeText(s) {
  if (!s) {
    return '';
  }
  return s
    .replace(OPENING_CODE_BLOCK_REGEX, '')
    .replace(CLOSING_CODE_BLOCK_REGEX, '')
    .replace(/`/g, '') // remove inline backticks to prevent shell substitutions in logs
    .trim();
}

function stripWrappingQuotes(s) {
  if (!s) {
    return s;
  }
  // remove wrapping single or double quotes if present
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function buildStructuredBody(text) {
  const lines = text.split(NEWLINE_SPLIT_RE);
  const extracted = {
    change: '',
    why: '',
    risk: '',
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const withoutBullet = BULLET_LINE_RE.test(trimmed)
      ? trimmed.replace(BULLET_LINE_RE, '')
      : trimmed;
    const lower = withoutBullet.toLowerCase();
    if (lower.startsWith('change:')) {
      extracted.change = withoutBullet.slice('change:'.length).trim();
    } else if (lower.startsWith('why:')) {
      extracted.why = withoutBullet.slice('why:'.length).trim();
    } else if (lower.startsWith('risk:')) {
      extracted.risk = withoutBullet.slice('risk:'.length).trim();
    } else if (lower.startsWith('testing:') && !extracted.risk) {
      extracted.risk = `testing: ${withoutBullet.slice('testing:'.length).trim()}`;
    }
  }

  const change = extracted.change || '(not provided)';
  const why = extracted.why || '(not provided)';
  const risk = extracted.risk || '(not provided)';

  return [
    `- change: ${change}`,
    `- why: ${why}`,
    `- risk: ${risk}`,
  ].join('\n');
}

function buildRepairMessages(content, reasoning, built, violations) {
  const issueList = violations.map((v) => `- ${v}`).join('\n');
  const raw = sanitizeText([content, reasoning].filter(Boolean).join('\n'));
  return [
    {
      role: 'system',
      content:
        'You fix commit messages to match these rules exactly.\n\n' +
        'Commit message format: <type>: <description>\n' +
        'Types (lowercase, required): chore, deprecate, feat, fix, release\n' +
        'Breaking changes: append ! after the type (e.g., fix!: ...)\n' +
        'Description: required, under 256 characters, imperative mood, no trailing period\n' +
        'Body: optional, but if present use exactly three bullets in this order:\n' +
        '- change: ...\n' +
        '- why: ...\n' +
        '- risk: ...\n' +
        'Body lines must be under 256 characters each.\n' +
        'Do not include a scope.\n' +
        'Output only the final commit text, no markdown or code fences.',
    },
    {
      role: 'user',
      content: [
        'Violations:',
        issueList,
        '',
        'Current commit:',
        built.title + (built.body ? `\n\n${built.body}` : ''),
        '',
        'Original model output (for context):',
        raw || '(not provided)',
      ].join('\n'),
    },
  ];
}

function findCommitViolations(built) {
  const violations = [];
  const title = built.title || '';
  if (!title) {
    violations.push('title is missing');
  }
  if (title.length > 256) {
    violations.push('title exceeds 256 characters');
  }
  if (!/^(chore|deprecate|feat|fix|release)!?:\s+/.test(title)) {
    violations.push('title does not match required type format');
  }
  if (title.includes('(')) {
    violations.push('title includes a scope');
  }
  const subject = title.split(':').slice(1).join(':').trim();
  if (!subject) {
    violations.push('description is empty');
  }
  if (subject.endsWith('.')) {
    violations.push('description ends with a period');
  }

  if (built.body) {
    const lines = built.body.split(NEWLINE_SPLIT_RE).filter(Boolean);
    if (lines.length !== 3) {
      violations.push('body must have exactly three bullets');
    }
    const expectedPrefixes = ['- change:', '- why:', '- risk:'];
    for (const [index, line] of lines.entries()) {
      if (line.length > 256) {
        violations.push('body line exceeds 256 characters');
        break;
      }
      const expected = expectedPrefixes[index];
      if (!expected || !line.startsWith(expected)) {
        violations.push('body bullets must be change/why/risk in order');
        break;
      }
    }
  }

  return violations;
}

function formatViolations(violations) {
  return violations.map((violation) => `- ${violation}`).join('\n');
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
    // Fallback to best-effort string conversion when JSON serialization fails
    try {
      return String(obj);
    } catch {
      return '[Unstringifiable]';
    }
  }
}

function formatError(error) {
  // Try to include as much structured information as possible
  const plain = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    // include standard fields: name, message, stack, cause, status, code, response
    // avoid huge nested response bodies without control
    if (key === 'response' && error.response) {
      plain.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers || undefined,
        data: error.response.data || undefined,
      };
    } else {
      try {
        // Copy other enumerable properties safely
        // eslint-disable-next-line no-param-reassign
        plain[key] = error[key];
      } catch {
        // ignore non-readable props
      }
    }
  }
  return safeStringify(plain);
}

```

```javascript
#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('dotenv');
const Groq = require('groq-sdk').default;

// Load environment variables from .env.local
config({ path: '.env.local' });

// Regex patterns for cleaning commit messages
const OPENING_CODE_BLOCK_REGEX = /^```[\s\S]*?\n/;
const CLOSING_CODE_BLOCK_REGEX = /\n```$/;
const NEWLINE_SPLIT_RE = /\r?\n/;
const BULLET_LINE_RE = /^[-*]\s+/;
const CODE_FILE_EXTENSION_RE = /\.(ts|tsx|js|jsx|css|json|md)$/;

/**
 * Analyze all code changes comprehensively for AI review
 */
function analyzeAllChanges() {
  console.log('🔍 Analyzing all code changes...');

  // Use larger buffer for git commands that may produce large output
  const LARGE_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

  // Check if there are any changes to analyze
  let gitStatus;
  try {
    gitStatus = execSync('git status --porcelain', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    if (!gitStatus.trim()) {
      return { hasChanges: false };
    }
  } catch (error) {
    throw new Error(`Failed to get git status: ${error.message}`);
  }

  // Stage all changes if nothing is staged
  let gitDiff = execSync('git diff --staged --name-status', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  });
  if (!gitDiff.trim()) {
    console.log('📝 Staging all changes for analysis...');
    execSync('git add .', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    gitDiff = execSync('git diff --staged --name-status', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
  }

  // Get list of modified files first (needed for other operations)
  const modifiedFiles = execSync('git diff --staged --name-only', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  // Try to get detailed diff, but handle buffer overflow gracefully
  let detailedDiff = '';
  try {
    // Use minimal context (U3) and limit to text files to reduce size
    detailedDiff = execSync('git diff --staged -U3 --diff-filter=ACMRT', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    // Truncate if still too large (keep first 5MB)
    if (detailedDiff.length > 5 * 1024 * 1024) {
      detailedDiff = `${detailedDiff.slice(0, 5 * 1024 * 1024)}\n...[truncated due to size]...`;
    }
  } catch (error) {
    if (
      error.message.includes('ENOBUFS') ||
      error.message.includes('maxBuffer')
    ) {
      console.log('⚠️  Diff too large, using summary only');
      // Fallback: get diff stats only
      detailedDiff =
        'Diff too large to include. See file changes summary above.';
    } else {
      throw error;
    }
  }

  // Get comprehensive change information
  const changes = {
    // Summary of file changes
    fileChanges: gitDiff,

    // Detailed code diff (may be truncated or empty if too large)
    detailedDiff,

    // List of modified files
    modifiedFiles,

    // Get diff stats (additions/deletions)
    diffStats: execSync('git diff --staged --stat', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }),

    // Get commit info context
    lastCommit: execSync('git log -1 --oneline', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),

    // Branch information
    currentBranch: execSync('git branch --show-current', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),
  };

  // Analyze each modified file individually for better context
  const fileAnalysis = [];
  for (const file of changes.modifiedFiles.slice(0, 10)) {
    // Limit to 10 files and skip binary/large files
    const fileType = getFileType(file);
    if (fileType === 'Code' && !CODE_FILE_EXTENSION_RE.test(file)) {
      continue; // Skip non-code files
    }

    try {
      const fileDiff = execSync(`git diff --staged -U3 -- "${file}"`, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024, // 1MB per file
      });
      fileAnalysis.push({
        file,
        changes: fileDiff.slice(0, 2000), // Limit per file for API
        type: fileType,
      });
    } catch (error) {
      if (
        error.message.includes('ENOBUFS') ||
        error.message.includes('maxBuffer')
      ) {
        // File too large, skip it
        continue;
      }
      console.error(`⚠️  Failed to analyze file ${file}:`, error.message);
    }
  }

  return {
    hasChanges: true,
    summary: {
      totalFiles: changes.modifiedFiles.length,
      stats: changes.diffStats,
      branch: changes.currentBranch,
      lastCommit: changes.lastCommit,
    },
    fileChanges: changes.fileChanges,
    detailedDiff: changes.detailedDiff,
    fileAnalysis,
  };
}

/**
 * Determine file type for better AI analysis
 */
function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const typeMap = {
    tsx: 'React TypeScript Component',
    ts: 'TypeScript',
    jsx: 'React JavaScript Component',
    js: 'JavaScript',
    css: 'Stylesheet',
    json: 'Configuration',
    md: 'Documentation',
    yml: 'Configuration',
    yaml: 'Configuration',
  };
  return typeMap[ext] || 'Code';
}

/**
 * Generate an AI-powered commit message based on git changes
 */
async function generateCommitMessage() {
  try {
    const isDryRun = process.argv.includes('--dry-run');
    // Check if GROQ_API_KEY is set
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === '') {
      console.error('❌ GROQ_API_KEY environment variable is required');
      console.log('💡 Get your API key from: https://console.groq.com/keys');
      console.log('💡 Set it in .env.local file: GROQ_API_KEY="your-key-here"');
      process.exit(1);
    }

    // Initialize Groq client
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // Get comprehensive analysis of all changes
    let changeAnalysis;
    try {
      changeAnalysis = analyzeAllChanges();
    } catch (error) {
      console.error('❌ Failed to analyze changes:', error.message);
      process.exit(1);
    }

    if (!changeAnalysis.hasChanges) {
      console.log('✅ No changes to commit');
      return;
    }

    console.log('🤖 Generating commit message with AI...');

    // Generate commit message using Groq with comprehensive analysis
    const completion = await createCompletionSafe(
      groq,
      buildChatMessages(changeAnalysis),
      'openai/gpt-oss-120b'
    );

    const rawContent = completion?.choices?.[0]?.message?.content
      ?.trim()
      .replace(OPENING_CODE_BLOCK_REGEX, '') // Remove opening code block
      .replace(CLOSING_CODE_BLOCK_REGEX, '') // Remove closing code block
      .trim();

    // Some models put useful text in a nonstandard `reasoning` field
    const reasoning =
      completion?.choices?.[0]?.message?.reasoning?.toString?.().trim?.() ?? '';

    // Build a robust Conventional Commit from either content or reasoning
    let built = buildConventionalCommit(rawContent || '', reasoning || '');

    if (!built) {
      logCompletionFailureAndExit(completion);
    }

    const violations = findCommitViolations(built);
    if (violations.length > 0) {
      const repairCompletion = await createCompletionSafe(
        groq,
        buildRepairMessages(rawContent || '', reasoning || '', built, violations),
        'openai/gpt-oss-120b'
      );
      const repairedContent = repairCompletion?.choices?.[0]?.message?.content
        ?.trim()
        .replace(OPENING_CODE_BLOCK_REGEX, '')
        .replace(CLOSING_CODE_BLOCK_REGEX, '')
        .trim();
      const repairedReasoning =
        repairCompletion?.choices?.[0]?.message?.reasoning
          ?.toString?.()
          .trim?.() ?? '';
      built = buildConventionalCommit(repairedContent || '', repairedReasoning || '');
      if (!built) {
        logCompletionFailureAndExit(repairCompletion);
      }
      const remaining = findCommitViolations(built);
      if (remaining.length > 0) {
        console.error('❌ Commit message failed validation:');
        console.error(formatViolations(remaining));
        process.exit(1);
      }
    }

    console.log(`✨ Generated commit message: "${built.title}"`);
    if (isDryRun) {
      const preview = buildFullMessage(built);
      console.log('\n--- Commit message preview (dry run) ---');
      console.log(preview);
      return;
    }

    // Write full commit message to a temporary file to avoid shell quoting issues
    const tmpFile = path.join(
      os.tmpdir(),
      `commit-msg-${Date.now().toString()}.txt`
    );
    const fullMessage = buildFullMessage(built);
    fs.writeFileSync(tmpFile, fullMessage, 'utf8');

    // Commit using -F to read message from file
    try {
      execSync(`git commit -F "${tmpFile}"`, { encoding: 'utf8' });
      console.log('✅ Changes committed successfully');
    } catch (error) {
      console.error('❌ Failed to commit changes:', error.message);
      process.exit(1);
    }
    // Cleanup temp file (best-effort)
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }

    // Push to remote
    try {
      const currentBranch = execSync('git branch --show-current', {
        encoding: 'utf8',
      }).trim();
      execSync(`git push origin ${currentBranch}`, { encoding: 'utf8' });
      console.log(`🚀 Changes pushed to origin/${currentBranch}`);
    } catch (error) {
      console.error('❌ Failed to push changes:', error.message);
      console.log('💡 You may need to push manually with: git push');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error generating commit message:');
    console.error(formatError(error));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  generateCommitMessage();
}

module.exports = { generateCommitMessage };

// --- helpers ---------------------------------------------------------------

async function createCompletionSafe(groq, messages, model) {
  try {
    return await groq.chat.completions.create({
      messages,
      model,
      temperature: 0.3,
      max_tokens: 16_384,
      reasoning_effort: 'high',
    });
  } catch (error) {
    console.error('❌ Groq API error while creating completion');
    console.error(formatError(error));
    process.exit(1);
  }
}

function buildChatMessages(changeAnalysis) {
  const filesBlock = changeAnalysis.fileAnalysis
    .map((file) => `### ${file.file} (${file.type})\n${file.changes}`)
    .join('\n\n');

  // Estimate token count: ~4 characters per token, leave room for system prompt and other content
  // Target: ~6000 tokens max for user content (leaving ~2000 for system prompt and overhead)
  const MAX_USER_CONTENT_CHARS = 24_000; // ~6000 tokens

  // Build user content
  const summarySection =
    'Summary:\n' +
    `- Modified ${changeAnalysis.summary.totalFiles} files\n` +
    `- Branch: ${changeAnalysis.summary.branch}\n` +
    `- Previous commit: ${changeAnalysis.summary.lastCommit}\n\n`;

  const filesSection = `Files:\n${changeAnalysis.fileChanges}\n\n`;
  const statsSection = `Stats:\n${changeAnalysis.summary.stats}\n\n`;
  const detailsSection = `Details:\n${filesBlock}\n\n`;

  // Calculate remaining space for diff
  const usedChars =
    summarySection.length +
    filesSection.length +
    statsSection.length +
    detailsSection.length;
  const diffMaxChars = Math.max(0, MAX_USER_CONTENT_CHARS - usedChars - 500); // 500 char buffer

  const diffSection =
    diffMaxChars > 0
      ? `Full diff (truncated):\n${changeAnalysis.detailedDiff.slice(0, diffMaxChars)}\n`
      : '';

  const userContent =
    'Analyze these changes and produce a single conventional commit:\n\n' +
    summarySection +
    filesSection +
    statsSection +
    detailsSection +
    diffSection;

  return [
    {
      role: 'system',
      content:
        'You are an AI assistant tasked with generating a git commit message based on the staged code changes provided below. Follow these rules.\n\n' +
        'Commit message format: <type>: <description>\n' +
        'Types (lowercase, required): chore, deprecate, feat, fix, release\n' +
        'Breaking changes: append ! after the type (e.g., fix!: ...)\n' +
        'Description: required, under 256 characters, imperative mood, no trailing period\n' +
        'Body: optional. If present, use exactly three bullets in this order:\n' +
        '- change: ...\n' +
        '- why: ...\n' +
        '- risk: ...\n' +
        'Body lines must be under 256 characters each.\n' +
        'Footer: optional lines after a blank line following the body. Each line must be under 256 characters.\n' +
        'Do not include a scope.\n' +
        'Output only the final commit text, no markdown or code fences.',
    },
    {
      role: 'user',
      content: userContent,
    },
  ];
}

function logCompletionFailureAndExit(completion) {
  console.error(
    '❌ Failed to generate commit message. Raw completion payload:'
  );
  const raw = safeStringify(completion);
  console.error(
    raw.length > 10_000 ? `${raw.slice(0, 10_000)}\n...[truncated]...` : raw
  );
  if (completion?.usage) {
    console.error('Usage:', safeStringify(completion.usage));
  }
  if (completion?.choices) {
    console.error(
      'Choices meta:',
      safeStringify(
        completion.choices.map((c) => ({
          finish_reason: c.finish_reason,
          index: c.index,
        }))
      )
    );
  }
  process.exit(1);
}

// Extract a Conventional Commit from possibly noisy model output
const TITLE_RE =
  /^(?<type>chore|deprecate|feat|fix|release)(?<breaking>!)?:\s*(?<subject>.+)$/gim;

function buildConventionalCommit(content, reasoning) {
  const text = sanitizeText([content, reasoning].filter(Boolean).join('\n'));
  if (!text.trim()) {
    return null;
  }

  let titleMatch = null;
  for (const m of text.matchAll(TITLE_RE)) {
    if (m?.groups?.subject) {
      titleMatch = m;
      break;
    }
  }

  if (!titleMatch) {
    return null;
  }

  const { type } = titleMatch.groups;
  const breaking = titleMatch.groups.breaking ? '!' : '';
  let subject = titleMatch.groups.subject.trim();
  subject = stripWrappingQuotes(subject);

  const title = `${type}${breaking}: ${subject}`;

  const { body, footer } = buildStructuredBody(text);

  return { title, body, footer };
}

function sanitizeText(s) {
  if (!s) {
    return '';
  }
  return s
    .replace(OPENING_CODE_BLOCK_REGEX, '')
    .replace(CLOSING_CODE_BLOCK_REGEX, '')
    .replace(/`/g, '') // remove inline backticks to prevent shell substitutions in logs
    .trim();
}

function stripWrappingQuotes(s) {
  if (!s) {
    return s;
  }
  // remove wrapping single or double quotes if present
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function buildStructuredBody(text) {
  const lines = text.split(NEWLINE_SPLIT_RE);
  const extracted = {
    change: '',
    why: '',
    risk: '',
  };
  const footerLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const withoutBullet = BULLET_LINE_RE.test(trimmed)
      ? trimmed.replace(BULLET_LINE_RE, '')
      : trimmed;
    const lower = withoutBullet.toLowerCase();
    if (lower.startsWith('change:')) {
      extracted.change = withoutBullet.slice('change:'.length).trim();
    } else if (lower.startsWith('why:')) {
      extracted.why = withoutBullet.slice('why:'.length).trim();
    } else if (lower.startsWith('risk:')) {
      extracted.risk = withoutBullet.slice('risk:'.length).trim();
    } else if (lower.startsWith('testing:') && !extracted.risk) {
      extracted.risk = `testing: ${withoutBullet.slice('testing:'.length).trim()}`;
    } else if (
      withoutBullet.startsWith('Footer:') ||
      withoutBullet.startsWith('Refs:') ||
      withoutBullet.startsWith('Ref:') ||
      withoutBullet.startsWith('Fixes:') ||
      withoutBullet.startsWith('BREAKING CHANGE:')
    ) {
      footerLines.push(withoutBullet);
    }
  }

  const hasBody =
    Boolean(extracted.change) || Boolean(extracted.why) || Boolean(extracted.risk);
  if (!hasBody && footerLines.length === 0) {
    return { body: '', footer: '' };
  }
  const change = extracted.change || '(not provided)';
  const why = extracted.why || '(not provided)';
  const risk = extracted.risk || '(not provided)';

  const body = [
    `- change: ${change}`,
    `- why: ${why}`,
    `- risk: ${risk}`,
  ].join('\n');
  const footer = footerLines.join('\n');
  return { body, footer };
}

function buildRepairMessages(content, reasoning, built, violations) {
  const issueList = violations.map((v) => `- ${v}`).join('\n');
  const raw = sanitizeText([content, reasoning].filter(Boolean).join('\n'));
  return [
    {
      role: 'system',
      content:
        'You fix commit messages to match these rules exactly.\n\n' +
        'Commit message format: <type>: <description>\n' +
        'Types (lowercase, required): chore, deprecate, feat, fix, release\n' +
        'Breaking changes: append ! after the type (e.g., fix!: ...)\n' +
        'Description: required, under 256 characters, imperative mood, no trailing period\n' +
        'Body: optional. If present, use exactly three bullets in this order:\n' +
        '- change: ...\n' +
        '- why: ...\n' +
        '- risk: ...\n' +
        'Body lines must be under 256 characters each.\n' +
        'Footer: optional lines after a blank line following the body. Each line must be under 256 characters.\n' +
        'Do not include a scope.\n' +
        'Output only the final commit text, no markdown or code fences.',
    },
    {
      role: 'user',
      content: [
        'Violations:',
        issueList,
        '',
        'Current commit:',
        buildFullMessage(built),
        '',
        'Original model output (for context):',
        raw || '(not provided)',
      ].join('\n'),
    },
  ];
}

function findCommitViolations(built) {
  const violations = [];
  const title = built.title || '';
  if (!title) {
    violations.push('title is missing');
  }
  if (title.length > 256) {
    violations.push('title exceeds 256 characters');
  }
  if (!/^(chore|deprecate|feat|fix|release)!?:\s+/.test(title)) {
    violations.push('title does not match required type format');
  }
  if (title.includes('(')) {
    violations.push('title includes a scope');
  }
  const subject = title.split(':').slice(1).join(':').trim();
  if (!subject) {
    violations.push('description is empty');
  }
  if (subject.endsWith('.')) {
    violations.push('description ends with a period');
  }

  if (built.body) {
    const lines = built.body.split(NEWLINE_SPLIT_RE).filter(Boolean);
    if (lines.length !== 3) {
      violations.push('body must have exactly three bullets');
    }
    const expectedPrefixes = ['- change:', '- why:', '- risk:'];
    for (const [index, line] of lines.entries()) {
      if (line.length > 256) {
        violations.push('body line exceeds 256 characters');
        break;
      }
      const expected = expectedPrefixes[index];
      if (!expected || !line.startsWith(expected)) {
        violations.push('body bullets must be change/why/risk in order');
        break;
      }
    }
  }

  if (built.footer) {
    const footerLines = built.footer.split(NEWLINE_SPLIT_RE).filter(Boolean);
    for (const line of footerLines) {
      if (line.length > 256) {
        violations.push('footer line exceeds 256 characters');
        break;
      }
    }
  }

  return violations;
}

function formatViolations(violations) {
  return violations.map((violation) => `- ${violation}`).join('\n');
}

function buildFullMessage(built) {
  const sections = [built.title];
  if (built.body) {
    sections.push(built.body);
  }
  if (built.footer) {
    sections.push(built.footer);
  }
  return sections.join('\n\n');
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
    // Fallback to best-effort string conversion when JSON serialization fails
    try {
      return String(obj);
    } catch {
      return '[Unstringifiable]';
    }
  }
}

function formatError(error) {
  // Try to include as much structured information as possible
  const plain = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    // include standard fields: name, message, stack, cause, status, code, response
    // avoid huge nested response bodies without control
    if (key === 'response' && error.response) {
      plain.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers || undefined,
        data: error.response.data || undefined,
      };
    } else {
      try {
        // Copy other enumerable properties safely
        // eslint-disable-next-line no-param-reassign
        plain[key] = error[key];
      } catch {
        // ignore non-readable props
      }
    }
  }
  return safeStringify(plain);
}

```

Done. We now support a **hybrid**:

- Body is **optional** (no more forced bullets if nothing is provided).
- If body exists, it **must** be the `change/why/risk` 3‑bullet structure.
- Footer is **optional** and, if present, is separated by a blank line after the body.
- Footer lines are validated for ≤256 characters.

The script now builds the full message as:
```
<title>

<body (optional)>

<footer (optional)>
```

Footer extraction recognizes lines starting with:
`Footer:`, `Refs:`, `Ref:`, `Fixes:`, or `BREAKING CHANGE:`.

If you want different footer keywords (or want to allow any line after the blank line), I can loosen/tighten that.

Want me to run another `--dry-run` so you can see the current output with the hybrid rules?

```plaintext
<title>

<body (optional)>

<footer (optional)>
```

---

**User**

how do we determine is a body or footer will be created, i don't understand 

---

**Cursor**

Right now it’s purely **content‑driven**:

- **Body is created only if the model output contains any of these keys** (with or without a bullet):  
  `change:`, `why:`, or `risk:` (also `testing:` maps into `risk` if `risk` is missing).  
  If none of those appear, **no body is included**.

- **Footer is created only if the model output contains lines that start with**:  
  `Footer:`, `Refs:`, `Ref:`, `Fixes:`, or `BREAKING CHANGE:`.  
  Those lines are collected verbatim into the footer block.  
  If none appear, **no footer is included**.

So the model decides whether to include body/footer based on whether it outputs those markers. The script just detects them and assembles the sections.

If you want it to **always** include the body, or to **always** add a footer when a breaking change is detected, we can make that deterministic.

---

**User**

what do we do about the "Note that usually, it is advisable to put this kind of information in your pull request description, in addition to/rather than directly in the commit." 

---

**Cursor**

That line is just guidance, not a hard rule. It’s saying: **don’t overload commits with long context**—prefer to put detail in the PR.

What we can do to align with that:

- Keep commit bodies **short and strictly structured** (which we now do).
- Only include a body **when it adds value** (risk/testing/breaking), otherwise omit it.
- Keep detailed reasoning in the **PR summary** (which you already like).

If you want, I can make the commit script **prefer no body** unless:
- a breaking change is detected (`!` or `BREAKING CHANGE:`), or
- the model explicitly provides `risk:` / `testing:`.

That would keep commits clean while still surfacing critical info.

---

**User**

okay lets run a dry run 

---

**Cursor**

Dry run complete. Here’s the preview from the current changes:

```
feat: add dry-run mode, validation, and repair for commit messages

- change: Add a --dry-run flag, commit message validation, and automatic repair logic to generate-commit-message script
- why: Ensure generated commit messages follow strict conventional format and allow preview without committing
- risk: Potential false positives in validation may block valid messages; repair step may introduce delays
```

If you want the body to be omitted unless there’s a real risk or breaking change, I can tweak the logic accordingly.

```plaintext
feat: add dry-run mode, validation, and repair for commit messages

- change: Add a --dry-run flag, commit message validation, and automatic repair logic to generate-commit-message script
- why: Ensure generated commit messages follow strict conventional format and allow preview without committing
- risk: Potential false positives in validation may block valid messages; repair step may introduce delays
```

---

**User**

okay make the commit now for real.

---

**Cursor**

Committed and pushed to `origin/staging`.

Generated commit message:
```
feat: Add dry-run mode, commit validation, and repair workflow to generate-commit-message script
```

If you want the commit subject to be lower‑case (per your guide), I can update the commit message rules to enforce that too.

```plaintext
feat: Add dry-run mode, commit validation, and repair workflow to generate-commit-message script
```

---

**User**

fix this @bash (978-1018) 

---

**Cursor**

```javascript
#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('dotenv');
const Groq = require('groq-sdk').default;

// Load environment variables from .env.local
config({ path: '.env.local' });

// Regex patterns for cleaning commit messages
const OPENING_CODE_BLOCK_REGEX = /^```[\s\S]*?\n/;
const CLOSING_CODE_BLOCK_REGEX = /\n```$/;
const NEWLINE_SPLIT_RE = /\r?\n/;
const BULLET_LINE_RE = /^[-*]\s+/;
const CODE_FILE_EXTENSION_RE = /\.(ts|tsx|js|jsx|css|json|md)$/;

/**
 * Analyze all code changes comprehensively for AI review
 */
function analyzeAllChanges() {
  console.log('🔍 Analyzing all code changes...');

  // Use larger buffer for git commands that may produce large output
  const LARGE_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

  // Check if there are any changes to analyze
  let gitStatus;
  try {
    gitStatus = execSync('git status --porcelain', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    if (!gitStatus.trim()) {
      return { hasChanges: false };
    }
  } catch (error) {
    throw new Error(`Failed to get git status: ${error.message}`);
  }

  // Stage all changes if nothing is staged
  let gitDiff = execSync('git diff --staged --name-status', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  });
  if (!gitDiff.trim()) {
    console.log('📝 Staging all changes for analysis...');
    execSync('git add .', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    gitDiff = execSync('git diff --staged --name-status', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
  }

  // Get list of modified files first (needed for other operations)
  const modifiedFiles = execSync('git diff --staged --name-only', {
    encoding: 'utf8',
    maxBuffer: LARGE_BUFFER_SIZE,
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  // Try to get detailed diff, but handle buffer overflow gracefully
  let detailedDiff = '';
  try {
    // Use minimal context (U3) and limit to text files to reduce size
    detailedDiff = execSync('git diff --staged -U3 --diff-filter=ACMRT', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    });
    // Truncate if still too large (keep first 5MB)
    if (detailedDiff.length > 5 * 1024 * 1024) {
      detailedDiff = `${detailedDiff.slice(0, 5 * 1024 * 1024)}\n...[truncated due to size]...`;
    }
  } catch (error) {
    if (
      error.message.includes('ENOBUFS') ||
      error.message.includes('maxBuffer')
    ) {
      console.log('⚠️  Diff too large, using summary only');
      // Fallback: get diff stats only
      detailedDiff =
        'Diff too large to include. See file changes summary above.';
    } else {
      throw error;
    }
  }

  // Get comprehensive change information
  const changes = {
    // Summary of file changes
    fileChanges: gitDiff,

    // Detailed code diff (may be truncated or empty if too large)
    detailedDiff,

    // List of modified files
    modifiedFiles,

    // Get diff stats (additions/deletions)
    diffStats: execSync('git diff --staged --stat', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }),

    // Get commit info context
    lastCommit: execSync('git log -1 --oneline', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),

    // Branch information
    currentBranch: execSync('git branch --show-current', {
      encoding: 'utf8',
      maxBuffer: LARGE_BUFFER_SIZE,
    }).trim(),
  };

  // Analyze each modified file individually for better context
  const fileAnalysis = [];
  for (const file of changes.modifiedFiles.slice(0, 10)) {
    // Limit to 10 files and skip binary/large files
    const fileType = getFileType(file);
    if (fileType === 'Code' && !CODE_FILE_EXTENSION_RE.test(file)) {
      continue; // Skip non-code files
    }

    try {
      const fileDiff = execSync(`git diff --staged -U3 -- "${file}"`, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024, // 1MB per file
      });
      fileAnalysis.push({
        file,
        changes: fileDiff.slice(0, 2000), // Limit per file for API
        type: fileType,
      });
    } catch (error) {
      if (
        error.message.includes('ENOBUFS') ||
        error.message.includes('maxBuffer')
      ) {
        // File too large, skip it
        continue;
      }
      console.error(`⚠️  Failed to analyze file ${file}:`, error.message);
    }
  }

  return {
    hasChanges: true,
    summary: {
      totalFiles: changes.modifiedFiles.length,
      stats: changes.diffStats,
      branch: changes.currentBranch,
      lastCommit: changes.lastCommit,
    },
    fileChanges: changes.fileChanges,
    detailedDiff: changes.detailedDiff,
    fileAnalysis,
  };
}

/**
 * Determine file type for better AI analysis
 */
function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const typeMap = {
    tsx: 'React TypeScript Component',
    ts: 'TypeScript',
    jsx: 'React JavaScript Component',
    js: 'JavaScript',
    css: 'Stylesheet',
    json: 'Configuration',
    md: 'Documentation',
    yml: 'Configuration',
    yaml: 'Configuration',
  };
  return typeMap[ext] || 'Code';
}

/**
 * Generate an AI-powered commit message based on git changes
 */
async function generateCommitMessage() {
  try {
    const isDryRun = process.argv.includes('--dry-run');
    // Check if GROQ_API_KEY is set
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === '') {
      console.error('❌ GROQ_API_KEY environment variable is required');
      console.log('💡 Get your API key from: https://console.groq.com/keys');
      console.log('💡 Set it in .env.local file: GROQ_API_KEY="your-key-here"');
      process.exit(1);
    }

    // Initialize Groq client
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // Get comprehensive analysis of all changes
    let changeAnalysis;
    try {
      changeAnalysis = analyzeAllChanges();
    } catch (error) {
      console.error('❌ Failed to analyze changes:', error.message);
      process.exit(1);
    }

    if (!changeAnalysis.hasChanges) {
      console.log('✅ No changes to commit');
      return;
    }

    console.log('🤖 Generating commit message with AI...');

    // Generate commit message using Groq with comprehensive analysis
    const completion = await createCompletionSafe(
      groq,
      buildChatMessages(changeAnalysis),
      'openai/gpt-oss-120b'
    );

    const rawContent = completion?.choices?.[0]?.message?.content
      ?.trim()
      .replace(OPENING_CODE_BLOCK_REGEX, '') // Remove opening code block
      .replace(CLOSING_CODE_BLOCK_REGEX, '') // Remove closing code block
      .trim();

    // Some models put useful text in a nonstandard `reasoning` field
    const reasoning =
      completion?.choices?.[0]?.message?.reasoning?.toString?.().trim?.() ?? '';

    // Build a robust Conventional Commit from either content or reasoning
    let built = buildConventionalCommit(rawContent || '', reasoning || '');

    if (!built) {
      logCompletionFailureAndExit(completion);
    }

    const violations = findCommitViolations(built);
    if (violations.length > 0) {
      const repairCompletion = await createCompletionSafe(
        groq,
        buildRepairMessages(
          rawContent || '',
          reasoning || '',
          built,
          violations
        ),
        'openai/gpt-oss-120b'
      );
      const repairedContent = repairCompletion?.choices?.[0]?.message?.content
        ?.trim()
        .replace(OPENING_CODE_BLOCK_REGEX, '')
        .replace(CLOSING_CODE_BLOCK_REGEX, '')
        .trim();
      const repairedReasoning =
        repairCompletion?.choices?.[0]?.message?.reasoning
          ?.toString?.()
          .trim?.() ?? '';
      built = buildConventionalCommit(
        repairedContent || '',
        repairedReasoning || ''
      );
      if (!built) {
        logCompletionFailureAndExit(repairCompletion);
      }
      const remaining = findCommitViolations(built);
      if (remaining.length > 0) {
        console.error('❌ Commit message failed validation:');
        console.error(formatViolations(remaining));
        process.exit(1);
      }
    }

    console.log(`✨ Generated commit message: "${built.title}"`);
    if (isDryRun) {
      const preview = buildFullMessage(built);
      console.log('\n--- Commit message preview (dry run) ---');
      console.log(preview);
      return;
    }

    // Write full commit message to a temporary file to avoid shell quoting issues
    const tmpFile = path.join(
      os.tmpdir(),
      `commit-msg-${Date.now().toString()}.txt`
    );
    const fullMessage = buildFullMessage(built);
    fs.writeFileSync(tmpFile, fullMessage, 'utf8');

    // Commit using -F to read message from file
    try {
      execSync(`git commit -F "${tmpFile}"`, { encoding: 'utf8' });
      console.log('✅ Changes committed successfully');
    } catch (error) {
      console.error('❌ Failed to commit changes:', error.message);
      process.exit(1);
    }
    // Cleanup temp file (best-effort)
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }

    // Push to remote
    try {
      const currentBranch = execSync('git branch --show-current', {
        encoding: 'utf8',
      }).trim();
      execSync(`git push origin ${currentBranch}`, { encoding: 'utf8' });
      console.log(`🚀 Changes pushed to origin/${currentBranch}`);
    } catch (error) {
      console.error('❌ Failed to push changes:', error.message);
      console.log('💡 You may need to push manually with: git push');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error generating commit message:');
    console.error(formatError(error));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  generateCommitMessage();
}

module.exports = { generateCommitMessage };

// --- helpers ---------------------------------------------------------------

async function createCompletionSafe(groq, messages, model) {
  try {
    return await groq.chat.completions.create({
      messages,
      model,
      temperature: 0.3,
      max_tokens: 16_384,
      reasoning_effort: 'high',
    });
  } catch (error) {
    console.error('❌ Groq API error while creating completion');
    console.error(formatError(error));
    process.exit(1);
  }
}

function buildChatMessages(changeAnalysis) {
  const filesBlock = changeAnalysis.fileAnalysis
    .map((file) => `### ${file.file} (${file.type})\n${file.changes}`)
    .join('\n\n');

  // Estimate token count: ~4 characters per token, leave room for system prompt and other content
  // Target: ~6000 tokens max for user content (leaving ~2000 for system prompt and overhead)
  const MAX_USER_CONTENT_CHARS = 24_000; // ~6000 tokens

  // Build user content
  const summarySection =
    'Summary:\n' +
    `- Modified ${changeAnalysis.summary.totalFiles} files\n` +
    `- Branch: ${changeAnalysis.summary.branch}\n` +
    `- Previous commit: ${changeAnalysis.summary.lastCommit}\n\n`;

  const filesSection = `Files:\n${changeAnalysis.fileChanges}\n\n`;
  const statsSection = `Stats:\n${changeAnalysis.summary.stats}\n\n`;
  const detailsSection = `Details:\n${filesBlock}\n\n`;

  // Calculate remaining space for diff
  const usedChars =
    summarySection.length +
    filesSection.length +
    statsSection.length +
    detailsSection.length;
  const diffMaxChars = Math.max(0, MAX_USER_CONTENT_CHARS - usedChars - 500); // 500 char buffer

  const diffSection =
    diffMaxChars > 0
      ? `Full diff (truncated):\n${changeAnalysis.detailedDiff.slice(0, diffMaxChars)}\n`
      : '';

  const userContent =
    'Analyze these changes and produce a single conventional commit:\n\n' +
    summarySection +
    filesSection +
    statsSection +
    detailsSection +
    diffSection;

  return [
    {
      role: 'system',
      content:
        'You are an AI assistant tasked with generating a git commit message based on the staged code changes provided below. Follow these rules.\n\n' +
        'Commit message format: <type>: <description>\n' +
        'Types (lowercase, required): chore, deprecate, feat, fix, release\n' +
        'Breaking changes: append ! after the type (e.g., fix!: ...)\n' +
        'Description: required, under 256 characters, imperative mood, no trailing period\n' +
        'Body: optional. If present, use exactly three bullets in this order:\n' +
        '- change: ...\n' +
        '- why: ...\n' +
        '- risk: ...\n' +
        'Body lines must be under 256 characters each.\n' +
        'Footer: optional lines after a blank line following the body. Each line must be under 256 characters.\n' +
        'Do not include a scope.\n' +
        'Output only the final commit text, no markdown or code fences.',
    },
    {
      role: 'user',
      content: userContent,
    },
  ];
}

function logCompletionFailureAndExit(completion) {
  console.error(
    '❌ Failed to generate commit message. Raw completion payload:'
  );
  const raw = safeStringify(completion);
  console.error(
    raw.length > 10_000 ? `${raw.slice(0, 10_000)}\n...[truncated]...` : raw
  );
  if (completion?.usage) {
    console.error('Usage:', safeStringify(completion.usage));
  }
  if (completion?.choices) {
    console.error(
      'Choices meta:',
      safeStringify(
        completion.choices.map((c) => ({
          finish_reason: c.finish_reason,
          index: c.index,
        }))
      )
    );
  }
  process.exit(1);
}

// Extract a Conventional Commit from possibly noisy model output
const TITLE_RE =
  /^(?<type>chore|deprecate|feat|fix|release)(?<breaking>!)?:\s*(?<subject>.+)$/gim;
const TITLE_VALIDATION_RE = /^(chore|deprecate|feat|fix|release)!?:\s+/;

function buildConventionalCommit(content, reasoning) {
  const text = sanitizeText([content, reasoning].filter(Boolean).join('\n'));
  if (!text.trim()) {
    return null;
  }

  let titleMatch = null;
  for (const m of text.matchAll(TITLE_RE)) {
    if (m?.groups?.subject) {
      titleMatch = m;
      break;
    }
  }

  if (!titleMatch) {
    return null;
  }

  const { type } = titleMatch.groups;
  const breaking = titleMatch.groups.breaking ? '!' : '';
  let subject = titleMatch.groups.subject.trim();
  subject = stripWrappingQuotes(subject);

  const title = `${type}${breaking}: ${subject}`;

  const { body, footer } = buildStructuredBody(text);

  return { title, body, footer };
}

function sanitizeText(s) {
  if (!s) {
    return '';
  }
  return s
    .replace(OPENING_CODE_BLOCK_REGEX, '')
    .replace(CLOSING_CODE_BLOCK_REGEX, '')
    .replace(/`/g, '') // remove inline backticks to prevent shell substitutions in logs
    .trim();
}

function stripWrappingQuotes(s) {
  if (!s) {
    return s;
  }
  // remove wrapping single or double quotes if present
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function buildStructuredBody(text) {
  const lines = text.split(NEWLINE_SPLIT_RE);
  const extracted = {
    change: '',
    why: '',
    risk: '',
  };
  const footerLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const withoutBullet = BULLET_LINE_RE.test(trimmed)
      ? trimmed.replace(BULLET_LINE_RE, '')
      : trimmed;
    const lower = withoutBullet.toLowerCase();
    if (lower.startsWith('change:')) {
      extracted.change = withoutBullet.slice('change:'.length).trim();
    } else if (lower.startsWith('why:')) {
      extracted.why = withoutBullet.slice('why:'.length).trim();
    } else if (lower.startsWith('risk:')) {
      extracted.risk = withoutBullet.slice('risk:'.length).trim();
    } else if (lower.startsWith('testing:') && !extracted.risk) {
      extracted.risk = `testing: ${withoutBullet.slice('testing:'.length).trim()}`;
    } else if (
      withoutBullet.startsWith('Footer:') ||
      withoutBullet.startsWith('Refs:') ||
      withoutBullet.startsWith('Ref:') ||
      withoutBullet.startsWith('Fixes:') ||
      withoutBullet.startsWith('BREAKING CHANGE:')
    ) {
      footerLines.push(withoutBullet);
    }
  }

  const hasBody =
    Boolean(extracted.change) ||
    Boolean(extracted.why) ||
    Boolean(extracted.risk);
  if (!hasBody && footerLines.length === 0) {
    return { body: '', footer: '' };
  }
  const change = extracted.change || '(not provided)';
  const why = extracted.why || '(not provided)';
  const risk = extracted.risk || '(not provided)';

  const body = [`- change: ${change}`, `- why: ${why}`, `- risk: ${risk}`].join(
    '\n'
  );
  const footer = footerLines.join('\n');
  return { body, footer };
}

function buildRepairMessages(content, reasoning, built, violations) {
  const issueList = violations.map((v) => `- ${v}`).join('\n');
  const raw = sanitizeText([content, reasoning].filter(Boolean).join('\n'));
  return [
    {
      role: 'system',
      content:
        'You fix commit messages to match these rules exactly.\n\n' +
        'Commit message format: <type>: <description>\n' +
        'Types (lowercase, required): chore, deprecate, feat, fix, release\n' +
        'Breaking changes: append ! after the type (e.g., fix!: ...)\n' +
        'Description: required, under 256 characters, imperative mood, no trailing period\n' +
        'Body: optional. If present, use exactly three bullets in this order:\n' +
        '- change: ...\n' +
        '- why: ...\n' +
        '- risk: ...\n' +
        'Body lines must be under 256 characters each.\n' +
        'Footer: optional lines after a blank line following the body. Each line must be under 256 characters.\n' +
        'Do not include a scope.\n' +
        'Output only the final commit text, no markdown or code fences.',
    },
    {
      role: 'user',
      content: [
        'Violations:',
        issueList,
        '',
        'Current commit:',
        buildFullMessage(built),
        '',
        'Original model output (for context):',
        raw || '(not provided)',
      ].join('\n'),
    },
  ];
}

function findCommitViolations(built) {
  const violations = [];
  const title = built.title || '';
  if (!title) {
    violations.push('title is missing');
  }
  if (title.length > 256) {
    violations.push('title exceeds 256 characters');
  }
  if (!TITLE_VALIDATION_RE.test(title)) {
    violations.push('title does not match required type format');
  }
  if (title.includes('(')) {
    violations.push('title includes a scope');
  }
  const subject = title.split(':').slice(1).join(':').trim();
  if (!subject) {
    violations.push('description is empty');
  }
  if (subject.endsWith('.')) {
    violations.push('description ends with a period');
  }

  if (built.body) {
    const lines = built.body.split(NEWLINE_SPLIT_RE).filter(Boolean);
    if (lines.length !== 3) {
      violations.push('body must have exactly three bullets');
    }
    const expectedPrefixes = ['- change:', '- why:', '- risk:'];
    for (const [index, line] of lines.entries()) {
      if (line.length > 256) {
        violations.push('body line exceeds 256 characters');
        break;
      }
      const expected = expectedPrefixes[index];
      if (!(expected && line.startsWith(expected))) {
        violations.push('body bullets must be change/why/risk in order');
        break;
      }
    }
  }

  if (built.footer) {
    const footerLines = built.footer.split(NEWLINE_SPLIT_RE).filter(Boolean);
    for (const line of footerLines) {
      if (line.length > 256) {
        violations.push('footer line exceeds 256 characters');
        break;
      }
    }
  }

  return violations;
}

function formatViolations(violations) {
  return violations.map((violation) => `- ${violation}`).join('\n');
}

function buildFullMessage(built) {
  const sections = [built.title];
  if (built.body) {
    sections.push(built.body);
  }
  if (built.footer) {
    sections.push(built.footer);
  }
  return sections.join('\n\n');
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
    // Fallback to best-effort string conversion when JSON serialization fails
    try {
      return String(obj);
    } catch {
      return '[Unstringifiable]';
    }
  }
}

function formatError(error) {
  // Try to include as much structured information as possible
  const plain = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    // include standard fields: name, message, stack, cause, status, code, response
    // avoid huge nested response bodies without control
    if (key === 'response' && error.response) {
      plain.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers || undefined,
        data: error.response.data || undefined,
      };
    } else {
      try {
        // Copy other enumerable properties safely
        // eslint-disable-next-line no-param-reassign
        plain[key] = error[key];
      } catch {
        // ignore non-readable props
      }
    }
  }
  return safeStringify(plain);
}

```

Fixed the lint issue by moving the title validation regex to top-level. `scripts/generate-commit-message.js` now passes lint.

You can rerun:
`npm run staging:pr`

---

**User**

how our staging pr looks like this 

Release summary
Unknown

Notable user-facing changes
Unknown

Risk / breaking changes
Unknown

QA / verification
Unknown

Operational notes / rollout
Unknown

Follow-ups / TODOs
Unknown

go look at it yourself. This is a problem. 

---

**Cursor**

```javascript
#!/usr/bin/env node

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

function buildPass3Messages(pass2Summaries, branch, base, issue, pass1Text, commitTitles) {
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

function buildReleaseMessages(pass2Summaries, branch, base, issue, pass1Text, commitTitles) {
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
    } else if (current === '--mode' && argv[i + 1]) {
      args.mode = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

async function main() {
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === '') {
    fail('GROQ_API_KEY environment variable is required');
    step('Set it in .env.local: GROQ_API_KEY="your-key-here"');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
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
    step('Running npm run format before PR creation...');
    try {
      execSync('npm run format', { encoding: 'utf8', stdio: 'inherit' });
    } catch (_error) {
      fail('npm run format failed; fix formatting errors first.');
      process.exit(1);
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
    finalSummary = retry?.choices?.[0]?.message?.content?.trim() || finalSummary;
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

if (require.main === module) {
  main();
}

```

```javascript
#!/usr/bin/env node

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

function buildPass3Messages(pass2Summaries, branch, base, issue, pass1Text, commitTitles) {
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

function buildReleaseMessages(pass2Summaries, branch, base, issue, pass1Text, commitTitles) {
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
  const lines = trimmed.split(/\r?\n/);
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
    } else if (current === '--mode' && argv[i + 1]) {
      args.mode = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

async function main() {
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === '') {
    fail('GROQ_API_KEY environment variable is required');
    step('Set it in .env.local: GROQ_API_KEY="your-key-here"');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
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
    step('Running npm run format before PR creation...');
    try {
      execSync('npm run format', { encoding: 'utf8', stdio: 'inherit' });
    } catch (_error) {
      fail('npm run format failed; fix formatting errors first.');
      process.exit(1);
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
    finalSummary = retry?.choices?.[0]?.message?.content?.trim() || finalSummary;
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

if (require.main === module) {
  main();
}

```

I pulled the current PR summary files — they really are all “Unknown.” I’ve fixed the generator so it **always includes additional context** (Pass 1 snapshot + commit titles) and **retries** if the release summary still comes back as all “Unknown.”

What I changed in `scripts/generate-pr-summary.js`:
- Pass 3 now includes:
  - condensed commit summaries **plus**
  - the Pass 1 5Cs snapshot
  - a list of commit titles
- If the release summary still returns all “Unknown,” it **retries** with more commit titles and a fallback note if Pass 2 is empty.

This should prevent the blank/Unknown release summary.

You can rerun your staging PR command now:
```
npm run staging:pr
```

If you want, I can also run it for you.

```plaintext
npm run staging:pr
```

---

**User**

@bash (978-1018) fix this first

---

**Cursor**

```javascript
#!/usr/bin/env node

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
    } else if (current === '--mode' && argv[i + 1]) {
      args.mode = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

async function main() {
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === '') {
    fail('GROQ_API_KEY environment variable is required');
    step('Set it in .env.local: GROQ_API_KEY="your-key-here"');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
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
    step('Running npm run format before PR creation...');
    try {
      execSync('npm run format', { encoding: 'utf8', stdio: 'inherit' });
    } catch (_error) {
      fail('npm run format failed; fix formatting errors first.');
      process.exit(1);
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

if (require.main === module) {
  main();
}

```

Fixed the lint issue by moving the newline regex to top-level. `scripts/generate-pr-summary.js` should now pass format.

Rerun:
`npm run staging:pr`

---

**User**

okay now lets work on getting this into its own npm that i can then install into other repos. 

Lets continue talking about this to see how we can wire this up. 

is this one below unscoped or scoped? 

skip to:contentpackage searchsign in
❤
Pro
Teams
Pricing
Documentation
npm
Search packages
Search
ralphy-cli
4.0.1 • Public • Published 7 hours ago
Ralphy
Autonomous AI coding loop. Runs AI agents on tasks until done.

Install
npm install -g ralphy-cli
Quick Start
# Single task
ralphy "add login button"

# Work through a task list
ralphy --prd PRD.md
Two Modes
Single task - just tell it what to do:

ralphy "add dark mode"
ralphy "fix the auth bug"
Task list - work through a PRD:

ralphy              # uses PRD.md
ralphy --prd tasks.md
Project Config
Optional. Stores rules the AI must follow.

ralphy --init              # auto-detects project settings
ralphy --config            # view config
ralphy --add-rule "use TypeScript strict mode"
Creates .ralphy/config.yaml:

project:
  name: "my-app"
  language: "TypeScript"
  framework: "Next.js"

commands:
  test: "npm test"
  lint: "npm run lint"
  build: "npm run build"

rules:
  - "use server actions not API routes"
  - "follow error pattern in src/utils/errors.ts"

boundaries:
  never_touch:
    - "src/legacy/**"
    - "*.lock"
AI Engines
ralphy              # Claude Code (default)
ralphy --opencode   # OpenCode
ralphy --cursor     # Cursor
ralphy --codex      # Codex
ralphy --qwen       # Qwen-Code
ralphy --droid      # Factory Droid
Task Sources
Markdown (default):

ralphy --prd PRD.md
YAML:

ralphy --yaml tasks.yaml
GitHub Issues:

ralphy --github owner/repo
ralphy --github owner/repo --github-label "ready"
Parallel Execution
ralphy --parallel                  # 3 agents default
ralphy --parallel --max-parallel 5 # 5 agents
Each agent gets isolated worktree + branch. Without --create-pr: auto-merges back. With --create-pr: keeps branches, creates PRs.

Branch Workflow
ralphy --branch-per-task                # branch per task
ralphy --branch-per-task --create-pr    # + create PRs
ralphy --branch-per-task --draft-pr     # + draft PRs
Options
Flag	What it does
--prd FILE	task file (default: PRD.md)
--yaml FILE	YAML task file
--github REPO	use GitHub issues
--github-label TAG	filter issues by label
--parallel	run parallel
--max-parallel N	max agents (default: 3)
--branch-per-task	branch per task
--create-pr	create PRs
--draft-pr	draft PRs
--no-tests	skip tests
--no-lint	skip lint
--fast	skip tests + lint
--no-commit	don't auto-commit
--max-iterations N	stop after N tasks
--max-retries N	retries per task (default: 3)
--dry-run	preview only
-v, --verbose	debug output
--init	setup .ralphy/ config
--config	show config
--add-rule "rule"	add rule to config
Requirements
Node.js 18+ or Bun
AI CLI: Claude Code, OpenCode, Cursor, Codex, Qwen-Code, or Factory Droid
gh (optional, for GitHub issues / --create-pr)
Links
GitHub
Bash script version
License
MIT

Readme
Keywords
aicodingautomationclaudeopencodecursorcodexqwendroidcli
Package Sidebar
Install
npm i ralphy-cli


Repository
github.com/michaelshimeles/ralphy

Homepage
github.com/michaelshimeles/ralphy#readme

Version
4.0.1

License
MIT

Unpacked Size
445 MB

Total Files
8

Last publish
7 hours ago

Collaborators
michaelshimeles
Try on RunKit
Report malware
Footer
Support
Help
Advisories
Status
Contact npm
Company
About
Blog
Press
Terms & Policies
Policies
Terms of Use
Code of Conduct
Privacy
Viewing ralphy-cli version 4.0.1 

---

**Cursor**

Got it on a single CLI package.

One more: where should it be published?  
Please pick one:

- Public npm (unscoped, new name)  
- Public npm under a scope (e.g., `@yourname/tool`)  
- Private npm package

That package (`ralphy-cli`) is **unscoped**. Scoped packages look like `@scope/name`.

Thanks for the choice — we’ll go with **unscoped public** for your CLI.

If you want, I can move us into a concrete plan for the new repo structure, CLI command name, and how we’ll wire in the two commands (commit + PR summary).

---

**User**

okay lets do it continue

i want the name to represent something to both pr and commits 

---

**Cursor**

Great — we’ll use **`changelogger`** as the unscoped public package and CLI name.

I’ll update the plan accordingly and then proceed with the packaging steps.

---

**User**

ok continue

---

**Cursor**

```markdown
---
name: Publish Npm CLI
overview: ""
todos: []
---

# Publish Npm CLI

## Assumptions

- Use an unscoped public package name `changelogger` with CLI command `changelogger` (verify availability and adjust if taken).
- Config remains env-only via `.env.local` (no config file).

## Plan

- Create a new repo structure for the CLI (e.g., `packages/changelogger` or a sibling repo) with a `package.json` exposing a `bin` entry for `changelogger`.
- Build a single CLI entry that exposes subcommands:
    - `changelogger commit` (wraps logic from `scripts/generate-commit-message.js`)
    - `changelogger pr` (wraps logic from `scripts/generate-pr-summary.js`)
- Refactor the two scripts into shared modules under `src/` so the CLI and tests can import them cleanly.
- Preserve current behavior, flags, and environment handling; add minimal CLI help/usage output.
- Add README with install/usage examples and required env (`GROQ_API_KEY`) and optional env vars (like `PR_SUMMARY_BASE`, `PR_SUMMARY_OUT`).
- Validate by running the CLI locally against this repo (dry-run for commit, summary for PR), then prep for publish.

## Key Files

- `package.json` (bin entry + dependencies)
- `src/cli.ts` (command router)
- `src/commit.ts` (commit generator logic from `scripts/generate-commit-message.js`)
- `src/pr-summary.ts` (PR summary logic from `scripts/generate-pr-summary.js`)
- `README.md` (usage + env configuration)

## Implementation Todos

- id: check-name

content: Verify `changelogger` availability on npm, adjust name if needed.

- id: scaffold-cli

content: Create new package repo with `bin` entry and CLI command structure.

- id: move-commit

content: Port commit message generator into `src/commit.ts` and expose CLI subcommand.

- id: move-pr

content: Port PR summary generator into `src/pr-summary.ts` and expose CLI subcommand.

- id: docs

content: Write README with install/usage/env vars and examples.

- id: validate

content: Run local CLI tests (commit dry-run, PR summary generation).
```

Here’s the updated plan with the name **`changelogger`**. If this looks good, say “approve” and I’ll start executing.

# Publish Npm CLI

## Assumptions
- Use an unscoped public package name `changelogger` with CLI command `changelogger` (verify availability and adjust if taken).
- Config remains env-only via `.env.local` (no config file).

## Plan
- Create a new repo structure for the CLI (e.g., `packages/changelogger` or a sibling repo) with a `package.json` exposing a `bin` entry for `changelogger`.
- Build a single CLI entry that exposes subcommands:
  - `changelogger commit` (wraps logic from `scripts/generate-commit-message.js`)
  - `changelogger pr` (wraps logic from `scripts/generate-pr-summary.js`)
- Refactor the two scripts into shared modules under `src/` so the CLI and tests can import them cleanly.
- Preserve current behavior, flags, and environment handling; add minimal CLI help/usage output.
- Add README with install/usage examples and required env (`GROQ_API_KEY`) and optional env vars (like `PR_SUMMARY_BASE`, `PR_SUMMARY_OUT`).
- Validate by running the CLI locally against this repo (dry-run for commit, summary for PR), then prep for publish.

## Key Files
- `package.json` (bin entry + dependencies)
- `src/cli.ts` (command router)
- `src/commit.ts` (commit generator logic from `scripts/generate-commit-message.js`)
- `src/pr-summary.ts` (PR summary logic from `scripts/generate-pr-summary.js`)
- `README.md` (usage + env configuration)

## Implementation Todos
- Verify `changelogger` availability on npm, adjust name if needed.
- Create new package repo with `bin` entry and CLI command structure.
- Port commit message generator into `src/commit.ts` and expose CLI subcommand.
- Port PR summary generator into `src/pr-summary.ts` and expose CLI subcommand.
- Write README with install/usage/env vars and examples.
- Run local CLI tests (commit dry-run, PR summary generation).

---

**User**

okay go ahead and do it. 

---

**Cursor**

`changelogger` is already taken on npm (there’s a published package).  
Pick a new unscoped name and I’ll proceed. Options:

1) `changelogger-cli`  
2) `changelogger-tool`  
3) `prcommit-cli`  
4) `changescribe`  
5) your own name

---

**User**

lets do changescribe

---

**Cursor**

`changescribe` is also already taken on npm.

Pick another unscoped name and I’ll proceed. Suggestions:
1) `changescribe-cli`
2) `changescribe-tool`
3) `prcommit-cli`
4) `reviewscribe`
5) your own name

---

**User**

what about cli-changescribe

---

**Cursor**

Got it wired up as a standalone npm CLI in `/Users/andrewulloa/cli-changescribe`.

What’s in place
- `package.json` with name `cli-changescribe` and bin `changescribe`
- `bin/changescribe.js` dispatches `commit` and `pr`
- `src/commit.js` + `src/pr-summary.js` ported and argv-aware
- `README.md` with install + usage + env vars
- Dependencies installed (`dotenv`, `groq-sdk`)
- CLI help runs successfully

Key paths
- `cli-changescribe/package.json`
- `cli-changescribe/bin/changescribe.js`
- `cli-changescribe/src/commit.js`
- `cli-changescribe/src/pr-summary.js`
- `cli-changescribe/README.md`

Next steps (you can tell me which you want)
1. Initialize git + create GitHub repo
2. Publish to npm (`npm login`, then `npm publish --access public`)
3. (Optional) I can add a `changescribe` README badge, examples, or a versioning workflow

If you want, I can proceed with the git init + first commit and/or npm publish steps.

