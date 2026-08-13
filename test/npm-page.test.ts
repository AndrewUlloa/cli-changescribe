import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

function repositoryFile(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

test('published README leads with product identity and a one-minute quick start', () => {
  const firstSection = readme.slice(0, readme.indexOf('## Providers'));

  assert.match(firstSection, /<div align="center">/);
  assert.match(firstSection, /Turn Git diffs into.*Conventional Commit.*PR summar/is);
  assert.match(firstSection, /npm install -g diffwright/);
  assert.match(firstSection, /## Choose your workflow/);
  assert.match(firstSection, /## Quick start/);
  assert.match(firstSection, /diffwright doctor/);
  assert.match(firstSection, /diffwright commit --dry-run/);
  assert.match(firstSection, /diffwright pr --dry-run/);
});

test('published README preserves provider, command, and security reference material', () => {
  for (const heading of [
    '## Why Diffwright',
    '## Commands',
    '## Providers',
    '## Security and privacy',
    '## Development',
  ]) {
    assert.ok(readme.includes(heading), heading);
  }

  assert.match(readme, /OpenRouter/);
  assert.match(readme, /Vercel AI Gateway/);
  assert.match(readme, /Ollama/);
  assert.match(readme, /stages changes if nothing is staged/i);
  assert.match(readme, /directly from your machine/i);
});

test('published README navigation and project links are npm-safe', () => {
  assert.match(readme, /\[Quick start\]\(#quick-start\)/);
  assert.match(readme, /\[Providers\]\(#providers\)/);
  assert.match(readme, /\[Security\]\(#security-and-privacy\)/);
  assert.match(readme, /https:\/\/github\.com\/AndrewUlloa\/diffwright/);

  const markdownLinks = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(
    (match) => match[1],
  );
  for (const link of markdownLinks) {
    assert.match(link, /^(?:https:\/\/|#)/, link);
  }
});

test('published README states requirements and command side effects precisely', () => {
  for (const pattern of [
    /Node\.js 18/i,
    /Git repository/i,
    /provider.*API key|local.*Ollama/is,
    /commit --dry-run.*calls the provider/is,
    /candidate.*not reused|calls the provider again/is,
    /pr --dry-run.*fetch/is,
    /pr --dry-run.*does not call the provider/is,
    /minimum of three provider requests/i,
    /20,000-character/i,
    /always runs.*npm test.*npm run build/is,
    /existing PR.*does not push/is,
    /\.final\.md/,
    /temporary backup/i,
  ]) {
    assert.match(readme, pattern);
  }
});

test('README links to shipped reference and community documentation', () => {
  const targets = [
    'documentation/cli-reference.md',
    'documentation/providers.md',
    'documentation/troubleshooting.md',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'SUPPORT.md',
  ];
  for (const target of targets) {
    assert.match(
      readme,
      new RegExp(
        `https://github\\.com/AndrewUlloa/diffwright/blob/main/${target.replace('.', '\\.')}`,
      ),
      target,
    );
    assert.equal(fs.existsSync(path.join(repoRoot, target)), true, target);
  }
  assert.doesNotMatch(readme, /\.gif(?:\)|")/i);
});

test('CLI reference documents every supported option and exit behavior', () => {
  const reference = repositoryFile('documentation/cli-reference.md');
  for (const option of [
    '--dry-run',
    '--live',
    '--base',
    '--out',
    '--limit',
    '--issue',
    '--create-pr',
    '--skip-format',
    '--no-format',
    '--mode',
  ]) {
    assert.ok(reference.includes(`\`${option}`), option);
  }
  assert.match(reference, /unknown option.*nonzero/is);
  assert.match(reference, /Closes #/);
});

test('provider and troubleshooting references use actionable official paths', () => {
  const providers = repositoryFile('documentation/providers.md');
  for (const provider of [
    'OpenAI',
    'Anthropic',
    'Google Gemini',
    'xAI',
    'DeepSeek',
    'OpenRouter',
    'Vercel AI Gateway',
    'Cerebras',
    'Groq',
    'Ollama',
  ]) {
    assert.match(providers, new RegExp(provider));
  }
  assert.match(providers, /https:\/\//);

  const troubleshooting = repositoryFile('documentation/troubleshooting.md');
  for (const category of [
    'request_incompatible',
    'authentication',
    'payment_required',
    'not_found',
    'rate_limit',
    'timeout',
    'dns',
    'tls',
    'incompatible_response',
    'provider_error',
    'connection',
  ]) {
    assert.ok(troubleshooting.includes(`\`${category}\``), category);
  }
  assert.match(troubleshooting, /request ID/i);
  assert.match(troubleshooting, /never.*API key/is);
});

test('community files provide contribution, support, and private security paths', () => {
  const security = repositoryFile('SECURITY.md');
  const contributing = repositoryFile('CONTRIBUTING.md');
  const support = repositoryFile('SUPPORT.md');

  assert.match(
    security,
    /github\.com\/AndrewUlloa\/diffwright\/security\/advisories\/new/,
  );
  assert.match(security, /0\.3\.x/);
  assert.match(contributing, /npm run typecheck/);
  assert.match(contributing, /npm test/);
  assert.match(contributing, /security\/advisories\/new/);
  assert.match(support, /github\.com\/AndrewUlloa\/diffwright\/issues/);
  assert.match(support, /Do not.*security.*public issue/is);
});
