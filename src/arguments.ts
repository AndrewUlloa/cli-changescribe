import { SUPPORTED_PROVIDER_IDS } from './provider';

export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliArgumentError';
  }
}

function rejectUnknown(command: string, _option: string): never {
  throw new CliArgumentError(
    `Unknown ${command} option. Run \`diffwright ${command} --help\` for usage.`,
  );
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new CliArgumentError(`${option} requires a value.`);
  }
  return value;
}

export function validateCommitArguments(argv: string[]): void {
  for (const argument of argv) {
    if (argument !== '--dry-run') {
      rejectUnknown('commit', argument);
    }
  }
}

export function validateDoctorArguments(argv: string[]): void {
  for (const argument of argv) {
    if (argument !== '--live') {
      rejectUnknown('doctor', argument);
    }
  }
}

export function validateInitArguments(argv: string[]): void {
  const valueOptions = new Set([
    '--provider',
    '--model',
    '--base',
    '--agents',
    '--credential-source',
  ]);
  const booleanOptions = new Set(['--yes', '--dry-run', '--live']);
  const supportedProviders = new Set<string>(SUPPORTED_PROVIDER_IDS);
  const agentSelections = new Set([
    'claude',
    'codex',
    'claude,codex',
    'codex,claude',
    'none',
  ]);
  const credentialSources = new Set(['existing', 'file']);
  const seenValues = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!option) {
      continue;
    }
    if (booleanOptions.has(option)) {
      continue;
    }
    if (!valueOptions.has(option)) {
      rejectUnknown('init', option);
    }

    const value = requireValue(argv, index, option);
    const previousValue = seenValues.get(option);
    if (previousValue !== undefined && previousValue !== value) {
      throw new CliArgumentError(
        `${option} cannot be supplied with conflicting values.`,
      );
    }
    seenValues.set(option, value);
    if (option === '--provider' && !supportedProviders.has(value)) {
      throw new CliArgumentError(
        `--provider must be one of: ${SUPPORTED_PROVIDER_IDS.join(', ')}.`,
      );
    }
    if (option === '--model' && value.trim().length === 0) {
      throw new CliArgumentError('--model requires a nonempty value.');
    }
    if (
      option === '--base' &&
      (value.trim().length === 0 || /[\s\u0000-\u001f\u007f]/u.test(value))
    ) {
      throw new CliArgumentError(
        '--base must be a nonempty branch name without whitespace or control characters.',
      );
    }
    if (option === '--agents' && !agentSelections.has(value)) {
      throw new CliArgumentError(
        '--agents must be claude, codex, claude,codex, codex,claude, or none.',
      );
    }
    if (option === '--credential-source' && !credentialSources.has(value)) {
      throw new CliArgumentError(
        '--credential-source must be either existing or file.',
      );
    }
    index += 1;
  }

  if (argv.includes('--live') && argv.includes('--dry-run')) {
    throw new CliArgumentError('--live cannot be combined with --dry-run.');
  }
}

export function normalizeIssueReference(value: string): string {
  const normalized = value.startsWith('#') ? value.slice(1) : value;
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new CliArgumentError(
      '--issue must be a positive issue number, such as 123 or #123.',
    );
  }
  return `#${normalized}`;
}

export function parsePositiveSafeInteger(
  value: string,
  label: string,
): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new CliArgumentError(`${label} must be a positive safe integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CliArgumentError(`${label} must be a positive safe integer.`);
  }
  return parsed;
}

export function validatePrArguments(argv: string[]): void {
  const valueOptions = new Set(['--base', '--out', '--limit', '--issue', '--mode']);
  const booleanOptions = new Set([
    '--dry-run',
    '--create-pr',
    '--skip-format',
    '--no-format',
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!option) {
      continue;
    }
    if (booleanOptions.has(option)) {
      continue;
    }
    if (!valueOptions.has(option)) {
      rejectUnknown('pr', option);
    }

    const value = requireValue(argv, index, option);
    if (option === '--limit') {
      parsePositiveSafeInteger(value, '--limit');
    }
    if (option === '--mode' && value !== 'feature' && value !== 'release') {
      throw new CliArgumentError('--mode must be either feature or release.');
    }
    if (option === '--issue') {
      normalizeIssueReference(value);
    }
    index += 1;
  }
}

export function validateCommandArguments(command: string, argv: string[]): void {
  if (command === 'commit') {
    validateCommitArguments(argv);
    return;
  }
  if (command === 'doctor') {
    validateDoctorArguments(argv);
    return;
  }
  if (command === 'init') {
    validateInitArguments(argv);
    return;
  }
  validatePrArguments(argv);
}
