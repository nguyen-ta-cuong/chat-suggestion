import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { Disposable } from "@chat-suggestion/protocol";

export interface CodexAppServerClientOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly requestTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly maxLineBytes?: number;
  readonly maxStderrBytes?: number;
}

export interface CodexNotification {
  readonly method: string;
  readonly params?: unknown;
}

export interface CodexServerRequest extends CodexNotification {
  readonly id: number | string;
}

export interface CodexProtocolState {
  readonly pendingRequests: number;
  readonly closed: boolean;
}

export interface CodexThreadStartOptions {
  readonly cwd: string;
  readonly ephemeral?: boolean;
  readonly baseInstructions?: string;
  readonly approvalPolicy?: "untrusted" | "on-request" | "never";
  readonly sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  readonly model?: string;
}

export interface CodexTurnStartOptions {
  readonly threadId: string;
  readonly text: string;
  readonly outputSchema?: unknown;
}

interface JsonRpcResponse {
  readonly id?: number | string | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
  };
}

interface PendingResponse {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;

export class CodexAppServerClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #requestTimeoutMs: number;
  readonly #shutdownTimeoutMs: number;
  readonly #maxLineBytes: number;
  readonly #maxStderrBytes: number;
  readonly #notifications = new Set<(value: CodexNotification) => void>();
  readonly #requests = new Set<(value: CodexServerRequest) => void>();
  readonly #pending = new Map<number, PendingResponse>();
  readonly #pendingServerRequests = new Set<number | string>();

  #nextId = 1;
  #buffer = "";
  #stderrBytes = 0;
  #closed = false;
  #closing: Promise<void> | undefined;
  #failure: Error | undefined;

  constructor(executable: string, options: CodexAppServerClientOptions) {
    this.#requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#shutdownTimeoutMs =
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.#maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.#maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
    this.#child = spawn(executable, ["app-server", "--stdio"], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", this.#onData);
    this.#child.stderr.on("data", this.#onStderr);
    this.#child.once("error", this.#onError);
    this.#child.once("close", this.#onClose);
  }

  async initialize(): Promise<void> {
    const result = await this.#request("initialize", {
      clientInfo: { name: "chat-suggestion", version: "0.1.0" },
      capabilities: { experimentalApi: false },
    });
    if (!isRecord(result) || typeof result.userAgent !== "string") {
      throw new Error(
        "Codex App Server returned an incompatible initialize response.",
      );
    }
    this.#send({ jsonrpc: "2.0", method: "initialized", params: {} });
  }

  async startThread(
    options: CodexThreadStartOptions,
  ): Promise<{ threadId: string }> {
    const result = await this.#request(
      "thread/start",
      compactObject({
        cwd: options.cwd,
        ephemeral: options.ephemeral,
        baseInstructions: options.baseInstructions,
        approvalPolicy: options.approvalPolicy,
        sandbox: options.sandbox,
        model: options.model,
      }),
    );
    const thread = isRecord(result) ? result.thread : undefined;
    if (!isRecord(thread) || typeof thread.id !== "string") {
      throw new Error(
        "Codex App Server returned an incompatible thread/start response.",
      );
    }
    return { threadId: thread.id };
  }

  async startTurn(options: CodexTurnStartOptions): Promise<{ turnId: string }> {
    const result = await this.#request(
      "turn/start",
      compactObject({
        threadId: options.threadId,
        input: [{ type: "text", text: options.text }],
        outputSchema: options.outputSchema,
      }),
    );
    const turn = isRecord(result) ? result.turn : undefined;
    if (!isRecord(turn) || typeof turn.id !== "string") {
      throw new Error(
        "Codex App Server returned an incompatible turn/start response.",
      );
    }
    return { turnId: turn.id };
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.#request("turn/interrupt", { threadId, turnId });
  }

  onNotification(listener: (value: CodexNotification) => void): Disposable {
    this.#notifications.add(listener);
    return { dispose: () => this.#notifications.delete(listener) };
  }

  onRequest(listener: (value: CodexServerRequest) => void): Disposable {
    this.#requests.add(listener);
    return { dispose: () => this.#requests.delete(listener) };
  }

  respond(id: number | string, result: unknown): void {
    if (!this.#pendingServerRequests.delete(id)) return;
    this.#send({ jsonrpc: "2.0", id, result });
  }

  respondError(
    id: number | string,
    code = -32_601,
    message = "Request is not supported by this frontend.",
  ): void {
    if (!this.#pendingServerRequests.delete(id)) return;
    this.#send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  protocolState(): CodexProtocolState {
    return {
      pendingRequests: this.#pending.size + this.#pendingServerRequests.size,
      closed: this.#closed,
    };
  }

  async close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closing = this.#closeChild();
    return this.#closing;
  }

  async #request(method: string, params: unknown): Promise<unknown> {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#closed) throw new Error("Codex App Server client is closed.");
    const id = this.#nextId++;
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex App Server ${method} request timed out.`));
      }, this.#requestTimeoutMs);
      timer.unref();
      this.#pending.set(id, { resolve, reject, timer });
    });
    this.#send({ jsonrpc: "2.0", id, method, params });
    return response;
  }

  #send(message: unknown): void {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#closed || !this.#child.stdin.writable) {
      throw new Error("Codex App Server input is closed.");
    }
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  readonly #onData = (chunk: string): void => {
    this.#buffer += chunk;
    if (Buffer.byteLength(this.#buffer) > this.#maxLineBytes) {
      this.#fail(
        new Error("Codex App Server protocol line exceeded the byte limit."),
      );
      return;
    }
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > this.#maxLineBytes) {
        this.#fail(
          new Error("Codex App Server protocol line exceeded the byte limit."),
        );
        return;
      }
      if (line.length > 0) this.#consumeLine(line);
      newline = this.#buffer.indexOf("\n");
    }
  };

  readonly #onStderr = (chunk: Buffer): void => {
    this.#stderrBytes += chunk.length;
    if (this.#stderrBytes > this.#maxStderrBytes) {
      this.#fail(new Error("Codex App Server stderr exceeded the byte limit."));
    }
  };

  readonly #onError = (error: Error): void => {
    this.#fail(new Error(`Codex App Server failed: ${error.message}`));
  };

  readonly #onClose = (): void => {
    this.#closed = true;
    if (this.#closing === undefined) {
      this.#fail(new Error("Codex App Server exited unexpectedly."));
    }
  };

  #consumeLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      this.#fail(new Error("Codex App Server returned malformed JSON."));
      return;
    }
    if (!isRecord(message)) {
      this.#fail(
        new Error("Codex App Server returned an invalid protocol message."),
      );
      return;
    }
    const id = message.id;
    const method = message.method;
    if (
      (typeof id === "number" || typeof id === "string") &&
      typeof method !== "string"
    ) {
      this.#consumeResponse(id, message);
      return;
    }
    if (typeof method !== "string") return;
    if (typeof id === "number" || typeof id === "string") {
      const request: CodexServerRequest = {
        id,
        method,
        params: message.params,
      };
      this.#pendingServerRequests.add(id);
      if (this.#requests.size === 0) {
        this.respondError(id);
        return;
      }
      for (const listener of this.#requests) listener(request);
      return;
    }
    const notification: CodexNotification = { method, params: message.params };
    for (const listener of this.#notifications) listener(notification);
  }

  #consumeResponse(id: number | string, response: JsonRpcResponse): void {
    if (typeof id !== "number") return;
    const pending = this.#pending.get(id);
    if (pending === undefined) return;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    if (response.error !== undefined) {
      const code = response.error.code;
      pending.reject(
        new Error(
          `Codex App Server request failed${code === undefined ? "" : ` (${code})`}.`,
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  #fail(error: Error): void {
    if (this.#failure !== undefined) return;
    this.#failure = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#pendingServerRequests.clear();
    if (!this.#closed) this.#child.kill("SIGTERM");
  }

  async #closeChild(): Promise<void> {
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex App Server client closed."));
    }
    this.#pending.clear();
    this.#pendingServerRequests.clear();
    this.#notifications.clear();
    this.#requests.clear();
    this.#child.stdout.off("data", this.#onData);
    this.#child.stderr.off("data", this.#onStderr);
    this.#child.off("error", this.#onError);
    if (this.#child.exitCode !== null || this.#child.signalCode !== null)
      return;
    this.#child.stdin.end();
    this.#child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.#child.kill("SIGKILL");
      }, this.#shutdownTimeoutMs);
      timer.unref();
      this.#child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function compactObject(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
