import fs from 'node:fs';
import path from 'node:path';

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface PackageCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly display: string;
}

const PACKAGE_MANAGER_NAMES = new Set<PackageManagerName>([
  'npm',
  'pnpm',
  'yarn',
  'bun',
]);

const LOCKFILE_MANAGERS: ReadonlyArray<
  readonly [filename: string, manager: PackageManagerName]
> = [
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

function parseDeclaredManager(declared: unknown): PackageManagerName | null {
  if (declared === undefined) {
    return null;
  }
  if (typeof declared !== 'string') {
    throw new Error('packageManager must be a string when present.');
  }
  const name = declared.split('@', 1)[0] as PackageManagerName;
  if (!PACKAGE_MANAGER_NAMES.has(name)) {
    throw new Error(`Unsupported packageManager declaration: ${declared}`);
  }
  return name;
}

export function detectPackageManager(
  cwd: string,
  declared?: unknown,
): PackageManagerName {
  const declaredManager = parseDeclaredManager(declared);
  const lockManagers = new Set<PackageManagerName>();
  for (const [filename, manager] of LOCKFILE_MANAGERS) {
    if (fs.existsSync(path.join(cwd, filename))) {
      lockManagers.add(manager);
    }
  }

  if (lockManagers.size > 1) {
    throw new Error(
      `Conflicting package manager lockfiles detected: ${[...lockManagers].join(', ')}.`,
    );
  }
  const [lockManager] = lockManagers;
  if (
    declaredManager !== null &&
    lockManager !== undefined &&
    declaredManager !== lockManager
  ) {
    throw new Error(
      `Conflicting package manager evidence: packageManager=${declaredManager}, lockfile=${lockManager}.`,
    );
  }
  return declaredManager ?? lockManager ?? 'npm';
}

function validateVersion(version: string): void {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
    throw new Error('Running Diffwright version is unsafe for installation.');
  }
}

function command(file: string, args: string[]): PackageCommand {
  return Object.freeze({
    file,
    args: Object.freeze([...args]),
    display: [file, ...args].join(' '),
  });
}

export function buildInstallCommand(
  manager: PackageManagerName,
  version: string,
  options: { readonly yarnMajor?: number } = {},
): PackageCommand {
  validateVersion(version);
  const packageSpec = `diffwright@${version}`;
  if (manager === 'npm') {
    return command('npm', [
      'install',
      '--save-dev',
      '--save-exact',
      '--ignore-scripts',
      packageSpec,
    ]);
  }
  if (manager === 'pnpm') {
    return command('pnpm', [
      'add',
      '--save-dev',
      '--save-exact',
      '--ignore-scripts',
      packageSpec,
    ]);
  }
  if (manager === 'yarn') {
    return options.yarnMajor === 1
      ? command('yarn', [
          'add',
          '--dev',
          '--exact',
          '--ignore-scripts',
          packageSpec,
        ])
      : command('yarn', [
          'add',
          '--dev',
          '--exact',
          '--mode=skip-build',
          packageSpec,
        ]);
  }
  return command('bun', [
    'add',
    '--dev',
    '--exact',
    '--ignore-scripts',
    packageSpec,
  ]);
}

export function buildRunScriptCommand(
  manager: PackageManagerName,
  script: string,
): PackageCommand {
  if (!/^[A-Za-z0-9:_-]+$/.test(script)) {
    throw new Error('Unsafe script name.');
  }
  return command(manager, ['run', script]);
}

export function buildLocalVersionCommand(
  manager: PackageManagerName,
): PackageCommand {
  if (manager === 'npm') {
    return command('npm', [
      'exec',
      '--offline',
      '--',
      'diffwright',
      '--version',
    ]);
  }
  if (manager === 'bun') {
    return command('bunx', ['--no-install', 'diffwright', '--version']);
  }
  return manager === 'yarn'
    ? command('yarn', ['exec', '--', 'diffwright', '--version'])
    : command(manager, ['exec', 'diffwright', '--version']);
}

export function hasExactDiffwrightPin(
  cwd: string,
  version: string,
): boolean {
  try {
    validateVersion(version);
    const projectPackagePath = path.join(cwd, 'package.json');
    const projectStat = fs.lstatSync(projectPackagePath);
    if (
      !projectStat.isFile() ||
      projectStat.isSymbolicLink() ||
      projectStat.nlink !== 1
    ) {
      return false;
    }
    const parsed: unknown = JSON.parse(
      fs.readFileSync(projectPackagePath, 'utf8'),
    );
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return false;
    }
    const devDependencies = (parsed as { devDependencies?: unknown })
      .devDependencies;
    return (
      typeof devDependencies === 'object' &&
      devDependencies !== null &&
      !Array.isArray(devDependencies) &&
      (devDependencies as Record<string, unknown>).diffwright === version
    );
  } catch {
    return false;
  }
}

export function isExactLocalDiffwrightInstalled(
  cwd: string,
  version: string,
): boolean {
  try {
    validateVersion(version);
    const packagePath = path.join(
      cwd,
      'node_modules',
      'diffwright',
      'package.json',
    );
    const binPath = path.join(
      cwd,
      'node_modules',
      'diffwright',
      'bin',
      'diffwright.js',
    );
    if (!hasExactDiffwrightPin(cwd, version)) {
      return false;
    }
    if (!fs.existsSync(packagePath) || !fs.existsSync(binPath)) {
      return false;
    }

    const projectRoot = fs.realpathSync(cwd);
    const modulesPath = path.join(cwd, 'node_modules');
    const modulesStat = fs.lstatSync(modulesPath);
    if (!modulesStat.isDirectory() || modulesStat.isSymbolicLink()) {
      return false;
    }
    const modulesRoot = fs.realpathSync(modulesPath);
    if (!modulesRoot.startsWith(`${projectRoot}${path.sep}`)) {
      return false;
    }
    const packageRoot = fs.realpathSync(
      path.join(cwd, 'node_modules', 'diffwright'),
    );
    const realPackagePath = fs.realpathSync(packagePath);
    const realBinPath = fs.realpathSync(binPath);
    const insideModules = (filename: string): boolean =>
      filename === modulesRoot || filename.startsWith(`${modulesRoot}${path.sep}`);
    const insidePackage = (filename: string): boolean =>
      filename === packageRoot || filename.startsWith(`${packageRoot}${path.sep}`);
    if (
      !insideModules(packageRoot) ||
      !insidePackage(realPackagePath) ||
      !insidePackage(realBinPath)
    ) {
      return false;
    }
    const packageStat = fs.statSync(realPackagePath);
    const binStat = fs.lstatSync(binPath);
    if (
      !packageStat.isFile() ||
      !binStat.isFile() ||
      binStat.isSymbolicLink()
    ) {
      return false;
    }
    const parsed: unknown = JSON.parse(
      fs.readFileSync(realPackagePath, 'utf8'),
    );
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return false;
    }
    const manifest = parsed as {
      name?: unknown;
      version?: unknown;
      bin?: unknown;
    };
    return (
      manifest.name === 'diffwright' &&
      manifest.version === version &&
      typeof manifest.bin === 'object' &&
      manifest.bin !== null &&
      !Array.isArray(manifest.bin) &&
      (manifest.bin as Record<string, unknown>).diffwright ===
        'bin/diffwright.js'
    );
  } catch {
    return false;
  }
}
