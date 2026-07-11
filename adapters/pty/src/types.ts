import type { Disposable } from "@chat-suggestion/protocol";

export interface PtyExitEvent {
  readonly exitCode: number;
  readonly signal?: number;
}

export interface PtySpawnOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly columns: number;
  readonly rows: number;
}

export interface PtyChild {
  write(data: Uint8Array): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: Uint8Array) => void): Disposable;
  onExit(listener: (event: PtyExitEvent) => void): Disposable;
}

export interface PtyBackend {
  readonly name: string;
  readonly supportedPlatforms: readonly NodeJS.Platform[];
  spawn(
    executable: string,
    args: readonly string[],
    options: PtySpawnOptions,
  ): PtyChild;
}

export interface TerminalEndpoint {
  readonly columns: number;
  readonly rows: number;
  readonly isRaw: boolean;
  setRawMode(enabled: boolean): void;
  write(data: Uint8Array): void;
  onData(listener: (data: Uint8Array) => void): Disposable;
  onResize(listener: (columns: number, rows: number) => void): Disposable;
}

export type ForwardedSignal = "SIGINT" | "SIGTERM" | "SIGTSTP" | "SIGCONT";

export interface SignalSource {
  on(signal: ForwardedSignal, listener: () => void): Disposable;
}

export interface AdjacentSuggestionSurface {
  show(text: string): void;
  clear(reason: string): void;
}

export interface LifecycleHooks {
  onSpawn?(backendName: string): void;
  onRestore?(): void;
  onExit?(event: PtyExitEvent): void;
  onDowngrade?(reason: string): void;
}
