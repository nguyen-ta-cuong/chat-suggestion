import { utf8ByteLength, type PromptSnapshot } from "@chat-suggestion/protocol";
import { describe, expect, it } from "vitest";
import { createOfflineSuggestionBridge } from "../smoke/offline-extension.js";
import { PI_NATIVE_CAPABILITIES } from "../src/pi-suggestion-editor.js";

describe("offline Pi smoke bridge", () => {
  it("offers the deterministic ghost for an ordinary three-character draft", async () => {
    const snapshot = createSnapshot("tes");

    const candidate = await createOfflineSuggestionBridge().suggest(
      snapshot,
      "offline-smoke-1",
      new AbortController().signal,
    );

    expect(candidate).toMatchObject({
      requestId: "offline-smoke-1",
      revision: snapshot.revision,
      edit: {
        startByte: snapshot.cursorByte,
        endByte: snapshot.cursorByte,
        text: " tests and add a regression test",
      },
    });
  });

  it("stays silent for short drafts and canceled work", async () => {
    const bridge = createOfflineSuggestionBridge();
    const controller = new AbortController();
    controller.abort();

    await expect(
      bridge.suggest(
        createSnapshot("hi"),
        "short",
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    await expect(
      bridge.suggest(createSnapshot("tes"), "aborted", controller.signal),
    ).resolves.toBeNull();
  });
});

function createSnapshot(text: string): PromptSnapshot {
  return {
    revision: 1,
    text,
    cursorByte: utf8ByteLength(text),
    host: { name: "pi", version: "0.80.6" },
    capabilities: PI_NATIVE_CAPABILITIES,
    workingDirectory: "/fixture",
    sessionId: "offline-smoke",
  };
}
