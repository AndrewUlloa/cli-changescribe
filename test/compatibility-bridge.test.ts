import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

interface BridgeManifest {
  name: string;
  version: string;
  bin: Record<string, string>;
  dependencies: Record<string, string>;
  scripts?: Record<string, string>;
}

const bridgeRoot = path.join(__dirname, '..', 'compat', 'cli-changescribe');

test('legacy package delegates to Diffwright without install hooks', () => {
  const manifest: BridgeManifest = JSON.parse(
    readFileSync(path.join(bridgeRoot, 'package.json'), 'utf8'),
  );
  const wrapper = readFileSync(
    path.join(bridgeRoot, 'bin', 'changescribe.js'),
    'utf8',
  );

  assert.equal(manifest.name, 'cli-changescribe');
  assert.equal(manifest.version, '0.2.4');
  assert.deepEqual(manifest.bin, {
    changescribe: 'bin/changescribe.js',
  });
  assert.equal(manifest.dependencies.diffwright, '>=0.3.0 <1');
  assert.equal(manifest.scripts, undefined);

  assert.match(wrapper, /diffwright\/bin\/diffwright\.js/);
  assert.match(wrapper, /npm uninstall -g cli-changescribe/);
  assert.match(wrapper, /npm install -g diffwright/);
});
