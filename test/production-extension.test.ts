import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import productionExtension, {
  CHAT_SUGGESTION_VERSION,
} from "../src/production-extension.js";

describe("production extension metadata", () => {
  it("reports the published package version through the status command", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const handlers = new Map<
      string,
      ((event: unknown, context: ExtensionContext) => void | Promise<void>)[]
    >();
    const commands = new Map<
      string,
      (args: string, context: ExtensionContext) => void | Promise<void>
    >();
    const api: ExtensionAPI = {
      on(event, handler) {
        const registered = handlers.get(event) ?? [];
        registered.push(handler);
        handlers.set(event, registered);
      },
      registerCommand(name, command) {
        commands.set(name, command.handler);
      },
    };
    const notify = vi.fn();
    let editorFactory: ReturnType<ExtensionContext["ui"]["getEditorComponent"]>;
    const context: ExtensionContext = {
      mode: "tui",
      cwd: "/fixture",
      sessionManager: {
        getSessionId: () => "session-1",
        buildContextEntries: () => [],
      },
      modelRegistry: {
        getApiKeyAndHeaders: () =>
          Promise.resolve({ ok: false as const, error: "not configured" }),
      },
      model: undefined,
      ui: {
        theme: { fg: (_color, text) => text },
        notify,
        setStatus: vi.fn(),
        setEditorComponent(factory) {
          editorFactory = factory;
        },
        getEditorComponent: () => editorFactory,
      },
    };

    productionExtension(api);
    for (const handler of handlers.get("session_start") ?? []) {
      void handler({}, context);
    }
    void commands.get("chat-suggest")?.("status", context);

    expect(CHAT_SUGGESTION_VERSION).toBe(manifest.version);
    expect(notify).toHaveBeenLastCalledWith(
      `Chat suggestions v${manifest.version}: on; capability native eol-only; last clear none`,
      "info",
    );
  });
});
