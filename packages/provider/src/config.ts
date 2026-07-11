import { MAX_PROVIDER_TOKENS } from "@chat-suggestion/protocol";

import { ProviderError } from "./errors.js";

export type OutputProjection = "suffix" | "full-prompt";

export interface OpenAICompatibleProviderConfig {
  readonly endpoint: string;
  readonly model: string;
  readonly apiKeyEnvironmentVariable: string;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
  readonly requestsPerHour?: number;
  readonly outputProjection?: OutputProjection;
}

export interface ResolvedProviderConfig {
  readonly endpoint: URL;
  readonly model: string;
  readonly apiKeyEnvironmentVariable: string;
  readonly timeoutMs: number;
  readonly maxTokens: number;
  readonly requestsPerHour: number;
  readonly outputProjection: OutputProjection;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUESTS_PER_HOUR = 60;

export function parseOpenAICompatibleProviderConfig(
  input: unknown,
): ResolvedProviderConfig {
  if (!isRecord(input)) {
    throw new ProviderError(
      "configuration",
      "provider configuration must be an object",
    );
  }
  const allowedKeys = new Set([
    "endpoint",
    "model",
    "apiKeyEnvironmentVariable",
    "timeoutMs",
    "maxTokens",
    "requestsPerHour",
    "outputProjection",
  ]);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined) {
    throw new ProviderError(
      "configuration",
      `provider configuration field ${unknownKey} is not supported`,
    );
  }
  const endpoint = parseEndpoint(input.endpoint);
  const model = requireBoundedValue(input.model, "model", 256);
  const apiKeyEnvironmentVariable = requireEnvironmentVariableName(
    input.apiKeyEnvironmentVariable,
  );

  return {
    endpoint,
    model,
    apiKeyEnvironmentVariable,
    timeoutMs: positiveInteger(
      optionalNumber(input.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs"),
      "timeoutMs",
    ),
    maxTokens: boundedInteger(
      optionalNumber(input.maxTokens, MAX_PROVIDER_TOKENS, "maxTokens"),
      "maxTokens",
      1,
      MAX_PROVIDER_TOKENS,
    ),
    requestsPerHour: positiveInteger(
      optionalNumber(
        input.requestsPerHour,
        DEFAULT_REQUESTS_PER_HOUR,
        "requestsPerHour",
      ),
      "requestsPerHour",
    ),
    outputProjection: parseOutputProjection(input.outputProjection),
  };
}

function parseEndpoint(value: unknown): URL {
  if (typeof value !== "string") {
    throw new ProviderError("configuration", "endpoint must be a URL string");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new ProviderError("configuration", "endpoint must be a valid URL");
  }
  if (endpoint.protocol !== "https:" && !isLoopbackHttp(endpoint)) {
    throw new ProviderError(
      "configuration",
      "endpoint must use HTTPS (loopback HTTP is permitted for local testing)",
    );
  }
  if (endpoint.username !== "" || endpoint.password !== "") {
    throw new ProviderError(
      "configuration",
      "endpoint must not contain credentials",
    );
  }
  return endpoint;
}

function isLoopbackHttp(endpoint: URL): boolean {
  return (
    endpoint.protocol === "http:" &&
    ["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname)
  );
}

function requireBoundedValue(
  value: unknown,
  name: string,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    Array.from(value).length > maximum
  ) {
    throw new ProviderError(
      "configuration",
      `${name} must be a non-empty value of at most ${maximum} characters`,
    );
  }
  return value;
}

function requireEnvironmentVariableName(value: unknown): string {
  const name = requireBoundedValue(value, "apiKeyEnvironmentVariable", 128);
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) {
    throw new ProviderError(
      "configuration",
      "apiKeyEnvironmentVariable must be an uppercase environment variable name",
    );
  }
  return name;
}

function parseOutputProjection(value: unknown): OutputProjection {
  if (value === undefined || value === "suffix") return "suffix";
  if (value === "full-prompt") return value;
  throw new ProviderError(
    "configuration",
    "outputProjection must be suffix or full-prompt",
  );
}

function optionalNumber(
  value: unknown,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number") {
    throw new ProviderError("configuration", `${name} must be a number`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: number, name: string): number {
  return boundedInteger(value, name, 1, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ProviderError(
      "configuration",
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}
