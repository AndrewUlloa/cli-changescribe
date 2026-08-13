import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';

export type ConfigSource = 'shell' | '.env.local';

export const CREDENTIAL_ENV_NAMES = Object.freeze([
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'XAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY',
  'AI_GATEWAY_API_KEY',
  'VERCEL_OIDC_TOKEN',
  'CEREBRAS_API_KEY',
  'GROQ_API_KEY',
  'DIFFWRIGHT_API_KEY',
] as const);

export interface RuntimeConfig {
  readonly values: Readonly<NodeJS.ProcessEnv>;
  readonly sources: Readonly<Record<string, ConfigSource>>;
}

export interface LoadRuntimeConfigOptions {
  cwd?: string;
  shellEnv?: NodeJS.ProcessEnv;
}

function readLocalEnvironment(cwd: string): Record<string, string> {
  const filename = path.join(cwd, '.env.local');
  try {
    return parse(fs.readFileSync(filename));
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      Reflect.get(error, 'code') === 'ENOENT'
    ) {
      return {};
    }
    throw error;
  }
}

export function loadRuntimeConfig(
  options: LoadRuntimeConfigOptions = {},
): RuntimeConfig {
  const cwd = options.cwd ?? process.cwd();
  const shellEnv = options.shellEnv ?? process.env;
  const fileEnv = readLocalEnvironment(cwd);
  const values: NodeJS.ProcessEnv = { ...fileEnv };
  const sources: Record<string, ConfigSource> = {};

  for (const name of Object.keys(fileEnv)) {
    sources[name] = '.env.local';
  }
  for (const [name, value] of Object.entries(shellEnv)) {
    values[name] = value;
    sources[name] = 'shell';
  }

  return Object.freeze({
    values: Object.freeze(values),
    sources: Object.freeze(sources),
  });
}

export function sanitizeChildEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  for (const name of CREDENTIAL_ENV_NAMES) {
    delete sanitized[name];
  }
  return sanitized;
}

export function knownSecretValues(env: NodeJS.ProcessEnv): readonly string[] {
  return Object.freeze(
    CREDENTIAL_ENV_NAMES.map((name) => env[name]).filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  );
}
