import fs from 'node:fs';
import path from 'node:path';

interface PackageJson {
  scripts?: Record<string, string> | null;
  [key: string]: unknown;
}

interface ScriptChanges {
  added: string[];
  migrated: string[];
}

const SCRIPT_MAP: Readonly<Record<string, string>> = {
  commit: 'diffwright commit',
  'pr:summary': 'diffwright pr:summary',
  'feature:pr': 'diffwright feature:pr',
  'staging:pr': 'diffwright staging:pr',
};

const LEGACY_SCRIPT_MAP: Readonly<Record<string, string>> = {
  commit: 'changescribe commit',
  'pr:summary': 'changescribe pr:summary',
  'feature:pr': 'changescribe feature:pr',
  'staging:pr': 'changescribe staging:pr',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readPackageJson(packagePath: string): PackageJson {
  try {
    const raw = fs.readFileSync(packagePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('package.json must contain a JSON object');
    }
    return parsed as PackageJson;
  } catch (error) {
    throw new Error(`Failed to read ${packagePath}: ${errorMessage(error)}`);
  }
}

function writePackageJson(packagePath: string, data: PackageJson): void {
  const contents = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(packagePath, contents, 'utf8');
}

function ensureScripts(pkg: PackageJson): ScriptChanges {
  const scripts = pkg.scripts ?? {};
  const added: string[] = [];
  const migrated: string[] = [];
  for (const [name, command] of Object.entries(SCRIPT_MAP)) {
    if (!scripts[name]) {
      scripts[name] = command;
      added.push(name);
    } else if (scripts[name] === LEGACY_SCRIPT_MAP[name]) {
      scripts[name] = command;
      migrated.push(name);
    }
  }
  pkg.scripts = scripts;
  return { added, migrated };
}

export function runInit(cwd = process.cwd()): void {
  const packagePath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packagePath)) {
    console.error('❌ No package.json found in the current directory.');
    process.exit(1);
  }

  const pnpmLock = path.join(cwd, 'pnpm-lock.yaml');
  const yarnLock = path.join(cwd, 'yarn.lock');
  if (fs.existsSync(pnpmLock)) {
    console.warn(
      '⚠️  pnpm-lock.yaml detected. Use pnpm to install/update dependencies so the lockfile stays in sync.',
    );
  } else if (fs.existsSync(yarnLock)) {
    console.warn(
      '⚠️  yarn.lock detected. Use yarn to install/update dependencies so the lockfile stays in sync.',
    );
  }

  const pkg = readPackageJson(packagePath);
  const { added, migrated } = ensureScripts(pkg);
  writePackageJson(packagePath, pkg);

  if (added.length === 0 && migrated.length === 0) {
    console.log('✅ Scripts already present; no changes made.');
    return;
  }

  if (added.length > 0) {
    console.log(`✅ Added npm scripts: ${added.join(', ')}`);
  }
  if (migrated.length > 0) {
    console.log(`✅ Migrated npm scripts to Diffwright: ${migrated.join(', ')}`);
  }
}

if (require.main === module) {
  runInit();
}
