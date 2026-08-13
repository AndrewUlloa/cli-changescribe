import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const testFiles = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.test.js'))
  .sort()
  .map((file) => path.join(__dirname, file));

if (testFiles.length === 0) {
  throw new Error('No compiled test files found');
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
