import { utf8ByteLength, type PromptSnapshot } from "@chat-suggestion/protocol";
import type { Message } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createPiModelSuggestionBridge } from "../src/pi-model-bridge.js";
import { PI_NATIVE_CAPABILITIES } from "../src/pi-suggestion-editor.js";

describe("Pi model suggestion bridge", () => {
  it("uses the selected model and returns only a safe insertion", async () => {
    const complete = vi.fn(
      (
        _model: unknown,
        request: { messages: readonly Message[]; systemPrompt: string },
        options: { maxTokens: number },
      ) => {
        expect(request.messages[0]?.content).toBe("fix auth");
        expect(request.systemPrompt).toContain("only the short text");
        expect(options.maxTokens).toBe(64);
        return Promise.resolve({
          content: [
            { type: "text" as const, text: " tests and add a regression test" },
          ],
          stopReason: "stop",
          usage: { output: 7 },
        });
      },
    );
    const context = createContext();

    const candidate = await createPiModelSuggestionBridge({
      getContext: () => context,
      complete,
    }).suggest(
      createSnapshot("fix auth"),
      "pi-1-1",
      new AbortController().signal,
    );

    expect(candidate).toMatchObject({
      requestId: "pi-1-1",
      revision: 1,
      tokenCount: 7,
      edit: {
        startByte: utf8ByteLength("fix auth"),
        endByte: utf8ByteLength("fix auth"),
        text: " tests and add a regression test",
      },
    });
    expect(complete).toHaveBeenCalledOnce();
  });

  it("fails closed without a model or resolved credentials", async () => {
    const context = createContext();
    const complete = vi.fn();
    const bridge = createPiModelSuggestionBridge({
      getContext: () => ({ ...context, model: undefined }),
      complete,
    });
    await expect(
      bridge.suggest(
        createSnapshot("fix"),
        "no-model",
        new AbortController().signal,
      ),
    ).resolves.toBeNull();

    const unresolved = createContext({ ok: false, error: "missing" });
    await expect(
      createPiModelSuggestionBridge({
        getContext: () => unresolved,
        complete,
      }).suggest(
        createSnapshot("fix"),
        "no-auth",
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("projects a full-prompt response to the missing suffix", async () => {
    const candidate = await createPiModelSuggestionBridge({
      getContext: createContext,
      complete: () =>
        Promise.resolve({
          content: [{ type: "text" as const, text: "fix auth tests" }],
          stopReason: "stop",
        }),
    }).suggest(
      createSnapshot("fix auth"),
      "full-prompt",
      new AbortController().signal,
    );

    expect(candidate?.edit.text).toBe(" tests");
  });

  it("rejects multiline and canceled model output", async () => {
    const context = createContext();
    const controller = new AbortController();
    const bridge = createPiModelSuggestionBridge({
      getContext: () => context,
      complete: (_model, _request, options) => {
        expect(options.signal).toBe(controller.signal);
        return Promise.resolve({
          content: [{ type: "text" as const, text: "first\nsecond" }],
          stopReason: "stop",
        });
      },
    });
    await expect(
      bridge.suggest(createSnapshot("fix"), "multiline", controller.signal),
    ).resolves.toBeNull();

    controller.abort();
    await expect(
      bridge.suggest(createSnapshot("fix"), "aborted", controller.signal),
    ).resolves.toBeNull();
  });
});

function createContext(
  auth: { ok: true } | { ok: false; error: string } = { ok: true },
): ExtensionContext {
  return {
    mode: "tui",
    cwd: "/fixture",
    sessionManager: { getSessionId: () => "session-1" },
    model: { id: "fixture-model" },
    modelRegistry: {
      getApiKeyAndHeaders: () => Promise.resolve(auth),
    },
    ui: {} as ExtensionContext["ui"],
  };
}

function createSnapshot(text: string): PromptSnapshot {
  return {
    revision: 1,
    text,
    cursorByte: utf8ByteLength(text),
    host: { name: "pi", version: "0.80.6" },
    capabilities: PI_NATIVE_CAPABILITIES,
    workingDirectory: "/fixture",
    sessionId: "session-1",
  };
}
