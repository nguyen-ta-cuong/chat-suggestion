import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  utf8ByteLength,
  type AdapterCapabilities,
  type SuggestionRequest,
} from "@chat-suggestion/protocol";

import {
  CodexSuggestionProvider,
  type CodexSuggestionClient,
} from "../src/codex-suggestion-provider.js";

const CAPABILITIES: AdapterCapabilities = {
  transport: "app-server",
  inlineRender: "arbitrary",
  bufferRead: true,
  cursorRead: true,
  atomicAcceptance: true,
  cancellation: true,
  resizeAwareness: true,
  alternateScreenSafety: true,
  nativeCompletionAwareness: true,
  attachmentReferences: false,
};

describe("CodexSuggestionProvider", () => {
  it("returns a bounded insertion candidate from the dedicated suggestion thread", async () => {
    const client = new FakeSuggestionClient();
    const provider = new CodexSuggestionProvider(client, "suggest-thread");

    const result = provider.provide(
      request("fix auth"),
      new AbortController().signal,
    );
    client.emit("item/agentMessage/delta", {
      threadId: "suggest-thread",
      turnId: "suggest-turn",
      delta: " tests",
    });
    client.emit("turn/completed", {
      threadId: "suggest-thread",
      turn: { id: "suggest-turn", status: "completed" },
    });

    await expect(result).resolves.toMatchObject({
      requestId: "request-1",
      revision: 1,
      edit: {
        startByte: utf8ByteLength("fix auth"),
        endByte: utf8ByteLength("fix auth"),
        text: " tests",
      },
    });
    provider.dispose();
  });

  it("projects full-prompt output and strips unsafe terminal controls", async () => {
    const client = new FakeSuggestionClient();
    const provider = new CodexSuggestionProvider(client, "suggest-thread");

    const result = provider.provide(
      request("run"),
      new AbortController().signal,
    );
    client.emit("item/agentMessage/delta", {
      threadId: "suggest-thread",
      turnId: "suggest-turn",
      delta: "run tests\u001b[31m\nignored",
    });
    client.emit("turn/completed", {
      threadId: "suggest-thread",
      turn: { id: "suggest-turn", status: "completed" },
    });

    await expect(result).resolves.toMatchObject({ edit: { text: " tests" } });
    provider.dispose();
  });

  it("interrupts generation and never returns a candidate after abort", async () => {
    const client = new FakeSuggestionClient();
    const provider = new CodexSuggestionProvider(client, "suggest-thread");
    const controller = new AbortController();

    const result = provider.provide(request("fix auth"), controller.signal);
    await Promise.resolve();
    controller.abort(new Error("edited"));

    await expect(result).rejects.toThrow("edited");
    await waitFor(() => client.interruptions.length === 1);
    expect(client.interruptions).toEqual([
      { threadId: "suggest-thread", turnId: "suggest-turn" },
    ]);
    provider.dispose();
  });

  it("ignores notifications from the coding thread", async () => {
    const client = new FakeSuggestionClient();
    const provider = new CodexSuggestionProvider(client, "suggest-thread");
    const result = provider.provide(
      request("fix auth"),
      new AbortController().signal,
    );

    client.emit("item/agentMessage/delta", {
      threadId: "coding-thread",
      turnId: "coding-turn",
      delta: "private coding response",
    });
    client.emit("item/agentMessage/delta", {
      threadId: "suggest-thread",
      turnId: "suggest-turn",
      delta: " tests",
    });
    client.emit("turn/completed", {
      threadId: "suggest-thread",
      turn: { id: "suggest-turn", status: "completed" },
    });

    await expect(result).resolves.toMatchObject({ edit: { text: " tests" } });
    provider.dispose();
  });
});

class FakeSuggestionClient implements CodexSuggestionClient {
  readonly interruptions: { threadId: string; turnId: string }[] = [];
  readonly #listeners = new Set<
    (notification: { method: string; params?: unknown }) => void
  >();

  startTurn(): Promise<{ turnId: string }> {
    return Promise.resolve({ turnId: "suggest-turn" });
  }

  interruptTurn(threadId: string, turnId: string): Promise<void> {
    this.interruptions.push({ threadId, turnId });
    return Promise.resolve();
  }

  onNotification(
    listener: (notification: { method: string; params?: unknown }) => void,
  ) {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.#listeners) listener({ method, params });
  }
}

function request(text: string): SuggestionRequest {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: "request-1",
    revision: 1,
    snapshot: {
      revision: 1,
      text,
      cursorByte: utf8ByteLength(text),
      host: { name: "chat-suggest-codex", version: "0.1.0" },
      capabilities: CAPABILITIES,
      workingDirectory: "/tmp/project",
      sessionId: "session-1",
    },
    context: { contributions: [] },
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
