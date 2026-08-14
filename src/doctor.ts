import {
  resolveProvider,
  type ResolveProviderOptions,
  type ResolvedProvider,
} from './provider';
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from './runtime-config';
import {
  completeChat,
  type CompleteChatInput,
  type ParsedCompletion,
} from './transport';
import { validateDoctorArguments } from './arguments';

const DOCTOR_OUTPUT_LIMIT = 1024;

interface DoctorDependencies {
  loadRuntimeConfig(): RuntimeConfig;
  resolveProvider(options: ResolveProviderOptions): ResolvedProvider | null;
  completeChat(
    resolved: ResolvedProvider,
    input: CompleteChatInput,
  ): Promise<ParsedCompletion>;
}

const defaultDependencies: DoctorDependencies = {
  loadRuntimeConfig,
  resolveProvider,
  completeChat,
};

function parseDoctorArgs(argv: string[]): { live: boolean } {
  validateDoctorArguments(argv);
  return { live: argv.includes('--live') };
}

function printProfile(resolved: ResolvedProvider): void {
  const { profile, credential } = resolved;
  console.log(`Provider: ${profile.id}`);
  console.log(`Model: ${profile.model}`);
  console.log(`Endpoint: ${new URL(profile.baseURL).hostname}`);
  console.log(
    `Credential: ${profile.credentialEnv ?? '(none)'} (${credential.source})`,
  );
  console.log(`Transport: ${profile.transport}`);
  console.log(`Status: ${profile.status}`);
}

export async function runResolvedDoctor(
  resolved: ResolvedProvider,
  live: boolean,
  complete: DoctorDependencies['completeChat'] = completeChat,
): Promise<void> {
  printProfile(resolved);
  if (!live) {
    console.log('Configuration check: OK (offline)');
    return;
  }

  await complete(resolved, {
    messages: [
      {
        role: 'user',
        content: 'Reply with exactly OK and no other text.',
      },
    ],
    outputLimit: DOCTOR_OUTPUT_LIMIT,
    intent: 'doctor',
  });
  console.log('Live check: OK');
}

export async function runDoctor(
  argv: string[] = process.argv.slice(2),
  dependencies: DoctorDependencies = defaultDependencies,
): Promise<void> {
  const args = parseDoctorArgs(argv);
  const runtime = dependencies.loadRuntimeConfig();
  const resolved = dependencies.resolveProvider({
    env: runtime.values,
    sources: runtime.sources,
    command: 'doctor',
  });
  if (!resolved) {
    throw new Error(
      'No provider configured. Set DIFFWRIGHT_PROVIDER and its credential, or CEREBRAS_API_KEY/GROQ_API_KEY.',
    );
  }

  await runResolvedDoctor(resolved, args.live, dependencies.completeChat);
}
