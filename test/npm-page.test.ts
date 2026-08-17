import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
const packageRunnerCommands = [
  'pnpm dlx diffwright@latest init',
  'npx diffwright@latest init',
  'yarn dlx diffwright@latest init',
  'bunx diffwright@latest init',
] as const;
const packageRunnerPreviewCommands = packageRunnerCommands.map(
  (command) => `${command} --dry-run`,
);
const readmeBadgeUrls = [
  'https://img.shields.io/npm/v/diffwright?style=flat-square',
  'https://img.shields.io/npm/dw/diffwright?style=flat-square',
  'https://img.shields.io/github/v/release/AndrewUlloa/diffwright?style=flat-square',
  'https://img.shields.io/github/stars/AndrewUlloa/diffwright?style=flat-square',
  'https://img.shields.io/npm/l/diffwright?style=flat-square',
] as const;

function repositoryFile(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

test('published README leads with product identity and a one-minute quick start', () => {
  const firstSection = readme.slice(0, readme.indexOf('## Providers'));

  assert.match(firstSection, /<div align="center">/);
  assert.match(firstSection, /Compile Git evidence into.*Conventional Commit.*PRs/is);
  assert.match(firstSection, /npm install -g diffwright/);
  assert.match(firstSection, /## Choose your workflow/);
  assert.match(firstSection, /## Quick start/);
  assert.match(firstSection, /diffwright doctor/);
  assert.match(firstSection, /diffwright commit --dry-run/);
  assert.match(firstSection, /diffwright pr --dry-run/);
  for (const badgeUrl of readmeBadgeUrls) {
    assert.ok(firstSection.includes(badgeUrl), badgeUrl);
  }
  assert.doesNotMatch(firstSection, /shieldcn\.dev/);
  for (const command of packageRunnerCommands) {
    assert.ok(firstSection.includes(command), command);
  }
  for (const command of packageRunnerPreviewCommands) {
    assert.ok(firstSection.includes(command), command);
  }
});

test('published README leads setup with the guided init contract', () => {
  assert.match(readme, /package runner.*packageManager.*lockfile/is);
  assert.match(readme, /Yarn Classic.*npx.*yarn\.lock/is);
  assert.match(
    readme,
    /interactive.*provider.*exact model.*credential.*branch.*gate.*Claude.*Codex/is,
  );
  assert.match(readme, /preview.*confirm.*before.*writ/is);
  assert.match(readme, /exact.*local.*development dependency/is);
  assert.match(readme, /self-host.*build.*\.\/bin\/diffwright\.js/is);
  assert.match(readme, /non-TTY.*legacy.*script/is);
  assert.match(readme, /--yes.*never prompts/is);
  assert.match(readme, /--dry-run.*no.*writes.*live.*request/is);
  assert.match(readme, /managed.*CLAUDE\.md.*AGENTS\.md/is);
  assert.match(readme, /offline doctor.*after.*setup/is);
  assert.match(readme, /live.*one.*provider request/is);
});

test('published setup docs advertise every supported package runner', () => {
  for (const file of [
    'README.md',
    'documentation/cli-reference.md',
    'documentation/providers.md',
    'documentation/troubleshooting.md',
  ]) {
    const contents = repositoryFile(file);
    for (const command of packageRunnerCommands) {
      assert.ok(contents.includes(command), `${file}: ${command}`);
    }
    for (const command of packageRunnerPreviewCommands) {
      assert.ok(contents.includes(command), `${file}: ${command}`);
    }
    assert.match(contents, /Yarn Classic.*npx/is, file);
  }
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
  assert.match(readme, /reads only the staged diff/i);
  assert.match(readme, /directly from your machine/i);
  assert.match(readme, /Apache 2\.0 license/);
  assert.match(readme, /0\.4\.4.*MIT license/is);
  assert.doesNotMatch(readme, /MIT license.*blob\/main\/LICENSE/i);
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
    /complete bounded evidence.*structured draft/is,
    /separate terminal critic/i,
    /same resolved provider\s+and model/is,
    /2 normally; up to 5 across bounded draft and primary-claim repairs/i,
    /--timings.*fixed phase names.*no repository paths.*credentials.*telemetry/is,
    /removes critic-.*optional claims.*primary claim.*smaller replacement/is,
    /always runs.*npm test.*npm run build/is,
    /update requires the remote PR head to already equal it/i,
    /\.final\.md/,
    /temporary backup/i,
  ]) {
    assert.match(readme, pattern);
  }
});

test('README links to shipped reference and community documentation', () => {
  const targets = [
    'documentation/cli-reference.md',
    'documentation/diffwrightrc.schema.json',
    'documentation/providers.md',
    'documentation/troubleshooting.md',
    'documentation/releases.md',
    'CHANGELOG.md',
    'NOTICE',
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
    '--context-file',
    '--yes',
    '--provider',
    '--model',
    '--agents',
    '--credential-source',
    '--version',
  ]) {
    assert.ok(reference.includes(`\`${option}`), option);
  }
  assert.match(reference, /unknown commands\/options.*nonzero/is);
  assert.match(reference, /Closes #/);
});

test('repository policy schema is shipped and matches the documented v1/v2 surface', () => {
  const schemaPath = path.join(
    repoRoot,
    'documentation/diffwrightrc.schema.json',
  );
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as {
    $schema?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    $defs?: Record<string, unknown>;
  };

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(schema.required, ['version']);
  assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), [
    '$schema',
    'editorial',
    'merge',
    'pullRequest',
    'title',
    'version',
  ]);
  assert.ok(schema.$defs?.titlePolicy);
  assert.ok(schema.$defs?.editorialPolicy);
  const titlePolicy = schema.$defs?.titlePolicy as {
    properties?: Record<string, unknown>;
  };
  const additionalTypes = titlePolicy.properties?.additionalTypes as {
    not?: { contains?: { enum?: string[] } };
  };
  assert.deepEqual(additionalTypes.not?.contains?.enum, [
    'build',
    'chore',
    'ci',
    'docs',
    'feat',
    'fix',
    'perf',
    'refactor',
    'revert',
    'style',
    'test',
  ]);
  assert.ok(schema.$defs?.pullRequestPolicy);
  assert.ok(schema.$defs?.mergePolicy);
  assert.deepEqual(
    (schema.properties?.version as { enum?: number[] }).enum,
    [1, 2],
  );
  assert.match(readme, /diffwrightrc\.schema\.json/);
  assert.match(
    repositoryFile('documentation/cli-reference.md'),
    /diffwrightrc\.schema\.json/,
  );
  assert.match(
    repositoryFile('documentation/cli-reference.md'),
    /version 2.*issueContext.*template.*strategy.*deleteBranch/is,
  );
  assert.match(readme, /version 2.*issue context.*PR-template.*branch deletion/is);
  assert.match(readme, /Grounding, critic,/i);
  assert.match(readme, /cannot be disabled/i);
  assert.match(
    repositoryFile('documentation/troubleshooting.md'),
    /diffwrightrc\.schema\.json/,
  );
});

test('CLI reference distinguishes guided, legacy, and deterministic init modes', () => {
  const reference = repositoryFile('documentation/cli-reference.md');

  assert.match(reference, /stdin and stdout.*TTY/is);
  assert.match(reference, /no-argument.*non-TTY.*legacy/is);
  assert.match(reference, /--yes.*never prompts/is);
  assert.match(reference, /--dry-run.*no.*install.*write.*live/is);
  assert.match(reference, /exact.*local.*version/is);
  assert.match(reference, /shell.*including.*empty.*override.*\.env\.local/is);
  assert.match(reference, /declin|Ctrl-C/i);
  assert.match(reference, /zero.*write|without writes/i);
  assert.match(reference, /CLAUDE\.md.*AGENTS\.md/is);
  assert.match(reference, /marker-delimited|managed block/i);
  assert.match(reference, /doctor.*offline.*one.*live/is);
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

test('provider and troubleshooting guides cover wizard credentials and recovery', () => {
  const providers = repositoryFile('documentation/providers.md');
  assert.match(providers, /guided.*init.*provider.*exact model/is);
  assert.match(providers, /masked.*echo.*characters/is);
  assert.match(providers, /\.env\.local.*\.gitignore/is);
  assert.match(providers, /shell.*including.*empty.*override.*\.env\.local/is);
  assert.match(providers, /never.*command line/is);

  const troubleshooting = repositoryFile('documentation/troubleshooting.md');
  assert.match(troubleshooting, /## Init setup/i);
  assert.match(troubleshooting, /install.*fail.*rerun.*init/is);
  assert.match(troubleshooting, /never.*global.*fallback/is);
  assert.match(troubleshooting, /offline doctor.*fail.*files.*remain/is);
  assert.match(troubleshooting, /live.*fail.*configuration.*remain/is);
  assert.match(troubleshooting, /Ctrl-C|decline/i);
  assert.match(troubleshooting, /diffwright --version/);
  assert.doesNotMatch(troubleshooting, /--version.*not currently supported/i);
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
