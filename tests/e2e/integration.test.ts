import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { probeClaude } from "@chat-suggestion/adapter-claude";
import { probeCodexCapabilities } from "@chat-suggestion/adapter-codex";
import { compilePtyProfile } from "@chat-suggestion/adapter-pty";
import {
  inspectCapabilities,
  parseConfiguration,
  previewConfiguredContext,
  runFakeDemo,
} from "@chat-suggestion/app";
import { SuggestionCoordinator } from "@chat-suggestion/engine";
import {
  PROTOCOL_VERSION,
  utf8ByteLength,
  type AdapterCapabilities,
  type PtyProfileDescriptor,
  type SuggestionCandidate,
  type SuggestionProvider,
  type SuggestionSurface,
} from "@chat-suggestion/protocol";
import { transcript, type FixtureScenario } from "@chat-suggestion/tui-fixture";
import { describe, expect, it } from "vitest";

const PTY_CAPABILITIES: AdapterCapabilities = {
  transport: "pty",
  inlineRender: "adjacent",
  bufferRead: true,
  cursorRead: true,
  atomicAcceptance: true,
  cancellation: true,
  resizeAwareness: true,
  alternateScreenSafety: false,
  nativeCompletionAwareness: false,
  attachmentReferences: false,
};

describe("cross-package integration", () => {
  it("assembles context and accepts exactly one offline suggestion", async () => {
    const result = await runFakeDemo(parseConfiguration({}), process.cwd());

    expect(result.acceptedDraft).toBe(
      "fix the failing auth tests and add a regression test",
    );
    expect(result.submitted).toBe(false);
    expect(
      result.metrics.filter(({ name }) => name === "suggestion-accepted"),
    ).toHaveLength(1);
  });

  it("keeps the exported demo offline under remote configuration", async () => {
    const configuration = parseConfiguration({
      provider: "openai-compatible",
      remote: {
        endpoint: "https://unreachable.invalid/v1",
        model: "must-not-run",
        apiKeyEnvironmentVariable: "MISSING_TEST_KEY",
      },
    });

    await expect(
      runFakeDemo(configuration, process.cwd()),
    ).resolves.toMatchObject({
      submitted: false,
      suggestion: " tests and add a regression test",
    });
  });

  it("rejects a delayed result after a newer prompt revision", async () => {
    const shown: SuggestionCandidate[] = [];
    const provider: SuggestionProvider = {
      provide: async (request) => {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
        return {
          protocolVersion: PROTOCOL_VERSION,
          requestId: request.requestId,
          revision: request.revision,
          edit: {
            startByte: request.snapshot.cursorByte,
            endByte: request.snapshot.cursorByte,
            text: " stale suffix",
          },
          tokenCount: 2,
        };
      },
    };
    const surface: SuggestionSurface = {
      capabilities: () => PTY_CAPABILITIES,
      show: (candidate) => {
        shown.push(candidate);
      },
      clear: () => undefined,
      accept: () => undefined,
    };
    const coordinator = new SuggestionCoordinator({
      provider,
      context: async () => await Promise.resolve({ contributions: [] }),
      surface,
      configuration: { debounceMs: 100, requestTimeoutMs: 200 },
    });
    const input = (text: string, revision: number) => ({
      snapshot: {
        revision,
        text,
        cursorByte: utf8ByteLength(text),
        host: { name: "fixture", version: "1" },
        capabilities: PTY_CAPABILITIES,
        workingDirectory: process.cwd(),
        sessionId: "stale-test",
      },
      enabled: true,
      focused: true,
      hostIdle: true,
      imeComposing: false,
      nativeCompletionVisible: false,
      hiddenInput: false,
      layoutKnown: true,
    });

    coordinator.update(input("first draft", 1));
    coordinator.manualTrigger();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    coordinator.update(input("newer draft", 2));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));

    expect(shown).toEqual([]);
    coordinator.dispose();
  });

  it("requires trust and excludes denied secret files from preview", async () => {
    const root = await mkdtemp(join(tmpdir(), "chat-suggest-e2e-"));
    try {
      await writeFile(join(root, ".env"), "TOKEN=synthetic-secret-marker\n");
      await writeFile(join(root, "AGENTS.md"), "safe project guidance\n");
      const configuration = parseConfiguration({}, {}, root);
      await expect(
        previewConfiguredContext(configuration, root, false),
      ).rejects.toThrow("requires --trust-project");

      const preview = await previewConfiguredContext(configuration, root, true);
      expect(JSON.stringify(preview)).not.toContain("synthetic-secret-marker");
      expect(JSON.stringify(preview)).toContain("safe project guidance");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not collect context sources disabled by configuration", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "chat-suggest-disabled-context-"),
    );
    try {
      await writeFile(join(root, "AGENTS.md"), "must-not-be-collected\n");
      const configuration = parseConfiguration(
        { context: { enabledSources: [] } },
        {},
        root,
      );
      const preview = await previewConfiguredContext(configuration, root, true);

      expect(preview.status).toBe("collected");
      if (preview.status === "collected") {
        expect(preview.envelope.contributions).toEqual([]);
        expect(preview.sources).toEqual([]);
      }
      expect(JSON.stringify(preview)).not.toContain("must-not-be-collected");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never upgrades absent Codex or Claude executables to native support", async () => {
    const [codex, claude] = await Promise.all([
      probeCodexCapabilities({ resolution: { pathEnvironment: "" } }),
      probeClaude({ pathEnvironment: "" }),
    ]);

    expect(codex.stockTui.inlineRender).toBe("none");
    expect(codex.selection).toBe("unsupported");
    expect(claude.capabilities.inlineRender).toBe("none");
    expect(claude.status).toBe("unavailable");
  });

  it("does not claim Pi native rendering outside a runtime editor handshake", async () => {
    const status = await inspectCapabilities();

    expect(status.pi.support).toBe("runtime-handshake-required");
    expect(status.pi.inlineRender).toBe("none");
    expect(status.pi.availableAfterHandshake).toBe("eol-only");
  });

  it("smoke-tests fixture output events against conservative PTY suspension", () => {
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
    const descriptor: PtyProfileDescriptor = {
      protocolVersion: PROTOCOL_VERSION,
      host: {
        executable: "/fixture",
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
      capabilities: PTY_CAPABILITIES,
    };

    for (const scenario of scenarios) {
      const compiled = compilePtyProfile(descriptor, descriptor.host);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) continue;
      compiled.value.profile.observeMarker("prompt-start");
      compiled.value.profile.observeMarker("prompt-end");
      expect(compiled.value.profile.canRequestSuggestion).toBe(true);
      const events = transcript(scenario);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        if (event.type === "output")
          compiled.value.profile.observeOutput(
            Buffer.from(String(event.value)),
          );
        if (event.type === "resize") compiled.value.profile.suspend("resized");
        if (event.type === "signal")
          compiled.value.profile.suspend("unknown-sequence");
      }
      if (
        events.some(
          ({ type }) =>
            type === "output" || type === "resize" || type === "signal",
        )
      ) {
        expect(compiled.value.profile.canRequestSuggestion).toBe(false);
      }
    }
  });
});
