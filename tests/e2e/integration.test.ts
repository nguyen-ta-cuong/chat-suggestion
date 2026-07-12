import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ClaudeCapabilityReport } from "@chat-suggestion/adapter-claude";
import type { CodexCapabilityReport } from "@chat-suggestion/adapter-codex";
import { compilePtyProfile } from "@chat-suggestion/adapter-pty";
import { SuggestionCoordinator } from "@chat-suggestion/engine";
import {
  PROTOCOL_VERSION,
  utf8ByteLength,
  type AdapterCapabilities,
  type PromptSnapshot,
  type PtyProfileDescriptor,
  type SuggestionCandidate,
} from "@chat-suggestion/protocol";
import { FakeSuggestionProvider } from "@chat-suggestion/provider";
import { transcript, type FixtureScenario } from "@chat-suggestion/tui-fixture";
import { describe, expect, it } from "vitest";

import { inspectCapabilities } from "../../apps/chat-suggest/src/capabilities.js";
import { runCli } from "../../apps/chat-suggest/src/cli.js";
import {
  defaultConfiguration,
  parseConfiguration,
  redactedConfiguration,
} from "../../apps/chat-suggest/src/config.js";
import {
  createSuggestionService,
  previewProjectContext,
  runFakeDemo,
} from "../../apps/chat-suggest/src/service.js";

const NATIVE_CAPABILITIES: AdapterCapabilities = {
  transport: "native",
  inlineRender: "eol-only",
  bufferRead: true,
  cursorRead: true,
  atomicAcceptance: true,
  cancellation: true,
  resizeAwareness: true,
  alternateScreenSafety: true,
  nativeCompletionAwareness: true,
  attachmentReferences: false,
};

const DISABLED_CAPABILITIES: AdapterCapabilities = {
  transport: "none",
  inlineRender: "none",
  bufferRead: false,
  cursorRead: false,
  atomicAcceptance: false,
  cancellation: false,
  resizeAwareness: false,
  alternateScreenSafety: false,
  nativeCompletionAwareness: false,
  attachmentReferences: false,
};

describe("integrated application", () => {
  it("accepts the deterministic fake suffix exactly once without submitting", async () => {
    const result = await runFakeDemo(defaultConfiguration());

    expect(result.finalDraft).toBe(
      "fix the failing auth tests and add a regression test",
    );
    expect(result.acceptedCount).toBe(1);
    expect(result.submitted).toBe(false);
    expect(result.phases).toEqual([
      "collecting",
      "generating",
      "visible",
      "accepted",
    ]);
  });

  it("rejects a delayed result after the immutable prompt revision changes", async () => {
    const shown: SuggestionCandidate[] = [];
    const clears: string[] = [];
    const metrics: unknown[] = [];
    const provider = new FakeSuggestionProvider({
      delayMs: 80,
      mappings: { alpha: " suffix" },
    });
    const coordinator = new SuggestionCoordinator({
      provider,
      context: () => Promise.resolve({ contributions: [] }),
      surface: {
        capabilities: () => NATIVE_CAPABILITIES,
        show: (candidate) => shown.push(candidate),
        clear: (reason) => clears.push(reason),
        accept: () => undefined,
      },
      metrics: { record: (metric) => metrics.push(metric) },
      configuration: { debounceMs: 100, requestTimeoutMs: 1_000 },
      requestId: () => "cross-package-request",
    });
    coordinator.update(eligibleInput(snapshot("alpha", 1)));
    await wait(120);
    coordinator.update(eligibleInput(snapshot("alphab", 2)));
    await wait(100);
    coordinator.dispose();

    expect(shown).toEqual([]);
    expect(clears).not.toContain("accepted");
    const telemetry = JSON.stringify(metrics);
    expect(telemetry).not.toContain("alpha");
    expect(telemetry).not.toContain("suffix");
  });

  it("keeps remote configuration out of the offline demo and redacts endpoint queries", async () => {
    const configuration = parseConfiguration({
      provider: {
        kind: "openai-compatible",
        endpoint: "https://example.test/v1/chat?tenant=private-marker",
        model: "fast-model",
        apiKeyEnvironmentVariable: "SYNTHETIC_API_KEY",
      },
    });

    const result = await runFakeDemo(configuration);
    const diagnostics = JSON.stringify(redactedConfiguration(configuration));
    expect(result.acceptedCount).toBe(1);
    expect(diagnostics).not.toContain("private-marker");
    expect(diagnostics).not.toContain("SYNTHETIC_API_KEY_VALUE");
    expect(diagnostics).toContain("SYNTHETIC_API_KEY");
  });

  it("requires explicit project trust and does not instantiate disabled context sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "chat-suggest-context-"));
    await writeFile(join(root, "AGENTS.md"), "synthetic-private-draft", "utf8");
    const configuration = parseConfiguration(
      {
        context: {
          enabledSources: {
            "recent-chat": false,
            git: false,
            project: false,
            attachment: false,
            plan: false,
          },
        },
      },
      root,
    );

    await expect(
      previewProjectContext(configuration, root, false),
    ).rejects.toThrow("project is trusted");
    const result = await previewProjectContext(configuration, root, true);
    expect(result.status).toBe("collected");
    if (result.status === "collected") {
      expect(result.envelope.contributions).toEqual([]);
      expect(result.sources).toEqual([]);
    }
  });

  it("reports all unverified host surfaces as fail-closed", async () => {
    const status = await inspectCapabilities({
      codex: () => Promise.resolve(unsupportedCodexReport()),
      claude: () => Promise.resolve(unsupportedClaudeReport()),
    });

    expect(status.pi.capabilities.inlineRender).toBe("none");
    expect(status.pi.state).toBe("runtime-handshake-required");
    expect(status.codex).toMatchObject({
      selection: "unsupported",
      ptyProfileVerified: false,
    });
    expect(status.claude).toMatchObject({
      status: "present-unsupported",
      ptyProfileVerified: false,
    });
    expect(JSON.stringify(status)).not.toContain("/private/executable");
  });

  it("validates strict configuration and exact trust boundaries", () => {
    expect(() => parseConfiguration({ surprise: true })).toThrow(
      "not supported",
    );
    expect(() => parseConfiguration({ debounceMs: 99 })).toThrow(
      "between 100 and 1000",
    );
    expect(() =>
      parseConfiguration({ debounceMs: 1_000, requestTimeoutMs: 1_000 }),
    ).toThrow("greater than debounceMs");
    expect(() => parseConfiguration({ codexSuggestionTimeoutMs: 999 })).toThrow(
      "between 1000 and 60000",
    );
    expect(
      parseConfiguration({ codexSuggestionModel: "gpt-fast" })
        .codexSuggestionModel,
    ).toBe("gpt-fast");
    expect(
      parseConfiguration({ trustedProjects: ["project"] }, "/workspace")
        .trustedProjects,
    ).toEqual(["/workspace/project"]);
  });

  it("refuses the experimental wrapper before child launch without an exact profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "chat-suggest-wrapper-"));
    await writeFile(
      join(root, ".chat-suggestion.json"),
      JSON.stringify({ experimentalPty: true }),
      "utf8",
    );
    let standardError = "";
    const exitCode = await runCli(
      ["wrap", "--experimental-pty", "--", "codex"],
      {
        cwd: root,
        environment: {},
        codex: () => Promise.resolve(unsupportedCodexReport()),
        claude: () => Promise.resolve(unsupportedClaudeReport()),
        io: {
          stdout: () => undefined,
          stderr: (text) => {
            standardError += text;
          },
        },
      },
    );

    expect(exitCode).toBe(78);
    expect(standardError).toContain("child was not launched");
    expect(standardError).not.toContain("/private/executable");
  });

  it("routes the Codex command to the owned ghost-text frontend", async () => {
    const root = await mkdtemp(join(tmpdir(), "chat-suggest-codex-frontend-"));
    let observed: unknown;
    const exitCode = await runCli(["codex", "--provider", "fake"], {
      cwd: root,
      environment: {},
      codexFrontend: (options) => {
        observed = options;
        return Promise.resolve(0);
      },
      io: {
        stdout: () => undefined,
        stderr: () => undefined,
      },
    });

    expect(exitCode).toBe(0);
    expect(observed).toMatchObject({
      cwd: root,
      offlineFake: true,
      configuration: { provider: { kind: "fake" } },
    });
  });

  it("composes a provider request with bounded empty context when sources are disabled", async () => {
    let observedContext: unknown;
    const configuration = parseConfiguration({
      context: {
        enabledSources: {
          "recent-chat": false,
          git: false,
          project: false,
          attachment: false,
          plan: false,
        },
      },
    });
    const provider = new FakeSuggestionProvider({
      resolve(request) {
        observedContext = request.context;
        return " safe";
      },
    });
    const service = createSuggestionService(configuration, provider);
    const candidate = await service.suggest(
      snapshot("compose", 1),
      "service-request",
      new AbortController().signal,
    );

    expect(candidate?.edit.text).toBe(" safe");
    expect(observedContext).toEqual({ contributions: [] });
  });

  it("runs every semantic TUI transcript through conservative PTY suspension", () => {
    const scenarios: readonly FixtureScenario[] = [
      "line",
      "raw",
      "alternate",
      "cursor-repaint",
      "async-output",
      "bracketed-paste",
      "hidden",
      "unicode-wrap",
      "completion-menu",
      "malformed-ansi",
      "resize",
      "signal",
      "exit-code",
    ];
    for (const scenario of scenarios) {
      const compiled = compilePtyProfile(ptyDescriptor(), ptyDescriptor().host);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) continue;
      const profile = compiled.value.profile;
      profile.observeMarker("prompt-start");
      profile.observeMarker("prompt-end");
      expect(profile.canRequestSuggestion).toBe(true);

      for (const event of transcript(scenario)) {
        if (event.type === "output") {
          profile.observeOutput(
            Buffer.from(decodeFixture(String(event.value))),
          );
        } else if (event.type === "resize") {
          profile.suspend("resized");
        } else if (event.type === "signal") {
          profile.suspend("unknown-sequence");
        } else if (event.type === "mode" && event.value === "hidden") {
          profile.observeMarker("hidden-input-start");
        } else if (event.type === "mode" && event.value === "alternate") {
          profile.observeOutput(Buffer.from("\u001b[?1049h"));
        }
      }

      if (scenario !== "exit-code") {
        expect(profile.canRequestSuggestion, scenario).toBe(false);
      }
    }
  });
});

function snapshot(text: string, revision: number): PromptSnapshot {
  return {
    revision,
    text,
    cursorByte: utf8ByteLength(text),
    host: { name: "e2e", version: "1.0.0" },
    capabilities: NATIVE_CAPABILITIES,
    workingDirectory: process.cwd(),
    sessionId: "e2e-session",
  };
}

function eligibleInput(value: PromptSnapshot) {
  return {
    snapshot: value,
    enabled: true,
    focused: true,
    hostIdle: true,
    imeComposing: false,
    nativeCompletionVisible: false,
    hiddenInput: false,
    layoutKnown: true,
  };
}

function ptyDescriptor(): PtyProfileDescriptor {
  return {
    protocolVersion: PROTOCOL_VERSION,
    host: {
      executable: "/synthetic/fixture",
      version: "1.0.0",
      sha256: "a".repeat(64),
    },
    detectors: [
      "alternate-screen",
      "bracketed-paste",
      "completion-ui",
      "cursor-motion",
      "hidden-input",
      "output-mode",
      "redraw",
    ],
    markers: [
      "prompt-start",
      "prompt-end",
      "hidden-input-start",
      "hidden-input-end",
    ],
    capabilities: {
      ...NATIVE_CAPABILITIES,
      transport: "pty",
      inlineRender: "adjacent",
      bufferRead: false,
      cursorRead: false,
      atomicAcceptance: false,
      alternateScreenSafety: false,
      nativeCompletionAwareness: false,
    },
  };
}

function decodeFixture(value: string): string {
  return value.replaceAll("\\u001b", "\u001b");
}

function unsupportedCodexReport(): CodexCapabilityReport {
  return {
    available: true,
    commandName: "codex",
    executable: "/private/executable",
    executableSource: "path",
    version: "1.0.0",
    evidence: {
      rootHelp: true,
      appServerAdvertised: false,
      appServerHelp: false,
      schemaGenerationAdvertised: false,
      initializeSchemaCompatible: false,
      appServerInitialized: false,
      unknownMethodRejected: false,
      malformedRequestRejected: false,
    },
    stockTui: DISABLED_CAPABILITIES,
    customFrontend: {
      available: false,
      capabilities: DISABLED_CAPABILITIES,
      reason: "no-handshake",
    },
    selection: "unsupported",
    downgradeReasons: ["no verified editor surface"],
  };
}

function unsupportedClaudeReport(): ClaudeCapabilityReport {
  return {
    status: "present-unsupported",
    executable: "/private/executable",
    version: "1.0.0",
    fingerprint: "b".repeat(64),
    capabilities: DISABLED_CAPABILITIES,
    lifecycleHooksAdvertised: true,
    evidence: ["help-probe"],
    downgradeReasons: ["lifecycle-hooks-are-not-editor-access"],
    missingHandshakeDimensions: [],
  };
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
