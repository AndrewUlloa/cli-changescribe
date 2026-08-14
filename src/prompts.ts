import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';

export type PromptValidationResult = string | undefined;
export type PromptValidator = (value: string) => PromptValidationResult;

export interface InputPromptOptions {
  readonly defaultValue?: string;
  readonly validate?: PromptValidator;
}

export interface SecretPromptOptions {
  readonly allowEmpty?: boolean;
  readonly validate?: PromptValidator;
}

export interface SelectChoice<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
}

export interface SelectPromptOptions<T extends string> {
  readonly defaultValue?: T;
}

export interface Prompter {
  input(message: string, options?: InputPromptOptions): Promise<string>;
  select<T extends string>(
    message: string,
    choices: readonly SelectChoice<T>[],
    options?: SelectPromptOptions<T>,
  ): Promise<T>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  secret(message: string, options?: SecretPromptOptions): Promise<string>;
  close(): void;
}

export type PromptDataListener = (chunk: Buffer | string) => void;
export type PromptEndListener = () => void;
export type PromptErrorListener = (error: Error) => void;

export interface RawInputAdapter {
  readonly isRaw: boolean;
  isPaused(): boolean;
  setRawMode(enabled: boolean): void;
  resume(): void;
  pause(): void;
  onData(listener: PromptDataListener): void;
  offData(listener: PromptDataListener): void;
  onEnd(listener: PromptEndListener): void;
  offEnd(listener: PromptEndListener): void;
  onError(listener: PromptErrorListener): void;
  offError(listener: PromptErrorListener): void;
}

export interface PromptTerminalAdapter {
  readonly inputIsTTY: boolean;
  readonly outputIsTTY: boolean;
  readonly rawInput: RawInputAdapter;
  readLine(prompt: string, signal: AbortSignal): Promise<string | null>;
  write(text: string): void;
  close(): void;
}

export class PromptCancelledError extends Error {
  readonly code = 'prompt_cancelled';

  constructor(message = 'Prompt cancelled.') {
    super(message);
    this.name = 'PromptCancelledError';
  }
}

class NodeRawInputAdapter implements RawInputAdapter {
  constructor(private readonly input: NodeJS.ReadStream) {}

  get isRaw(): boolean {
    return Boolean(this.input.isRaw);
  }

  isPaused(): boolean {
    return this.input.isPaused();
  }

  setRawMode(enabled: boolean): void {
    this.input.setRawMode(enabled);
  }

  resume(): void {
    this.input.resume();
  }

  pause(): void {
    this.input.pause();
  }

  onData(listener: PromptDataListener): void {
    this.input.on('data', listener);
  }

  offData(listener: PromptDataListener): void {
    this.input.off('data', listener);
  }

  onEnd(listener: PromptEndListener): void {
    this.input.on('end', listener);
  }

  offEnd(listener: PromptEndListener): void {
    this.input.off('end', listener);
  }

  onError(listener: PromptErrorListener): void {
    this.input.on('error', listener);
  }

  offError(listener: PromptErrorListener): void {
    this.input.off('error', listener);
  }
}

class NodeTerminalAdapter implements PromptTerminalAdapter {
  readonly rawInput: RawInputAdapter;
  private activeReadline: ReadlineInterface | null = null;
  private closed = false;

  constructor(
    private readonly input: NodeJS.ReadStream,
    private readonly output: NodeJS.WriteStream,
  ) {
    this.rawInput = new NodeRawInputAdapter(input);
  }

  get inputIsTTY(): boolean {
    return Boolean(this.input.isTTY);
  }

  get outputIsTTY(): boolean {
    return Boolean(this.output.isTTY);
  }

  readLine(prompt: string, signal: AbortSignal): Promise<string | null> {
    if (this.closed) {
      return Promise.resolve(null);
    }
    if (this.activeReadline) {
      return Promise.reject(new Error('A terminal question is already active.'));
    }

    return new Promise((resolve, reject) => {
      const readline = createInterface({
        input: this.input,
        output: this.output,
        terminal: this.inputIsTTY && this.outputIsTTY,
      });
      this.activeReadline = readline;
      let settled = false;

      const cleanup = (): void => {
        signal.removeEventListener('abort', onAbort);
        readline.off('SIGINT', onInterrupt);
        readline.off('close', onClose);
        this.input.off('error', onError);
        if (this.activeReadline === readline) {
          this.activeReadline = null;
        }
      };
      const finish = (value: string | null, error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        readline.close();
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };
      const onAbort = (): void => {
        finish(null, new PromptCancelledError());
      };
      const onInterrupt = (): void => {
        finish(null, new PromptCancelledError());
      };
      const onClose = (): void => {
        finish(null);
      };
      const onError = (error: Error): void => {
        finish(null, error);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      readline.once('SIGINT', onInterrupt);
      readline.once('close', onClose);
      this.input.once('error', onError);

      if (signal.aborted) {
        onAbort();
        return;
      }
      readline.question(prompt, (answer) => finish(answer));
    });
  }

  write(text: string): void {
    this.output.write(text);
  }

  close(): void {
    this.closed = true;
    this.activeReadline?.close();
  }
}

function validationMessage(
  value: string,
  validator: PromptValidator | undefined,
): string | undefined {
  return validator?.(value) || undefined;
}

function redactValue(message: string, value: string): string {
  return value.length === 0
    ? message
    : message.split(value).join('[REDACTED]');
}

function validateSecret(
  value: string,
  validator: PromptValidator | undefined,
): string | undefined {
  try {
    return validationMessage(value, validator);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Secret validation failed.';
    throw new Error(redactValue(message, value));
  }
}

class TerminalPrompter implements Prompter {
  private activeController: AbortController | null = null;
  private closed = false;

  constructor(private readonly terminal: PromptTerminalAdapter) {}

  input(message: string, options: InputPromptOptions = {}): Promise<string> {
    return this.runPrompt(async (signal) => {
      while (true) {
        const suffix = options.defaultValue === undefined
          ? ': '
          : ` (${options.defaultValue}): `;
        const answer = await this.readLine(`${message}${suffix}`, signal);
        const value = answer.length === 0 && options.defaultValue !== undefined
          ? options.defaultValue
          : answer;
        const error = validationMessage(value, options.validate);
        if (!error) {
          return value;
        }
        this.terminal.write(`  ${error}\n`);
      }
    });
  }

  select<T extends string>(
    message: string,
    choices: readonly SelectChoice<T>[],
    options: SelectPromptOptions<T> = {},
  ): Promise<T> {
    if (choices.length === 0) {
      return Promise.reject(new Error('Select prompt requires at least one choice.'));
    }
    const values = new Set(choices.map((choice) => choice.value));
    if (values.size !== choices.length) {
      return Promise.reject(new Error('Select prompt values must be unique.'));
    }
    if (
      options.defaultValue !== undefined &&
      !values.has(options.defaultValue)
    ) {
      return Promise.reject(new Error('Select prompt default must match a choice.'));
    }

    return this.runPrompt(async (signal) => {
      for (const [index, choice] of choices.entries()) {
        const description = choice.description ? ` — ${choice.description}` : '';
        this.terminal.write(`  ${index + 1}) ${choice.label}${description}\n`);
      }
      const defaultIndex = options.defaultValue === undefined
        ? undefined
        : choices.findIndex((choice) => choice.value === options.defaultValue) + 1;
      const suffix = defaultIndex === undefined
        ? ` [1-${choices.length}]: `
        : ` [1-${choices.length}, default ${defaultIndex}]: `;

      while (true) {
        const answer = (await this.readLine(`${message}${suffix}`, signal)).trim();
        if (answer.length === 0 && options.defaultValue !== undefined) {
          return options.defaultValue;
        }
        if (/^[1-9]\d*$/.test(answer)) {
          const selected = choices[Number(answer) - 1];
          if (selected) {
            return selected.value;
          }
        }
        const matching = choices.find((choice) => choice.value === answer);
        if (matching) {
          return matching.value;
        }
        this.terminal.write(`  Enter a number from 1 to ${choices.length}.\n`);
      }
    });
  }

  confirm(message: string, defaultValue?: boolean): Promise<boolean> {
    return this.runPrompt(async (signal) => {
      const suffix = defaultValue === true
        ? ' [Y/n]: '
        : defaultValue === false
          ? ' [y/N]: '
          : ' [y/n]: ';
      while (true) {
        const answer = (await this.readLine(`${message}${suffix}`, signal))
          .trim()
          .toLowerCase();
        if (answer.length === 0 && defaultValue !== undefined) {
          return defaultValue;
        }
        if (answer === 'y' || answer === 'yes') {
          return true;
        }
        if (answer === 'n' || answer === 'no') {
          return false;
        }
        this.terminal.write('  Enter yes or no.\n');
      }
    });
  }

  secret(message: string, options: SecretPromptOptions = {}): Promise<string> {
    if (!this.terminal.inputIsTTY || !this.terminal.outputIsTTY) {
      return Promise.reject(
        new Error('Secret prompts require an interactive TTY.'),
      );
    }

    return this.runPrompt(async (signal) => {
      while (true) {
        const value = await this.readSecret(`${message}: `, signal);
        let error: string | undefined;
        if (!options.allowEmpty && value.length === 0) {
          error = 'A value is required.';
        } else if (value.includes('\0')) {
          error = 'Secret values must not contain NUL bytes.';
        } else {
          error = validateSecret(value, options.validate);
        }
        if (!error) {
          return value;
        }
        this.terminal.write(`  ${redactValue(error, value)}\n`);
      }
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.activeController?.abort();
    this.terminal.close();
  }

  private async runPrompt<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closed) {
      throw new PromptCancelledError('Prompter is closed.');
    }
    if (this.activeController) {
      throw new Error('Another prompt is already active.');
    }

    const controller = new AbortController();
    this.activeController = controller;
    try {
      return await operation(controller.signal);
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
      }
    }
  }

  private async readLine(prompt: string, signal: AbortSignal): Promise<string> {
    const answer = await this.terminal.readLine(prompt, signal);
    if (answer === null) {
      throw new PromptCancelledError('Prompt cancelled at end of input.');
    }
    return answer;
  }

  private readSecret(prompt: string, signal: AbortSignal): Promise<string> {
    this.terminal.write(prompt);
    const input = this.terminal.rawInput;
    const previousRawMode = input.isRaw;
    const previouslyPaused = input.isPaused();
    const decoder = new StringDecoder('utf8');
    let value = '';
    let changedRawMode = false;

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = (): Error | undefined => {
        signal.removeEventListener('abort', onAbort);
        input.offData(onData);
        input.offEnd(onEnd);
        input.offError(onError);

        let cleanupError: Error | undefined;
        if (changedRawMode) {
          try {
            input.setRawMode(previousRawMode);
          } catch (error) {
            cleanupError = error instanceof Error ? error : new Error(String(error));
          }
        }
        if (previouslyPaused) {
          try {
            input.pause();
          } catch (error) {
            cleanupError ??= error instanceof Error ? error : new Error(String(error));
          }
        }
        return cleanupError;
      };
      const finish = (result?: string, error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        let outputError: Error | undefined;
        try {
          this.terminal.write('\n');
        } catch (caught) {
          outputError = caught instanceof Error ? caught : new Error(String(caught));
        }
        const cleanupError = cleanup();
        const failure = error ?? outputError ?? cleanupError;
        if (failure) {
          reject(failure);
        } else {
          resolve(result ?? '');
        }
      };
      const onAbort = (): void => {
        finish(undefined, new PromptCancelledError());
      };
      const onEnd = (): void => {
        finish(undefined, new PromptCancelledError('Prompt cancelled at end of input.'));
      };
      const onError = (error: Error): void => {
        finish(undefined, error);
      };
      const onData = (chunk: Buffer | string): void => {
        const decoded = typeof chunk === 'string'
          ? chunk
          : decoder.write(chunk);
        for (const character of decoded) {
          if (character === '\u0003') {
            finish(undefined, new PromptCancelledError());
            return;
          }
          if (character === '\u0004') {
            finish(
              undefined,
              new PromptCancelledError('Prompt cancelled at end of input.'),
            );
            return;
          }
          if (character === '\u007f' || character === '\b') {
            value = Array.from(value).slice(0, -1).join('');
            continue;
          }
          if (character === '\r' || character === '\n') {
            finish(value);
            return;
          }
          value += character;
        }
      };

      input.onData(onData);
      input.onEnd(onEnd);
      input.onError(onError);
      signal.addEventListener('abort', onAbort, { once: true });

      if (signal.aborted) {
        onAbort();
        return;
      }
      try {
        if (!previousRawMode) {
          input.setRawMode(true);
          changedRawMode = true;
        }
        input.resume();
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

export function createPrompter(terminal: PromptTerminalAdapter): Prompter {
  return new TerminalPrompter(terminal);
}

export function createNodePrompter(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Prompter {
  return createPrompter(new NodeTerminalAdapter(input, output));
}
