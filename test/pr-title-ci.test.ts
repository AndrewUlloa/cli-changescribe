import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workflow = fs.readFileSync(
  path.resolve(__dirname, '..', '.github', 'workflows', 'pr-title.yml'),
  'utf8',
);
const ordinaryCi = fs.readFileSync(
  path.resolve(__dirname, '..', '.github', 'workflows', 'ci.yml'),
  'utf8',
);

test('PR-title CI runs trusted base code on every title-changing event', () => {
  assert.match(
    workflow,
    /pull_request_target:\s*\n\s+types:\s*\[opened, edited, synchronize, reopened, ready_for_review\]/,
  );
  assert.match(workflow, /pr-title:\s*\n\s+name: PR title/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.doesNotMatch(workflow, /\n\s+pull_request:\s*(?:\n|$)/);
  assert.match(ordinaryCi, /\n\s+pull_request:\s*(?:\n|$)/);
  assert.doesNotMatch(ordinaryCi, /pull_request_target/);
});

test('PR-title CI pins full trusted base history and fixed event-file input', () => {
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm run build/);
  assert.match(
    workflow,
    /node \.\/bin\/diffwright\.js title-check --event-file "\$GITHUB_EVENT_PATH"/,
  );
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.title/);
  assert.doesNotMatch(workflow, /pull_request\.(?:head|merge)|github\.head_ref/);
});

test('PR-title CI cannot execute pull-request code or access mutation authority', () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /\b(?:write|admin):/);
  assert.doesNotMatch(workflow, /\bgh\s/);
  assert.doesNotMatch(workflow, /actions\/(?:cache|download-artifact|upload-artifact)/);
  assert.doesNotMatch(workflow, /git (?:fetch|checkout)/);
  assert.doesNotMatch(workflow, /DIFFWRIGHT_PROVIDER|GROQ_API_KEY|OPENAI_API_KEY/);
});
