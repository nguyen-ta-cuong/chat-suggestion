import { utf8ByteLength, type PromptSnapshot } from "@chat-suggestion/protocol";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Message,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  createPiModelSuggestionBridge,
  type PiModelRequestOptions,
} from "../src/pi-model-bridge.js";
import { PI_NATIVE_CAPABILITIES } from "../src/pi-suggestion-editor.js";

describe("Pi model suggestion bridge", () => {
  it("uses the selected model and returns only a safe insertion", async () => {
    const stream = vi.fn(
      (
        _model: unknown,
        request: { messages: readonly Message[]; systemPrompt: string },
        options: PiModelRequestOptions & { temperature?: number },
      ) => {
        expect(request.messages[0]?.content).toBe("fix auth");
        expect(request.systemPrompt).toContain("only the short text");
        expect(options.maxTokens).toBe(64);
        expect(options.sessionId).toBe("chat-suggestion:session-1");
        expect(options).not.toHaveProperty("temperature");
        return streamFromMessage(
          assistantMessage(" tests and add a regression test", 7),
        );
      },
    );
    const context = createContext();

    const candidate = await createPiModelSuggestionBridge({
      getContext: () => context,
      stream,
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
    expect(stream).toHaveBeenCalledOnce();
  });

  it("fails closed without a model or resolved credentials", async () => {
    const context = createContext();
    const stream = vi.fn(() => streamFromMessage(assistantMessage(" tests")));
    const bridge = createPiModelSuggestionBridge({
      getContext: () => ({ ...context, model: undefined }),
      stream,
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
        stream,
      }).suggest(
        createSnapshot("fix"),
        "no-auth",
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });

  it("publishes safe streamed text before the final message", async () => {
    const updates: string[] = [];
    const finalMessage = assistantMessage("fix auth tests and add coverage");
    async function* stream(): AsyncIterable<AssistantMessageEvent> {
      await Promise.resolve();
      yield {
        type: "text_delta",
        contentIndex: 0,
        delta: "fix",
        partial: assistantMessage("fix"),
      };
      yield {
        type: "text_delta",
        contentIndex: 0,
        delta: " auth tests",
        partial: assistantMessage("fix auth tests"),
      };
      yield { type: "done", reason: "stop", message: finalMessage };
    }

    const candidate = await createPiModelSuggestionBridge({
      getContext: createContext,
      stream,
    }).suggest(
      createSnapshot("fix auth"),
      "streamed",
      new AbortController().signal,
      (partial) => updates.push(partial.edit.text),
    );

    expect(updates).toEqual([" tests"]);
    expect(candidate?.edit.text).toBe(" tests and add coverage");
  });

  it("projects a full-prompt response to the missing suffix", async () => {
    const candidate = await createPiModelSuggestionBridge({
      getContext: createContext,
      stream: () => streamFromMessage(assistantMessage("fix auth tests")),
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
      stream: (_model, _request, options) => {
        expect(options.signal).toBe(controller.signal);
        return streamFromMessage(assistantMessage("first\nsecond"));
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

function assistantMessage(text: string, output = 2): AssistantMessage {
  return {
    content: [{ type: "text", text }],
    usage: { output },
    stopReason: "stop",
  };
}

async function* streamFromMessage(
  message: AssistantMessage,
): AsyncIterable<AssistantMessageEvent> {
  await Promise.resolve();
  yield { type: "done", reason: "stop", message };
}
