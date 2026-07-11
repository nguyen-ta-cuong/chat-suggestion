import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  CONTEXT_SOURCE_BYTE_LIMITS,
  MAX_CONTEXT_BYTES,
  MAX_DRAFT_BYTES,
  type ContextSourceKind,
} from "@chat-suggestion/protocol";
import {
  parseOpenAICompatibleProviderConfig,
  type OpenAICompatibleProviderConfig,
} from "@chat-suggestion/provider";

export interface FakeProviderConfiguration {
  readonly kind: "fake";
}

export interface RemoteProviderConfiguration extends OpenAICompatibleProviderConfig {
  readonly kind: "openai-compatible";
}

export type ProviderConfiguration =
  FakeProviderConfiguration | RemoteProviderConfiguration;

export interface ContextConfiguration {
  readonly enabledSources: Readonly<Record<ContextSourceKind, boolean>>;
  readonly sourceByteLimits: Readonly<Record<ContextSourceKind, number>>;
  readonly totalBytes: number;
  readonly draftBytes: number;
  readonly collectorTimeoutMs: number;
}

export interface ChatSuggestConfiguration {
  readonly enabled: boolean;
  readonly provider: ProviderConfiguration;
  readonly debounceMs: number;
  readonly requestTimeoutMs: number;
  readonly minimumPrefixCharacters: number;
  readonly context: ContextConfiguration;
  readonly trustedProjects: readonly string[];
  readonly hostCommands: readonly string[];
  readonly experimentalPty: boolean;
}

export interface LoadedConfiguration {
  readonly configuration: ChatSuggestConfiguration;
  readonly source: "defaults" | "project" | "environment";
}

export interface LoadConfigurationOptions {
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

const CONFIG_FILE = ".chat-suggestion.json";
const CONFIG_ENVIRONMENT_VARIABLE = "CHAT_SUGGEST_CONFIG";
const SOURCE_KINDS: readonly ContextSourceKind[] = [
  "recent-chat",
  "git",
  "project",
  "attachment",
  "plan",
];

const DEFAULT_ENABLED_SOURCES: Readonly<Record<ContextSourceKind, boolean>> = {
  "recent-chat": true,
  git: true,
  project: true,
  attachment: true,
  plan: true,
};

export function defaultConfiguration(): ChatSuggestConfiguration {
  const configuration: ChatSuggestConfiguration = {
    enabled: true,
    provider: Object.freeze({ kind: "fake" }),
    debounceMs: 200,
    requestTimeoutMs: 1_800,
    minimumPrefixCharacters: 3,
    context: Object.freeze({
      enabledSources: Object.freeze({ ...DEFAULT_ENABLED_SOURCES }),
      sourceByteLimits: Object.freeze({ ...CONTEXT_SOURCE_BYTE_LIMITS }),
      totalBytes: MAX_CONTEXT_BYTES,
      draftBytes: MAX_DRAFT_BYTES,
      collectorTimeoutMs: 100,
    }),
    trustedProjects: Object.freeze([]),
    hostCommands: Object.freeze(["codex", "claude"]),
    experimentalPty: false,
  };
  if (configuration.requestTimeoutMs <= configuration.debounceMs) {
    throw new Error("requestTimeoutMs must be greater than debounceMs");
  }
  return Object.freeze(configuration);
}

export async function loadConfiguration(
  options: LoadConfigurationOptions = {},
): Promise<LoadedConfiguration> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const environment = options.environment ?? process.env;
  const override = environment[CONFIG_ENVIRONMENT_VARIABLE];
  if (override !== undefined && !isAbsolute(override)) {
    throw new Error(`${CONFIG_ENVIRONMENT_VARIABLE} must be an absolute path`);
  }
  const path = override ?? join(cwd, CONFIG_FILE);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error) && override === undefined) {
      return { configuration: defaultConfiguration(), source: "defaults" };
    }
    throw safeConfigurationError(error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("configuration file must contain valid JSON");
  }
  return {
    configuration: parseConfiguration(parsed, cwd),
    source: override === undefined ? "project" : "environment",
  };
}

export function parseConfiguration(
  input: unknown,
  cwd: string = process.cwd(),
): ChatSuggestConfiguration {
  const root = requireRecord(input, "configuration");
  rejectUnknown(root, [
    "enabled",
    "provider",
    "debounceMs",
    "requestTimeoutMs",
    "minimumPrefixCharacters",
    "context",
    "trustedProjects",
    "hostCommands",
    "experimentalPty",
  ]);
  const defaults = defaultConfiguration();
  const configuration: ChatSuggestConfiguration = {
    enabled: optionalBoolean(root.enabled, defaults.enabled, "enabled"),
    provider: parseProvider(root.provider),
    debounceMs: boundedInteger(
      root.debounceMs,
      defaults.debounceMs,
      "debounceMs",
      100,
      1_000,
    ),
    requestTimeoutMs: boundedInteger(
      root.requestTimeoutMs,
      defaults.requestTimeoutMs,
      "requestTimeoutMs",
      1,
      60_000,
    ),
    minimumPrefixCharacters: boundedInteger(
      root.minimumPrefixCharacters,
      defaults.minimumPrefixCharacters,
      "minimumPrefixCharacters",
      0,
      8_192,
    ),
    context: parseContext(root.context),
    trustedProjects: Object.freeze(
      parseStringArray(root.trustedProjects, "trustedProjects").map((path) =>
        resolve(cwd, path),
      ),
    ),
    hostCommands: Object.freeze(
      parseStringArray(root.hostCommands, "hostCommands", [
        ...defaults.hostCommands,
      ]).map(parseCommandName),
    ),
    experimentalPty: optionalBoolean(
      root.experimentalPty,
      defaults.experimentalPty,
      "experimentalPty",
    ),
  };
  if (configuration.requestTimeoutMs <= configuration.debounceMs) {
    throw new Error("requestTimeoutMs must be greater than debounceMs");
  }
  return Object.freeze(configuration);
}

export function redactedConfiguration(
  configuration: ChatSuggestConfiguration,
): Record<string, unknown> {
  const provider =
    configuration.provider.kind === "fake"
      ? { kind: "fake" }
      : {
          kind: configuration.provider.kind,
          endpoint: redactEndpoint(configuration.provider.endpoint),
          model: configuration.provider.model,
          apiKeyEnvironmentVariable:
            configuration.provider.apiKeyEnvironmentVariable,
          timeoutMs: configuration.provider.timeoutMs,
          maxTokens: configuration.provider.maxTokens,
          requestsPerHour: configuration.provider.requestsPerHour,
          outputProjection: configuration.provider.outputProjection,
        };
  return {
    enabled: configuration.enabled,
    provider,
    debounceMs: configuration.debounceMs,
    requestTimeoutMs: configuration.requestTimeoutMs,
    minimumPrefixCharacters: configuration.minimumPrefixCharacters,
    context: configuration.context,
    trustedProjectCount: configuration.trustedProjects.length,
    hostCommands: configuration.hostCommands,
    experimentalPty: configuration.experimentalPty,
  };
}

function parseProvider(input: unknown): ProviderConfiguration {
  if (input === undefined) return Object.freeze({ kind: "fake" });
  const provider = requireRecord(input, "provider");
  if (provider.kind === "fake") {
    rejectUnknown(provider, ["kind"]);
    return Object.freeze({ kind: "fake" });
  }
  if (provider.kind !== "openai-compatible") {
    throw new Error("provider.kind must be fake or openai-compatible");
  }
  const remote = { ...provider };
  delete remote.kind;
  const parsed = parseOpenAICompatibleProviderConfig(remote);
  return Object.freeze({
    kind: "openai-compatible",
    endpoint: parsed.endpoint.href,
    model: parsed.model,
    apiKeyEnvironmentVariable: parsed.apiKeyEnvironmentVariable,
    timeoutMs: parsed.timeoutMs,
    maxTokens: parsed.maxTokens,
    requestsPerHour: parsed.requestsPerHour,
    outputProjection: parsed.outputProjection,
  });
}

function parseContext(input: unknown): ContextConfiguration {
  const defaults = defaultConfiguration().context;
  if (input === undefined) return defaults;
  const context = requireRecord(input, "context");
  rejectUnknown(context, [
    "enabledSources",
    "sourceByteLimits",
    "totalBytes",
    "draftBytes",
    "collectorTimeoutMs",
  ]);
  return Object.freeze({
    enabledSources: parseSourceBooleans(context.enabledSources),
    sourceByteLimits: parseSourceLimits(context.sourceByteLimits),
    totalBytes: boundedInteger(
      context.totalBytes,
      defaults.totalBytes,
      "context.totalBytes",
      1,
      MAX_CONTEXT_BYTES,
    ),
    draftBytes: boundedInteger(
      context.draftBytes,
      defaults.draftBytes,
      "context.draftBytes",
      1,
      MAX_DRAFT_BYTES,
    ),
    collectorTimeoutMs: boundedInteger(
      context.collectorTimeoutMs,
      defaults.collectorTimeoutMs,
      "context.collectorTimeoutMs",
      1,
      10_000,
    ),
  });
}

function parseSourceBooleans(
  input: unknown,
): Readonly<Record<ContextSourceKind, boolean>> {
  if (input === undefined) return Object.freeze({ ...DEFAULT_ENABLED_SOURCES });
  const sources = requireRecord(input, "context.enabledSources");
  rejectUnknown(sources, SOURCE_KINDS);
  return Object.freeze(
    Object.fromEntries(
      SOURCE_KINDS.map((kind) => [
        kind,
        optionalBoolean(sources[kind], true, `context.enabledSources.${kind}`),
      ]),
    ) as Record<ContextSourceKind, boolean>,
  );
}

function parseSourceLimits(
  input: unknown,
): Readonly<Record<ContextSourceKind, number>> {
  if (input === undefined)
    return Object.freeze({ ...CONTEXT_SOURCE_BYTE_LIMITS });
  const limits = requireRecord(input, "context.sourceByteLimits");
  rejectUnknown(limits, SOURCE_KINDS);
  return Object.freeze(
    Object.fromEntries(
      SOURCE_KINDS.map((kind) => [
        kind,
        boundedInteger(
          limits[kind],
          CONTEXT_SOURCE_BYTE_LIMITS[kind],
          `context.sourceByteLimits.${kind}`,
          0,
          CONTEXT_SOURCE_BYTE_LIMITS[kind],
        ),
      ]),
    ) as Record<ContextSourceKind, number>,
  );
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  record: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).find((key) => !allowedSet.has(key));
  if (unknown !== undefined) {
    throw new Error(`configuration field ${unknown} is not supported`);
  }
}

function optionalBoolean(
  value: unknown,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value as number;
}

function parseStringArray(
  value: unknown,
  name: string,
  fallback: string[] = [],
): string[] {
  if (value === undefined) return fallback;
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error(`${name} must be an array of non-empty strings`);
  }
  return [...new Set(value as string[])];
}

function parseCommandName(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(
      "hostCommands entries must be executable names without paths",
    );
  }
  return value;
}

function redactEndpoint(value: string): string {
  const endpoint = new URL(value);
  endpoint.username = "";
  endpoint.password = "";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.href;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function safeConfigurationError(error: unknown): Error {
  if (isMissingFile(error)) return new Error("configured file does not exist");
  return new Error("configuration file could not be read");
}
