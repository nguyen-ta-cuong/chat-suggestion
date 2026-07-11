import { Buffer } from "node:buffer";

import type { Disposable } from "@chat-suggestion/protocol";

import type { PtySuggestionController } from "./suggestion-controller.js";
import type {
  ForwardedSignal,
  LifecycleHooks,
  PtyBackend,
  PtyExitEvent,
  SignalSource,
  TerminalEndpoint,
} from "./types.js";

export interface PtyRunnerOptions {
  readonly backend: PtyBackend;
  readonly terminal: TerminalEndpoint;
  readonly controller: PtySuggestionController;
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly allowlistedExecutables: ReadonlySet<string>;
  readonly signals?: SignalSource;
  readonly hooks?: LifecycleHooks;
}

export class PtyRunner {
  async run(options: PtyRunnerOptions): Promise<PtyExitEvent> {
    this.#validate(options);
    const previousRawMode = options.terminal.isRaw;
    const disposables: Disposable[] = [];
    let restored = false;
    const restore = (): void => {
      if (restored) {
        return;
      }
      restored = true;
      options.terminal.setRawMode(previousRawMode);
      options.hooks?.onRestore?.();
    };

    try {
      options.terminal.setRawMode(true);
      const child = options.backend.spawn(
        options.executable,
        options.args ?? [],
        {
          cwd: options.cwd,
          env: options.env ?? inheritedEnvironment(),
          columns: options.terminal.columns,
          rows: options.terminal.rows,
        },
      );
      options.hooks?.onSpawn?.(options.backend.name);
      let resolveCompletion: (event: PtyExitEvent) => void = () => undefined;
      let rejectCompletion: (error: unknown) => void = () => undefined;
      const completion = new Promise<PtyExitEvent>((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      });
      let forcedCleanup: Promise<void> | undefined;
      const fail = (error: unknown): void => {
        if (forcedCleanup !== undefined) return;
        restore();
        forcedCleanup = terminateChild(child);
        rejectCompletion(error);
      };
      disposables.push(
        child.onData((data) => {
          try {
            const bytes = Buffer.from(data);
            options.terminal.write(bytes);
            options.controller.observeOutput(bytes);
          } catch (error) {
            fail(error);
          }
        }),
        options.terminal.onData((data) => {
          try {
            options.controller.handleInput(data, (bytes) => {
              child.write(bytes);
            });
          } catch (error) {
            fail(error);
          }
        }),
        options.terminal.onResize((columns, rows) => {
          try {
            options.controller.resize();
            child.resize(columns, rows);
          } catch (error) {
            fail(error);
          }
        }),
        child.onExit(resolveCompletion),
      );
      if (options.signals !== undefined) {
        for (const signal of FORWARDED_SIGNALS) {
          disposables.push(
            options.signals.on(signal, () => {
              try {
                if (
                  signal === "SIGINT" ||
                  signal === "SIGTERM" ||
                  signal === "SIGTSTP"
                ) {
                  restore();
                } else if (signal === "SIGCONT") {
                  options.terminal.setRawMode(true);
                  restored = false;
                  options.controller.resize();
                }
                child.kill(signal);
              } catch (error) {
                fail(error);
              }
            }),
          );
        }
      }
      try {
        const event = await completion;
        options.hooks?.onExit?.(event);
        return event;
      } finally {
        await forcedCleanup;
      }
    } finally {
      for (const disposable of disposables.splice(0).reverse()) {
        disposable.dispose();
      }
      restore();
    }
  }

  #validate(options: PtyRunnerOptions): void {
    if (!options.allowlistedExecutables.has(options.executable)) {
      throw new Error(
        `PTY executable is not allowlisted: ${options.executable}`,
      );
    }
    if (!options.backend.supportedPlatforms.includes(process.platform)) {
      throw new Error(
        `${options.backend.name} does not support platform ${process.platform}`,
      );
    }
    if (options.terminal.columns < 1 || options.terminal.rows < 1) {
      throw new RangeError("terminal dimensions must be positive");
    }
  }
}

async function terminateChild(
  child: {
    kill(signal: ForwardedSignal | "SIGKILL"): void;
    onExit(listener: (event: PtyExitEvent) => void): Disposable;
  },
  graceMs = 100,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const timers: {
      escalation?: ReturnType<typeof setTimeout>;
      fallback?: ReturnType<typeof setTimeout>;
    } = {};
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timers.escalation !== undefined) clearTimeout(timers.escalation);
      if (timers.fallback !== undefined) clearTimeout(timers.fallback);
      exitListener.dispose();
      resolve();
    };
    const exitListener = child.onExit(finish);
    try {
      child.kill("SIGTERM");
    } catch {
      finish();
      return;
    }
    timers.escalation = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } finally {
        timers.fallback = setTimeout(finish, graceMs);
      }
    }, graceMs);
  });
}

function inheritedEnvironment(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

const FORWARDED_SIGNALS: readonly ForwardedSignal[] = [
  "SIGINT",
  "SIGTERM",
  "SIGTSTP",
  "SIGCONT",
];

export function processSignalSource(): SignalSource {
  return {
    on(signal, listener) {
      let active = true;
      const wrapped = (): void => {
        listener();
        if (signal === "SIGTSTP") {
          process.off(signal, wrapped);
          try {
            process.kill(process.pid, signal);
          } finally {
            if (active) {
              process.on(signal, wrapped);
            }
          }
        }
      };
      process.on(signal, wrapped);
      return {
        dispose: () => {
          active = false;
          process.off(signal, wrapped);
        },
      };
    },
  };
}

export function processTerminalEndpoint(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): TerminalEndpoint {
  if (
    !input.isTTY ||
    !output.isTTY ||
    output.columns === undefined ||
    output.rows === undefined
  ) {
    throw new Error(
      "PTY fallback requires an interactive terminal with known dimensions",
    );
  }
  return {
    get columns() {
      return output.columns ?? 0;
    },
    get rows() {
      return output.rows ?? 0;
    },
    get isRaw() {
      return input.isRaw ?? false;
    },
    setRawMode(enabled) {
      input.setRawMode(enabled);
    },
    write(data) {
      output.write(Buffer.from(data));
    },
    onData(listener) {
      const handleData = (data: string | Buffer): void => {
        listener(typeof data === "string" ? Buffer.from(data, "utf8") : data);
      };
      input.on("data", handleData);
      return {
        dispose: () => {
          input.off("data", handleData);
        },
      };
    },
    onResize(listener) {
      const handleResize = (): void => {
        listener(output.columns ?? 0, output.rows ?? 0);
      };
      output.on("resize", handleResize);
      return {
        dispose: () => {
          output.off("resize", handleResize);
        },
      };
    },
  };
}
