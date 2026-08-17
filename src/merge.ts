import { validateMergeArguments } from './arguments';
import type { ConventionalTitleDraft } from './artifact-draft';
import { parseConventionalTitle } from './artifact-renderer';
import {
  assertGitHubRepositoryIdentityCurrent,
  resolveGitHubRepositoryIdentity,
  type GitHubRepositoryIdentity,
} from './github-repository';
import { createNodePrompter } from './prompts';
import {
  loadRepositoryPolicy,
  type LoadedRepositoryPolicy,
} from './repository-policy';
import { knownSecretValues, loadRuntimeConfig } from './runtime-config';
import {
  createCommandRunner,
  type CommandOptions,
  type CommandRunner,
} from './subprocess';

const SHA_RE = /^[0-9a-f]{40,64}$/u;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u;
const SAFE_TEXT_RE =
  /^[^\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]+$/u;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024;
const MAX_GH_OUTPUT_BYTES = 256 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;
const MINIMUM_GH_VERSION = Object.freeze([2, 50, 0] as const);

class MergeValidationError extends Error {
  override readonly name = 'MergeValidationError';
}

interface MergeCommandExecutor {
  exec(file: string, args: readonly string[], options?: CommandOptions): string;
}

export interface MergeDependencies {
  readonly runner?: MergeCommandExecutor;
  readonly resolveRepository?: () => GitHubRepositoryIdentity;
  readonly assertRepositoryCurrent?: (
    expected: GitHubRepositoryIdentity,
  ) => void;
  readonly loadPolicy?: (revision: string) => LoadedRepositoryPolicy;
  readonly confirm?: (message: string) => Promise<boolean>;
  readonly isInteractive?: () => boolean;
  readonly knownSecrets?: readonly string[];
  readonly loadKnownSecrets?: () => readonly string[];
  readonly log?: (message: string) => void;
}

interface PullRequestView {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly baseRefOid: string;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly reviewDecision: 'APPROVED' | null;
  readonly latestReviewStates: readonly string[];
}

interface PullRequestCheck {
  readonly bucket: 'pass' | 'skipping';
  readonly name: string;
  readonly state: string;
  readonly workflow: string;
}

interface MergeSnapshot {
  readonly repository: GitHubRepositoryIdentity;
  readonly branch: string;
  readonly headSha: string;
  readonly pullRequest: PullRequestView;
  readonly title: ConventionalTitleDraft;
  readonly checks: readonly PullRequestCheck[];
  readonly stableState: string;
}

function defaultRunner(): CommandRunner {
  return createCommandRunner({
    ...process.env,
    GH_PROMPT_DISABLED: '1',
    GIT_TERMINAL_PROMPT: '0',
  });
}

function withCommandTimeout(
  runner: MergeCommandExecutor,
): MergeCommandExecutor {
  return Object.freeze({
    exec(
      file: string,
      args: readonly string[],
      options: CommandOptions = {},
    ): string {
      return runner.exec(file, args, {
        ...options,
        timeout: COMMAND_TIMEOUT_MS,
      });
    },
  });
}

function exec(
  runner: MergeCommandExecutor,
  file: string,
  args: readonly string[],
  maximum = MAX_GIT_OUTPUT_BYTES,
  input?: string,
): string {
  return runner.exec(file, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: maximum,
    timeout: COMMAND_TIMEOUT_MS,
    ...(input === undefined ? {} : { input }),
  });
}

function asMergeValidation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof MergeValidationError) {
      throw error;
    }
    throw new MergeValidationError(
      error instanceof Error
        ? error.message
        : 'GitHub returned invalid merge-validation data.',
    );
  }
}

function assertSupportedGitHubCli(runner: MergeCommandExecutor): void {
  let output: string;
  try {
    output = exec(runner, 'gh', ['--version'], 4_096);
  } catch {
    throw new Error('Merge requires GitHub CLI 2.50.0 or newer.');
  }
  const match = /^gh version (\d+)\.(\d+)\.(\d+)(?:\s|$)/u.exec(output);
  if (match === null) {
    throw new Error('Merge requires GitHub CLI 2.50.0 or newer.');
  }
  const version = match.slice(1, 4).map(Number);
  let comparison = 0;
  for (let index = 0; index < MINIMUM_GH_VERSION.length; index += 1) {
    if (version[index] > MINIMUM_GH_VERSION[index]) {
      comparison = 1;
      break;
    }
    if (version[index] < MINIMUM_GH_VERSION[index]) {
      comparison = -1;
      break;
    }
  }
  if (comparison < 0) {
    throw new Error('Merge requires GitHub CLI 2.50.0 or newer.');
  }
}

function assertTitleContainsNoSecret(
  title: string,
  knownSecrets: readonly string[],
): void {
  if (knownSecrets.some((secret) => secret.length > 0 && title.includes(secret))) {
    throw new Error('Pull-request title contains a configured secret.');
  }
}

function safeString(value: unknown, label: string, maximum = 512): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    !SAFE_TEXT_RE.test(value) ||
    Buffer.from(value, 'utf8').toString('utf8') !== value
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`);
  }
  return value;
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    (value.length > 0 && !SAFE_TEXT_RE.test(value)) ||
    Buffer.from(value, 'utf8').toString('utf8') !== value
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`);
  }
  return value;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    throw new Error(`GitHub returned an invalid ${label}.`);
  }
  return value;
}

function branch(value: unknown, label: string): string {
  const name = safeString(value, label, 255);
  if (
    !BRANCH_RE.test(name) ||
    name.includes('..') ||
    name.includes('//') ||
    name.endsWith('.') ||
    name.endsWith('/') ||
    name.endsWith('.lock') ||
    name.startsWith('-') ||
    name.includes('@{')
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`);
  }
  return name;
}

function parseJson(output: string, label: string): unknown {
  if (Buffer.byteLength(output, 'utf8') > MAX_GH_OUTPUT_BYTES) {
    throw new Error(`GitHub returned oversized ${label} data.`);
  }
  try {
    return JSON.parse(output) as unknown;
  } catch {
    throw new Error(`GitHub returned invalid ${label} data.`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`GitHub returned invalid ${label} data.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error(`GitHub returned invalid ${label} data.`);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const expected = new Set(allowed);
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !expected.has(key))) {
    throw new Error(`GitHub returned unexpected ${label} data.`);
  }
}

function parsePullRequestNumberList(output: string): number {
  return asMergeValidation(() => {
    const values = array(parseJson(output, 'pull-request lookup'), 'pull-request lookup');
    if (values.length !== 1) {
      throw new Error('Expected exactly one open pull request for the current branch.');
    }
    const entry = record(values[0], 'pull-request lookup');
    exactKeys(entry, ['number'], 'pull-request lookup');
    if (!Number.isSafeInteger(entry.number) || (entry.number as number) <= 0) {
      throw new Error('GitHub returned an invalid pull-request number.');
    }
    return entry.number as number;
  });
}

function parseReviewStates(value: unknown): readonly string[] {
  return Object.freeze(
    array(value, 'pull-request reviews').map((entry) => {
      const review = record(entry, 'pull-request review');
      return safeString(review.state, 'pull-request review state', 64);
    }),
  );
}

function parsePullRequestView(output: string): PullRequestView {
  return asMergeValidation(() => parsePullRequestViewValue(output));
}

function parsePullRequestViewValue(output: string): PullRequestView {
  const value = record(parseJson(output, 'pull-request'), 'pull-request');
  const fields = [
    'number', 'title', 'url', 'state', 'isDraft', 'isCrossRepository',
    'baseRefName', 'baseRefOid', 'headRefName', 'headRefOid', 'mergeable',
    'mergeStateStatus', 'reviewDecision', 'reviewRequests', 'latestReviews',
    'autoMergeRequest',
  ] as const;
  exactKeys(value, fields, 'pull-request');
  if (!Number.isSafeInteger(value.number) || (value.number as number) <= 0) {
    throw new Error('GitHub returned an invalid pull-request number.');
  }
  if (
    value.state !== 'OPEN' ||
    value.isDraft !== false ||
    value.isCrossRepository !== false
  ) {
    throw new Error('The pull request must be open, ready, and from this repository.');
  }
  if (value.mergeable !== 'MERGEABLE' || value.mergeStateStatus !== 'CLEAN') {
    throw new Error('The pull request is not currently clean and mergeable.');
  }
  if (
    value.reviewDecision !== null &&
    value.reviewDecision !== '' &&
    value.reviewDecision !== 'APPROVED'
  ) {
    throw new Error('The pull request has not satisfied its review decision.');
  }
  const reviewRequests = array(value.reviewRequests, 'pull-request review requests');
  const latestReviewStates = parseReviewStates(value.latestReviews);
  if (
    reviewRequests.length > 0 ||
    latestReviewStates.includes('CHANGES_REQUESTED')
  ) {
    throw new Error('The pull request still has pending or requested review changes.');
  }
  if (value.autoMergeRequest !== null) {
    throw new Error('The pull request already has an automatic merge request.');
  }
  return Object.freeze({
    number: value.number as number,
    title: safeString(value.title, 'pull-request title', 256),
    url: safeString(value.url, 'pull-request URL', 2_048),
    baseRefName: branch(value.baseRefName, 'pull-request base branch'),
    baseRefOid: sha(value.baseRefOid, 'pull-request base revision'),
    headRefName: branch(value.headRefName, 'pull-request head branch'),
    headRefOid: sha(value.headRefOid, 'pull-request head revision'),
    reviewDecision: value.reviewDecision === 'APPROVED' ? 'APPROVED' : null,
    latestReviewStates,
  });
}

function parseChecks(output: string): readonly PullRequestCheck[] {
  return asMergeValidation(() => parseCheckValues(output));
}

function parseCheckValues(output: string): readonly PullRequestCheck[] {
  const values = array(parseJson(output, 'pull-request checks'), 'pull-request checks');
  if (values.length === 0) {
    throw new Error('The pull request has no reported checks.');
  }
  const checks = values.map((entry) => {
    const check = record(entry, 'pull-request check');
    exactKeys(check, ['bucket', 'name', 'state', 'workflow'], 'pull-request check');
    if (check.bucket !== 'pass' && check.bucket !== 'skipping') {
      throw new Error('The pull request has checks that are not complete and successful.');
    }
    return Object.freeze({
      bucket: check.bucket,
      name: safeString(check.name, 'pull-request check name', 256),
      state: safeString(check.state, 'pull-request check state', 64),
      workflow: boundedString(check.workflow, 'pull-request check workflow', 256),
    });
  });
  return Object.freeze(
    checks.sort((left, right) =>
      `${left.workflow}\u0000${left.name}\u0000${left.state}`.localeCompare(
        `${right.workflow}\u0000${right.name}\u0000${right.state}`,
        'en-US',
      ),
    ),
  );
}

const MERGE_QUEUE_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){isMergeQueueEnabled isInMergeQueue}}}';

function repositoryCoordinates(repository: GitHubRepositoryIdentity): {
  readonly hostname: string;
  readonly owner: string;
  readonly name: string;
} {
  const [hostname, owner, name, ...extra] = repository.ghRepo.split('/');
  if (!hostname || !owner || !name || extra.length > 0) {
    throw new Error('The pinned GitHub repository identity is invalid.');
  }
  return Object.freeze({ hostname, owner, name });
}

function assertMergeQueueDisabled(
  runner: MergeCommandExecutor,
  repository: GitHubRepositoryIdentity,
  number: number,
): void {
  const coordinates = repositoryCoordinates(repository);
  let value: Record<string, unknown>;
  try {
    value = record(
      parseJson(
        exec(
          runner,
          'gh',
          [
            'api', '--hostname', coordinates.hostname, '--method', 'POST',
            'graphql', '-H', 'GraphQL-Features: merge_queue', '--input', '-',
          ],
          MAX_GH_OUTPUT_BYTES,
          JSON.stringify({
            query: MERGE_QUEUE_QUERY,
            variables: {
              owner: coordinates.owner,
              name: coordinates.name,
              number,
            },
          }),
        ),
        'merge-queue status',
      ),
      'merge-queue status',
    );
  } catch {
    throw new Error('Could not validate the pull-request merge-queue status.');
  }
  exactKeys(value, ['data'], 'merge-queue status');
  const data = record(value.data, 'merge-queue status');
  exactKeys(data, ['repository'], 'merge-queue status');
  const repositoryValue = record(data.repository, 'merge-queue status');
  exactKeys(repositoryValue, ['pullRequest'], 'merge-queue status');
  const pullRequest = record(repositoryValue.pullRequest, 'merge-queue status');
  exactKeys(
    pullRequest,
    ['isMergeQueueEnabled', 'isInMergeQueue'],
    'merge-queue status',
  );
  if (
    typeof pullRequest.isMergeQueueEnabled !== 'boolean' ||
    typeof pullRequest.isInMergeQueue !== 'boolean'
  ) {
    throw new Error('GitHub returned invalid merge-queue status data.');
  }
  if (pullRequest.isMergeQueueEnabled || pullRequest.isInMergeQueue) {
    throw new Error(
      'This pull request uses a merge queue, which Diffwright will not bypass.',
    );
  }
}

function remoteSha(
  runner: MergeCommandExecutor,
  reference: string,
  label: string,
): string {
  let output: string;
  try {
    output = exec(runner, 'git', [
      'ls-remote', '--exit-code', 'origin', reference,
    ]);
  } catch {
    throw new Error(`The remote ${label} is unavailable.`);
  }
  const match = /^([0-9a-f]{40,64})\t[^\r\n]+\r?\n?$/u.exec(output);
  if (match === null) {
    throw new Error(`The remote ${label} returned an invalid revision.`);
  }
  return match[1];
}

function stableState(
  repository: GitHubRepositoryIdentity,
  branchName: string,
  headSha: string,
  pullRequest: PullRequestView,
  checks: readonly PullRequestCheck[],
): string {
  return JSON.stringify({ repository, branchName, headSha, pullRequest, checks });
}

function collectSnapshot(
  dependencies: Required<
    Pick<MergeDependencies, 'runner' | 'resolveRepository' | 'loadPolicy'>
  >,
  expectedNumber?: number,
): MergeSnapshot {
  const { runner } = dependencies;
  let currentBranch: string;
  try {
    currentBranch = branch(
      exec(runner, 'git', ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim(),
      'current branch',
    );
    exec(runner, 'git', ['check-ref-format', '--branch', currentBranch]);
  } catch {
    throw new Error('Merge requires an attached, valid current branch.');
  }
  let status: string;
  let headOutput: string;
  try {
    status = exec(runner, 'git', [
      'status', '--porcelain=v1', '-z', '--untracked-files=normal',
    ]);
    headOutput = exec(runner, 'git', [
      'rev-parse', '--verify', 'HEAD^{commit}',
    ]);
  } catch {
    throw new Error('Could not inspect the local working tree and head revision.');
  }
  if (status.length > 0) {
    throw new Error('Merge requires a clean working tree.');
  }
  const headSha = sha(
    headOutput.trim(),
    'local head revision',
  );
  const repository = dependencies.resolveRepository();
  if (
    remoteSha(runner, `refs/heads/${currentBranch}`, 'feature branch') !== headSha
  ) {
    throw new Error('The local and remote feature branch revisions do not match.');
  }

  let number: number;
  try {
    number = parsePullRequestNumberList(
      exec(runner, 'gh', [
        'pr', 'list', '--head', currentBranch, '--state', 'open', '--limit', '2',
        '--json', 'number', '--repo', repository.ghRepo,
      ], MAX_GH_OUTPUT_BYTES),
    );
  } catch (error) {
    if (error instanceof MergeValidationError) {
      throw error;
    }
    throw new Error('Could not resolve the current pull request from GitHub.');
  }
  if (expectedNumber !== undefined && number !== expectedNumber) {
    throw new Error('The current pull request changed during merge validation.');
  }

  let pullRequest: PullRequestView;
  try {
    pullRequest = parsePullRequestView(
      exec(runner, 'gh', [
        'pr', 'view', String(number), '--json',
        'number,title,url,state,isDraft,isCrossRepository,baseRefName,baseRefOid,headRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,reviewRequests,latestReviews,autoMergeRequest',
        '--repo', repository.ghRepo,
      ], MAX_GH_OUTPUT_BYTES),
    );
  } catch (error) {
    if (error instanceof MergeValidationError) {
      throw error;
    }
    throw new Error('Could not validate the current pull request on GitHub.');
  }
  if (
    pullRequest.number !== number ||
    pullRequest.headRefName !== currentBranch ||
    pullRequest.headRefOid !== headSha ||
    pullRequest.baseRefOid === headSha
  ) {
    throw new Error('The pull request does not match the reviewed branch revisions.');
  }
  assertMergeQueueDisabled(runner, repository, number);
  if (
    remoteSha(runner, `refs/heads/${pullRequest.baseRefName}`, 'base branch') !==
    pullRequest.baseRefOid
  ) {
    throw new Error('The remote base branch changed during merge validation.');
  }
  try {
    exec(runner, 'git', [
      'cat-file', '-e', `${pullRequest.baseRefOid}^{commit}`,
    ]);
  } catch {
    throw new Error(
      'The pull-request base revision is not available locally. Fetch it and retry.',
    );
  }
  const loadedPolicy = dependencies.loadPolicy(pullRequest.baseRefOid);
  const title = parseConventionalTitle(pullRequest.title, loadedPolicy.policy.title);

  let checks: readonly PullRequestCheck[];
  try {
    checks = parseChecks(
      exec(runner, 'gh', [
        'pr', 'checks', String(number), '--json', 'bucket,name,state,workflow',
        '--repo', repository.ghRepo,
      ], MAX_GH_OUTPUT_BYTES),
    );
  } catch (error) {
    if (error instanceof MergeValidationError) {
      throw error;
    }
    throw new Error('Could not validate the pull-request checks on GitHub.');
  }

  return Object.freeze({
    repository,
    branch: currentBranch,
    headSha,
    pullRequest,
    title,
    checks,
    stableState: stableState(repository, currentBranch, headSha, pullRequest, checks),
  });
}

async function defaultConfirm(message: string): Promise<boolean> {
  const prompter = createNodePrompter();
  try {
    return await prompter.confirm(message, false);
  } finally {
    prompter.close();
  }
}

function parseMergeResponse(output: string): string {
  const value = record(parseJson(output, 'merge response'), 'merge response');
  exactKeys(value, ['sha', 'merged', 'message'], 'merge response');
  if (value.merged !== true) {
    throw new Error('GitHub did not confirm an immediate merge.');
  }
  safeString(value.message, 'merge response message', 512);
  return sha(value.sha, 'merge response revision');
}

function parsePostcondition(output: string, expectedMergeSha: string): string {
  const value = record(parseJson(output, 'merge postcondition'), 'merge postcondition');
  exactKeys(value, ['state', 'mergedAt', 'mergeCommit'], 'merge postcondition');
  if (value.state !== 'MERGED' || typeof value.mergedAt !== 'string') {
    throw new Error('Merge postcondition was not confirmed.');
  }
  safeString(value.mergedAt, 'merge timestamp', 128);
  if (Number.isNaN(Date.parse(value.mergedAt))) {
    throw new Error('GitHub returned an invalid merge timestamp.');
  }
  const mergeCommit = record(value.mergeCommit, 'merge commit');
  exactKeys(mergeCommit, ['oid'], 'merge commit');
  const mergeSha = sha(mergeCommit.oid, 'merge commit revision');
  if (mergeSha !== expectedMergeSha) {
    throw new Error('GitHub returned a different merge commit revision.');
  }
  return mergeSha;
}

function defaultKnownSecrets(): readonly string[] {
  return knownSecretValues(loadRuntimeConfig().values);
}

function apiTarget(repository: GitHubRepositoryIdentity, number: number): {
  readonly hostname: string;
  readonly path: string;
} {
  const { hostname, owner, name } = repositoryCoordinates(repository);
  return Object.freeze({
    hostname,
    path: `repos/${owner}/${name}/pulls/${number}/merge`,
  });
}

export async function runMerge(
  argv: string[] = [],
  dependencies: MergeDependencies = {},
): Promise<void> {
  validateMergeArguments(argv);
  const dryRun = argv.includes('--dry-run');
  const yes = argv.includes('--yes');
  const runner = withCommandTimeout(dependencies.runner ?? defaultRunner());
  const resolveRepository = dependencies.resolveRepository ??
    (() => resolveGitHubRepositoryIdentity(runner));
  const assertRepositoryCurrent = dependencies.assertRepositoryCurrent ??
    ((expected: GitHubRepositoryIdentity) =>
      assertGitHubRepositoryIdentityCurrent(expected, runner));
  const loadPolicy = dependencies.loadPolicy ??
    ((revision: string) => loadRepositoryPolicy({ revision, runner }));
  const confirm = dependencies.confirm ?? defaultConfirm;
  const isInteractive = dependencies.isInteractive ??
    (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  const log = dependencies.log ?? console.log;
  let knownSecrets: readonly string[];
  try {
    knownSecrets = dependencies.knownSecrets ??
      (dependencies.loadKnownSecrets ?? defaultKnownSecrets)();
  } catch {
    throw new Error('Could not safely load configured secrets.');
  }
  const mergeDependencies = { runner, resolveRepository, loadPolicy };

  assertSupportedGitHubCli(runner);
  const initial = collectSnapshot(mergeDependencies);
  assertTitleContainsNoSecret(initial.pullRequest.title, knownSecrets);
  log(`Repository: ${initial.repository.ghRepo}`);
  log(`Pull request: #${initial.pullRequest.number}`);
  log(`Title: ${initial.pullRequest.title}`);
  log(`Head: ${initial.headSha}`);
  log(`Checks: ${initial.checks.length} complete`);
  if (dryRun) {
    log('Dry run complete. No merge was performed.');
    return;
  }
  if (!yes) {
    if (!isInteractive()) {
      throw new Error('Noninteractive merge requires --yes.');
    }
    if (!(await confirm(
      `Squash-merge PR #${initial.pullRequest.number} with this exact title?`,
    ))) {
      log('Merge cancelled.');
      return;
    }
  }

  const current = collectSnapshot(mergeDependencies, initial.pullRequest.number);
  assertTitleContainsNoSecret(current.pullRequest.title, knownSecrets);
  if (current.stableState !== initial.stableState) {
    throw new Error('Pull-request state changed after the merge preview. Retry.');
  }
  assertRepositoryCurrent(initial.repository);

  try {
    const target = apiTarget(initial.repository, initial.pullRequest.number);
    const mutationResponse = exec(
      runner,
      'gh',
      [
        'api', '--hostname', target.hostname, '--method', 'PUT', target.path,
        '--input', '-',
      ],
      MAX_GH_OUTPUT_BYTES,
      JSON.stringify({
        commit_title: initial.pullRequest.title,
        sha: initial.headSha,
        merge_method: 'squash',
      }),
    );
    const requestedMergeSha = parseMergeResponse(mutationResponse);
    const postcondition = exec(runner, 'gh', [
      'pr', 'view', String(initial.pullRequest.number), '--json',
      'state,mergedAt,mergeCommit', '--repo', initial.repository.ghRepo,
    ], MAX_GH_OUTPUT_BYTES);
    const mergeSha = parsePostcondition(postcondition, requestedMergeSha);
    log(`Merged PR #${initial.pullRequest.number} as ${mergeSha}.`);
  } catch {
    throw new Error(
      `Merge outcome for PR #${initial.pullRequest.number} could not be confirmed. Inspect it before retrying.`,
    );
  }
}
