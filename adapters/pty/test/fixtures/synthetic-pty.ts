import type { Disposable } from "@chat-suggestion/protocol";

import type {
  ForwardedSignal,
  PtyBackend,
  PtyChild,
  PtyExitEvent,
  PtySpawnOptions,
  SignalSource,
  TerminalEndpoint,
} from "../../src/index.js";

type Listener<T> = (value: T) => void;

class Listeners<T> {
  readonly #values = new Set<Listener<T>>();

  add(listener: Listener<T>): Disposable {
    this.#values.add(listener);
    return { dispose: () => this.#values.delete(listener) };
  }

  emit(value: T): void {
    for (const listener of this.#values) {
      listener(value);
    }
  }

  get size(): number {
    return this.#values.size;
  }
}

export class SyntheticPtyChild implements PtyChild {
  readonly writes: Uint8Array[] = [];
  readonly resizes: { columns: number; rows: number }[] = [];
  readonly signals: string[] = [];
  readonly #data = new Listeners<Uint8Array>();
  readonly #exit = new Listeners<PtyExitEvent>();

  write(data: Uint8Array): void {
    this.writes.push(Uint8Array.from(data));
  }

  resize(columns: number, rows: number): void {
    this.resizes.push({ columns, rows });
  }

  kill(signal = "SIGTERM"): void {
    this.signals.push(signal);
  }

  onData(listener: (data: Uint8Array) => void): Disposable {
    return this.#data.add(listener);
  }

  onExit(listener: (event: PtyExitEvent) => void): Disposable {
    return this.#exit.add(listener);
  }

  emitData(bytes: Uint8Array): void {
    this.#data.emit(Uint8Array.from(bytes));
  }

  emitExit(event: PtyExitEvent): void {
    this.#exit.emit(event);
  }

  get listenerCount(): number {
    return this.#data.size + this.#exit.size;
  }
}

export class SyntheticPtyBackend implements PtyBackend {
  readonly name = "synthetic-node-pty";
  readonly supportedPlatforms = [process.platform];
  readonly child = new SyntheticPtyChild();
  spawnError?: Error;
  lastSpawnOptions?: PtySpawnOptions;

  spawn(
    _executable: string,
    _args: readonly string[],
    options: PtySpawnOptions,
  ): PtyChild {
    if (this.spawnError !== undefined) {
      throw this.spawnError;
    }
    this.lastSpawnOptions = options;
    return this.child;
  }
}

export class SyntheticTerminal implements TerminalEndpoint {
  columns = 80;
  rows = 24;
  isRaw = false;
  readonly rawModeChanges: boolean[] = [];
  readonly output: Uint8Array[] = [];
  readonly #data = new Listeners<Uint8Array>();
  readonly #resize = new Listeners<{ columns: number; rows: number }>();

  setRawMode(enabled: boolean): void {
    this.isRaw = enabled;
    this.rawModeChanges.push(enabled);
  }

  write(data: Uint8Array): void {
    this.output.push(Uint8Array.from(data));
  }

  onData(listener: (data: Uint8Array) => void): Disposable {
    return this.#data.add(listener);
  }

  onResize(listener: (columns: number, rows: number) => void): Disposable {
    return this.#resize.add(({ columns, rows }) => {
      listener(columns, rows);
    });
  }

  emitData(data: Uint8Array): void {
    this.#data.emit(data);
  }

  emitResize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.#resize.emit({ columns, rows });
  }

  get listenerCount(): number {
    return this.#data.size + this.#resize.size;
  }
}

export class SyntheticSignals implements SignalSource {
  readonly #listeners = new Map<ForwardedSignal, Listeners<void>>();

  on(signal: ForwardedSignal, listener: () => void): Disposable {
    let listeners = this.#listeners.get(signal);
    if (listeners === undefined) {
      listeners = new Listeners();
      this.#listeners.set(signal, listeners);
    }
    return listeners.add(listener);
  }

  emit(signal: ForwardedSignal): void {
    this.#listeners.get(signal)?.emit();
  }

  get listenerCount(): number {
    return [...this.#listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }
}
