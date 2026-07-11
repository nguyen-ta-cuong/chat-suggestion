import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { CodexAppServerHandshakeResult } from "./types.js";

interface AppServerOptions {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

interface JsonRpcResponse {
  readonly id?: number | null;
  readonly result?: unknown;
  readonly error?: { readonly code?: number };
}

interface ResponseWaiter {
  readonly resolve: (response: JsonRpcResponse) => void;
  readonly reject: (error: Error) => void;
}

export async function negotiateCodexAppServer(
  executable: string,
  options: AppServerOptions,
): Promise<CodexAppServerHandshakeResult> {
  const child = spawn(executable, ["app-server", "--stdio"], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const responses = new JsonRpcResponseQueue(child, options);
  try {
    send(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "chat-suggestion", version: "0.1.0" },
        capabilities: { experimentalApi: false },
      },
    });
    const initialize = await responses.forId(1);
    if (!isInitializeResponse(initialize)) {
      return failed("App-server returned an incompatible initialize response.");
    }
    send(child, { jsonrpc: "2.0", method: "initialized", params: {} });
    send(child, {
      jsonrpc: "2.0",
      id: 2,
      method: "chat-suggestion/unknown",
      params: {},
    });
    const unknown = await responses.forId(2);
    send(child, {
      jsonrpc: "2.0",
      id: 3,
      method: "initialize",
      params: {},
    });
    const malformed = await responses.forId(3);
    return {
      initialized: true,
      unknownMethodRejected:
        unknown.error?.code === -32600 || unknown.error?.code === -32601,
      malformedRequestRejected:
        malformed.error?.code === -32600 || malformed.error?.code === -32602,
    };
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : "App-server failed.",
    );
  } finally {
    responses.dispose();
    await terminateAndReap(child, options.timeoutMs);
  }
}

function send(child: ChildProcessWithoutNullStreams, message: unknown): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function isInitializeResponse(response: JsonRpcResponse): boolean {
  if (typeof response.result !== "object" || response.result === null) {
    return false;
  }
  const result = response.result as Record<string, unknown>;
  return (
    typeof result.userAgent === "string" &&
    typeof result.platformFamily === "string" &&
    typeof result.platformOs === "string"
  );
}

function failed(reason: string): CodexAppServerHandshakeResult {
  return {
    initialized: false,
    unknownMethodRejected: false,
    malformedRequestRejected: false,
    reason,
  };
}

class JsonRpcResponseQueue {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #maxOutputBytes: number;
  readonly #timeoutMs: number;
  #buffer = "";
  #outputBytes = 0;
  #protocolLineCount = 0;
  #responses: JsonRpcResponse[] = [];
  #waiters = new Map<number, ResponseWaiter>();
  #failure: Error | undefined;

  constructor(
    child: ChildProcessWithoutNullStreams,
    options: AppServerOptions,
  ) {
    this.#child = child;
    this.#maxOutputBytes = options.maxOutputBytes;
    this.#timeoutMs = options.timeoutMs;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", this.#onData);
    child.stderr.on("data", this.#onStderr);
    child.once("error", this.#onError);
    child.once("close", this.#onClose);
  }

  async forId(id: number): Promise<JsonRpcResponse> {
    if (this.#failure !== undefined) throw this.#failure;
    const existingIndex = this.#responses.findIndex((item) => item.id === id);
    if (existingIndex >= 0) {
      const [existing] = this.#responses.splice(existingIndex, 1);
      if (existing === undefined) {
        throw new Error("App-server response queue changed unexpectedly.");
      }
      return existing;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(id);
        reject(
          new Error(
            `App-server response timed out after ${this.#protocolLineCount} protocol lines.`,
          ),
        );
      }, this.#timeoutMs);
      timer.unref();
      this.#waiters.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  dispose(): void {
    this.#child.stdout.off("data", this.#onData);
    this.#child.stderr.off("data", this.#onStderr);
    this.#child.off("error", this.#onError);
    this.#child.off("close", this.#onClose);
    this.#waiters.clear();
  }

  readonly #onData = (chunk: string): void => {
    this.#outputBytes += Buffer.byteLength(chunk);
    if (this.#outputBytes > this.#maxOutputBytes) {
      this.#fail(new Error("App-server output exceeded the configured limit."));
      return;
    }
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#consumeLine(line);
      newline = this.#buffer.indexOf("\n");
    }
  };

  readonly #onStderr = (chunk: Buffer): void => {
    this.#outputBytes += chunk.length;
    if (this.#outputBytes > this.#maxOutputBytes) {
      this.#fail(new Error("App-server output exceeded the configured limit."));
    }
  };

  readonly #onError = (error: Error): void => {
    this.#fail(error);
  };

  readonly #onClose = (): void => {
    this.#fail(new Error("App-server exited before negotiation completed."));
  };

  #consumeLine(line: string): void {
    this.#protocolLineCount += 1;
    try {
      const response = JSON.parse(line) as JsonRpcResponse;
      if (typeof response.id === "number") {
        const waiter = this.#waiters.get(response.id);
        if (waiter !== undefined) {
          this.#waiters.delete(response.id);
          waiter.resolve(response);
          return;
        }
      }
      this.#responses.push(response);
    } catch {
      this.#fail(new Error("App-server returned malformed JSON."));
    }
  }

  #fail(error: Error): void {
    this.#failure = error;
    for (const waiter of this.#waiters.values()) {
      waiter.reject(error);
    }
    this.#waiters.clear();
    this.#child.kill("SIGKILL");
  }
}

async function terminateAndReap(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    timer.unref();
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
