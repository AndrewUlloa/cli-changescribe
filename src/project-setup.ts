import fs from 'node:fs';
import path from 'node:path';
import {
  buildRunScriptCommand,
  detectPackageManager,
  type PackageManagerName,
} from './package-manager';
import type { CommandRunner } from './subprocess';

const MAX_PACKAGE_BYTES = 1024 * 1024;
const MAX_SCOPE_SUGGESTIONS = 128;
const MAX_SCOPE_DIRECTORY_ENTRIES = 256;
const GATE_NAMES = Object.freeze(['lint', 'typecheck', 'test', 'build'] as const);
const SCOPE_TOKEN_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/u;

export interface ProjectManifest {
  name?: string;
  version?: string;
  bin?: Record<string, string>;
  packageManager?: string;
  scripts?: Record<string, string>;
  workspaces?: readonly string[] | { readonly packages?: readonly string[] };
  [key: string]: unknown;
}

function workspacePatterns(manifest: ProjectManifest): readonly string[] {
  const workspaces = manifest.workspaces;
  if (Array.isArray(workspaces)) {
    return workspaces.filter(
      (value): value is string => typeof value === 'string',
    );
  }
  const packages = workspaces === undefined
    ? undefined
    : (workspaces as { readonly packages?: readonly string[] }).packages;
  return Array.isArray(packages)
    ? packages.filter((value): value is string => typeof value === 'string')
    : [];
}

function addDirectoryScopes(
  root: string,
  scopes: Set<string>,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.length > MAX_SCOPE_DIRECTORY_ENTRIES) {
    return;
  }
  for (const entry of entries) {
    if (
      scopes.size >= MAX_SCOPE_SUGGESTIONS ||
      entry.name.startsWith('.') ||
      entry.isSymbolicLink() ||
      !entry.isDirectory() ||
      !SCOPE_TOKEN_RE.test(entry.name)
    ) {
      continue;
    }
    scopes.add(entry.name);
  }
}

export function discoverScopeSuggestions(options: {
  readonly cwd: string;
  readonly runner: Pick<CommandRunner, 'exec'>;
}): readonly string[] {
  const manifest = readProjectManifest(options.cwd);
  const scopes = new Set<string>();
  for (const pattern of workspacePatterns(manifest)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\/\*$/u.exec(pattern);
    const parent = match?.[1];
    if (!parent || parent === 'node_modules') {
      continue;
    }
    addDirectoryScopes(path.join(options.cwd, parent), scopes);
  }
  addDirectoryScopes(path.join(options.cwd, 'src'), scopes);

  const history = tryGit(options.runner, options.cwd, [
    'log',
    '-n',
    '50',
    '--format=%s',
  ]);
  for (const subject of history?.split(/\r\n|\n|\r/u) ?? []) {
    const scope = /^[a-z][a-z0-9-]{0,31}\(([a-z0-9][a-z0-9._/-]{0,63})\)!?:/u
      .exec(subject)?.[1];
    if (scope && scopes.size < MAX_SCOPE_SUGGESTIONS) {
      scopes.add(scope);
    }
  }
  return Object.freeze([...scopes].sort((left, right) => left.localeCompare(right)));
}

export interface ProjectDiscovery {
  readonly manager: PackageManagerName;
  readonly defaultBranch: string;
  readonly hasStaging: boolean;
  readonly gates: readonly string[];
  readonly selfHosted: boolean;
}

export interface ScriptPlan {
  readonly scripts: Readonly<Record<string, string>>;
  readonly effective: Readonly<{
    commit: string;
    summary: string;
    featurePr: string;
    stagingPr: string | null;
  }>;
  readonly changes: ReadonlyArray<Readonly<{ name: string; action: string }>>;
}

export function readProjectManifest(cwd: string): ProjectManifest {
  const packagePath = path.join(cwd, 'package.json');
  const stat = fs.lstatSync(packagePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
    throw new Error('package.json must be a regular, unlinked file.');
  }
  if (stat.size > MAX_PACKAGE_BYTES) {
    throw new Error('package.json is too large to initialize safely.');
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json must contain a JSON object.');
  }
  const manifest = parsed as ProjectManifest;
  if (manifest.scripts !== undefined) {
    if (
      typeof manifest.scripts !== 'object' ||
      manifest.scripts === null ||
      Array.isArray(manifest.scripts) ||
      Object.values(manifest.scripts).some((value) => typeof value !== 'string')
    ) {
      throw new Error('package.json scripts must be string values.');
    }
  }
  return manifest;
}

function tryGit(
  runner: Pick<CommandRunner, 'exec'>,
  cwd: string,
  args: readonly string[],
): string | null {
  try {
    return runner.exec('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function safeBranchName(branch: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) &&
    !branch.startsWith('-') &&
    !branch.endsWith('.') &&
    !branch.endsWith('/') &&
    !branch.includes('..') &&
    !branch.includes('//') &&
    !branch.includes('@{') &&
    !branch.includes('\\')
  );
}

function discoverDefaultBranch(
  runner: CommandRunner,
  cwd: string,
): string {
  const originHead = tryGit(runner, cwd, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  if (originHead?.startsWith('origin/')) {
    const branch = originHead.slice('origin/'.length);
    if (safeBranchName(branch)) {
      return branch;
    }
  }
  for (const branch of ['main', 'master']) {
    const local = tryGit(runner, cwd, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${branch}`,
      ]);
    const remote = local === null
      ? tryGit(runner, cwd, [
          'show-ref',
          '--verify',
          '--quiet',
          `refs/remotes/origin/${branch}`,
        ])
      : null;
    if (local !== null || remote !== null) {
      return branch;
    }
  }
  const current = tryGit(runner, cwd, ['branch', '--show-current']);
  return current && safeBranchName(current) ? current : 'main';
}

function sameDirectory(left: string, right: string): boolean {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

function isValidatedSelfHost(
  cwd: string,
  manifest: ProjectManifest,
  runningPackageRoot: string,
  runningVersion: string,
): boolean {
  if (
    !sameDirectory(cwd, runningPackageRoot) ||
    manifest.name !== 'diffwright' ||
    manifest.version !== runningVersion ||
    manifest.bin?.diffwright !== 'bin/diffwright.js'
  ) {
    return false;
  }
  const binPath = path.join(cwd, 'bin', 'diffwright.js');
  try {
    const stat = fs.lstatSync(binPath);
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1;
  } catch {
    return false;
  }
}

export function discoverProject(options: {
  readonly cwd: string;
  readonly runner: CommandRunner;
  readonly runningPackageRoot: string;
  readonly runningVersion: string;
}): ProjectDiscovery {
  const manifest = readProjectManifest(options.cwd);
  const manager = detectPackageManager(
    options.cwd,
    manifest.packageManager,
  );
  tryGit(options.runner, options.cwd, ['rev-parse', '--show-toplevel']);
  const defaultBranch = discoverDefaultBranch(options.runner, options.cwd);
  const hasStaging =
    tryGit(options.runner, options.cwd, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/heads/staging',
    ]) !== null ||
    tryGit(options.runner, options.cwd, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/remotes/origin/staging',
    ]) !== null;
  const scripts = manifest.scripts ?? {};
  const gates = GATE_NAMES.filter((name) => typeof scripts[name] === 'string');
  return Object.freeze({
    manager,
    defaultBranch,
    hasStaging,
    gates: Object.freeze([...gates]),
    selfHosted: isValidatedSelfHost(
      options.cwd,
      manifest,
      options.runningPackageRoot,
      options.runningVersion,
    ),
  });
}

const MANAGED_SCRIPT_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  commit: new Set([
    'diffwright commit',
    'diffwright commit --all',
    'changescribe commit',
  ]),
  'pr:summary': new Set(['diffwright pr:summary', 'changescribe pr:summary']),
  'feature:pr': new Set([
    'diffwright feature:pr',
    'diffwright feature:pr --yes',
    'changescribe feature:pr',
    'changescribe feature:pr --yes',
  ]),
  'staging:pr': new Set([
    'diffwright staging:pr',
    'diffwright staging:pr --yes',
    'changescribe staging:pr',
    'changescribe staging:pr --yes',
  ]),
};

const MANAGED_GATE_PREFIX =
  '(?:(?:npm|pnpm|yarn|bun) run (?:lint|typecheck|test|build) && )*';
const MANAGED_CLI =
  '(?:diffwright|node \\.\\/bin\\/diffwright\\.js|node \\.\\/node_modules\\/diffwright\\/bin\\/diffwright\\.js|yarn exec (?:-- )?diffwright)';
const SAFE_GENERATED_BRANCH = '[A-Za-z0-9][A-Za-z0-9._/-]*';

function isStrictGeneratedScript(name: string, value: string): boolean {
  const suffixes: Readonly<Record<string, string>> = {
    commit: 'commit(?: --all)?',
    'pr:summary': '(?:pr|pr:summary)',
    'feature:pr':
      `pr --base ${SAFE_GENERATED_BRANCH} --create-pr(?: --yes)? --mode feature`,
    'staging:pr':
      `pr --base ${SAFE_GENERATED_BRANCH} --create-pr(?: --yes)? --mode release`,
  };
  const suffix = suffixes[name];
  return suffix !== undefined && new RegExp(
    `^${MANAGED_GATE_PREFIX}${MANAGED_CLI} ${suffix}$`,
  ).test(value);
}

function setManagedScript(
  scripts: Record<string, string>,
  preferredName: string,
  desiredValue: string,
  changes: Array<{ name: string; action: string }>,
): string {
  const existing = scripts[preferredName];
  if (
    existing === undefined ||
    existing === desiredValue ||
    (MANAGED_SCRIPT_VALUES[preferredName]?.has(existing) ?? false) ||
    isStrictGeneratedScript(preferredName, existing)
  ) {
    scripts[preferredName] = desiredValue;
    if (existing !== desiredValue) {
      changes.push({
        name: preferredName,
        action: existing === undefined ? 'add' : 'migrate',
      });
    }
    return preferredName;
  }

  const fallback = `diffwright:${preferredName}`;
  const fallbackExisting = scripts[fallback];
  if (fallbackExisting !== undefined && fallbackExisting !== desiredValue) {
    throw new Error(
      `${fallback} contains a custom command; choose another script name manually.`,
    );
  }
  scripts[fallback] = desiredValue;
  if (fallbackExisting !== desiredValue) {
    changes.push({ name: fallback, action: 'add fallback' });
  }
  return fallback;
}

function commandChain(parts: readonly string[]): string {
  return parts.filter(Boolean).join(' && ');
}

export function buildScriptPlan(options: {
  readonly manifest: ProjectManifest;
  readonly manager: PackageManagerName;
  readonly baseBranch: string;
  readonly releaseBranch?: string;
  readonly hasStaging: boolean;
  readonly selectedGates: readonly string[];
  readonly selfHosted: boolean;
}): ScriptPlan {
  if (!safeBranchName(options.baseBranch)) {
    throw new Error('Unsafe branch name for generated scripts.');
  }
  const releaseBranch = options.releaseBranch ?? 'main';
  if (!safeBranchName(releaseBranch)) {
    throw new Error('Unsafe release branch name for generated scripts.');
  }
  const originalScripts = options.manifest.scripts ?? {};
  const scripts: Record<string, string> = { ...originalScripts };
  for (const gate of options.selectedGates) {
    if (!GATE_NAMES.includes(gate as (typeof GATE_NAMES)[number])) {
      throw new Error(`Unsupported project gate: ${gate}`);
    }
    if (typeof scripts[gate] !== 'string') {
      throw new Error(`Selected project gate is missing: ${gate}`);
    }
  }

  const commitGateCommands = options.selectedGates.map(
    (gate) => buildRunScriptCommand(options.manager, gate).display,
  );
  const selfHostBuildCommands =
    options.selfHosted && typeof scripts.build === 'string'
      ? [buildRunScriptCommand(options.manager, 'build').display]
      : [];
  const commitPrelude = [...commitGateCommands];
  if (
    selfHostBuildCommands.length > 0 &&
    !options.selectedGates.includes('build')
  ) {
    commitPrelude.push(...selfHostBuildCommands);
  }
  const cli = options.selfHosted
    ? 'node ./bin/diffwright.js'
    : options.manager === 'yarn'
      ? 'yarn exec -- diffwright'
      : 'node ./node_modules/diffwright/bin/diffwright.js';
  const changes: Array<{ name: string; action: string }> = [];
  const commit = setManagedScript(
    scripts,
    'commit',
    commandChain([...commitPrelude, `${cli} commit --all`]),
    changes,
  );
  const summary = setManagedScript(
    scripts,
    'pr:summary',
    commandChain([...selfHostBuildCommands, `${cli} pr`]),
    changes,
  );
  const featurePr = setManagedScript(
    scripts,
    'feature:pr',
    commandChain([
      ...selfHostBuildCommands,
      `${cli} pr --base ${options.baseBranch} --create-pr --mode feature`,
    ]),
    changes,
  );

  let stagingPr: string | null = null;
  if (options.hasStaging && options.baseBranch === 'staging') {
    stagingPr = setManagedScript(
      scripts,
      'staging:pr',
      commandChain([
        ...selfHostBuildCommands,
        `${cli} pr --base ${releaseBranch} --create-pr --mode release`,
      ]),
      changes,
    );
  } else {
    const existing = scripts['staging:pr'];
    if (
      existing !== undefined &&
      ((MANAGED_SCRIPT_VALUES['staging:pr']?.has(existing) ?? false) ||
        isStrictGeneratedScript('staging:pr', existing))
    ) {
      delete scripts['staging:pr'];
      changes.push({ name: 'staging:pr', action: 'remove' });
    }
  }

  return Object.freeze({
    scripts: Object.freeze(scripts),
    effective: Object.freeze({ commit, summary, featurePr, stagingPr }),
    changes: Object.freeze(changes.map((change) => Object.freeze(change))),
  });
}
