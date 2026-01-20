const fs = require('fs');
const path = require('path');

const SCRIPT_MAP = {
  commit: 'changescribe commit',
  'pr:summary': 'changescribe pr:summary',
  'feature:pr': 'changescribe feature:pr',
  'staging:pr': 'changescribe staging:pr',
};

function readPackageJson(packagePath) {
  try {
    const raw = fs.readFileSync(packagePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to read ${packagePath}: ${error.message}`);
  }
}

function writePackageJson(packagePath, data) {
  const contents = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(packagePath, contents, 'utf8');
}

function ensureScripts(pkg) {
  const scripts = pkg.scripts ?? {};
  const added = [];
  for (const [name, command] of Object.entries(SCRIPT_MAP)) {
    if (!scripts[name]) {
      scripts[name] = command;
      added.push(name);
    }
  }
  pkg.scripts = scripts;
  return added;
}

function runInit(cwd = process.cwd()) {
  const packagePath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packagePath)) {
    console.error('❌ No package.json found in the current directory.');
    process.exit(1);
  }

  const pnpmLock = path.join(cwd, 'pnpm-lock.yaml');
  const yarnLock = path.join(cwd, 'yarn.lock');
  if (fs.existsSync(pnpmLock)) {
    console.warn(
      '⚠️  pnpm-lock.yaml detected. Use pnpm to install/update dependencies so the lockfile stays in sync.'
    );
  } else if (fs.existsSync(yarnLock)) {
    console.warn(
      '⚠️  yarn.lock detected. Use yarn to install/update dependencies so the lockfile stays in sync.'
    );
  }

  const pkg = readPackageJson(packagePath);
  const added = ensureScripts(pkg);
  writePackageJson(packagePath, pkg);

  if (added.length === 0) {
    console.log('✅ Scripts already present; no changes made.');
    return;
  }

  console.log(`✅ Added npm scripts: ${added.join(', ')}`);
}

if (require.main === module) {
  runInit();
}

module.exports = { runInit };
