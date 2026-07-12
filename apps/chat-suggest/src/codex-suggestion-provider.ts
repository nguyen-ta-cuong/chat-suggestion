import {
  MAX_PROVIDER_TOKENS,
  PROTOCOL_VERSION,
  type Disposable,
  type SuggestionCandidate,
  type SuggestionProvider,
  type SuggestionRequest,
} from "@chat-suggestion/protocol";
import { sanitizeTerminalText } from "@chat-suggestion/terminal";

export interface CodexSuggestionNotification {
  readonly method: string;
  readonly params?: unknown;
}

export interface CodexSuggestionClient {
  startTurn(options: {
    readonly threadId: string;
    readonly text: string;
  }): Promise<{ turnId: string }>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  onNotification(
    listener: (notification: CodexSuggestionNotification) => void,
  ): Disposable;
}

interface ActiveSuggestion {
  readonly request: SuggestionRequest;
  readonly signal: AbortSignal;
  readonly resolve: (candidate: SuggestionCandidate | null) => void;
  readonly reject: (error: Error) => void;
  turnId: string | undefined;
  completedTurnId: string | undefined;
  output: string;
  settled: boolean;
  cancelTurn: boolean;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly abort: () => void;
}

export class CodexSuggestionProvider implements SuggestionProvider, Disposable {
  readonly #client: CodexSuggestionClient;
  readonly #threadId: string;
  readonly #subscription: Disposable;
  #active: ActiveSuggestion | undefined;
  #turnChain: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(client: CodexSuggestionClient, threadId: string) {
    this.#client = client;
    this.#threadId = threadId;
    this.#subscription = client.onNotification(this.#onNotification);
  }

  provide(
    request: SuggestionRequest,
    signal: AbortSignal,
  ): Promise<SuggestionCandidate | null> {
    if (this.#disposed) {
      return Promise.reject(
        new Error("Codex suggestion provider is disposed."),
      );
    }
    if (this.#active !== undefined) {
      this.#rejectActive(new Error("Codex suggestion request was superseded."));
    }
    signal.throwIfAborted();
    const promise = new Promise<SuggestionCandidate | null>(
      (resolve, reject) => {
        let finish: () => void = () => undefined;
        const done = new Promise<void>((resolveDone) => {
          finish = resolveDone;
        });
        const active: ActiveSuggestion = {
          request,
          signal,
          resolve,
          reject,
          turnId: undefined,
          completedTurnId: undefined,
          output: "",
          settled: false,
          cancelTurn: false,
          done,
          finish,
          abort: () => {
            this.#abort(active);
          },
        };
        this.#active = active;
        signal.addEventListener("abort", active.abort, { once: true });
        this.#turnChain = this.#turnChain
          .then(async () => this.#runTurn(active))
          .catch(() => undefined);
      },
    );
    return promise;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#subscription.dispose();
    this.#rejectActive(new Error("Codex suggestion provider was disposed."));
  }

  async #runTurn(active: ActiveSuggestion): Promise<void> {
    if (active.settled) return;
    try {
      const turn = await this.#client.startTurn({
        threadId: this.#threadId,
        text: buildSuggestionPrompt(active.request),
      });
      if (active.settled) {
        if (active.cancelTurn) {
          await ignoreFailure(
            this.#client.interruptTurn(this.#threadId, turn.turnId),
          );
        }
        return;
      }
      active.turnId = turn.turnId;
      if (active.signal.aborted) {
        this.#abort(active);
        return;
      }
      if (active.completedTurnId === active.turnId) this.#complete(active);
      await active.done;
      if (active.cancelTurn) {
        await ignoreFailure(
          this.#client.interruptTurn(this.#threadId, turn.turnId),
        );
      }
    } catch (error) {
      if (!active.settled) {
        this.#settleError(active, safeError(error));
      }
    }
  }

  readonly #onNotification = (
    notification: CodexSuggestionNotification,
  ): void => {
    const active = this.#active;
    if (
      active === undefined ||
      active.settled ||
      !isRecord(notification.params)
    ) {
      return;
    }
    if (notification.params.threadId !== this.#threadId) return;
    if (notification.method === "item/agentMessage/delta") {
      const turnId = notification.params.turnId;
      const delta = notification.params.delta;
      if (
        typeof turnId === "string" &&
        typeof delta === "string" &&
        (active.turnId === undefined || active.turnId === turnId)
      ) {
        active.output += delta;
        if (Buffer.byteLength(active.output) > 4 * 1024) {
          this.#settleError(
            active,
            new Error("Codex suggestion output exceeded the byte limit."),
          );
        }
      }
      return;
    }
    if (notification.method === "turn/completed") {
      const turn = notification.params.turn;
      if (!isRecord(turn) || typeof turn.id !== "string") return;
      active.completedTurnId = turn.id;
      if (active.turnId === turn.id) this.#complete(active);
    }
  };

  #complete(active: ActiveSuggestion): void {
    const safe = sanitizeTerminalText(active.output, { maxLines: 1 });
    const projected = safe.startsWith(active.request.snapshot.text)
      ? safe.slice(active.request.snapshot.text.length)
      : safe;
    const text = projected === active.request.snapshot.text ? "" : projected;
    if (text.length === 0) {
      this.#settle(active, null);
      return;
    }
    this.#settle(active, {
      protocolVersion: PROTOCOL_VERSION,
      requestId: active.request.requestId,
      revision: active.request.revision,
      edit: {
        startByte: active.request.snapshot.cursorByte,
        endByte: active.request.snapshot.cursorByte,
        text,
      },
      tokenCount: Math.max(
        1,
        Math.min(MAX_PROVIDER_TOKENS, Math.ceil(Array.from(text).length / 4)),
      ),
    });
  }

  #abort(active: ActiveSuggestion): void {
    if (active.settled) return;
    active.cancelTurn = true;
    this.#settleError(active, abortReason(active.signal));
  }

  #rejectActive(error: Error): void {
    const active = this.#active;
    if (active !== undefined) {
      active.cancelTurn = true;
      this.#settleError(active, error);
    }
  }

  #settle(active: ActiveSuggestion, value: SuggestionCandidate | null): void {
    if (active.settled) return;
    active.settled = true;
    active.signal.removeEventListener("abort", active.abort);
    if (this.#active === active) this.#active = undefined;
    active.finish();
    active.resolve(value);
  }

  #settleError(active: ActiveSuggestion, error: Error): void {
    if (active.settled) return;
    active.settled = true;
    active.signal.removeEventListener("abort", active.abort);
    if (this.#active === active) this.#active = undefined;
    active.finish();
    active.reject(error);
  }
}

function buildSuggestionPrompt(request: SuggestionRequest): string {
  const contextKinds = request.context.contributions.map((item) => item.kind);
  return JSON.stringify({
    task: "complete-the-unfinished-coding-agent-prompt",
    draft: request.snapshot.text,
    cursor: "end",
    availableContextKinds: contextKinds,
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Codex suggestion request was aborted.");
}

function safeError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Codex suggestion request failed.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function ignoreFailure(promise: Promise<void>): Promise<void> {
  try {
    await promise;
  } catch {
    // The request is already canceled; transport shutdown is handled elsewhere.
  }
}
