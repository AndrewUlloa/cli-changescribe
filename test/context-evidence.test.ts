import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

interface ContextEvidenceModule {
  loadContextEvidence(
    paths: readonly string[],
    options?: { cwd?: string; knownSecrets?: readonly string[] },
  ): ReadonlyArray<{
    id: string;
    kind: 'intent';
    basis: 'provided';
    source: { kind: 'context-file'; locator: string };
    payload: { text: string };
  }>;
}

const contextEvidence: ContextEvidenceModule = require(
  '../dist/context-evidence.js'
);

function fixture(context: TestContext): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'diffwright-context-evidence-'),
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('loads bounded regular files as source-agnostic provided evidence', (context) => {
  const directory = fixture(context);
  fs.mkdirSync(path.join(directory, 'notes'));
  fs.writeFileSync(
    path.join(directory, 'notes', 'intent.txt'),
    'Preserve the exact staged-index contract.\n',
  );

  const items = contextEvidence.loadContextEvidence(['notes/intent.txt'], {
    cwd: directory,
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'intent');
  assert.equal(items[0].basis, 'provided');
  assert.equal(items[0].source.kind, 'context-file');
  assert.equal(items[0].source.locator, 'notes/intent.txt');
  assert.match(items[0].payload.text, /staged-index contract/);
  assert.equal(Object.isFrozen(items), true);
  assert.equal(Object.isFrozen(items[0]), true);
});

test('redacts configured credentials before context enters evidence', (context) => {
  const directory = fixture(context);
  const secret = 'gsk_context_secret';
  fs.writeFileSync(
    path.join(directory, 'intent.txt'),
    `Use the configured provider without exposing ${secret}.\n`,
  );

  const items = contextEvidence.loadContextEvidence(['intent.txt'], {
    cwd: directory,
    knownSecrets: [secret],
  });

  assert.doesNotMatch(JSON.stringify(items), new RegExp(secret));
  assert.match(items[0].payload.text, /\[REDACTED\]/);
});

test('rejects missing, duplicate, absolute, escaping, and control-character paths', (context) => {
  const directory = fixture(context);
  fs.writeFileSync(path.join(directory, 'intent.txt'), 'valid\n');

  for (const paths of [
    ['missing.txt'],
    ['intent.txt', 'intent.txt'],
    [path.join(directory, 'intent.txt')],
    ['../outside.txt'],
    ['bad\npath.txt'],
  ]) {
    assert.throws(
      () => contextEvidence.loadContextEvidence(paths, { cwd: directory }),
      /context file/i,
    );
  }
});

test('refuses symlinks, hardlinks, non-files, and oversized input', (context) => {
  const directory = fixture(context);
  const source = path.join(directory, 'source.txt');
  fs.writeFileSync(source, 'provided intent\n');
  fs.symlinkSync(source, path.join(directory, 'link.txt'));
  fs.linkSync(source, path.join(directory, 'hardlink.txt'));
  fs.mkdirSync(path.join(directory, 'folder'));
  fs.writeFileSync(path.join(directory, 'large.txt'), 'x'.repeat(65 * 1024));

  for (const target of ['link.txt', 'hardlink.txt', 'folder', 'large.txt']) {
    assert.throws(
      () => contextEvidence.loadContextEvidence([target], { cwd: directory }),
      /context file/i,
    );
  }
});

test('rejects invalid UTF-8 without echoing file contents', (context) => {
  const directory = fixture(context);
  const secretBytes = Buffer.from([0x67, 0x73, 0x6b, 0xff, 0x00]);
  fs.writeFileSync(path.join(directory, 'invalid.txt'), secretBytes);

  let message = '';
  try {
    contextEvidence.loadContextEvidence(['invalid.txt'], { cwd: directory });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /context file/i);
  assert.doesNotMatch(message, /gsk/);
});
