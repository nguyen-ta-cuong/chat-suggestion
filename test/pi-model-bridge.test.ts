import { utf8ByteLength, type PromptSnapshot } from "../src/suggestion.js";
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

describe("Pi model suggestion bridge", () => {
  it("uses the selected model and returns only a safe insertion", async () => {
    const stream = vi.fn(
      (
        _model: unknown,
        request: { messages: readonly Message[]; systemPrompt: string },
        options: PiModelRequestOptions & { temperature?: number },
      ) => {
        expect(request.messages.at(-1)?.content).toBe("fix auth");
        expect(request.systemPrompt).toContain("only the short text");
        expect(options.maxTokens).toBe(64);
        expect(options.sessionId).toBe("session-1");
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

  it("includes the active compaction-aware conversation before the draft", async () => {
    const conversation = [
      sessionMessage("user", "Add login support", "entry-1", null),
      sessionMessage(
        "assistant",
        "I added OAuth login and tests.",
        "entry-2",
        "entry-1",
      ),
    ];
    const context = createContext({ ok: true }, conversation);
    const stream = vi.fn(
      (
        _model: unknown,
        request: { messages: readonly Message[]; systemPrompt: string },
      ) => {
        expect(request.messages).toMatchObject([
          { role: "user", content: "Add login support" },
          {
            role: "assistant",
            content: [{ type: "text", text: "I added OAuth login and tests." }],
          },
          { role: "user", content: "now update" },
        ]);
        return streamFromMessage(assistantMessage(" the documentation"));
      },
    );

    const candidate = await createPiModelSuggestionBridge({
      getContext: () => context,
      stream,
    }).suggest(
      createSnapshot("now update"),
      "with-conversation",
      new AbortController().signal,
    );

    expect(candidate?.edit.text).toBe(" the documentation");
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

  it("keeps the last safe streamed candidate when the final message is invalid", async () => {
    const updates: string[] = [];
    async function* stream(): AsyncIterable<AssistantMessageEvent> {
      await Promise.resolve();
      yield {
        type: "text_delta",
        contentIndex: 0,
        delta: " tests",
        partial: assistantMessage(" tests"),
      };
      yield {
        type: "done",
        reason: "stop",
        message: assistantMessage(" tests\nexplanation"),
      };
    }

    const candidate = await createPiModelSuggestionBridge({
      getContext: createContext,
      stream,
    }).suggest(
      createSnapshot("fix auth"),
      "stable-partial",
      new AbortController().signal,
      (partial) => updates.push(partial.edit.text),
    );

    expect(updates).toEqual([" tests"]);
    expect(candidate?.edit.text).toBe(" tests");
  });

  it("keeps the last safe streamed candidate after a provider error", async () => {
    async function* stream(): AsyncIterable<AssistantMessageEvent> {
      await Promise.resolve();
      yield {
        type: "text_delta",
        contentIndex: 0,
        delta: " tests",
        partial: assistantMessage(" tests"),
      };
      yield {
        type: "error",
        reason: "error",
        error: assistantMessage(" tests"),
      };
    }

    const candidate = await createPiModelSuggestionBridge({
      getContext: createContext,
      stream,
    }).suggest(
      createSnapshot("fix auth"),
      "provider-error-fallback",
      new AbortController().signal,
    );

    expect(candidate?.edit.text).toBe(" tests");
  });

  it("keeps the last safe streamed candidate after a thrown stream failure", async () => {
    async function* stream(): AsyncIterable<AssistantMessageEvent> {
      await Promise.resolve();
      yield {
        type: "text_delta",
        contentIndex: 0,
        delta: " tests",
        partial: assistantMessage(" tests"),
      };
      throw new Error("transport failed");
    }

    const candidate = await createPiModelSuggestionBridge({
      getContext: createContext,
      stream,
    }).suggest(
      createSnapshot("fix auth"),
      "thrown-error-fallback",
      new AbortController().signal,
    );

    expect(candidate?.edit.text).toBe(" tests");
  });

  it("does not retain a safe streamed candidate after cancellation", async () => {
    const controller = new AbortController();
    const updates: string[] = [];
    async function* stream(): AsyncIterable<AssistantMessageEvent> {
      await Promise.resolve();
      yield {
        type: "text_delta",
        contentIndex: 0,
        delta: " tests",
        partial: assistantMessage(" tests"),
      };
      controller.abort();
      yield {
        type: "done",
        reason: "stop",
        message: assistantMessage(" tests and coverage"),
      };
    }

    const candidate = await createPiModelSuggestionBridge({
      getContext: createContext,
      stream,
    }).suggest(
      createSnapshot("fix auth"),
      "cancel-after-partial",
      controller.signal,
      (partial) => updates.push(partial.edit.text),
    );

    expect(updates).toEqual([" tests"]);
    expect(candidate).toBeNull();
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
  contextEntries: readonly unknown[] = [],
): ExtensionContext {
  return {
    mode: "tui",
    cwd: "/fixture",
    sessionManager: {
      getSessionId: () => "session-1",
      buildContextEntries: () => contextEntries,
    },
    model: { id: "fixture-model" },
    modelRegistry: {
      getApiKeyAndHeaders: () => Promise.resolve(auth),
    },
    ui: {} as ExtensionContext["ui"],
  };
}

function sessionMessage(
  role: "user" | "assistant",
  text: string,
  id: string,
  parentId: string | null,
): unknown {
  const message =
    role === "user"
      ? { role, content: text, timestamp: Date.now() }
      : {
          role,
          content: [{ type: "text", text }],
          api: "openai-responses",
          provider: "openai",
          model: "fixture-model",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        };
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message,
  };
}

function createSnapshot(text: string): PromptSnapshot {
  return {
    revision: 1,
    text,
    cursorByte: utf8ByteLength(text),
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
