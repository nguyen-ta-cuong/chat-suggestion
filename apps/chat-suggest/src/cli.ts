#!/usr/bin/env node

import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import type { ClaudeCapabilityReport } from "@chat-suggestion/adapter-claude";
import type { CodexCapabilityReport } from "@chat-suggestion/adapter-codex";

import {
  inspectCapabilities,
  type CapabilityProbeDependencies,
} from "./capabilities.js";
import {
  loadConfiguration,
  redactedConfiguration,
  type ChatSuggestConfiguration,
} from "./config.js";
import {
  previewProjectContext,
  resolvePiPackagePath,
  runFakeDemo,
} from "./service.js";
import {
  runCodexFrontend,
  type RunCodexFrontendOptions,
} from "./codex-runtime.js";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface CliDependencies extends CapabilityProbeDependencies {
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly io?: CliIo;
  readonly codexFrontend?: (
    options: RunCodexFrontendOptions,
  ) => Promise<number>;
}

export async function runCli(
  arguments_: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const io = dependencies.io ?? {
    stdout: (text: string) => process.stdout.write(text),
    stderr: (text: string) => process.stderr.write(text),
  };
  try {
    const loaded = await loadConfiguration({
      ...(dependencies.cwd === undefined ? {} : { cwd: dependencies.cwd }),
      ...(dependencies.environment === undefined
        ? {}
        : { environment: dependencies.environment }),
    });
    const configuration = hasOption(arguments_, "--provider", "fake")
      ? forceFakeProvider(loaded.configuration)
      : loaded.configuration;
    const [command, subcommand] = arguments_;

    if (command === "status" && subcommand === undefined) {
      const capabilities = await inspectCapabilities(dependencies);
      writeJson(io, {
        configurationSource: loaded.source,
        configuration: redactedConfiguration(configuration),
        capabilities,
      });
      return 0;
    }

    if (command === "demo") {
      if (providerOption(arguments_) === "openai-compatible") {
        throw new Error("demo supports only --provider fake");
      }
      writeJson(io, await runFakeDemo(forceFakeProvider(configuration)));
      return 0;
    }

    if (command === "context" && subcommand === "preview") {
      const result = await previewProjectContext(
        configuration,
        dependencies.cwd ?? process.cwd(),
        arguments_.includes("--trust-project"),
      );
      writeJson(io, result);
      return 0;
    }

    if (command === "pi" && subcommand === "install-path") {
      io.stdout(`${resolvePiPackagePath()}\n`);
      return 0;
    }

    if (command === "codex") {
      return await (dependencies.codexFrontend ?? runCodexFrontend)({
        configuration,
        cwd: dependencies.cwd ?? process.cwd(),
        environment: {
          ...process.env,
          ...dependencies.environment,
        },
        offlineFake: hasOption(arguments_, "--provider", "fake"),
      });
    }

    if (command === "wrap") {
      return await validateWrapperRequest(
        arguments_,
        configuration,
        dependencies,
        io,
      );
    }

    io.stderr(`${usage()}\n`);
    return 64;
  } catch (error) {
    io.stderr(`chat-suggest: ${safeErrorMessage(error)}\n`);
    return 78;
  }
}

async function validateWrapperRequest(
  arguments_: readonly string[],
  configuration: ChatSuggestConfiguration,
  dependencies: CliDependencies,
  io: CliIo,
): Promise<number> {
  if (!configuration.experimentalPty) {
    throw new Error(
      "experimental PTY is disabled in configuration; set experimentalPty to true only after reviewing the warning",
    );
  }
  if (!arguments_.includes("--experimental-pty")) {
    throw new Error("wrap requires the --experimental-pty acknowledgment");
  }
  const separator = arguments_.indexOf("--");
  const command = separator < 0 ? undefined : arguments_[separator + 1];
  if (command === undefined) {
    throw new Error("wrap requires -- <allowlisted-command> [args...]");
  }
  if (
    basename(command) !== command ||
    !configuration.hostCommands.includes(command)
  ) {
    throw new Error("wrapper command is not allowlisted");
  }

  const report = await probeWrappedCommand(command, dependencies);
  if (!hasExactPtyProfile(command, report)) {
    throw new Error(
      "no exact fixture-tested PTY profile matched; the child was not launched",
    );
  }

  io.stderr(
    "chat-suggest: a verified profile exists, but executable PTY launch is not packaged in this release\n",
  );
  return 78;
}

async function probeWrappedCommand(
  command: string,
  dependencies: CliDependencies,
): Promise<CodexCapabilityReport | ClaudeCapabilityReport> {
  if (command === "codex") {
    return await (dependencies.codex ?? defaultCodexProbe)();
  }
  if (command === "claude") {
    return await (dependencies.claude ?? defaultClaudeProbe)();
  }
  throw new Error("allowlisted command has no capability probe");
}

async function defaultCodexProbe(): Promise<CodexCapabilityReport> {
  const { probeCodexCapabilities } =
    await import("@chat-suggestion/adapter-codex");
  return await probeCodexCapabilities();
}

async function defaultClaudeProbe(): Promise<ClaudeCapabilityReport> {
  const { probeClaude } = await import("@chat-suggestion/adapter-claude");
  return await probeClaude();
}

function hasExactPtyProfile(
  command: string,
  report: CodexCapabilityReport | ClaudeCapabilityReport,
): boolean {
  return command === "codex"
    ? "selection" in report &&
        report.selection === "pty" &&
        report.ptyProfile !== undefined
    : "status" in report &&
        report.status === "pty-profile-supported" &&
        report.ptyProfile !== undefined;
}

function forceFakeProvider(
  configuration: ChatSuggestConfiguration,
): ChatSuggestConfiguration {
  return Object.freeze({
    ...configuration,
    enabled: true,
    provider: Object.freeze({ kind: "fake" as const }),
  });
}

function providerOption(arguments_: readonly string[]): string | undefined {
  const index = arguments_.indexOf("--provider");
  return index < 0 ? undefined : arguments_[index + 1];
}

function hasOption(
  arguments_: readonly string[],
  option: string,
  expectedValue: string,
): boolean {
  const index = arguments_.indexOf(option);
  return index >= 0 && arguments_[index + 1] === expectedValue;
}

function writeJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "operation failed";
}

function usage(): string {
  return [
    "usage:",
    "  chat-suggest status",
    "  chat-suggest demo [--provider fake]",
    "  chat-suggest context preview [--provider fake] [--trust-project]",
    "  chat-suggest pi install-path",
    "  chat-suggest codex [--provider fake]",
    "  chat-suggest wrap --experimental-pty -- <codex|claude> [args...]",
  ].join("\n");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
