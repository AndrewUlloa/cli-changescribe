import assert from 'node:assert/strict';
import test from 'node:test';

type ValidationResult = string | undefined;

interface InputOptions {
  defaultValue?: string;
  validate?: (value: string) => ValidationResult;
}

interface SecretOptions {
  allowEmpty?: boolean;
  validate?: (value: string) => ValidationResult;
}

interface SelectChoice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface SelectOptions<T extends string> {
  defaultValue?: T;
}

interface Prompter {
  input(message: string, options?: InputOptions): Promise<string>;
  select<T extends string>(
    message: string,
    choices: readonly SelectChoice<T>[],
    options?: SelectOptions<T>,
  ): Promise<T>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  secret(message: string, options?: SecretOptions): Promise<string>;
  close(): void;
}

type DataListener = (chunk: Buffer | string) => void;
type EndListener = () => void;
type ErrorListener = (error: Error) => void;

interface RawInputAdapter {
  readonly isRaw: boolean;
  isPaused(): boolean;
  setRawMode(enabled: boolean): void;
  resume(): void;
  pause(): void;
  onData(listener: DataListener): void;
  offData(listener: DataListener): void;
  onEnd(listener: EndListener): void;
  offEnd(listener: EndListener): void;
  onError(listener: ErrorListener): void;
  offError(listener: ErrorListener): void;
}

interface TerminalAdapter {
  readonly inputIsTTY: boolean;
  readonly outputIsTTY: boolean;
  readonly rawInput: RawInputAdapter;
  readLine(prompt: string, signal: AbortSignal): Promise<string | null>;
  write(text: string): void;
  close(): void;
}

interface PromptsModule {
  PromptCancelledError: new (message?: string) => Error;
  createPrompter(adapter: TerminalAdapter): Prompter;
}

const prompts: PromptsModule = require('../dist/prompts.js');

class FakeRawInput implements RawInputAdapter {
  isRaw: boolean;
  private paused: boolean;
  readonly rawModeChanges: boolean[] = [];
  readonly dataListeners = new Set<DataListener>();
  readonly endListeners = new Set<EndListener>();
  readonly errorListeners = new Set<ErrorListener>();

  constructor(options: { isRaw?: boolean; paused?: boolean } = {}) {
    this.isRaw = options.isRaw ?? false;
    this.paused = options.paused ?? true;
  }

  isPaused(): boolean {
    return this.paused;
  }

  setRawMode(enabled: boolean): void {
    this.rawModeChanges.push(enabled);
    this.isRaw = enabled;
  }

  resume(): void {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }

  onData(listener: DataListener): void {
    this.dataListeners.add(listener);
  }

  offData(listener: DataListener): void {
    this.dataListeners.delete(listener);
  }

  onEnd(listener: EndListener): void {
    this.endListeners.add(listener);
  }

  offEnd(listener: EndListener): void {
    this.endListeners.delete(listener);
  }

  onError(listener: ErrorListener): void {
    this.errorListeners.add(listener);
  }

  offError(listener: ErrorListener): void {
    this.errorListeners.delete(listener);
  }

  emitData(chunk: Buffer | string): void {
    for (const listener of [...this.dataListeners]) {
      listener(chunk);
    }
  }

  emitEnd(): void {
    for (const listener of [...this.endListeners]) {
      listener();
    }
  }

  emitError(error: Error): void {
    for (const listener of [...this.errorListeners]) {
      listener(error);
    }
  }
}

class FakeTerminal implements TerminalAdapter {
  readonly rawInput: FakeRawInput;
  readonly linePrompts: string[] = [];
  readonly output: string[] = [];
  readonly signals: AbortSignal[] = [];
  closed = false;

  constructor(
    readonly answers: Array<string | null | Error> = [],
    options: {
      inputIsTTY?: boolean;
      outputIsTTY?: boolean;
      rawInput?: FakeRawInput;
    } = {},
  ) {
    this.inputIsTTY = options.inputIsTTY ?? true;
    this.outputIsTTY = options.outputIsTTY ?? true;
    this.rawInput = options.rawInput ?? new FakeRawInput();
  }

  readonly inputIsTTY: boolean;
  readonly outputIsTTY: boolean;

  async readLine(prompt: string, signal: AbortSignal): Promise<string | null> {
    this.linePrompts.push(prompt);
    this.signals.push(signal);
    const answer = this.answers.shift();
    if (answer instanceof Error) {
      throw answer;
    }
    return answer ?? null;
  }

  write(text: string): void {
    this.output.push(text);
  }

  close(): void {
    this.closed = true;
  }
}

async function nextPromptTurn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function assertRawInputRestored(raw: FakeRawInput): void {
  assert.deepEqual(raw.rawModeChanges, [true, false]);
  assert.equal(raw.isRaw, false);
  assert.equal(raw.isPaused(), true);
  assert.equal(raw.dataListeners.size, 0);
  assert.equal(raw.endListeners.size, 0);
  assert.equal(raw.errorListeners.size, 0);
}

test('input applies defaults and retries validation failures', async () => {
  const terminal = new FakeTerminal(['bad', 'valid', '']);
  const prompter = prompts.createPrompter(terminal);

  const first = await prompter.input('Model', {
    validate: (value) => value === 'bad' ? 'Choose another model.' : undefined,
  });
  const second = await prompter.input('Base branch', { defaultValue: 'main' });

  assert.equal(first, 'valid');
  assert.equal(second, 'main');
  assert.match(terminal.output.join(''), /Choose another model\./);
  assert.deepEqual(terminal.linePrompts, [
    'Model: ',
    'Model: ',
    'Base branch (main): ',
  ]);
});

test('select prints choices and accepts either an index or a default', async () => {
  const terminal = new FakeTerminal(['2', '']);
  const prompter = prompts.createPrompter(terminal);
  const choices = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'groq', label: 'Groq', description: 'Fast inference' },
  ] as const;

  assert.equal(await prompter.select('Provider', choices), 'groq');
  assert.equal(
    await prompter.select('Provider', choices, { defaultValue: 'openai' }),
    'openai',
  );
  assert.match(terminal.output.join(''), /1\) OpenAI/);
  assert.match(terminal.output.join(''), /2\) Groq — Fast inference/);
});

test('confirm accepts yes/no values, retries invalid input, and honors defaults', async () => {
  const terminal = new FakeTerminal(['maybe', 'YES', '']);
  const prompter = prompts.createPrompter(terminal);

  assert.equal(await prompter.confirm('Apply changes?', false), true);
  assert.equal(await prompter.confirm('Run doctor?', true), true);
  assert.match(terminal.output.join(''), /Enter yes or no\./);
  assert.deepEqual(terminal.linePrompts, [
    'Apply changes? [y/N]: ',
    'Apply changes? [y/N]: ',
    'Run doctor? [Y/n]: ',
  ]);
});

test('line EOF and closing the prompter use the cancellation error', async () => {
  const eofTerminal = new FakeTerminal([null]);
  const eofPrompter = prompts.createPrompter(eofTerminal);

  await assert.rejects(
    eofPrompter.input('Provider'),
    (error: unknown) => error instanceof prompts.PromptCancelledError,
  );

  eofPrompter.close();
  assert.equal(eofTerminal.closed, true);
  await assert.rejects(
    eofPrompter.confirm('Continue?'),
    (error: unknown) => error instanceof prompts.PromptCancelledError,
  );
});

test('secret requires an input and output TTY before attaching listeners', async () => {
  for (const [inputIsTTY, outputIsTTY] of [[false, true], [true, false]]) {
    const terminal = new FakeTerminal([], { inputIsTTY, outputIsTTY });
    const prompter = prompts.createPrompter(terminal);

    await assert.rejects(prompter.secret('API key'), /interactive TTY/i);
    assert.deepEqual(terminal.rawInput.rawModeChanges, []);
    assert.equal(terminal.rawInput.dataListeners.size, 0);
    assert.equal(terminal.output.join(''), '');
  }
});

test('secret echoes no characters, handles backspace, and restores terminal state', async () => {
  const rawInput = new FakeRawInput({ paused: true });
  const terminal = new FakeTerminal([], { rawInput });
  const prompter = prompts.createPrompter(terminal);

  const pending = prompter.secret('API key');
  rawInput.emitData('abc\u007fd\r');

  assert.equal(await pending, 'abd');
  assert.equal(terminal.output.join(''), 'API key: \n');
  assert.doesNotMatch(terminal.output.join(''), /abc|abd|\*/);
  assertRawInputRestored(rawInput);
});

test('secret rejects empty and NUL-containing attempts without exposing them', async () => {
  const rawInput = new FakeRawInput({ paused: true });
  const terminal = new FakeTerminal([], { rawInput });
  const prompter = prompts.createPrompter(terminal);

  const pending = prompter.secret('API key');
  rawInput.emitData('\r');
  await nextPromptTurn();
  rawInput.emitData('bad\0value\n');
  await nextPromptTurn();
  rawInput.emitData('good-value\r\n');

  assert.equal(await pending, 'good-value');
  const output = terminal.output.join('');
  assert.match(output, /A value is required\./);
  assert.match(output, /must not contain NUL/i);
  assert.doesNotMatch(output, /bad|good-value|\*/);
  assert.equal(rawInput.dataListeners.size, 0);
  assert.equal(rawInput.endListeners.size, 0);
  assert.equal(rawInput.errorListeners.size, 0);
});

test('secret validation retries and never prints the rejected value', async () => {
  const rawInput = new FakeRawInput({ paused: true });
  const terminal = new FakeTerminal([], { rawInput });
  const prompter = prompts.createPrompter(terminal);

  const pending = prompter.secret('API key', {
    validate: (value) => value.startsWith('sk-') ? undefined : 'Invalid key format.',
  });
  rawInput.emitData('rejected-secret\r');
  await nextPromptTurn();
  rawInput.emitData('sk-accepted\r');

  assert.equal(await pending, 'sk-accepted');
  assert.match(terminal.output.join(''), /Invalid key format\./);
  assert.doesNotMatch(terminal.output.join(''), /rejected-secret|sk-accepted|\*/);
});

test('secret redacts its value when a validator throws', async () => {
  const rawInput = new FakeRawInput({ paused: true });
  const terminal = new FakeTerminal([], { rawInput });
  const prompter = prompts.createPrompter(terminal);
  const pending = prompter.secret('API key', {
    validate: (value) => {
      throw new Error(`validator rejected ${value}`);
    },
  });
  rawInput.emitData('never-print-this\r');

  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /\[REDACTED\]/);
    assert.doesNotMatch(error.message, /never-print-this/);
    return true;
  });
  assert.doesNotMatch(terminal.output.join(''), /never-print-this|\*/);
  assertRawInputRestored(rawInput);
});

test('secret Ctrl-C and EOF cancel and restore raw mode and listeners', async () => {
  for (const terminate of [
    (raw: FakeRawInput) => raw.emitData('\u0003'),
    (raw: FakeRawInput) => raw.emitData('\u0004'),
    (raw: FakeRawInput) => raw.emitEnd(),
  ]) {
    const rawInput = new FakeRawInput({ paused: true });
    const terminal = new FakeTerminal([], { rawInput });
    const prompter = prompts.createPrompter(terminal);
    const pending = prompter.secret('API key');

    terminate(rawInput);

    await assert.rejects(
      pending,
      (error: unknown) => error instanceof prompts.PromptCancelledError,
    );
    assertRawInputRestored(rawInput);
  }
});

test('secret restores state after input errors and close cancellation', async () => {
  const inputError = new Error('terminal failed');
  const erroredRaw = new FakeRawInput({ paused: true });
  const erroredPrompter = prompts.createPrompter(
    new FakeTerminal([], { rawInput: erroredRaw }),
  );
  const errored = erroredPrompter.secret('API key');

  erroredRaw.emitError(inputError);

  await assert.rejects(errored, inputError);
  assertRawInputRestored(erroredRaw);

  const closedRaw = new FakeRawInput({ paused: true });
  const closedTerminal = new FakeTerminal([], { rawInput: closedRaw });
  const closedPrompter = prompts.createPrompter(closedTerminal);
  const closed = closedPrompter.secret('API key');

  closedPrompter.close();

  await assert.rejects(
    closed,
    (error: unknown) => error instanceof prompts.PromptCancelledError,
  );
  assert.equal(closedTerminal.closed, true);
  assertRawInputRestored(closedRaw);
});

test('secret preserves a terminal that was already raw and flowing', async () => {
  const rawInput = new FakeRawInput({ isRaw: true, paused: false });
  const terminal = new FakeTerminal([], { rawInput });
  const prompter = prompts.createPrompter(terminal);
  const pending = prompter.secret('API key');

  rawInput.emitData('secret\r');

  assert.equal(await pending, 'secret');
  assert.deepEqual(rawInput.rawModeChanges, []);
  assert.equal(rawInput.isRaw, true);
  assert.equal(rawInput.isPaused(), false);
  assert.equal(rawInput.dataListeners.size, 0);
});
