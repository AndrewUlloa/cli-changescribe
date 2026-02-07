const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('dotenv');
const { createClient } = require('./provider');

// Load environment variables from .env.local
config({ path: '.env.local' });

// Regex patterns for cleaning commit messages
const OPENING_CODE_BLOCK_REGEX = /^```[\s\S]*?\n/;
const CLOSING_CODE_BLOCK_REGEX = /\n```$/;
const NEWLINE_SPLIT_RE = /\r?\n/;
const BULLET_LINE_RE = /^[-*]\s+/;
const CODE_FILE_EXTENSION_RE = /\.(ts|tsx|js|jsx|css|json|md)$/;
const TITLE_RE =
  /^(?<type>chore|deprecate|feat|fix|release)(?<breaking>!)?:\s*(?<subject>.+)$/gim;
const TITLE_VALIDATION_RE = /^(chore|deprecate|feat|fix|release)!?:\s+/;

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
async function generateCommitMessage(argv) {
  try {
    const isDryRun = argv.includes('--dry-run');

    const providerInfo = createClient();
    if (!providerInfo) {
      console.error('❌ No API key found');
      console.log('💡 Set CEREBRAS_API_KEY or GROQ_API_KEY in .env.local');
      process.exit(1);
    }

    const { client, provider, defaultModel } = providerInfo;
    const model =
      process.env.CHANGESCRIBE_MODEL ||
      process.env.GROQ_MODEL ||
      defaultModel;

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

    console.log(`🤖 Generating commit message with AI (${provider})...`);

    // Generate commit message using LLM with comprehensive analysis
    const completion = await createCompletionSafe(
      client,
      buildChatMessages(changeAnalysis),
      model,
      provider
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
        client,
        buildRepairMessages(rawContent || '', reasoning || '', built, violations),
        model,
        provider
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

async function createCompletionSafe(client, messages, model, provider) {
  try {
    const params = {
      messages,
      model,
      temperature: 0.3,
      max_tokens: 16_384,
    };
    // reasoning_effort is a Groq-specific parameter; omit for other providers
    if (provider === 'groq') {
      params.reasoning_effort = 'high';
    }
    return await client.chat.completions.create(params);
  } catch (error) {
    console.error('❌ LLM API error while creating completion');
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

async function runCommit(argv = process.argv.slice(2)) {
  await generateCommitMessage(argv);
}

if (require.main === module) {
  runCommit();
}

module.exports = { runCommit };
