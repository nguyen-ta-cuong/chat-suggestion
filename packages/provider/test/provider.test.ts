import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  MAX_CANDIDATE_BYTES,
  MAX_CANDIDATE_CHARACTERS,
  MAX_CANDIDATE_LINES,
  MAX_PROVIDER_TOKENS,
  createFakeSuggestionRequest,
  type SuggestionRequest,
} from "@chat-suggestion/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FakeSuggestionProvider,
  OpenAICompatibleSuggestionProvider,
  ProviderError,
  parseOpenAICompatibleProviderConfig,
  type ProviderTelemetryEvent,
} from "../src/index.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

describe("FakeSuggestionProvider", () => {
  it("returns a deterministic insertion candidate", async () => {
    const request = createFakeSuggestionRequest();
    const provider = new FakeSuggestionProvider({
      mappings: { "add unit": " tests" },
    });

    await expect(
      provider.provide(request, new AbortController().signal),
    ).resolves.toMatchObject({
      requestId: request.requestId,
      revision: request.revision,
      edit: {
        startByte: request.snapshot.cursorByte,
        endByte: request.snapshot.cursorByte,
        text: " tests",
      },
    });
  });

  it("returns null for an unmapped draft", async () => {
    const provider = new FakeSuggestionProvider();
    await expect(
      provider.provide(
        createFakeSuggestionRequest(),
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
  });

  it("honors cancellation during latency", async () => {
    const controller = new AbortController();
    const provider = new FakeSuggestionProvider({
      delayMs: 1_000,
      mappings: { "add unit": " tests" },
    });
    const result = provider.provide(
      createFakeSuggestionRequest(),
      controller.signal,
    );
    controller.abort(new Error("cancelled"));
    await expect(result).rejects.toThrow("cancelled");
  });

  it("honors cancellation while a deferred resolver is pending", async () => {
    const controller = new AbortController();
    const provider = new FakeSuggestionProvider({
      resolve: () => new Promise(() => undefined),
    });
    const result = provider.provide(
      createFakeSuggestionRequest(),
      controller.signal,
    );
    controller.abort(new Error("stale"));
    await expect(result).rejects.toThrow("stale");
  });

  it("rejects unsafe fake output", async () => {
    const provider = new FakeSuggestionProvider({
      mappings: { "add unit": "\u001b[31mbad" },
    });
    await expect(
      provider.provide(
        createFakeSuggestionRequest(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "unsafe-output" });
  });
});

describe("OpenAICompatibleSuggestionProvider", () => {
  let fixture: LoopbackFixture;

  beforeEach(async () => {
    fixture = await LoopbackFixture.start();
  });

  afterEach(async () => {
    await fixture.close();
    vi.restoreAllMocks();
  });

  it("sends bounded OpenAI-compatible fields and returns chat content", async () => {
    fixture.respondJson({ choices: [{ message: { content: " tests" } }] });
    const provider = createProvider(fixture.endpoint);
    const request = createFakeSuggestionRequest();

    const candidate = await provider.provide(
      request,
      new AbortController().signal,
    );
    const received = fixture.requests[0];

    expect(received?.headers.authorization).toBe("Bearer test-secret-key");
    expect(received?.headers["content-type"]).toBe("application/json");
    expect(received?.body).toMatchObject({
      model: "fixture-model",
      max_tokens: MAX_PROVIDER_TOKENS,
      temperature: 0.1,
      stream: false,
    });
    expect(JSON.stringify(received?.body)).toContain("untrusted data");
    expect(
      countOccurrences(JSON.stringify(received?.body), request.snapshot.text),
    ).toBe(1);
    expect(candidate?.edit.text).toBe(" tests");
  });

  it("supports the completions text response shape", async () => {
    fixture.respondJson({ choices: [{ text: " coverage" }] });
    await expect(
      createProvider(fixture.endpoint).provide(
        createFakeSuggestionRequest(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ edit: { text: " coverage" } });
  });

  it("projects an exact full-prompt response to its suffix", async () => {
    fixture.respondJson({ choices: [{ text: "add unit tests" }] });
    const provider = createProvider(fixture.endpoint, {
      outputProjection: "full-prompt",
    });
    await expect(
      provider.provide(
        createFakeSuggestionRequest(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ edit: { text: " tests" } });
  });

  it("rejects a non-exact full-prompt projection", async () => {
    fixture.respondJson({ choices: [{ text: "Add unit tests" }] });
    const provider = createProvider(fixture.endpoint, {
      outputProjection: "full-prompt",
    });
    await expectProviderCode(provider, "invalid-response");
  });

  it("returns null and emits no-content telemetry for empty output", async () => {
    fixture.respondJson({ choices: [{ text: "" }] });
    const events: ProviderTelemetryEvent[] = [];
    const provider = createProvider(
      fixture.endpoint,
      {},
      { telemetry: (event) => events.push(event) },
    );
    await expectProviderResult(provider, null);
    expect(events).toEqual([
      expect.objectContaining({
        statusClass: "success",
        errorCode: "no-content",
      }),
    ]);
  });

  it.each([
    ["malformed JSON", "not-json"],
    [
      "multiple choices",
      JSON.stringify({ choices: [{ text: " one" }, { text: " two" }] }),
    ],
    [
      "tool calls",
      JSON.stringify({
        choices: [{ message: { content: "", tool_calls: [] } }],
      }),
    ],
    [
      "content parts",
      JSON.stringify({ choices: [{ message: { content: [] } }] }),
    ],
  ])("rejects %s", async (_name, body) => {
    fixture.respond(200, body);
    await expectProviderCode(
      createProvider(fixture.endpoint),
      "invalid-response",
    );
  });

  it.each([
    ["ANSI", "\u001b[31mred"],
    ["OSC", "\u001b]0;title\u0007text"],
    ["C0", "bad\u0000text"],
    ["C1", "bad\u0085text"],
    ["characters", "x".repeat(MAX_CANDIDATE_CHARACTERS + 1)],
    ["bytes", "界".repeat(Math.floor(MAX_CANDIDATE_BYTES / 3) + 1)],
    [
      "lines",
      Array.from({ length: MAX_CANDIDATE_LINES + 1 }, () => "x").join("\n"),
    ],
  ])("rejects unsafe or oversized %s output", async (_name, output) => {
    fixture.respondJson({ choices: [{ text: output }] });
    await expectProviderCode(createProvider(fixture.endpoint), "unsafe-output");
  });

  it.each([
    [400, "http-client"],
    [401, "http-client"],
    [500, "http-server"],
  ])("classifies HTTP %i", async (status, code) => {
    fixture.respond(status, "failure");
    await expectProviderCode(createProvider(fixture.endpoint), code);
  });

  it("retries exactly once for an explicitly retryable status", async () => {
    fixture.respondSequence([
      { status: 503, body: "busy" },
      { status: 200, body: JSON.stringify({ choices: [{ text: " tests" }] }) },
    ]);
    await expectProviderResult(createProvider(fixture.endpoint), " tests");
    expect(fixture.requests).toHaveLength(2);
  });

  it("charges every retry attempt against the remote request budget", async () => {
    fixture.respondSequence([
      { status: 503, body: "busy" },
      { status: 200, body: JSON.stringify({ choices: [{ text: " tests" }] }) },
    ]);
    const provider = createProvider(fixture.endpoint, { requestsPerHour: 2 });
    await expectProviderResult(provider, " tests");
    await expectProviderCode(provider, "rate-limited");
    expect(fixture.requests).toHaveLength(2);
  });

  it("does not retry a non-retryable status", async () => {
    fixture.respond(400, "bad request");
    await expectProviderCode(createProvider(fixture.endpoint), "http-client");
    expect(fixture.requests).toHaveLength(1);
  });

  it("enters cooldown immediately after HTTP 429", async () => {
    fixture.respond(429, "slow down");
    const provider = createProvider(
      fixture.endpoint,
      {},
      { cooldownBaseMs: 60_000 },
    );
    await expectProviderCode(provider, "rate-limited");
    await expectProviderCode(provider, "cooldown");
    expect(fixture.requests).toHaveLength(1);
  });

  it("enters cooldown after five consecutive failures", async () => {
    fixture.respond(400, "bad request");
    const provider = createProvider(
      fixture.endpoint,
      {},
      { cooldownBaseMs: 60_000 },
    );
    for (let count = 0; count < 5; count += 1) {
      await expectProviderCode(provider, "http-client");
    }
    await expectProviderCode(provider, "cooldown");
    expect(fixture.requests).toHaveLength(5);
  });

  it("enforces the per-process token bucket", async () => {
    fixture.respondJson({ choices: [{ text: " tests" }] });
    const provider = createProvider(fixture.endpoint, { requestsPerHour: 1 });
    await expectProviderResult(provider, " tests");
    await expectProviderCode(provider, "rate-limited");
    expect(fixture.requests).toHaveLength(1);
  });

  it("times out a hanging request", async () => {
    fixture.handle((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
    });
    const provider = createProvider(fixture.endpoint, { timeoutMs: 20 });
    await expectProviderCode(provider, "timeout");
  });

  it("aborts fetch and closes the loopback request", async () => {
    let requestClosed = false;
    fixture.handle((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
      response.on("close", () => {
        requestClosed = true;
      });
    });
    const controller = new AbortController();
    const result = createProvider(fixture.endpoint).provide(
      createFakeSuggestionRequest(),
      controller.signal,
    );
    await fixture.waitForRequests(1);
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "aborted" });
    await vi.waitFor(() => {
      expect(requestClosed).toBe(true);
    });
  });

  it("keeps telemetry free of draft, context, key, authorization, and completion text", async () => {
    fixture.respondJson({ choices: [{ text: " private-completion" }] });
    const events: ProviderTelemetryEvent[] = [];
    const request = sensitiveRequest();
    const provider = createProvider(
      fixture.endpoint,
      {},
      { telemetry: (event) => events.push(event) },
    );
    await provider.provide(request, new AbortController().signal);

    const logged = JSON.stringify(events);
    for (const secret of [
      request.snapshot.text,
      request.context.contributions[0]?.content ?? "",
      "test-secret-key",
      "authorization",
      "private-completion",
    ]) {
      expect(logged).not.toContain(secret);
    }
    expect(events).toEqual([
      expect.objectContaining({ statusClass: "success" }),
    ]);
  });

  it("fails before network access when the configured key is absent", async () => {
    const provider = new OpenAICompatibleSuggestionProvider(
      baseConfig(fixture.endpoint),
      { environment: {} },
    );
    await expectProviderCode(provider, "configuration");
    expect(fixture.requests).toHaveLength(0);
  });

  it("rejects an oversized HTTP response before JSON parsing", async () => {
    fixture.respond(200, "x".repeat(20_000));
    await expectProviderCode(
      createProvider(fixture.endpoint),
      "invalid-response",
    );
  });
});

describe("provider configuration", () => {
  it.each([
    [
      "non-HTTPS remote endpoint",
      {
        endpoint: "http://example.com/v1",
        model: "m",
        apiKeyEnvironmentVariable: "KEY",
      },
    ],
    [
      "embedded credentials",
      {
        endpoint: "https://user:pass@example.com/v1",
        model: "m",
        apiKeyEnvironmentVariable: "KEY",
      },
    ],
    [
      "invalid key variable",
      {
        endpoint: "https://example.com/v1",
        model: "m",
        apiKeyEnvironmentVariable: "key-name",
      },
    ],
    [
      "too many tokens",
      {
        endpoint: "https://example.com/v1",
        model: "m",
        apiKeyEnvironmentVariable: "KEY",
        maxTokens: MAX_PROVIDER_TOKENS + 1,
      },
    ],
    [
      "an inline API key",
      {
        endpoint: "https://example.com/v1",
        model: "m",
        apiKeyEnvironmentVariable: "KEY",
        apiKey: "must-not-be-accepted",
      },
    ],
    [
      "an unknown output projection",
      {
        endpoint: "https://example.com/v1",
        model: "m",
        apiKeyEnvironmentVariable: "KEY",
        outputProjection: "normalized-prompt",
      },
    ],
  ])("rejects %s", (_name, config) => {
    expect(() => parseOpenAICompatibleProviderConfig(config)).toThrow(
      ProviderError,
    );
  });
});

interface ProviderOverrides {
  readonly timeoutMs?: number;
  readonly requestsPerHour?: number;
  readonly outputProjection?: "suffix" | "full-prompt";
}

interface RuntimeOverrides {
  readonly telemetry?: (event: ProviderTelemetryEvent) => void;
  readonly cooldownBaseMs?: number;
}

function createProvider(
  endpoint: string,
  overrides: ProviderOverrides = {},
  runtime: RuntimeOverrides = {},
): OpenAICompatibleSuggestionProvider {
  return new OpenAICompatibleSuggestionProvider(
    { ...baseConfig(endpoint), ...overrides },
    {
      environment: { FIXTURE_PROVIDER_KEY: "test-secret-key" },
      ...runtime,
    },
  );
}

function baseConfig(endpoint: string) {
  return {
    endpoint,
    model: "fixture-model",
    apiKeyEnvironmentVariable: "FIXTURE_PROVIDER_KEY",
  } as const;
}

async function expectProviderResult(
  provider: OpenAICompatibleSuggestionProvider,
  text: string | null,
): Promise<void> {
  const result = await provider.provide(
    createFakeSuggestionRequest(),
    new AbortController().signal,
  );
  expect(result === null ? null : result.edit.text).toBe(text);
}

async function expectProviderCode(
  provider: OpenAICompatibleSuggestionProvider,
  code: string,
): Promise<void> {
  try {
    await provider.provide(
      createFakeSuggestionRequest(),
      new AbortController().signal,
    );
    throw new Error("provider unexpectedly succeeded");
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code });
  }
}

function sensitiveRequest(): SuggestionRequest {
  const request = createFakeSuggestionRequest();
  return {
    ...request,
    snapshot: { ...request.snapshot, text: "private-draft" },
    context: {
      contributions: [{ kind: "project", content: "private-context" }],
    },
  };
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

interface RecordedRequest {
  readonly headers: IncomingMessage["headers"];
  readonly body: unknown;
}

class LoopbackFixture {
  readonly requests: RecordedRequest[] = [];
  readonly #server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      this.requests.push({
        headers: request.headers,
        body: rawBody === "" ? undefined : JSON.parse(rawBody),
      });
      this.#handler(request, response);
    });
  });
  #handler: Handler = (_request, response) => {
    response.writeHead(500).end();
  };
  #endpoint = "";

  get endpoint(): string {
    return this.#endpoint;
  }

  static async start(): Promise<LoopbackFixture> {
    const fixture = new LoopbackFixture();
    await new Promise<void>((resolve) =>
      fixture.#server.listen(0, "127.0.0.1", resolve),
    );
    const address = fixture.#server.address() as AddressInfo;
    fixture.#endpoint = `http://127.0.0.1:${address.port}/v1/chat/completions`;
    return fixture;
  }

  handle(handler: Handler): void {
    this.#handler = handler;
  }

  respond(status: number, body: string): void {
    this.handle((_request, response) => {
      response
        .writeHead(status, { "content-type": "application/json" })
        .end(body);
    });
  }

  respondJson(body: unknown): void {
    this.respond(200, JSON.stringify(body));
  }

  respondSequence(
    responses: readonly { readonly status: number; readonly body: string }[],
  ): void {
    let index = 0;
    this.handle((_request, response) => {
      const selected = responses[index] ?? responses.at(-1);
      index += 1;
      response
        .writeHead(selected?.status ?? 500, {
          "content-type": "application/json",
        })
        .end(selected?.body ?? "missing fixture response");
    });
  }

  async waitForRequests(count: number): Promise<void> {
    await vi.waitFor(() => {
      expect(this.requests).toHaveLength(count);
    });
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}
