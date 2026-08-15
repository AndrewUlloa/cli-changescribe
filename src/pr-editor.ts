import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RenderedPullRequest } from './artifact-renderer';
import { MAX_PR_BODY_BYTES, type PrEditorAdapter } from './pr-review';
import { defaultCommandRunner, type CommandRunner } from './subprocess';

const MAX_EDITOR_FILE_BYTES = MAX_PR_BODY_BYTES + 1024;

export interface ProcessPrEditorDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly runner?: Pick<CommandRunner, 'spawn'>;
  readonly temporaryRoot?: string;
}

function resolveEditorExecutable(env: NodeJS.ProcessEnv): string {
  const preferred = env.DIFFWRIGHT_EDITOR;
  const fallback = env.EDITOR;
  const executable = preferred === undefined || preferred === ''
    ? fallback === undefined || fallback === ''
      ? 'vi'
      : fallback
    : preferred;
  if (
    executable.length === 0 ||
    executable.startsWith('-') ||
    /[\s\u0000-\u001f\u007f]/u.test(executable)
  ) {
    throw new Error(
      'DIFFWRIGHT_EDITOR or EDITOR must name one executable without arguments.',
    );
  }
  return executable;
}

function serializeArtifact(artifact: RenderedPullRequest): string {
  return `${artifact.title}\n\n${artifact.body}`;
}

function parseArtifact(
  contents: string,
  previous: RenderedPullRequest,
): RenderedPullRequest {
  const lfSeparator = contents.indexOf('\n\n');
  const crlfSeparator = contents.indexOf('\r\n\r\n');
  const usesCrlf = crlfSeparator >= 0 &&
    (lfSeparator < 0 || crlfSeparator < lfSeparator);
  const separator = usesCrlf ? crlfSeparator : lfSeparator;
  if (separator < 1) {
    throw new Error(
      'Edited pull-request artifact must keep the title and body separated by a blank line.',
    );
  }
  const title = contents.slice(0, separator);
  if (title.includes('\n') || title.includes('\r')) {
    throw new Error('Edited pull-request title must occupy one line.');
  }
  return Object.freeze({
    title,
    body: contents.slice(separator + (usesCrlf ? 4 : 2)),
    warnings: previous.warnings,
  });
}

function readEditorFile(filePath: string): string {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new Error('Edited pull-request artifact must remain a regular file.');
    }
    if (metadata.size > MAX_EDITOR_FILE_BYTES) {
      throw new Error('Edited pull-request artifact exceeds its size limit.');
    }
    return fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

export function createProcessPrEditor(
  dependencies: ProcessPrEditorDependencies = {},
): PrEditorAdapter {
  const env = dependencies.env ?? process.env;
  const runner = dependencies.runner ?? defaultCommandRunner;
  const temporaryRoot = dependencies.temporaryRoot ?? os.tmpdir();

  return Object.freeze({
    async edit(artifact: RenderedPullRequest): Promise<RenderedPullRequest> {
      const directory = fs.mkdtempSync(
        path.join(temporaryRoot, 'diffwright-pr-edit-'),
      );
      const artifactPath = path.join(directory, 'pull-request.txt');
      try {
        fs.writeFileSync(artifactPath, serializeArtifact(artifact), {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        const result = runner.spawn(resolveEditorExecutable(env), [artifactPath], {
          cwd: process.cwd(),
          encoding: 'utf8',
          stdio: 'inherit',
        });
        if (result.error !== undefined || result.status !== 0) {
          throw new Error('Pull-request editor did not exit successfully.');
        }
        return parseArtifact(readEditorFile(artifactPath), artifact);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  });
}
