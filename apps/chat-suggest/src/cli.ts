#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadConfiguration, redactConfiguration } from "./config.js";
import {
  inspectCapabilities,
  previewConfiguredContext,
  runFakeDemo,
} from "./runtime.js";

export interface CliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export async function runCli(
  arguments_: readonly string[],
  io: CliIo = processIo,
  cwd = process.cwd(),
): Promise<number> {
  try {
    const configPath = optionValue(arguments_, "--config");
    const providerOption = optionValue(arguments_, "--provider");
    if (
      providerOption !== undefined &&
      providerOption !== "fake" &&
      providerOption !== "openai-compatible"
    ) {
      throw new Error("--provider must be fake or openai-compatible");
    }
    const configuration = await loadConfiguration({
      cwd,
      ...(configPath === undefined ? {} : { path: resolve(cwd, configPath) }),
      ...(providerOption === undefined
        ? {}
        : {
            environment: {
              ...process.env,
              CHAT_SUGGEST_PROVIDER: providerOption,
            },
          }),
    });
    const command = arguments_[0];
    if (command === "status") {
      writeJson(io.stdout, {
        configuration: redactConfiguration(configuration),
        capabilities: await inspectCapabilities(),
      });
      return 0;
    }
    if (command === "demo") {
      if (providerOption === "openai-compatible")
        throw new Error(
          "demo is offline-only; remote provider turns are never started automatically",
        );
      writeJson(
        io.stdout,
        await runFakeDemo({ ...configuration, provider: "fake" }, cwd),
      );
      return 0;
    }
    if (command === "context" && arguments_[1] === "preview") {
      writeJson(
        io.stdout,
        await previewConfiguredContext(
          configuration,
          cwd,
          arguments_.includes("--trust-project"),
          optionValue(arguments_, "--draft") ?? "preview draft",
        ),
      );
      return 0;
    }
    if (command === "pi" && arguments_[1] === "install-path") {
      const resolved = import.meta.resolve("@chat-suggestion/adapter-pi");
      io.stdout(`${dirname(dirname(fileURLToPath(resolved)))}\n`);
      return 0;
    }
    if (command === "wrap")
      return runWrapSeam(arguments_.slice(1), configuration.host, io);
    io.stderr(
      "usage: chat-suggest <status|demo|context preview|pi install-path|wrap -- command>\n",
    );
    return 64;
  } catch (error) {
    io.stderr(`chat-suggest: ${safeMessage(error)}\n`);
    return 1;
  }
}

function runWrapSeam(
  arguments_: readonly string[],
  host: {
    readonly command?: string;
    readonly allowlistedCommands: readonly string[];
    readonly experimentalPty: boolean;
  },
  io: CliIo,
): number {
  const separator = arguments_.indexOf("--");
  const command = separator >= 0 ? arguments_[separator + 1] : host.command;
  if (!host.experimentalPty || !arguments_.includes("--experimental-pty"))
    throw new Error(
      "PTY wrapping requires config host.experimentalPty=true and --experimental-pty",
    );
  if (command === undefined || !host.allowlistedCommands.includes(command))
    throw new Error("wrapped command must be explicitly allowlisted");
  io.stderr(
    `experimental PTY for ${command} is unavailable: no exact fixture-tested executable profile was configured; child was not launched\n`,
  );
  return 78;
}

function optionValue(
  arguments_: readonly string[],
  name: string,
): string | undefined {
  const index = arguments_.indexOf(name);
  return index < 0 ? undefined : arguments_[index + 1];
}

function writeJson(write: (value: string) => void, value: unknown): void {
  write(`${JSON.stringify(value, undefined, 2)}\n`);
}
function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

const processIo: CliIo = {
  stdout(value) {
    process.stdout.write(value);
  },
  stderr(value) {
    process.stderr.write(value);
  },
};
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
