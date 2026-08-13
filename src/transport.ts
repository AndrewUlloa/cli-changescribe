import OpenAI from 'openai';
import type { Fetch } from 'openai/core';
import { fetch as sdkFetch } from 'openai/_shims/index';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { classifyTransportError, TransportError } from './errors';
import type { PublicProviderProfile, ResolvedProvider } from './provider';

export const DEFAULT_TIMEOUT_MS = 120_000;

export type CompletionIntent = 'workflow' | 'doctor';

export interface ParsedCompletion {
  readonly content: string;
  readonly reasoning: string;
  readonly finishReason: string | null;
}

type ExtendedChatRequest = ChatCompletionCreateParamsNonStreaming & {
  reasoning_effort?: 'high';
};

export function buildChatRequest(
  profile: PublicProviderProfile,
  messages: ChatCompletionMessageParam[],
  outputLimit?: number,
  intent: CompletionIntent = 'workflow',
): ExtendedChatRequest {
  const request: ExtendedChatRequest = {
    model: profile.model,
    messages,
  };
  if (outputLimit !== undefined && profile.outputTokenField) {
    if (profile.outputTokenField === 'max_completion_tokens') {
      request.max_completion_tokens = outputLimit;
    } else {
      request.max_tokens = outputLimit;
    }
  }
  if (
    intent === 'workflow' &&
    profile.id === 'groq' &&
    profile.model === 'openai/gpt-oss-120b'
  ) {
    request.reasoning_effort = 'high';
  }
  return request;
}

const noRedirectFetch: Fetch = (input, init) => {
  return sdkFetch(input, { ...init, redirect: 'error' });
};

export interface TransportOptions {
  readonly timeoutMs?: number;
}

export function createOpenAIClient(
  resolved: ResolvedProvider,
  options: TransportOptions,
): OpenAI {
  return new OpenAI({
    apiKey: resolved.credential.value,
    baseURL: resolved.profile.baseURL,
    maxRetries: 0,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetch: noRedirectFetch,
    ...(resolved.profile.defaultHeaders
      ? { defaultHeaders: { ...resolved.profile.defaultHeaders } }
      : {}),
  });
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = Reflect.get(value, key);
  return typeof candidate === 'string' ? candidate : undefined;
}

export function parseChatResponse(value: unknown): ParsedCompletion {
  if (typeof value !== 'object' || value === null) {
    throw new TransportError({
      category: 'incompatible_response',
      provider: 'unknown',
      endpoint: 'unknown',
      providerMessage: 'Provider returned an incompatible response',
    });
  }
  const choices: unknown = Reflect.get(value, 'choices');
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message =
    typeof first === 'object' && first !== null
      ? Reflect.get(first, 'message')
      : undefined;
  const content = stringField(message, 'content') ?? '';
  const reasoning = stringField(message, 'reasoning') ?? '';
  const finishReason = stringField(first, 'finish_reason') ?? null;
  if (!content && !reasoning && finishReason !== 'length') {
    throw new TransportError({
      category: 'incompatible_response',
      provider: 'unknown',
      endpoint: 'unknown',
      providerMessage: 'Provider returned an incompatible response',
    });
  }
  return Object.freeze({ content, reasoning, finishReason });
}

export interface CompleteChatInput {
  readonly messages: ChatCompletionMessageParam[];
  readonly outputLimit?: number;
  readonly intent?: CompletionIntent;
}

export async function completeChat(
  resolved: ResolvedProvider,
  input: CompleteChatInput,
  options: TransportOptions = {},
): Promise<ParsedCompletion> {
  const client = createOpenAIClient(resolved, options);
  try {
    const response = await client.chat.completions.create(
      buildChatRequest(
        resolved.profile,
        input.messages,
        input.outputLimit,
        input.intent,
      ),
    );
    try {
      return parseChatResponse(response);
    } catch (error) {
      if (error instanceof TransportError) {
        throw new TransportError({
          category: 'incompatible_response',
          provider: resolved.profile.id,
          endpoint: new URL(resolved.profile.baseURL).hostname,
          providerMessage: error.providerMessage,
        });
      }
      throw error;
    }
  } catch (error) {
    throw classifyTransportError(error, resolved.profile);
  }
}
