import {
  CodexAppServerClient,
  probeCodexCapabilities,
  type CodexCapabilityReport,
} from "@chat-suggestion/adapter-codex";
import { FakeSuggestionProvider } from "@chat-suggestion/provider";

import { CodexFrontendSession } from "./codex-frontend.js";
import type { ChatSuggestConfiguration } from "./config.js";
import { createConfiguredProvider } from "./service.js";

export interface RunCodexFrontendOptions {
  readonly configuration: ChatSuggestConfiguration;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly offlineFake?: boolean;
  readonly input?: NodeJS.ReadStream;
  readonly output?: NodeJS.WriteStream;
  readonly probe?: () => Promise<CodexCapabilityReport>;
}

export async function runCodexFrontend(
  options: RunCodexFrontendOptions,
): Promise<number> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  if (!input.isTTY || !output.isTTY || input.setRawMode === undefined) {
    throw new Error("Codex ghost-text frontend requires an interactive TTY.");
  }
  const report = await (options.probe ?? probeCodexCapabilities)();
  if (
    report.selection !== "custom-frontend" ||
    !report.customFrontend.available ||
    report.executable === undefined ||
    report.version === undefined
  ) {
    const reason =
      report.downgradeReasons[0] ?? "Codex App Server is unavailable.";
    throw new Error(`Codex ghost-text frontend is unavailable: ${reason}`);
  }

  const client = new CodexAppServerClient(report.executable, {
    cwd: options.cwd,
    env: options.environment ?? process.env,
  });
  const providerSelection = selectProvider(options);
  let exit: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => {
    exit = resolve;
  });
  const session = new CodexFrontendSession({
    client,
    ...(providerSelection.provider === undefined
      ? {}
      : { provider: providerSelection.provider }),
    collectContext: providerSelection.collectContext,
    configuration: options.configuration,
    cwd: options.cwd,
    codexVersion: report.version,
    width: () => output.columns ?? 80,
    write: (text) => output.write(text),
    onExit: exit,
  });
  const originalRaw = input.isRaw;
  const onData = (data: string | Buffer): void => {
    session.handleInput(
      typeof data === "string" ? data : data.toString("utf8"),
    );
  };
  const onResize = (): void => {
    session.render();
  };
  const onTerminate = (): void => {
    exit();
  };

  try {
    await session.start();
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    process.on("SIGWINCH", onResize);
    process.once("SIGTERM", onTerminate);
    process.once("SIGHUP", onTerminate);
    await exited;
    return 0;
  } finally {
    input.off("data", onData);
    process.off("SIGWINCH", onResize);
    process.off("SIGTERM", onTerminate);
    process.off("SIGHUP", onTerminate);
    input.setRawMode(originalRaw ?? false);
    input.pause();
    await session.close();
    output.write("\n");
  }
}

function selectProvider(options: RunCodexFrontendOptions) {
  if (options.offlineFake === true) {
    return {
      provider: new FakeSuggestionProvider({
        mappings: {
          "fix the failing auth": " tests and add a regression test",
        },
      }),
      collectContext: false,
    };
  }
  if (options.configuration.provider.kind === "openai-compatible") {
    return {
      provider: createConfiguredProvider(options.configuration),
      collectContext: true,
    };
  }
  return { provider: undefined, collectContext: false };
}
