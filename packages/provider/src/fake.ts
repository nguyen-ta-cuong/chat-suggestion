import {
  PROTOCOL_VERSION,
  type SuggestionCandidate,
  type SuggestionProvider,
  type SuggestionRequest,
} from "@chat-suggestion/protocol";

import { createCandidate, validateOutputText } from "./output.js";

export interface FakeSuggestionProviderOptions {
  readonly mappings?: Readonly<Record<string, string>>;
  readonly delayMs?: number;
  readonly resolve?: (
    request: SuggestionRequest,
  ) => string | null | Promise<string | null>;
}

export class FakeSuggestionProvider implements SuggestionProvider {
  readonly #mappings: Readonly<Record<string, string>>;
  readonly #delayMs: number;
  readonly #resolve?: FakeSuggestionProviderOptions["resolve"];

  constructor(options: FakeSuggestionProviderOptions = {}) {
    this.#mappings = options.mappings ?? {};
    this.#delayMs = options.delayMs ?? 0;
    this.#resolve = options.resolve;
  }

  async provide(
    request: SuggestionRequest,
    signal: AbortSignal,
  ): Promise<SuggestionCandidate | null> {
    signal.throwIfAborted();
    await abortableDelay(this.#delayMs, signal);
    signal.throwIfAborted();
    const output = this.#resolve
      ? await raceWithAbort(Promise.resolve(this.#resolve(request)), signal)
      : (this.#mappings[request.snapshot.text] ?? null);
    signal.throwIfAborted();
    if (output === null || output === "") {
      return null;
    }
    validateOutputText(output);
    return createCandidate(request, output, PROTOCOL_VERSION);
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    void Promise.resolve().then(() => {
      if (signal.aborted) abort();
    });
  });
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("provider request aborted");
}
