import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

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
