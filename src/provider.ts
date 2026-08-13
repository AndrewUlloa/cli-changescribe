import OpenAI from 'openai';
import type { ConfigSource } from './runtime-config';

export const SUPPORTED_PROVIDER_IDS = Object.freeze([
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'openrouter',
  'vercel',
  'cerebras',
  'groq',
  'ollama',
  'custom',
] as const);

export type ProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];
export type CommandPurpose = 'commit' | 'pr' | 'doctor';
export type CompatibilityStatus =
  | 'docs-verified'
  | 'experimental'
  | 'live-verified'
  | 'user-defined';
export type OutputTokenField =
  | 'max_tokens'
  | 'max_completion_tokens'
  | null;
export type CredentialSource = ConfigSource | 'dummy';

export interface PublicProviderProfile {
  readonly id: ProviderId;
  readonly baseURL: string;
  readonly model: string;
  readonly credentialEnv: string | null;
  readonly transport: 'openai-chat-completions';
  readonly status: CompatibilityStatus;
  readonly outputTokenField: OutputTokenField;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

export interface PrivateCredential {
  readonly value: string;
  readonly source: CredentialSource;
}

export interface ResolvedProvider {
  readonly profile: Readonly<PublicProviderProfile>;
  readonly credential: Readonly<PrivateCredential>;
}

interface Preset {
  readonly id: Exclude<ProviderId, 'custom' | 'ollama'>;
  readonly baseURL: string;
  readonly credentialEnvs: readonly string[];
  readonly outputTokenField: OutputTokenField;
  readonly status: CompatibilityStatus;
  readonly defaultModel?: string;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

const PRESETS: Readonly<
  Record<Exclude<ProviderId, 'custom' | 'ollama'>, Preset>
> = Object.freeze({
  openai: {
    id: 'openai',
    baseURL: 'https://api.openai.com/v1',
    credentialEnvs: ['OPENAI_API_KEY'],
    outputTokenField: 'max_completion_tokens',
    status: 'docs-verified',
  },
  anthropic: {
    id: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    credentialEnvs: ['ANTHROPIC_API_KEY'],
    outputTokenField: 'max_tokens',
    status: 'experimental',
  },
  google: {
    id: 'google',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    credentialEnvs: ['GEMINI_API_KEY'],
    outputTokenField: null,
    status: 'docs-verified',
    defaultHeaders: Object.freeze({
      'x-goog-api-client': 'diffwright/0.3.0',
    }),
  },
  xai: {
    id: 'xai',
    baseURL: 'https://api.x.ai/v1',
    credentialEnvs: ['XAI_API_KEY'],
    outputTokenField: 'max_tokens',
    status: 'docs-verified',
  },
  deepseek: {
    id: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    credentialEnvs: ['DEEPSEEK_API_KEY'],
    outputTokenField: 'max_tokens',
    status: 'docs-verified',
  },
  openrouter: {
    id: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    credentialEnvs: ['OPENROUTER_API_KEY'],
    outputTokenField: 'max_completion_tokens',
    status: 'docs-verified',
  },
  vercel: {
    id: 'vercel',
    baseURL: 'https://ai-gateway.vercel.sh/v1',
    credentialEnvs: ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN'],
    outputTokenField: 'max_tokens',
    status: 'docs-verified',
  },
  cerebras: {
    id: 'cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    credentialEnvs: ['CEREBRAS_API_KEY'],
    outputTokenField: 'max_completion_tokens',
    status: 'docs-verified',
    defaultModel: 'gpt-oss-120b',
  },
  groq: {
    id: 'groq',
    baseURL: 'https://api.groq.com/openai/v1',
    credentialEnvs: ['GROQ_API_KEY'],
    outputTokenField: 'max_completion_tokens',
    status: 'docs-verified',
    defaultModel: 'openai/gpt-oss-120b',
  },
});

export class ProviderConfigError extends Error {
  readonly code = 'provider_configuration';

  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

function hasOwn(env: NodeJS.ProcessEnv, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(env, name);
}

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function credentialSource(
  sources: Readonly<Record<string, ConfigSource>> | undefined,
  name: string,
): ConfigSource {
  return sources?.[name] ?? 'shell';
}

function freezeProfile(
  profile: PublicProviderProfile,
): Readonly<PublicProviderProfile> {
  if (profile.defaultHeaders) {
    Object.freeze(profile.defaultHeaders);
  }
  return Object.freeze(profile);
}

function legacyModel(env: NodeJS.ProcessEnv, command: CommandPurpose): string | undefined {
  if (command === 'pr') {
    return (
      env.DIFFWRIGHT_MODEL ||
      env.CHANGESCRIBE_MODEL ||
      env.GROQ_PR_MODEL ||
      env.GROQ_MODEL
    );
  }
  return env.DIFFWRIGHT_MODEL || env.CHANGESCRIBE_MODEL || env.GROQ_MODEL;
}

function resolvePreset(
  preset: Preset,
  env: NodeJS.ProcessEnv,
  sources: Readonly<Record<string, ConfigSource>> | undefined,
  command: CommandPurpose,
  explicit: boolean,
): ResolvedProvider {
  const credentialEnv = preset.credentialEnvs.find((name) => present(env[name]));
  if (!credentialEnv) {
    throw new ProviderConfigError(
      `${preset.id} requires ${preset.credentialEnvs.join(' or ')}`,
    );
  }

  const model = explicit
    ? env.DIFFWRIGHT_MODEL || preset.defaultModel
    : legacyModel(env, command) || preset.defaultModel;
  if (!model) {
    throw new ProviderConfigError(`${preset.id} requires DIFFWRIGHT_MODEL`);
  }

  const profile = freezeProfile({
    id: preset.id,
    baseURL: preset.baseURL,
    model,
    credentialEnv,
    transport: 'openai-chat-completions',
    status: preset.status,
    outputTokenField: preset.outputTokenField,
    ...(preset.defaultHeaders
      ? { defaultHeaders: { ...preset.defaultHeaders } }
      : {}),
  });
  const credential = Object.freeze({
    value: env[credentialEnv] as string,
    source: credentialSource(sources, credentialEnv),
  });
  return Object.freeze({ profile, credential });
}

function normalizeCustomBaseURL(raw: string): {
  baseURL: string;
  keylessAllowed: boolean;
} {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProviderConfigError('DIFFWRIGHT_BASE_URL must be a valid URL');
  }

  if (parsed.username || parsed.password) {
    throw new ProviderConfigError('DIFFWRIGHT_BASE_URL must not contain credentials');
  }
  if (parsed.search) {
    throw new ProviderConfigError('DIFFWRIGHT_BASE_URL must not contain a query string');
  }
  if (parsed.hash) {
    throw new ProviderConfigError('DIFFWRIGHT_BASE_URL must not contain a fragment');
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const loopback = loopbackHosts.has(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new ProviderConfigError(
      'DIFFWRIGHT_BASE_URL must use HTTPS, except HTTP loopback endpoints',
    );
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  return {
    baseURL: `${parsed.origin}${pathname}`,
    keylessAllowed: parsed.protocol === 'http:' && loopback,
  };
}

function resolveCustom(
  env: NodeJS.ProcessEnv,
  sources: Readonly<Record<string, ConfigSource>> | undefined,
): ResolvedProvider {
  const rawBaseURL = env.DIFFWRIGHT_BASE_URL;
  const rawModel = env.DIFFWRIGHT_MODEL;
  const missing: string[] = [];
  if (!present(rawBaseURL)) {
    missing.push('DIFFWRIGHT_BASE_URL');
  }
  if (!present(rawModel)) {
    missing.push('DIFFWRIGHT_MODEL');
  }
  if (missing.length > 0) {
    if (!present(env.DIFFWRIGHT_API_KEY)) {
      missing.push('DIFFWRIGHT_API_KEY');
    }
    throw new ProviderConfigError(`custom requires ${missing.join(', ')}`);
  }

  if (!present(rawBaseURL) || !present(rawModel)) {
    throw new ProviderConfigError('custom configuration is incomplete');
  }

  const normalized = normalizeCustomBaseURL(rawBaseURL);
  const hasKey = present(env.DIFFWRIGHT_API_KEY);
  if (!hasKey && !normalized.keylessAllowed) {
    throw new ProviderConfigError(
      'custom requires DIFFWRIGHT_API_KEY unless using an HTTP loopback endpoint',
    );
  }

  const profile = freezeProfile({
    id: 'custom',
    baseURL: normalized.baseURL,
    model: rawModel,
    credentialEnv: hasKey ? 'DIFFWRIGHT_API_KEY' : null,
    transport: 'openai-chat-completions',
    status: 'user-defined',
    outputTokenField: null,
  });
  const credential = Object.freeze(
    hasKey
      ? {
          value: env.DIFFWRIGHT_API_KEY as string,
          source: credentialSource(sources, 'DIFFWRIGHT_API_KEY'),
        }
      : { value: 'diffwright-local', source: 'dummy' as const },
  );
  return Object.freeze({ profile, credential });
}

function resolveOllama(env: NodeJS.ProcessEnv): ResolvedProvider {
  if (!present(env.DIFFWRIGHT_MODEL)) {
    throw new ProviderConfigError('ollama requires DIFFWRIGHT_MODEL');
  }
  return Object.freeze({
    profile: freezeProfile({
      id: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      model: env.DIFFWRIGHT_MODEL,
      credentialEnv: null,
      transport: 'openai-chat-completions',
      status: 'docs-verified',
      outputTokenField: 'max_tokens',
    }),
    credential: Object.freeze({
      value: 'diffwright-local',
      source: 'dummy' as const,
    }),
  });
}

export interface ResolveProviderOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly sources?: Readonly<Record<string, ConfigSource>>;
  readonly command: CommandPurpose;
}

export function resolveProvider({
  env,
  sources,
  command,
}: ResolveProviderOptions): ResolvedProvider | null {
  const requested = env.DIFFWRIGHT_PROVIDER?.trim();
  if (requested) {
    if (!SUPPORTED_PROVIDER_IDS.includes(requested as ProviderId)) {
      throw new ProviderConfigError(
        `Unknown DIFFWRIGHT_PROVIDER. Supported IDs: ${SUPPORTED_PROVIDER_IDS.join(', ')}`,
      );
    }
    const id = requested as ProviderId;
    if (id === 'custom') {
      return resolveCustom(env, sources);
    }
    if (id === 'ollama') {
      return resolveOllama(env);
    }
    return resolvePreset(PRESETS[id], env, sources, command, true);
  }

  if (hasOwn(env, 'DIFFWRIGHT_BASE_URL') || hasOwn(env, 'DIFFWRIGHT_API_KEY')) {
    return resolveCustom(env, sources);
  }
  if (hasOwn(env, 'AI_GATEWAY_API_KEY')) {
    return resolvePreset(PRESETS.vercel, env, sources, command, false);
  }
  if (present(env.CEREBRAS_API_KEY)) {
    return resolvePreset(PRESETS.cerebras, env, sources, command, false);
  }
  if (present(env.GROQ_API_KEY)) {
    return resolvePreset(PRESETS.groq, env, sources, command, false);
  }
  return null;
}

export type OpenAIClientOptions = ConstructorParameters<typeof OpenAI>[0];
export type OpenAIClientFactory = (options: OpenAIClientOptions) => OpenAI;

const defaultClientFactory: OpenAIClientFactory = (options) => new OpenAI(options);

export interface ProviderInfo {
  client: OpenAI;
  provider: ProviderId;
  defaultModel: string;
}

/**
 * Backward-compatible adapter retained while command workflows migrate to the
 * pure resolver and shared transport.
 */
export function createClient(
  env: NodeJS.ProcessEnv = process.env,
  clientFactory: OpenAIClientFactory = defaultClientFactory,
): ProviderInfo | null {
  const resolved = resolveProvider({ env, command: 'commit' });
  if (!resolved) {
    return null;
  }
  return {
    client: clientFactory({
      apiKey: resolved.credential.value,
      baseURL: resolved.profile.baseURL,
    }),
    provider: resolved.profile.id,
    defaultModel: resolved.profile.model,
  };
}
