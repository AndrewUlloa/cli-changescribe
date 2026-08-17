import {
  execFileSync as nodeExecFileSync,
  spawnSync as nodeSpawnSync,
  type SpawnSyncReturns,
  type StdioOptions,
} from 'node:child_process';
import { sanitizeChildEnvironment } from './runtime-config';

export interface CommandOptions {
  readonly cwd?: string;
  readonly encoding?: 'utf8';
  readonly input?: string;
  readonly maxBuffer?: number;
  readonly stdio?: StdioOptions;
  readonly timeout?: number;
}

export interface SpawnOptions {
  readonly cwd?: string;
  readonly encoding?: 'utf8';
  readonly maxBuffer?: number;
  readonly stdio?: StdioOptions;
}

export interface CommandRunner {
  exec(
    file: string,
    args: readonly string[],
    options?: CommandOptions,
  ): string;
  spawn(
    file: string,
    args: readonly string[],
    options?: SpawnOptions,
  ): SpawnSyncReturns<string>;
}

function makeCommandRunner(
  environment: () => NodeJS.ProcessEnv,
): CommandRunner {
  return Object.freeze({
    exec(
      file: string,
      args: readonly string[],
      options: CommandOptions = {},
    ): string {
      return nodeExecFileSync(file, [...args], {
        ...options,
        encoding: 'utf8',
        env: sanitizeChildEnvironment(environment()),
      });
    },
    spawn(
      file: string,
      args: readonly string[],
      options: SpawnOptions = {},
    ): SpawnSyncReturns<string> {
      return nodeSpawnSync(file, [...args], {
        ...options,
        encoding: 'utf8',
        env: sanitizeChildEnvironment(environment()),
      });
    },
  });
}

export function createCommandRunner(env: NodeJS.ProcessEnv): CommandRunner {
  const snapshot = { ...env };
  return makeCommandRunner(() => snapshot);
}

export const defaultCommandRunner = makeCommandRunner(() => process.env);
