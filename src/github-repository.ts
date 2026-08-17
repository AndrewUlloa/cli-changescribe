import { defaultCommandRunner, type CommandRunner } from './subprocess';

export interface GitHubRepositoryIdentity {
  readonly originUrl: string;
  readonly pushUrl: string;
  readonly ghRepo: string;
}

export function resolveGitHubRepositoryIdentity(
  runner: Pick<CommandRunner, 'exec'> = defaultCommandRunner,
): GitHubRepositoryIdentity {
  let originUrls: string[];
  let pushUrls: string[];
  try {
    originUrls = remoteUrls(runner, ['remote', 'get-url', '--all', 'origin']);
    pushUrls = remoteUrls(runner, [
      'remote',
      'get-url',
      '--push',
      '--all',
      'origin',
    ]);
  } catch {
    throw new Error(
      'Could not resolve the GitHub repository from the origin remote.',
    );
  }
  if (originUrls.length !== 1 || pushUrls.length !== 1) {
    throw new Error(
      'The origin remote must have exactly one fetch URL and one push URL.',
    );
  }
  const originUrl = originUrls[0];
  const pushUrl = pushUrls[0];
  const ghRepo = parseGitHubRepository(originUrl);
  if (parseGitHubRepository(pushUrl) !== ghRepo) {
    throw new Error(
      'The origin push destination does not match its GitHub repository.',
    );
  }
  return Object.freeze({ originUrl, pushUrl, ghRepo });
}

export function assertGitHubRepositoryIdentityCurrent(
  expected: GitHubRepositoryIdentity,
  runner: Pick<CommandRunner, 'exec'> = defaultCommandRunner,
): void {
  const current = resolveGitHubRepositoryIdentity(runner);
  if (
    current.originUrl !== expected.originUrl ||
    current.pushUrl !== expected.pushUrl ||
    current.ghRepo !== expected.ghRepo
  ) {
    throw new Error(
      'The origin GitHub repository changed during the operation. Retry the command.',
    );
  }
}

export function parseGitHubRepository(originUrl: string): string {
  if (
    originUrl.length === 0 ||
    originUrl !== originUrl.trim() ||
    /[\u0000-\u001f\u007f]/u.test(originUrl)
  ) {
    throw new Error(
      'The origin remote is not a supported GitHub repository URL.',
    );
  }

  let host: string;
  let repositoryPath: string;
  const scpMatch = /^(?:([^@/:]+)@)?([a-z0-9.-]+):(.+)$/iu.exec(originUrl);
  if (scpMatch !== null && !originUrl.includes('://')) {
    if (scpMatch[1] !== undefined && scpMatch[1] !== 'git') {
      throw new Error(
        'The origin remote is not a supported GitHub repository URL.',
      );
    }
    host = scpMatch[2];
    repositoryPath = scpMatch[3];
  } else {
    let parsed: URL;
    try {
      parsed = new URL(originUrl);
    } catch {
      throw new Error(
        'The origin remote is not a supported GitHub repository URL.',
      );
    }
    if (
      !['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol) ||
      parsed.password.length > 0 ||
      (parsed.username.length > 0 &&
        !(parsed.protocol === 'ssh:' && parsed.username === 'git')) ||
      parsed.port.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      throw new Error(
        'The origin remote is not a supported GitHub repository URL.',
      );
    }
    host = parsed.hostname;
    repositoryPath = parsed.pathname;
  }

  const segments = repositoryPath.replace(/^\/+|\/+$/gu, '').split('/');
  if (segments.length !== 2) {
    throw new Error(
      'The origin remote is not a supported GitHub repository URL.',
    );
  }
  const owner = segments[0];
  const repository = segments[1].replace(/\.git$/iu, '');
  const componentPattern = /^[a-z0-9_.-]+$/iu;
  if (
    !/^[a-z0-9.-]+$/iu.test(host) ||
    !componentPattern.test(owner) ||
    !componentPattern.test(repository) ||
    owner === '.' ||
    owner === '..' ||
    repository === '.' ||
    repository === '..'
  ) {
    throw new Error(
      'The origin remote is not a supported GitHub repository URL.',
    );
  }
  return `${host.toLocaleLowerCase('en-US')}/${owner}/${repository}`;
}

function remoteUrls(
  runner: Pick<CommandRunner, 'exec'>,
  args: readonly string[],
): string[] {
  return runner
    .exec('git', args, { encoding: 'utf8', stdio: 'pipe' })
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
}
