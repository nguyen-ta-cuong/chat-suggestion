import { describe, expect, it } from "vitest";

import type {
  CodexNotification,
  CodexServerRequest,
  CodexThreadStartOptions,
  CodexTurnStartOptions,
} from "@chat-suggestion/adapter-codex";
import { FakeSuggestionProvider } from "@chat-suggestion/provider";

import { defaultConfiguration } from "../src/config.js";
import {
  CodexFrontendSession,
  type CodexFrontendClient,
} from "../src/codex-frontend.js";

describe("CodexFrontendSession", () => {
  it("renders, accepts, and submits ghost text through an owned editor", async () => {
    const client = new FakeFrontendClient();
    let output = "";
    let exited = false;
    const provider = new FakeSuggestionProvider({
      mappings: { "fix auth": " tests" },
    });
    const session = new CodexFrontendSession({
      client,
      provider,
      configuration: { ...defaultConfiguration(), debounceMs: 100 },
      cwd: "/tmp/project",
      codexVersion: "0.144.1",
      width: () => 80,
      write: (text) => {
        output += text;
      },
      onExit: () => {
        exited = true;
      },
    });

    await session.start();
    session.handleInput("fix auth");
    await waitFor(() => output.includes("\u001b[2m tests\u001b[22m"));

    session.handleInput("\t");
    expect(session.state()).toMatchObject({
      draft: "fix auth tests",
      suggestion: "",
      busy: false,
    });
    expect(client.turns).toEqual([]);

    session.handleInput("\r");
    await waitFor(() => client.turns.length === 1);
    expect(client.turns[0]).toMatchObject({
      threadId: "coding-thread",
      text: "fix auth tests",
    });

    client.emit("item/agentMessage/delta", {
      threadId: "coding-thread",
      turnId: "coding-turn",
      delta: "Done",
    });
    client.emit("turn/completed", {
      threadId: "coding-thread",
      turn: { id: "coding-turn", status: "completed" },
    });
    await waitFor(() => !session.state().busy);
    expect(output).toContain("Done");

    session.handleInput("\u0004");
    expect(exited).toBe(true);
    await session.close();
    expect(client.closed).toBe(true);
  });

  it("rejects server approval requests rather than hanging the agent", async () => {
    const client = new FakeFrontendClient();
    const session = new CodexFrontendSession({
      client,
      provider: new FakeSuggestionProvider(),
      configuration: defaultConfiguration(),
      cwd: "/tmp/project",
      codexVersion: "0.144.1",
      width: () => 80,
      write: () => undefined,
      onExit: () => undefined,
    });

    await session.start();
    client.request({
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: { command: "synthetic" },
    });

    expect(client.responses).toEqual([
      { id: 42, result: { decision: "decline" } },
    ]);
    await session.close();
  });

  it("handles printable text and Enter coalesced in one fast input chunk", async () => {
    const client = new FakeFrontendClient();
    const session = new CodexFrontendSession({
      client,
      provider: new FakeSuggestionProvider(),
      configuration: defaultConfiguration(),
      cwd: "/tmp/project",
      codexVersion: "0.144.1",
      width: () => 80,
      write: () => undefined,
      onExit: () => undefined,
    });

    await session.start();
    session.handleInput("fast typing\r");
    await waitFor(() => client.turns.length === 1);

    expect(client.turns[0]?.text).toBe("fast typing");
    await session.close();
  });
});

class FakeFrontendClient implements CodexFrontendClient {
  readonly turns: CodexTurnStartOptions[] = [];
  readonly responses: { id: number | string; result: unknown }[] = [];
  readonly #notifications = new Set<(value: CodexNotification) => void>();
  readonly #requests = new Set<(value: CodexServerRequest) => void>();
  closed = false;
  errorResponseCount = 0;

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  startThread(options: CodexThreadStartOptions): Promise<{ threadId: string }> {
    return Promise.resolve({
      threadId: options.ephemeral === true ? "suggest-thread" : "coding-thread",
    });
  }

  startTurn(options: CodexTurnStartOptions): Promise<{ turnId: string }> {
    this.turns.push(options);
    return Promise.resolve({ turnId: "coding-turn" });
  }

  interruptTurn(): Promise<void> {
    return Promise.resolve();
  }

  onNotification(listener: (value: CodexNotification) => void) {
    this.#notifications.add(listener);
    return { dispose: () => this.#notifications.delete(listener) };
  }

  onRequest(listener: (value: CodexServerRequest) => void) {
    this.#requests.add(listener);
    return { dispose: () => this.#requests.delete(listener) };
  }

  respond(id: number | string, result: unknown): void {
    this.responses.push({ id, result });
  }

  respondError(): void {
    this.errorResponseCount += 1;
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.#notifications) listener({ method, params });
  }

  request(value: CodexServerRequest): void {
    for (const listener of this.#requests) listener(value);
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
