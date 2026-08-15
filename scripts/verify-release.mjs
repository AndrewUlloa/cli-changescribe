import fs from 'node:fs';

const releaseTag = process.env.RELEASE_TAG;
if (!releaseTag || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(releaseTag)) {
  throw new Error('RELEASE_TAG must be a semantic version prefixed with v.');
}

const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lockfile = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const expectedVersion = releaseTag.slice(1);

if (manifest.name !== 'diffwright') {
  throw new Error('package.json must describe the diffwright package.');
}
if (manifest.version !== expectedVersion) {
  throw new Error(
    `Release tag ${releaseTag} does not match package.json version ${String(manifest.version)}.`,
  );
}
if (lockfile.version !== expectedVersion || lockfile.packages?.['']?.version !== expectedVersion) {
  throw new Error(`package-lock.json does not match release tag ${releaseTag}.`);
}

console.log(`Verified Diffwright ${expectedVersion} release metadata.`);
