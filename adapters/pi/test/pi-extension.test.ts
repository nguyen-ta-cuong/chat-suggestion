import type {
  EditorFactory,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createPiSuggestionExtension } from "../src/pi-extension.js";

describe("Pi extension lifecycle", () => {
  it("installs only in TUI mode and restores the default editor", () => {
    const harness = createHarness();
    createPiSuggestionExtension({
      bridge: { suggest: () => Promise.resolve(null) },
      piVersion: "0.80.6",
    })(harness.api);

    harness.emit("session_start", harness.context);
    expect(harness.currentFactory()).toBeTypeOf("function");
    expect(harness.statuses.get("chat-suggestion")).toBe(
      "suggestions: eol-only",
    );

    harness.emit("session_shutdown", harness.context);
    expect(harness.currentFactory()).toBeUndefined();
    expect(harness.statuses.has("chat-suggestion")).toBe(false);
  });

  it("fails closed when another custom editor already owns the surface", () => {
    const existing = (() => ({})) as unknown as EditorFactory;
    const harness = createHarness(existing);
    createPiSuggestionExtension({
      bridge: { suggest: () => Promise.resolve(null) },
      piVersion: "0.80.6",
    })(harness.api);

    harness.emit("session_start", harness.context);
    expect(harness.currentFactory()).toBe(existing);
    expect(harness.statuses.get("chat-suggestion")).toContain(
      "editor conflict",
    );

    harness.runCommand("chat-suggest", "status");
    expect(harness.notify).toHaveBeenCalledWith(
      expect.stringContaining("none: another extension already owns"),
      "info",
    );
  });

  it("does not install a component outside TUI mode", () => {
    const harness = createHarness(undefined, "rpc");
    createPiSuggestionExtension({
      bridge: { suggest: () => Promise.resolve(null) },
      piVersion: "0.80.6",
    })(harness.api);

    harness.emit("session_start", harness.context);
    expect(harness.currentFactory()).toBeUndefined();
  });
});

function createHarness(
  initialFactory?: EditorFactory,
  mode: ExtensionContext["mode"] = "tui",
) {
  const handlers = new Map<
    string,
    (event: unknown, context: ExtensionContext) => void | Promise<void>
  >();
  const commands = new Map<
    string,
    (args: string, context: ExtensionContext) => void | Promise<void>
  >();
  const statuses = new Map<string, string>();
  const notify = vi.fn();
  let editorFactory = initialFactory;
  const context: ExtensionContext = {
    mode,
    cwd: "/fixture",
    sessionManager: { getSessionId: () => "session-1" },
    modelRegistry: {
      getApiKeyAndHeaders: () =>
        Promise.resolve({ ok: false as const, error: "not configured" }),
    },
    model: undefined,
    ui: {
      theme: { fg: (_color, text) => text },
      notify,
      setStatus(key, text) {
        if (text === undefined) statuses.delete(key);
        else statuses.set(key, text);
      },
      setEditorComponent(factory) {
        editorFactory = factory;
      },
      getEditorComponent: () => editorFactory,
    },
  };
  const api: ExtensionAPI = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerCommand(name, command) {
      commands.set(name, command.handler);
    },
  };

  return {
    api,
    context,
    statuses,
    notify,
    currentFactory: () => editorFactory,
    emit(event: string, target: ExtensionContext) {
      void handlers.get(event)?.({}, target);
    },
    runCommand(name: string, args: string) {
      void commands.get(name)?.(args, context);
    },
  };
}
