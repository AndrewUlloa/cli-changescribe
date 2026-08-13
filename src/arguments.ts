export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliArgumentError';
  }
}

function rejectUnknown(command: string, option: string): never {
  throw new CliArgumentError(
    `Unknown ${command} option: ${option}. Run \`diffwright ${command} --help\` for usage.`,
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
  if (argv.length > 0) {
    rejectUnknown('init', argv[0]);
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
    if (option === '--limit' && !/^[1-9]\d*$/.test(value)) {
      throw new CliArgumentError('--limit must be a positive integer.');
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
