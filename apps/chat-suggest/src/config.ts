import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  CONTEXT_SOURCE_BYTE_LIMITS,
  MAX_CONTEXT_BYTES,
  MAX_DRAFT_BYTES,
  type ContextSourceKind,
} from "@chat-suggestion/protocol";
import { parseOpenAICompatibleProviderConfig } from "@chat-suggestion/provider";

export type ProviderName = "fake" | "openai-compatible";

export interface AppConfiguration {
  readonly enabled: boolean;
  readonly provider: ProviderName;
  readonly debounceMs: number;
  readonly requestTimeoutMs: number;
  readonly context: {
    readonly enabledSources: readonly ContextSourceKind[];
    readonly sourceByteLimits: Readonly<Record<ContextSourceKind, number>>;
    readonly totalBytes: number;
    readonly draftBytes: number;
    readonly trustedProjects: readonly string[];
  };
  readonly remote?: {
    readonly endpoint: string;
    readonly model: string;
    readonly apiKeyEnvironmentVariable: string;
    readonly requestsPerHour: number;
  };
  readonly host: {
    readonly command?: string;
    readonly allowlistedCommands: readonly string[];
    readonly experimentalPty: boolean;
  };
}

export interface LoadConfigurationOptions {
  readonly cwd?: string;
  readonly path?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

const SOURCE_KINDS: readonly ContextSourceKind[] = [
  "recent-chat",
  "git",
  "project",
  "attachment",
  "plan",
];

export function defaultConfiguration(): AppConfiguration {
  return {
    enabled: true,
    provider: "fake",
    debounceMs: 200,
    requestTimeoutMs: 1_800,
    context: {
      enabledSources: SOURCE_KINDS,
      sourceByteLimits: CONTEXT_SOURCE_BYTE_LIMITS,
      totalBytes: MAX_CONTEXT_BYTES,
      draftBytes: MAX_DRAFT_BYTES,
      trustedProjects: [],
    },
    host: {
      allowlistedCommands: ["codex", "claude"],
      experimentalPty: false,
    },
  };
}

export async function loadConfiguration(
  options: LoadConfigurationOptions = {},
): Promise<AppConfiguration> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const environment = options.environment ?? process.env;
  const configuredPath = options.path ?? environment.CHAT_SUGGEST_CONFIG;
  const filePath = configuredPath ?? join(cwd, ".chat-suggestion.json");
  const fileInput = await readOptionalJson(
    filePath,
    configuredPath !== undefined,
  );
  return parseConfiguration(fileInput, environment, cwd);
}

export function parseConfiguration(
  fileInput: unknown,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
): AppConfiguration {
  const defaults = defaultConfiguration();
  const input = requireRecord(fileInput, "configuration");
  rejectUnknown(
    input,
    [
      "enabled",
      "provider",
      "debounceMs",
      "requestTimeoutMs",
      "context",
      "remote",
      "host",
    ],
    "configuration",
  );
  const context =
    input.context === undefined ? {} : requireRecord(input.context, "context");
  rejectUnknown(
    context,
    [
      "enabledSources",
      "sourceByteLimits",
      "totalBytes",
      "draftBytes",
      "trustedProjects",
    ],
    "context",
  );
  const host =
    input.host === undefined ? {} : requireRecord(input.host, "host");
  rejectUnknown(
    host,
    ["command", "allowlistedCommands", "experimentalPty"],
    "host",
  );
  const provider = parseProvider(
    environment.CHAT_SUGGEST_PROVIDER ?? input.provider ?? defaults.provider,
  );
  const remote =
    input.remote === undefined ? undefined : parseRemote(input.remote);
  if (provider === "openai-compatible" && remote === undefined) {
    throw new Error(
      "remote configuration is required for the openai-compatible provider",
    );
  }
  const sourceByteLimits = parseSourceLimits(
    context.sourceByteLimits,
    defaults.context.sourceByteLimits,
  );
  const totalBytes = boundedInteger(
    context.totalBytes ?? defaults.context.totalBytes,
    "context.totalBytes",
    1,
    MAX_CONTEXT_BYTES,
  );
  for (const [kind, limit] of Object.entries(sourceByteLimits)) {
    if (limit > totalBytes)
      throw new Error(
        `context.sourceByteLimits.${kind} must not exceed context.totalBytes`,
      );
  }
  return {
    enabled: parseBoolean(
      environment.CHAT_SUGGEST_ENABLED ?? input.enabled ?? defaults.enabled,
      "enabled",
    ),
    provider,
    debounceMs: boundedInteger(
      environment.CHAT_SUGGEST_DEBOUNCE_MS ??
        input.debounceMs ??
        defaults.debounceMs,
      "debounceMs",
      100,
      1_000,
    ),
    requestTimeoutMs: boundedInteger(
      input.requestTimeoutMs ?? defaults.requestTimeoutMs,
      "requestTimeoutMs",
      100,
      60_000,
    ),
    context: {
      enabledSources: parseSourceKinds(
        context.enabledSources ?? defaults.context.enabledSources,
      ),
      sourceByteLimits,
      totalBytes,
      draftBytes: boundedInteger(
        context.draftBytes ?? defaults.context.draftBytes,
        "context.draftBytes",
        1,
        MAX_DRAFT_BYTES,
      ),
      trustedProjects: parseStringList(
        context.trustedProjects ?? defaults.context.trustedProjects,
        "context.trustedProjects",
      ).map((path) => resolve(cwd, path)),
    },
    ...(remote === undefined ? {} : { remote }),
    host: {
      ...(host.command === undefined
        ? {}
        : { command: nonEmptyString(host.command, "host.command") }),
      allowlistedCommands: parseStringList(
        host.allowlistedCommands ?? defaults.host.allowlistedCommands,
        "host.allowlistedCommands",
      ),
      experimentalPty: parseBoolean(
        environment.CHAT_SUGGEST_EXPERIMENTAL_PTY ??
          host.experimentalPty ??
          defaults.host.experimentalPty,
        "host.experimentalPty",
      ),
    },
  };
}

export function redactConfiguration(configuration: AppConfiguration): unknown {
  return {
    enabled: configuration.enabled,
    provider: configuration.provider,
    debounceMs: configuration.debounceMs,
    requestTimeoutMs: configuration.requestTimeoutMs,
    context: {
      enabledSources: configuration.context.enabledSources,
      sourceByteLimits: configuration.context.sourceByteLimits,
      totalBytes: configuration.context.totalBytes,
      draftBytes: configuration.context.draftBytes,
      trustedProjectCount: configuration.context.trustedProjects.length,
    },
    remote:
      configuration.remote === undefined
        ? undefined
        : {
            endpoint: redactEndpoint(configuration.remote.endpoint),
            model: configuration.remote.model,
            apiKeyEnvironmentVariable:
              configuration.remote.apiKeyEnvironmentVariable,
            apiKey: "[environment only; not read by diagnostics]",
            requestsPerHour: configuration.remote.requestsPerHour,
          },
    host: {
      experimentalPty: configuration.host.experimentalPty,
      commandConfigured: configuration.host.command !== undefined,
      allowlistedCommandCount: configuration.host.allowlistedCommands.length,
    },
  };
}

function parseRemote(value: unknown): NonNullable<AppConfiguration["remote"]> {
  const remote = requireRecord(value, "remote");
  const parsed = parseOpenAICompatibleProviderConfig(remote);
  return {
    endpoint: parsed.endpoint.toString(),
    model: parsed.model,
    apiKeyEnvironmentVariable: parsed.apiKeyEnvironmentVariable,
    requestsPerHour: parsed.requestsPerHour,
  };
}

function parseSourceLimits(
  value: unknown,
  defaults: Readonly<Record<ContextSourceKind, number>>,
): Readonly<Record<ContextSourceKind, number>> {
  if (value === undefined) return defaults;
  const input = requireRecord(value, "context.sourceByteLimits");
  rejectUnknown(input, SOURCE_KINDS, "context.sourceByteLimits");
  return Object.fromEntries(
    SOURCE_KINDS.map((kind) => [
      kind,
      boundedInteger(
        input[kind] ?? defaults[kind],
        `context.sourceByteLimits.${kind}`,
        0,
        CONTEXT_SOURCE_BYTE_LIMITS[kind],
      ),
    ]),
  ) as unknown as Readonly<Record<ContextSourceKind, number>>;
}

function parseSourceKinds(value: unknown): readonly ContextSourceKind[] {
  const values = parseStringList(value, "context.enabledSources");
  for (const value of values)
    if (!SOURCE_KINDS.includes(value as ContextSourceKind))
      throw new Error(`unsupported context source: ${value}`);
  return [...new Set(values)] as ContextSourceKind[];
}

function parseProvider(value: unknown): ProviderName {
  if (value === "fake" || value === "openai-compatible") return value;
  throw new Error("provider must be fake or openai-compatible");
}

function parseBoolean(value: unknown, name: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be a boolean`);
}

function boundedInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const number =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    !Number.isSafeInteger(number) ||
    typeof number !== "number" ||
    number < minimum ||
    number > maximum
  )
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  return number;
}

function parseStringList(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value))
    throw new Error(`${name} must be an array of non-empty strings`);
  const entries = value as unknown[];
  if (entries.some((entry) => typeof entry !== "string" || entry.trim() === ""))
    throw new Error(`${name} must be an array of non-empty strings`);
  return entries.map((entry) => String(entry).trim());
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function rejectUnknown(
  input: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown !== undefined)
    throw new Error(`${name}.${unknown} is not supported`);
}

async function readOptionalJson(
  path: string,
  required: boolean,
): Promise<unknown> {
  if (!isAbsolute(path)) throw new Error("configuration path must be absolute");
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (!required && isNodeError(error) && error.code === "ENOENT") return {};
    if (error instanceof SyntaxError)
      throw new Error(`configuration is not valid JSON: ${error.message}`);
    throw error;
  }
}

function redactEndpoint(value: string): string {
  const endpoint = new URL(value);
  return `${endpoint.origin}/[path-redacted]`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
