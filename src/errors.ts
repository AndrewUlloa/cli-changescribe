import type { PublicProviderProfile } from './provider';

export type TransportErrorCategory =
  | 'request_incompatible'
  | 'authentication'
  | 'payment_required'
  | 'not_found'
  | 'rate_limit'
  | 'timeout'
  | 'dns'
  | 'tls'
  | 'incompatible_response'
  | 'provider_error'
  | 'connection';

export interface TransportErrorDetails {
  readonly category: TransportErrorCategory;
  readonly provider: string;
  readonly endpoint: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly providerMessage?: string;
}

export class TransportError extends Error {
  readonly category: TransportErrorCategory;
  readonly provider: string;
  readonly endpoint: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly providerMessage?: string;

  constructor(details: TransportErrorDetails) {
    super(`${details.category.replaceAll('_', ' ')}: ${details.provider} request failed`);
    this.name = 'TransportError';
    this.category = details.category;
    this.provider = details.provider;
    this.endpoint = details.endpoint;
    this.status = details.status;
    this.requestId = details.requestId;
    this.providerMessage = details.providerMessage;
  }
}

function readNumber(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = Reflect.get(value, key);
  return typeof candidate === 'number' ? candidate : undefined;
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = Reflect.get(value, key);
  return typeof candidate === 'string' ? candidate : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Provider request failed';
}

function nestedCause(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? Reflect.get(error, 'cause')
    : undefined;
}

function errorCode(error: unknown): string | undefined {
  return readString(error, 'code') ?? readString(nestedCause(error), 'code');
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (typeof headers !== 'object' || headers === null) {
    return undefined;
  }
  const get = Reflect.get(headers, 'get');
  if (typeof get === 'function') {
    const value: unknown = Reflect.apply(get, headers, [name]);
    return typeof value === 'string' ? value : undefined;
  }
  const direct = Reflect.get(headers, name) ?? Reflect.get(headers, name.toLowerCase());
  return typeof direct === 'string' ? direct : undefined;
}

function requestId(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const direct = readString(error, 'request_id') ?? readString(error, 'requestId');
  if (direct) {
    return direct;
  }
  return headerValue(Reflect.get(error, 'headers'), 'x-request-id');
}

function categoryFor(error: unknown, status: number | undefined): TransportErrorCategory {
  if (status === 400) {
    return 'request_incompatible';
  }
  if (status === 401 || status === 403) {
    return 'authentication';
  }
  if (status === 402) {
    return 'payment_required';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (status === 408) {
    return 'timeout';
  }
  if (status === 429) {
    return 'rate_limit';
  }
  if (status !== undefined && status >= 500) {
    return 'provider_error';
  }

  const code = errorCode(error)?.toUpperCase();
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'dns';
  }
  if (
    code?.startsWith('ERR_TLS') ||
    code?.startsWith('CERT_') ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ) {
    return 'tls';
  }
  const combined = `${readString(error, 'name') ?? ''} ${errorMessage(error)}`;
  if (/timeout|timed out|abort/i.test(combined)) {
    return 'timeout';
  }
  return 'connection';
}

export function classifyTransportError(
  error: unknown,
  profile: PublicProviderProfile,
): TransportError {
  if (error instanceof TransportError) {
    return error;
  }
  const status = readNumber(error, 'status');
  return new TransportError({
    category: categoryFor(error, status),
    provider: profile.id,
    endpoint: new URL(profile.baseURL).hostname,
    ...(status === undefined ? {} : { status }),
    ...(requestId(error) ? { requestId: requestId(error) } : {}),
    providerMessage: errorMessage(error).slice(0, 400),
  });
}

function redact(text: string, secrets: readonly string[]): string {
  let output = text.replace(/bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
  for (const secret of secrets) {
    if (secret.length > 0) {
      output = output.split(secret).join('[REDACTED]');
    }
  }
  return output;
}

function clean(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function formatSafeError(
  error: unknown,
  secrets: readonly string[] = [],
): string {
  let message: string;
  if (error instanceof TransportError) {
    const fields = [
      `[${error.category}]`,
      `provider=${error.provider}`,
      `endpoint=${error.endpoint}`,
      ...(error.status === undefined ? [] : [`status=${error.status}`]),
      ...(error.requestId ? [`request=${error.requestId}`] : []),
      ...(error.providerMessage ? [`message=${error.providerMessage}`] : []),
    ];
    message = fields.join(' ');
  } else {
    message = errorMessage(error);
  }
  return clean(redact(message, secrets)).slice(0, 800);
}
