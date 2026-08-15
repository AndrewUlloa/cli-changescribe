import fs from 'node:fs';
import path from 'node:path';
import { validateInitArguments } from './arguments';
import {
  runDoctor as defaultRunDoctor,
  runResolvedDoctor as defaultRunResolvedDoctor,
} from './doctor';
import {
  buildInstallCommand,
  buildLocalVersionCommand,
  buildRunScriptCommand,
  hasExactDiffwrightPin,
  isExactLocalDiffwrightInstalled,
  type PackageManagerName,
} from './package-manager';
import {
  getProviderSetupMetadata,
  PROVIDER_SETUP_METADATA,
  resolveProvider,
  SUPPORTED_PROVIDER_IDS,
  type ProviderId,
  type ResolvedProvider,
} from './provider';
import {
  buildScriptPlan,
  discoverProject,
  readProjectManifest,
  type ProjectManifest,
  type ScriptPlan,
} from './project-setup';
import {
  createNodePrompter,
  PromptCancelledError,
  type Prompter,
  type SelectChoice,
} from './prompts';
import {
  loadRuntimeConfig,
  redactSecretValues,
  type ConfigSource,
} from './runtime-config';
import {
  applySetupFile,
  planSetupFile,
  transformEnvLocal,
  transformManagedDocument,
  transformPackageJsonScripts,
  type EnvSafetyChecks,
  type SemanticMutation,
  type TransformResult,
} from './setup-files';
import {
  createCommandRunner,
  type CommandRunner,
} from './subprocess';

interface PackageJson {
  scripts?: Record<string, string> | null;
  [key: string]: unknown;
}

interface InitOptions {
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly live: boolean;
  readonly provider?: ProviderId;
  readonly model?: string;
  readonly base?: string;
  readonly agents?: 'claude' | 'codex' | 'both' | 'none';
  readonly credentialSource?: 'existing' | 'file';
}

interface WizardAnswers {
  readonly provider: ProviderId;
  readonly model: string;
  readonly baseURL?: string;
  readonly baseBranch: string;
  readonly gates: readonly string[];
  readonly agents: InitOptions['agents'];
  readonly credentialName?: string;
  readonly credentialValue?: string;
  readonly configureLater: boolean;
}

export interface InitDependencies {
  readonly cwd: string;
  readonly inputIsTTY: boolean;
  readonly outputIsTTY: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly runner: CommandRunner;
  readonly prompter?: Prompter;
  readonly runningPackageRoot: string;
  readonly runningVersion: string;
  readonly runDoctor: (args: string[]) => Promise<void>;
  readonly runResolvedDoctor: (
    resolved: ResolvedProvider,
    live: boolean,
  ) => Promise<void>;
  readonly log: (message: string) => void;
  readonly warn: (message: string) => void;
}

const SCRIPT_MAP: Readonly<Record<string, string>> = {
  commit: 'diffwright commit --all',
  'pr:summary': 'diffwright pr:summary',
  'feature:pr': 'diffwright feature:pr --yes',
  'staging:pr': 'diffwright staging:pr --yes',
};

const LEGACY_SCRIPT_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  commit: new Set(['changescribe commit']),
  'pr:summary': new Set(['changescribe pr:summary']),
  'feature:pr': new Set([
    'diffwright feature:pr',
    'changescribe feature:pr',
    'changescribe feature:pr --yes',
  ]),
  'staging:pr': new Set([
    'diffwright staging:pr',
    'changescribe staging:pr',
    'changescribe staging:pr --yes',
  ]),
};

const MAX_SETUP_FILE_BYTES = 1024 * 1024;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
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

function runLegacyInit(
  cwd: string,
  log: (message: string) => void,
  warn: (message: string) => void,
): void {
  const packagePath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error('No package.json found in the current directory.');
  }

  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    warn(
      '⚠️  pnpm-lock.yaml detected. Use pnpm to install/update dependencies so the lockfile stays in sync.',
    );
  } else if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    warn(
      '⚠️  yarn.lock detected. Use yarn to install/update dependencies so the lockfile stays in sync.',
    );
  }

  const manifest = readProjectManifest(cwd);
  const scripts = manifest.scripts ?? {};
  const added: string[] = [];
  const migrated: string[] = [];
  const replacements: Record<string, string | null> = {};
  for (const [name, command] of Object.entries(SCRIPT_MAP)) {
    if (!scripts[name]) {
      replacements[name] = command;
      added.push(name);
    } else if (LEGACY_SCRIPT_VALUES[name]?.has(scripts[name])) {
      replacements[name] = command;
      migrated.push(name);
    }
  }
  if (added.length === 0 && migrated.length === 0) {
    log('✅ Scripts already present; no changes made.');
    return;
  }
  const plan = planSetupFile({
    path: packagePath,
    kind: 'package-json',
    transform: (contents) =>
      transformPackageJsonScripts(contents, replacements),
  });
  applySetupFile(plan);
  if (added.length > 0) {
    log(`✅ Added npm scripts: ${added.join(', ')}`);
  }
  if (migrated.length > 0) {
    log(`✅ Migrated npm scripts to Diffwright: ${migrated.join(', ')}`);
  }
}

function readRunningVersion(packageRoot: string): string {
  const manifest = readPackageJson(path.join(packageRoot, 'package.json'));
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('Unable to determine the running Diffwright version.');
  }
  return manifest.version;
}

function defaultDependencies(
  overrides: Partial<InitDependencies>,
): InitDependencies {
  const env = overrides.env ?? process.env;
  const packageRoot = overrides.runningPackageRoot ?? path.resolve(__dirname, '..');
  const doctorOverride = overrides.runDoctor;
  return {
    cwd: overrides.cwd ?? process.cwd(),
    inputIsTTY: overrides.inputIsTTY ?? Boolean(process.stdin.isTTY),
    outputIsTTY: overrides.outputIsTTY ?? Boolean(process.stdout.isTTY),
    env,
    runner: overrides.runner ?? createCommandRunner(env),
    ...(overrides.prompter ? { prompter: overrides.prompter } : {}),
    runningPackageRoot: packageRoot,
    runningVersion:
      overrides.runningVersion ?? readRunningVersion(packageRoot),
    runDoctor: overrides.runDoctor ?? defaultRunDoctor,
    runResolvedDoctor:
      overrides.runResolvedDoctor ??
      (doctorOverride
        ? async (_resolved, live) => doctorOverride(live ? ['--live'] : [])
        : defaultRunResolvedDoctor),
    log: overrides.log ?? console.log,
    warn: overrides.warn ?? console.warn,
  };
}

function valueAfter(argv: string[], option: string): string | undefined {
  const index = argv.lastIndexOf(option);
  return index === -1 ? undefined : argv[index + 1];
}

function parseOptions(argv: string[]): InitOptions {
  validateInitArguments(argv);
  const rawAgents = valueAfter(argv, '--agents');
  const agents = rawAgents === 'claude,codex' || rawAgents === 'codex,claude'
    ? 'both'
    : rawAgents as InitOptions['agents'];
  return Object.freeze({
    yes: argv.includes('--yes'),
    dryRun: argv.includes('--dry-run'),
    live: argv.includes('--live'),
    ...(valueAfter(argv, '--provider')
      ? { provider: valueAfter(argv, '--provider') as ProviderId }
      : {}),
    ...(valueAfter(argv, '--model')
      ? { model: valueAfter(argv, '--model') }
      : {}),
    ...(valueAfter(argv, '--base')
      ? { base: valueAfter(argv, '--base') }
      : {}),
    ...(agents ? { agents } : {}),
    ...(valueAfter(argv, '--credential-source')
      ? {
          credentialSource: valueAfter(
            argv,
            '--credential-source',
          ) as InitOptions['credentialSource'],
        }
      : {}),
  });
}

function readOptionalSafeFile(filename: string): string {
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
      throw new Error(`Setup target must be a regular, unlinked file: ${filename}`);
    }
    if (stat.size > MAX_SETUP_FILE_BYTES) {
      throw new Error(`Setup target is too large to initialize safely: ${filename}`);
    }
    const bytes = fs.readFileSync(filename);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`Setup target must contain valid UTF-8 text: ${filename}`);
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function isGitRepository(runner: CommandRunner, cwd: string): boolean {
  try {
    return runner.exec('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
      .length > 0;
  } catch {
    let directory = path.resolve(cwd);
    while (true) {
      if (fs.existsSync(path.join(directory, '.git'))) {
        throw new Error(
          'Unable to verify Git repository state; refusing to continue setup.',
        );
      }
      const parent = path.dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
    return false;
  }
}

function createEnvSafety(
  runner: CommandRunner,
  cwd: string,
  gitRepository: boolean,
): EnvSafetyChecks {
  return Object.freeze({
    isTracked(absolutePath: string): boolean {
      if (!gitRepository) {
        return false;
      }
      const relative = path.relative(cwd, absolutePath) || '.env.local';
      try {
        const tracked = runner.exec(
          'git',
          ['ls-files', '--', relative],
          { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        return tracked
          .split(/\r\n|\n|\r/)
          .some((entry) => entry.trim() === relative);
      } catch (error) {
        throw new Error(
          `Unable to verify whether ${relative} is tracked by Git: ${errorMessage(error)}`,
        );
      }
    },
    isIgnored(absolutePath: string): boolean {
      const relative = path.relative(cwd, absolutePath) || '.env.local';
      if (gitRepository) {
        try {
          runner.exec(
            'git',
            ['check-ignore', '--no-index', '--quiet', relative],
            { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
          );
          return true;
        } catch (error) {
          const status: unknown =
            typeof error === 'object' && error !== null
              ? Reflect.get(error, 'status')
              : undefined;
          if (status === 1) {
            return false;
          }
          throw new Error(
            `Unable to verify whether ${relative} is ignored by Git: ${errorMessage(error)}`,
          );
        }
      }
      const gitignore = readOptionalSafeFile(path.join(cwd, '.gitignore'));
      return hasEffectiveLocalEnvIgnore(gitignore);
    },
  });
}

function gitignoreTransform(contents: string): TransformResult {
  const newline = contents.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  const separator = contents.length === 0 || /(?:\r\n|\n|\r)$/.test(contents)
    ? ''
    : newline;
  const transformed = `${contents}${separator}.env.local${newline}`;
  const mutation: SemanticMutation = {
    kind: 'managed-block',
    action: 'added',
    name: '.env.local ignore rule',
  };
  return Object.freeze({
    contents: transformed,
    changed: transformed !== contents,
    mutations: Object.freeze([Object.freeze(mutation)]),
  });
}

function hasEffectiveLocalEnvIgnore(contents: string): boolean {
  let ignored = false;
  for (const rawLine of contents.split(/\r\n|\n|\r/)) {
    let line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const negated = line.startsWith('!');
    if (negated) {
      line = line.slice(1);
    }
    if (line.startsWith('/')) {
      line = line.slice(1);
    }
    if (line.endsWith('/') || line.includes('/')) {
      continue;
    }
    let expression = '^';
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index] as string;
      if (character === '*') {
        expression += '.*';
      } else if (character === '?') {
        expression += '.';
      } else {
        expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
    expression += '$';
    if (new RegExp(expression).test('.env.local')) {
      ignored = !negated;
    }
  }
  return ignored;
}

function selectedAgentFiles(
  cwd: string,
  selection: InitOptions['agents'],
): string[] {
  if (selection === 'claude') {
    return [path.join(cwd, 'CLAUDE.md')];
  }
  if (selection === 'codex') {
    return [path.join(cwd, 'AGENTS.md')];
  }
  if (selection === 'both') {
    return [path.join(cwd, 'CLAUDE.md'), path.join(cwd, 'AGENTS.md')];
  }
  return [];
}

function seedAgentDocument(filename: string, contents: string): string {
  if (contents.length > 0) {
    return contents;
  }
  const title = path.basename(filename) === 'CLAUDE.md'
    ? '# Claude Instructions'
    : '# Codex Agent Instructions';
  return `${title}\n\n`;
}

function renderWorkflowBlock(options: {
  readonly manager: ProjectManifest['packageManager'] | string;
  readonly baseBranch: string;
  readonly defaultBranch: string;
  readonly hasStaging: boolean;
  readonly gates: readonly string[];
  readonly scripts: ScriptPlan['effective'];
}): string {
  const run = (script: string): string =>
    buildRunScriptCommand(
      options.manager as 'npm' | 'pnpm' | 'yarn' | 'bun',
      script,
    ).display;
  const gateText = options.gates.length > 0
    ? `The commit script enforces these project gates first: ${options.gates.join(', ')}.`
    : 'No project lint, typecheck, test, or build scripts were detected; add gates and rerun setup when available.';
  const topology = options.hasStaging
    ? `Branch each independent feature from \`${options.baseBranch}\`. Use \`${run(options.scripts.stagingPr as string)}\` only to promote staging into \`${options.defaultBranch}\`.`
    : `Branch each independent feature from \`${options.baseBranch}\`. This workflow does not use a staging branch.`;
  return `## Git workflow\n\n${topology} Never branch new work from another unfinished feature branch.\n\nNever use raw \`git add\`, \`git commit\`, \`git push\`, \`gh pr create\`, or \`gh pr edit\` for work intended to ship. Read-only Git and GitHub inspection commands are allowed.\n\nCommit and push only with \`${run(options.scripts.commit)}\`. Create or update a feature pull request only with \`${run(options.scripts.featurePr)}\`. ${gateText}\n\nIf a generated command or gate fails, fix the underlying error and rerun the same project script. Never use \`--no-verify\`, skip hooks or gates, replace generated commit/PR text by hand, or fall back to raw Git/GitHub mutation.`;
}

function doctorInvocation(
  manager: 'npm' | 'pnpm' | 'yarn' | 'bun',
  selfHosted: boolean,
): string {
  if (selfHosted) {
    return 'node ./bin/diffwright.js doctor';
  }
  if (manager === 'yarn') {
    return 'yarn exec -- diffwright doctor';
  }
  return 'node ./node_modules/diffwright/bin/diffwright.js doctor';
}

function replacementsForPlan(
  manifest: ProjectManifest,
  plan: ScriptPlan,
): Record<string, string | null> {
  const replacements: Record<string, string | null> = { ...plan.scripts };
  for (const change of plan.changes) {
    if (change.action === 'remove') {
      replacements[change.name] = null;
    }
  }
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (!(name in replacements)) {
      replacements[name] = command;
    }
  }
  return replacements;
}

function parseProjectManifestContents(contents: string): ProjectManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('package.json changed to invalid JSON after preview.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json changed to a non-object after preview.');
  }
  const manifest = parsed as ProjectManifest;
  if (
    manifest.scripts !== undefined &&
    (typeof manifest.scripts !== 'object' ||
      manifest.scripts === null ||
      Array.isArray(manifest.scripts) ||
      Object.values(manifest.scripts).some((value) => typeof value !== 'string'))
  ) {
    throw new Error('package.json scripts changed to invalid values after preview.');
  }
  return manifest;
}

function sameEffectiveScripts(left: ScriptPlan, right: ScriptPlan): boolean {
  return (
    left.effective.commit === right.effective.commit &&
    left.effective.summary === right.effective.summary &&
    left.effective.featurePr === right.effective.featurePr &&
    left.effective.stagingPr === right.effective.stagingPr
  );
}

function printPreview(options: {
  readonly dependencies: InitDependencies;
  readonly discovery: ReturnType<typeof discoverProject>;
  readonly installDisplay: string | null;
  readonly scriptPlan: ScriptPlan;
  readonly envTransform: TransformResult;
  readonly gitignoreNeeded: boolean;
  readonly agentFiles: readonly string[];
  readonly configured: boolean;
  readonly live: boolean;
  readonly provider: ProviderId;
  readonly model: string;
  readonly endpoint: string;
  readonly baseBranch: string;
  readonly usesStaging: boolean;
}): void {
  const { log, cwd } = options.dependencies;
  log('');
  log('Diffwright setup preview');
  log(`- Project: ${cwd}`);
  log(`- Package manager: ${options.discovery.manager}`);
  log(`- Running Diffwright version: ${options.dependencies.runningVersion}`);
  log(`- Provider: ${options.provider}`);
  log(`- Model: ${options.model}`);
  log(`- Endpoint: ${options.endpoint}`);
  log(`- Feature PR base: ${options.baseBranch}`);
  log(
    options.usesStaging
      ? `- Release topology: staging -> ${options.discovery.defaultBranch}`
      : '- Release topology: main/default branch only',
  );
  log(
    options.installDisplay
      ? `- Exact local install: ${options.installDisplay}`
      : options.discovery.selfHosted
        ? '- Executable: validated self-host (build, then node ./bin/diffwright.js)'
        : '- Executable: exact local Diffwright install already verified',
  );
  for (const change of options.scriptPlan.changes) {
    const value = options.scriptPlan.scripts[change.name];
    log(`- Script ${change.action}: ${change.name}${value ? ` -> ${value}` : ''}`);
  }
  for (const mutation of options.envTransform.mutations) {
    log(`- Environment ${mutation.action}: ${mutation.name} [hidden]`);
  }
  if (options.gitignoreNeeded) {
    log('- Git ignore: add effective .env.local rule');
  }
  for (const filename of options.agentFiles) {
    log(`- Agent workflow: manage ${path.basename(filename)} Diffwright block`);
  }
  log(
    options.configured
      ? '- Validation: offline doctor after setup (zero provider requests)'
      : '- Validation: configure a credential later, then run doctor',
  );
  if (options.live) {
    log('- Live validation: one explicit provider request after offline doctor');
  }
  log('');
}

function existingProviderId(
  values: NodeJS.ProcessEnv,
): ProviderId | undefined {
  const requested = values.DIFFWRIGHT_PROVIDER?.trim();
  if (requested && SUPPORTED_PROVIDER_IDS.includes(requested as ProviderId)) {
    return requested as ProviderId;
  }
  try {
    return resolveProvider({ env: values, command: 'doctor' })?.profile.id;
  } catch {
    return undefined;
  }
}

function existingResolvedProvider(values: NodeJS.ProcessEnv):
  ReturnType<typeof resolveProvider> {
  try {
    return resolveProvider({ env: values, command: 'doctor' });
  } catch {
    return null;
  }
}

function detectYarnMajor(
  manifest: ProjectManifest,
  dependencies: InitDependencies,
): number | undefined {
  if (dependencies === undefined) {
    return undefined;
  }
  const declared = manifest.packageManager;
  if (declared?.startsWith('yarn@')) {
    const match = declared.slice('yarn@'.length).match(/^(\d+)/);
    if (match) {
      return Number(match[1]);
    }
  }
  try {
    const output = dependencies.runner.exec('yarn', ['--version'], {
      cwd: dependencies.cwd,
    });
    const match = output.trim().match(/^(\d+)/);
    if (match) {
      return Number(match[1]);
    }
  } catch (error) {
    throw new Error(`Unable to detect the Yarn major version: ${errorMessage(error)}`);
  }
  throw new Error('Unable to detect the Yarn major version.');
}

function hasSafeYarnPnpMap(cwd: string): boolean {
  try {
    const stat = fs.lstatSync(path.join(cwd, '.pnp.cjs'));
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1;
  } catch {
    return false;
  }
}

function verifyExactLocalExecutable(options: {
  readonly dependencies: InitDependencies;
  readonly manager: PackageManagerName;
}): boolean {
  const { dependencies, manager } = options;
  if (!hasExactDiffwrightPin(dependencies.cwd, dependencies.runningVersion)) {
    return false;
  }
  const hasPhysicalInstall = isExactLocalDiffwrightInstalled(
    dependencies.cwd,
    dependencies.runningVersion,
  );
  if (
    !hasPhysicalInstall &&
    !(manager === 'yarn' && hasSafeYarnPnpMap(dependencies.cwd))
  ) {
    return false;
  }
  try {
    if (hasPhysicalInstall && manager !== 'yarn') {
      const binPath = path.join(
        dependencies.cwd,
        'node_modules',
        'diffwright',
        'bin',
        'diffwright.js',
      );
      return dependencies.runner.exec(
        process.execPath,
        [binPath, '--version'],
        { cwd: dependencies.cwd },
      ).trim() === dependencies.runningVersion;
    }
    const command = buildLocalVersionCommand(manager);
    return dependencies.runner.exec(command.file, command.args, {
      cwd: dependencies.cwd,
    }).trim() === dependencies.runningVersion;
  } catch {
    return false;
  }
}

function requiresCredential(provider: ProviderId, baseURL: string | undefined): boolean {
  const metadata = getProviderSetupMetadata(provider);
  if (metadata.keylessAllowance === 'always') {
    return false;
  }
  if (metadata.keylessAllowance === 'loopback-only' && baseURL) {
    try {
      const url = new URL(baseURL);
      return !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
      );
    } catch {
      return true;
    }
  }
  return true;
}

async function chooseInteractiveAnswers(options: {
  readonly prompter: Prompter;
  readonly runtimeValues: NodeJS.ProcessEnv;
  readonly discovery: ReturnType<typeof discoverProject>;
  readonly envSafety: EnvSafetyChecks;
  readonly envPath: string;
}): Promise<WizardAnswers> {
  const defaultProvider = existingProviderId(options.runtimeValues) ?? 'openai';
  const provider = await options.prompter.select<ProviderId>(
    'AI provider',
    SUPPORTED_PROVIDER_IDS.map((id) => ({
      value: id,
      label: PROVIDER_SETUP_METADATA[id].displayName,
    })),
    { defaultValue: defaultProvider },
  );
  const metadata = getProviderSetupMetadata(provider);
  const detected = existingResolvedProvider(options.runtimeValues);
  const detectedModel = detected?.profile.id === provider
    ? detected.profile.model
    : undefined;
  const explicitModel = options.runtimeValues.DIFFWRIGHT_PROVIDER?.trim() === provider
    ? options.runtimeValues.DIFFWRIGHT_MODEL
    : undefined;
  const model = await options.prompter.input('Exact model ID', {
    ...(detectedModel || explicitModel || metadata.defaultModel
      ? {
          defaultValue:
            detectedModel ??
            explicitModel ??
            metadata.defaultModel,
        }
      : {}),
    validate: (value) => value.trim().length > 0
      ? undefined
      : 'A model ID is required.',
  });
  const baseURL = provider === 'custom'
    ? await options.prompter.input('OpenAI-compatible base URL', {
        ...(options.runtimeValues.DIFFWRIGHT_BASE_URL
          ? { defaultValue: options.runtimeValues.DIFFWRIGHT_BASE_URL }
          : {}),
        validate: (value) => value.length > 0 ? undefined : 'A base URL is required.',
      })
    : undefined;

  let credentialName: string | undefined;
  let credentialValue: string | undefined;
  let configureLater = false;
  if (requiresCredential(provider, baseURL)) {
    const existingName = metadata.credentialEnvs.find(
      (name) => Boolean(options.runtimeValues[name]),
    );
    type CredentialChoice = 'existing' | 'file' | 'later';
    const credentialChoices: Array<SelectChoice<CredentialChoice>> = [
      ...(existingName
        ? [{
            value: 'existing' as const,
            label: `Reuse ${existingName}`,
            description: 'Keep the current shell or .env.local credential',
          }]
        : []),
      {
        value: 'file',
        label: 'Store in .env.local',
        description: 'No echo; the value is never shown in the preview',
      },
      {
        value: 'later',
        label: 'Configure later',
        description: 'Install workflow files now and skip doctor',
      },
    ];
    const credentialChoice = await options.prompter.select(
      'Credential',
      credentialChoices,
      { defaultValue: existingName ? 'existing' : 'file' },
    );
    if (credentialChoice === 'file') {
      if (options.envSafety.isTracked(options.envPath)) {
        throw new Error('Refusing to store a credential because .env.local is tracked by Git.');
      }
      credentialName = metadata.credentialEnvs[0];
      credentialValue = await options.prompter.secret(
        `${credentialName} (input hidden)`,
        {
          validate: (value) => /["\\\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
            ? 'Credential contains a character that cannot be stored safely in .env.local.'
            : undefined,
        },
      );
    } else if (credentialChoice === 'later') {
      configureLater = true;
    }
  }

  const detectedBase = options.discovery.hasStaging
    ? 'staging'
    : options.discovery.defaultBranch;
  const baseBranch = await options.prompter.input('Feature PR base branch', {
    defaultValue: detectedBase,
    validate: (value) => /[\s\u0000-\u001f\u007f]/u.test(value)
      ? 'Branch names cannot contain whitespace or control characters.'
      : undefined,
  });
  const gates: string[] = [];
  for (const gate of options.discovery.gates) {
    if (await options.prompter.confirm(`Run ${gate} before commit?`, true)) {
      gates.push(gate);
    }
  }
  const agents = await options.prompter.select(
    'Install agent workflow guardrails',
    [
      { value: 'both', label: 'Claude and Codex' },
      { value: 'claude', label: 'Claude only' },
      { value: 'codex', label: 'Codex only' },
      { value: 'none', label: 'None' },
    ] as const,
    { defaultValue: 'both' },
  );
  return {
    provider,
    model,
    ...(baseURL ? { baseURL } : {}),
    baseBranch,
    gates,
    agents,
    ...(credentialName ? { credentialName } : {}),
    ...(credentialValue ? { credentialValue } : {}),
    configureLater,
  };
}

function validateBranch(
  runner: CommandRunner,
  cwd: string,
  branch: string,
  gitRepository: boolean,
): void {
  if (!gitRepository) {
    return;
  }
  try {
    runner.exec('git', ['check-ref-format', '--branch', branch], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`Invalid Git branch selected for pull requests: ${branch}`);
  }
}

function installExactDependency(options: {
  readonly dependencies: InitDependencies;
  readonly command: ReturnType<typeof buildInstallCommand>;
  readonly manager: PackageManagerName;
}): void {
  const result = options.dependencies.runner.spawn(
    options.command.file,
    options.command.args,
    {
      cwd: options.dependencies.cwd,
      encoding: 'utf8',
      stdio: 'inherit',
    },
  );
  if (result.error) {
    throw new Error(
      `Exact Diffwright install failed. Retry: ${options.command.display}. ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Exact Diffwright install failed with status ${result.status ?? 'unknown'}. Retry: ${options.command.display}`,
    );
  }
  if (!verifyExactLocalExecutable({
    dependencies: options.dependencies,
    manager: options.manager,
  })) {
    throw new Error(
      `The package manager completed, but exact local Diffwright ${options.dependencies.runningVersion} provenance could not be verified. Never fall back to a global executable.`,
    );
  }
}

async function runGuidedInit(
  argv: string[],
  dependencies: InitDependencies,
): Promise<void> {
  const options = parseOptions(argv);
  const interactive =
    dependencies.inputIsTTY &&
    dependencies.outputIsTTY &&
    !options.yes &&
    options.provider === undefined &&
    options.model === undefined &&
    options.base === undefined &&
    options.agents === undefined &&
    options.credentialSource === undefined;
  const packagePath = path.join(dependencies.cwd, 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error('No package.json found in the current directory.');
  }
  const envPath = path.join(dependencies.cwd, '.env.local');
  readOptionalSafeFile(envPath);
  const discovery = discoverProject({
    cwd: dependencies.cwd,
    runner: dependencies.runner,
    runningPackageRoot: dependencies.runningPackageRoot,
    runningVersion: dependencies.runningVersion,
  });
  const initialManifest = readProjectManifest(dependencies.cwd);
  if (initialManifest.name === 'diffwright' && !discovery.selfHosted) {
    throw new Error(
      'This package is named diffwright but is not the validated running checkout. Build it and run node ./bin/diffwright.js init; refusing to add a self-dependency.',
    );
  }
  const gitRepository = isGitRepository(dependencies.runner, dependencies.cwd);
  const envSafety = createEnvSafety(
    dependencies.runner,
    dependencies.cwd,
    gitRepository,
  );
  if (envSafety.isTracked(envPath)) {
    throw new Error(
      'Refusing to configure .env.local because it is tracked by Git. Remove it from tracking before setup.',
    );
  }
  const runtime = loadRuntimeConfig({
    cwd: dependencies.cwd,
    shellEnv: dependencies.env,
  });
  const prompter = interactive
    ? dependencies.prompter ?? createNodePrompter()
    : undefined;
  const secrets: string[] = [];
  let setupApplied = false;

  try {
    const answers: WizardAnswers = interactive && prompter
      ? await chooseInteractiveAnswers({
          prompter,
          runtimeValues: runtime.values,
          discovery,
          envSafety,
          envPath,
        })
      : ((): WizardAnswers => {
          const detected = existingResolvedProvider(runtime.values);
          const provider = options.provider ?? detected?.profile.id;
          if (!provider) {
            throw new Error(
              'Headless guided init requires --provider or an existing provider configuration.',
            );
          }
          const metadata = getProviderSetupMetadata(provider);
          const model =
            options.model ??
            (detected?.profile.id === provider
              ? detected.profile.model
              : undefined) ??
            (runtime.values.DIFFWRIGHT_PROVIDER?.trim() === provider
              ? runtime.values.DIFFWRIGHT_MODEL
              : undefined) ??
            metadata.defaultModel;
          if (!model) {
            throw new Error(
              'Headless guided init requires --model for the selected provider.',
            );
          }
          const baseURL = provider === 'custom'
            ? runtime.values.DIFFWRIGHT_BASE_URL
            : undefined;
          if (provider === 'custom' && !baseURL) {
            throw new Error(
              'Headless custom-provider setup requires DIFFWRIGHT_BASE_URL in the shell or .env.local.',
            );
          }
          const credentialName = metadata.credentialEnvs.find(
            (name) => Boolean(runtime.values[name]),
          );
          const missingCredential =
            requiresCredential(provider, baseURL) && !credentialName;
          if (missingCredential) {
            throw new Error(
              `No existing credential found. Expected ${metadata.credentialEnvs.join(' or ')}.`,
            );
          }
          if (options.credentialSource === 'file') {
            if (
              !credentialName ||
              runtime.sources[credentialName] !== '.env.local'
            ) {
              throw new Error(
                'Headless init cannot receive a credential value. Run interactive init to store one in .env.local.',
              );
            }
          }
          return {
            provider,
            model,
            ...(baseURL ? { baseURL } : {}),
            baseBranch:
              options.base ??
              (discovery.hasStaging ? 'staging' : discovery.defaultBranch),
            gates: [...discovery.gates],
            agents: options.agents ?? 'none',
            configureLater: false,
          };
        })();

    if (answers.credentialValue) {
      secrets.push(answers.credentialValue);
    }
    validateBranch(
      dependencies.runner,
      dependencies.cwd,
      answers.baseBranch,
      gitRepository,
    );
    const usesStaging =
      discovery.hasStaging && answers.baseBranch === 'staging';

    const envUpdates: Record<string, string> = {
      DIFFWRIGHT_PROVIDER: answers.provider,
      DIFFWRIGHT_MODEL: answers.model,
      ...(answers.baseURL ? { DIFFWRIGHT_BASE_URL: answers.baseURL } : {}),
      ...(answers.credentialName && answers.credentialValue
        ? { [answers.credentialName]: answers.credentialValue }
        : {}),
    };
    const existingEnvContents = readOptionalSafeFile(envPath);
    const envTransform = transformEnvLocal(existingEnvContents, envUpdates);
    const gitignorePath = path.join(dependencies.cwd, '.gitignore');
    const gitignoreContents = readOptionalSafeFile(gitignorePath);
    const gitignoreNeeded = !hasEffectiveLocalEnvIgnore(gitignoreContents);

    const initialScriptPlan = buildScriptPlan({
      manifest: initialManifest,
      manager: discovery.manager,
      baseBranch: answers.baseBranch,
      releaseBranch: discovery.defaultBranch,
      hasStaging: usesStaging,
      selectedGates: answers.gates,
      selfHosted: discovery.selfHosted,
    });
    transformPackageJsonScripts(
      readOptionalSafeFile(packagePath),
      replacementsForPlan(initialManifest, initialScriptPlan),
    );

    const agentFiles = selectedAgentFiles(dependencies.cwd, answers.agents);
    const workflowBody = renderWorkflowBlock({
      manager: discovery.manager,
      baseBranch: answers.baseBranch,
      defaultBranch: discovery.defaultBranch,
      hasStaging: usesStaging,
      gates: answers.gates,
      scripts: initialScriptPlan.effective,
    });
    const agentPreviews = agentFiles.map((filename) => ({
      filename,
      transform: transformManagedDocument(
        seedAgentDocument(filename, readOptionalSafeFile(filename)),
        workflowBody,
      ),
    }));

    const exactLocal = discovery.selfHosted || verifyExactLocalExecutable({
      dependencies,
      manager: discovery.manager,
    });
    const yarnMajor = discovery.manager === 'yarn' && !exactLocal
      ? detectYarnMajor(initialManifest, dependencies)
      : undefined;
    const installCommand = exactLocal
      ? null
      : buildInstallCommand(discovery.manager, dependencies.runningVersion, {
          ...(yarnMajor === undefined ? {} : { yarnMajor }),
        });

    const prospectiveValues: NodeJS.ProcessEnv = {
      ...runtime.values,
      ...envUpdates,
    };
    const prospectiveSources: Record<string, ConfigSource> = {
      ...runtime.sources,
      ...Object.fromEntries(
        Object.keys(envUpdates).map((name) => [name, '.env.local' as const]),
      ),
    };
    const shellConflicts: string[] = [];
    for (const [name, value] of Object.entries(dependencies.env)) {
      prospectiveValues[name] = value;
      prospectiveSources[name] = 'shell';
      if (name in envUpdates && value !== envUpdates[name]) {
        shellConflicts.push(name);
      }
    }
    if (shellConflicts.length > 0) {
      throw new Error(
        `Shell ${shellConflicts.join(', ')} overrides the selected setup values. Unset or update the conflicting variable before init; no files were changed.`,
      );
    }
    const configured = !answers.configureLater;
    let liveDescription = 'the configured provider';
    const validationValues = { ...prospectiveValues };
    const validationSources = { ...prospectiveSources };
    if (!configured) {
      const credentialName = getProviderSetupMetadata(answers.provider)
        .credentialEnvs[0];
      if (credentialName) {
        validationValues[credentialName] = 'diffwright-init-validation-only';
        validationSources[credentialName] = 'shell';
      }
    }
    try {
      const resolved = resolveProvider({
        env: validationValues,
        sources: validationSources,
        command: 'doctor',
      });
      if (!resolved) {
        throw new Error('No provider resolved from the planned configuration.');
      }
      liveDescription =
        `${resolved.profile.id} (${resolved.profile.model}) at ` +
        new URL(resolved.profile.baseURL).hostname;
    } catch (error) {
      throw new Error(`Planned provider configuration is invalid: ${errorMessage(error)}`);
    }
    if (options.live && !configured) {
      throw new Error(
        'Live validation requires an existing credential; setup has not changed any files.',
      );
    }

    printPreview({
      dependencies,
      discovery,
      installDisplay: installCommand?.display ?? null,
      scriptPlan: initialScriptPlan,
      envTransform,
      gitignoreNeeded,
      agentFiles,
      configured,
      live: options.live,
      provider: answers.provider,
      model: answers.model,
      endpoint:
        getProviderSetupMetadata(answers.provider).fixedBaseURL ??
        answers.baseURL as string,
      baseBranch: answers.baseBranch,
      usesStaging,
    });

    if (options.dryRun) {
      dependencies.log('Dry run complete; no files, installs, or provider requests were made.');
      return;
    }
    if (interactive && prompter) {
      const confirmed = await prompter.confirm('Apply this setup?', false);
      if (!confirmed) {
        dependencies.log('Setup cancelled; no changes were made.');
        return;
      }
    }

    if (installCommand) {
      dependencies.log(`Installing exact local Diffwright ${dependencies.runningVersion}...`);
      installExactDependency({
        dependencies,
        command: installCommand,
        manager: discovery.manager,
      });
    }

    const {
      packagePlan,
      currentScriptPlan,
      gitignorePlan,
      agentPlans,
    } = (() => {
      try {
        const finalPlanHolder: { value?: ScriptPlan } = {};
        const plannedPackage = planSetupFile({
          path: packagePath,
          kind: 'package-json',
          transform: (contents) => {
            const currentManifest = parseProjectManifestContents(contents);
            const planned = buildScriptPlan({
              manifest: currentManifest,
              manager: discovery.manager,
              baseBranch: answers.baseBranch,
              releaseBranch: discovery.defaultBranch,
              hasStaging: usesStaging,
              selectedGates: answers.gates,
              selfHosted: discovery.selfHosted,
            });
            if (!sameEffectiveScripts(initialScriptPlan, planned)) {
              throw new Error(
                'Managed script ownership changed after preview. Review the new package.json and rerun init.',
              );
            }
            finalPlanHolder.value = planned;
            return transformPackageJsonScripts(
              contents,
              replacementsForPlan(currentManifest, planned),
            );
          },
        });
        const finalScriptPlan = finalPlanHolder.value;
        if (!finalScriptPlan) {
          throw new Error('Unable to construct the final package script plan.');
        }
        const finalWorkflowBody = renderWorkflowBlock({
          manager: discovery.manager,
          baseBranch: answers.baseBranch,
          defaultBranch: discovery.defaultBranch,
          hasStaging: usesStaging,
          gates: answers.gates,
          scripts: finalScriptPlan.effective,
        });
        const plannedGitignore = planSetupFile({
          path: gitignorePath,
          kind: 'agent-document',
          transform: (contents) => hasEffectiveLocalEnvIgnore(contents)
            ? {
                contents,
                changed: false,
                mutations: [],
              }
            : gitignoreTransform(contents),
        });
        const plannedAgents = agentPreviews.map(({ filename }) =>
          planSetupFile({
            path: filename,
            kind: 'agent-document',
            transform: (contents) =>
              transformManagedDocument(
                seedAgentDocument(filename, contents),
                finalWorkflowBody,
              ),
          }));
        return {
          packagePlan: plannedPackage,
          currentScriptPlan: finalScriptPlan,
          gitignorePlan: plannedGitignore,
          agentPlans: plannedAgents,
        };
      } catch (error) {
        const phase = installCommand
          ? 'The exact dependency install completed and may have updated package.json or its lockfile; no Diffwright workflow transforms were applied.'
          : 'No Diffwright workflow transforms were applied.';
        throw new Error(
          `Setup planning after confirmation failed: ${errorMessage(error)} ${phase}`,
        );
      }
    })();

    const appliedPaths: string[] = [];
    try {
      applySetupFile(packagePlan);
      if (packagePlan.changed) appliedPaths.push(packagePlan.path);
      applySetupFile(gitignorePlan);
      if (gitignorePlan.changed) appliedPaths.push(gitignorePlan.path);
      for (const plan of agentPlans) {
        applySetupFile(plan);
        if (plan.changed) appliedPaths.push(plan.path);
      }
      const envPlan = planSetupFile({
        path: envPath,
        kind: 'environment',
        transform: (contents) => transformEnvLocal(contents, envUpdates),
        envSafety,
      });
      applySetupFile(envPlan, { envSafety });
      if (envPlan.changed) appliedPaths.push(envPlan.path);
      setupApplied = true;
    } catch (error) {
      const applied = appliedPaths.length > 0
        ? ` Applied before failure: ${appliedPaths.join(', ')}.`
        : '';
      throw new Error(
        `Setup file application failed: ${errorMessage(error)}.${applied}`,
      );
    }

    let appliedResolved: ResolvedProvider | null = null;
    if (configured) {
      try {
        const appliedRuntime = loadRuntimeConfig({
          cwd: dependencies.cwd,
          shellEnv: dependencies.env,
        });
        appliedResolved = resolveProvider({
          env: appliedRuntime.values,
          sources: appliedRuntime.sources,
          command: 'doctor',
        });
        if (!appliedResolved) {
          throw new Error('No provider resolved after setup.');
        }
        await dependencies.runResolvedDoctor(appliedResolved, false);
      } catch (error) {
        throw new Error(
          `Setup files were applied, but offline doctor failed: ${errorMessage(error)}`,
        );
      }
    } else {
      const expected = getProviderSetupMetadata(answers.provider).credentialEnvs;
      dependencies.log(
        `Credential not configured. Set ${expected.join(' or ')}, then run ${doctorInvocation(discovery.manager, discovery.selfHosted)}.`,
      );
      dependencies.log(
        '⚠️  Setup files were applied, but Diffwright is not ready until the credential and offline doctor succeed.',
      );
      return;
    }

    let runLive = options.live;
    if (interactive && configured && prompter && !options.live) {
      runLive = await prompter.confirm(
        `Run one live request to ${
          appliedResolved
            ? `${appliedResolved.profile.id} (${appliedResolved.profile.model}) at ${new URL(appliedResolved.profile.baseURL).hostname}`
            : liveDescription
        } now? This may incur provider cost.`,
        false,
      );
    }
    if (runLive) {
      if (!configured) {
        throw new Error('Live validation requires a configured credential.');
      }
      if (!appliedResolved) {
        throw new Error(
          'Setup files were applied, but live doctor could not reuse a validated provider.',
        );
      }
      try {
        await dependencies.runResolvedDoctor(appliedResolved, true);
      } catch (error) {
        throw new Error(
          `Setup files were applied and offline doctor passed, but live doctor failed: ${errorMessage(error)}`,
        );
      }
    }
    const commitCommand = buildRunScriptCommand(
      discovery.manager,
      currentScriptPlan.effective.commit,
    ).display;
    const featureCommand = buildRunScriptCommand(
      discovery.manager,
      currentScriptPlan.effective.featurePr,
    ).display;
    dependencies.log(
      `Executable provenance: Diffwright ${dependencies.runningVersion} (${discovery.selfHosted ? 'validated self-host' : 'verified exact local dependency'})`,
    );
    dependencies.log(`Commit preview: ${commitCommand} -- --dry-run`);
    dependencies.log(`Commit workflow: ${commitCommand}`);
    dependencies.log(`Feature PR preview: ${featureCommand} -- --dry-run`);
    dependencies.log(`Feature PR workflow: ${featureCommand}`);
    if (currentScriptPlan.effective.stagingPr) {
      dependencies.log(
        `Release PR workflow: ${buildRunScriptCommand(discovery.manager, currentScriptPlan.effective.stagingPr).display}`,
      );
    }
    dependencies.log('✅ Setup complete. Diffwright is ready for this repository.');
  } catch (error) {
    if (error instanceof PromptCancelledError) {
      dependencies.log(
        setupApplied
          ? 'Setup files were applied; live validation was cancelled.'
          : 'Setup cancelled; no changes were made.',
      );
      return;
    }
    const redacted = redactSecretValues(errorMessage(error), secrets);
    if (redacted !== errorMessage(error)) {
      throw new Error(redacted);
    }
    throw error;
  } finally {
    prompter?.close();
  }
}

export async function runInit(
  argv: string[] = [],
  dependencyOverrides: Partial<InitDependencies> = {},
): Promise<void> {
  const dependencies = defaultDependencies(dependencyOverrides);
  const legacyHeadless =
    argv.length === 0 &&
    (!dependencies.inputIsTTY || !dependencies.outputIsTTY);
  if (legacyHeadless) {
    runLegacyInit(dependencies.cwd, dependencies.log, dependencies.warn);
    return;
  }
  await runGuidedInit(argv, dependencies);
}
