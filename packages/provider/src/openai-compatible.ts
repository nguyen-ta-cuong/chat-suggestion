import { Buffer } from "node:buffer";

import {
  PROTOCOL_VERSION,
  type SuggestionCandidate,
  type SuggestionProvider,
  type SuggestionRequest,
} from "@chat-suggestion/protocol";

import {
  parseOpenAICompatibleProviderConfig,
  type OpenAICompatibleProviderConfig,
  type ResolvedProviderConfig,
} from "./config.js";
import {
  isProviderError,
  ProviderError,
  type ProviderErrorCode,
} from "./errors.js";
import {
  createCandidate,
  projectOutput,
  validateOutputText,
} from "./output.js";
import { formatProviderMessages } from "./prompt.js";
import { FailureCooldown, TokenBucket } from "./rate-limit.js";
import {
  bucketBytes,
  type ProviderStatusClass,
  type ProviderTelemetrySink,
} from "./telemetry.js";

interface RuntimeOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly telemetry?: ProviderTelemetrySink;
  readonly now?: () => number;
  readonly cooldownBaseMs?: number;
}

interface ResponseChoice {
  readonly text?: unknown;
  readonly message?: unknown;
}

interface ResponseBodyReader {
  read(): Promise<
    | { readonly done: true; readonly value?: undefined }
    | { readonly done: false; readonly value: Uint8Array }
  >;
  cancel(): Promise<void>;
  releaseLock(): void;
}

const RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504]);
const MAX_RESPONSE_BYTES = 16_384;

export class OpenAICompatibleSuggestionProvider implements SuggestionProvider {
  readonly #config: ResolvedProviderConfig;
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #fetch: typeof globalThis.fetch;
  readonly #telemetry: ProviderTelemetrySink | undefined;
  readonly #now: () => number;
  readonly #bucket: TokenBucket;
  readonly #cooldown: FailureCooldown;

  constructor(
    config: OpenAICompatibleProviderConfig,
    runtime: RuntimeOptions = {},
  ) {
    this.#config = parseOpenAICompatibleProviderConfig(config);
    this.#environment = runtime.environment ?? process.env;
    this.#fetch = runtime.fetch ?? globalThis.fetch;
    this.#telemetry = runtime.telemetry;
    this.#now = runtime.now ?? Date.now;
    this.#bucket = new TokenBucket(this.#config.requestsPerHour, this.#now);
    this.#cooldown = new FailureCooldown(this.#now, runtime.cooldownBaseMs);
  }

  async provide(
    request: SuggestionRequest,
    signal: AbortSignal,
  ): Promise<SuggestionCandidate | null> {
    const startedAt = this.#now();
    let requestBytes = 0;
    let responseBytes = 0;
    try {
      signal.throwIfAborted();
      this.#cooldown.assertAvailable();
      const body = this.#createBody(request);
      requestBytes = Buffer.byteLength(body, "utf8");
      const response = await this.#sendWithOneRetry(body, signal);
      const responseText = await readBoundedResponse(response);
      responseBytes = Buffer.byteLength(responseText, "utf8");
      const output = extractResponseOutput(responseText);
      if (output === "") {
        this.#cooldown.success();
        this.#emit(
          startedAt,
          requestBytes,
          responseBytes,
          "success",
          "no-content",
        );
        return null;
      }
      const suffix = projectOutput(
        output,
        request.snapshot.text,
        this.#config.outputProjection,
      );
      if (suffix === "") {
        this.#cooldown.success();
        this.#emit(
          startedAt,
          requestBytes,
          responseBytes,
          "success",
          "no-content",
        );
        return null;
      }
      validateOutputText(suffix);
      this.#cooldown.success();
      this.#emit(startedAt, requestBytes, responseBytes, "success");
      return createCandidate(request, suffix, PROTOCOL_VERSION);
    } catch (error) {
      const providerError = normalizeError(error, signal);
      if (
        providerError.code !== "aborted" &&
        providerError.code !== "cooldown"
      ) {
        this.#cooldown.failure(providerError.code === "rate-limited");
      }
      this.#emit(
        startedAt,
        requestBytes,
        responseBytes,
        statusClassFor(providerError),
        providerError.code,
      );
      throw providerError;
    }
  }

  #createBody(request: SuggestionRequest): string {
    return JSON.stringify({
      model: this.#config.model,
      messages: formatProviderMessages(request),
      max_tokens: this.#config.maxTokens,
      temperature: 0.1,
      stream: false,
    });
  }

  async #sendWithOneRetry(
    body: string,
    signal: AbortSignal,
  ): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      this.#bucket.take();
      const response = await this.#send(body, signal);
      if (response.ok) return response;
      if (attempt === 0 && RETRYABLE_STATUS.has(response.status)) {
        await response.body?.cancel();
        continue;
      }
      await response.body?.cancel();
      throw httpError(response.status);
    }
    throw new ProviderError("network", "remote provider retry failed");
  }

  async #send(body: string, signal: AbortSignal): Promise<Response> {
    const apiKey = this.#environment[this.#config.apiKeyEnvironmentVariable];
    if (apiKey === undefined || apiKey === "") {
      throw new ProviderError(
        "configuration",
        `configured API key environment variable is not set`,
      );
    }
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort(new ProviderError("timeout", "remote provider timed out"));
    }, this.#config.timeoutMs);
    const abort = (): void => {
      timeout.abort(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await this.#fetch(this.#config.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body,
        signal: timeout.signal,
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }

  #emit(
    startedAt: number,
    requestBytes: number,
    responseBytes: number,
    statusClass: ProviderStatusClass,
    errorCode?: ProviderErrorCode | "no-content",
  ): void {
    this.#telemetry?.({
      statusClass,
      durationMs: Math.max(0, this.#now() - startedAt),
      requestBytes: bucketBytes(requestBytes),
      responseBytes: bucketBytes(responseBytes),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
  }
}

function extractResponseOutput(responseText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch {
    throw new ProviderError(
      "invalid-response",
      "provider response is not valid JSON",
    );
  }
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.choices) ||
    parsed.choices.length !== 1
  ) {
    throw new ProviderError(
      "invalid-response",
      "provider response must contain one choice",
    );
  }
  const choice = parsed.choices[0] as ResponseChoice;
  if (!isRecord(choice)) {
    throw new ProviderError(
      "invalid-response",
      "provider choice must be an object",
    );
  }
  if (typeof choice.text === "string" && choice.message === undefined)
    return choice.text;
  if (!isRecord(choice.message) || choice.text !== undefined) {
    throw new ProviderError(
      "invalid-response",
      "provider choice has an unsupported shape",
    );
  }
  if (
    choice.message.tool_calls !== undefined ||
    choice.message.function_call !== undefined
  ) {
    throw new ProviderError(
      "invalid-response",
      "provider tool calls are not supported",
    );
  }
  if (typeof choice.message.content !== "string") {
    throw new ProviderError(
      "invalid-response",
      "provider message content must be text",
    );
  }
  return choice.message.content;
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ProviderError(
      "invalid-response",
      "provider response exceeds the size limit",
    );
  }
  if (response.body === null) return "";
  const reader = response.body.getReader() as ResponseBodyReader;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ProviderError(
          "invalid-response",
          "provider response exceeds the size limit",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    throw new ProviderError(
      "invalid-response",
      "provider response is not valid UTF-8",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpError(status: number): ProviderError {
  if (status === 429) {
    return new ProviderError(
      "rate-limited",
      "remote provider rate limited the request",
      status,
    );
  }
  if (status >= 500) {
    return new ProviderError(
      "http-server",
      "remote provider returned a server error",
      status,
    );
  }
  return new ProviderError(
    "http-client",
    "remote provider rejected the request",
    status,
  );
}

function normalizeError(error: unknown, signal: AbortSignal): ProviderError {
  if (isProviderError(error)) return error;
  if (signal.aborted)
    return new ProviderError("aborted", "provider request was aborted");
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ProviderError("aborted", "provider request was aborted");
  }
  return new ProviderError("network", "remote provider request failed");
}

function statusClassFor(error: ProviderError): ProviderStatusClass {
  if (error.code === "aborted") return "cancelled";
  if (error.code === "http-server" || error.code === "rate-limited")
    return "server-error";
  if (error.code === "network" || error.code === "timeout")
    return "network-error";
  return "client-error";
}
