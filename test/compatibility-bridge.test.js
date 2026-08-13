const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const bridgeRoot = path.join(__dirname, '..', 'compat', 'cli-changescribe');

test('legacy package delegates to Diffwright without install hooks', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(bridgeRoot, 'package.json'), 'utf8'),
  );
  const wrapper = readFileSync(
    path.join(bridgeRoot, 'bin', 'changescribe.js'),
    'utf8',
  );

  assert.equal(manifest.name, 'cli-changescribe');
  assert.equal(manifest.version, '0.2.2');
  assert.deepEqual(manifest.bin, {
    changescribe: 'bin/changescribe.js',
  });
  assert.equal(manifest.dependencies.diffwright, '^0.2.1');
  assert.equal(manifest.scripts, undefined);

  assert.match(wrapper, /diffwright\/bin\/diffwright\.js/);
  assert.match(wrapper, /npm uninstall -g cli-changescribe/);
  assert.match(wrapper, /npm install -g diffwright/);
});
