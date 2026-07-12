import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexAppServerClient, type CodexServerRequest } from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("CodexAppServerClient", () => {
  it("initializes, starts a thread and turn, and emits streamed notifications", async () => {
    const executable = await makeFakeAppServer();
    const client = new CodexAppServerClient(executable, clientOptions());
    const notifications: string[] = [];
    const subscription = client.onNotification((notification) => {
      notifications.push(notification.method);
    });

    await client.initialize();
    const thread = await client.startThread({ cwd: "/tmp/project" });
    const turn = await client.startTurn({
      threadId: thread.threadId,
      text: "synthetic prompt",
    });
    await waitFor(
      () => notifications.includes("turn/completed"),
      "turn completion",
    );

    expect(thread).toEqual({ threadId: "thread-1" });
    expect(turn).toEqual({ turnId: "turn-1" });
    expect(notifications).toContain("item/agentMessage/delta");
    subscription.dispose();
    await client.close();
  });

  it("surfaces server requests and sends an explicit response", async () => {
    const executable = await makeFakeAppServer({ requestApproval: true });
    const client = new CodexAppServerClient(executable, clientOptions());
    let request: CodexServerRequest | undefined;
    const subscription = client.onRequest((value) => {
      request = value;
      client.respond(value.id, { decision: "decline" });
    });

    await client.initialize();
    await client.startThread({ cwd: "/tmp/project" });
    await waitFor(() => request !== undefined, "approval request");

    expect(request).toMatchObject({
      id: 900,
      method: "item/commandExecution/requestApproval",
    });
    await waitFor(() => client.protocolState().pendingRequests === 0, "reply");
    subscription.dispose();
    await client.close();
  });

  it("interrupts a turn and rejects pending work when closed", async () => {
    const executable = await makeFakeAppServer({ hangingTurn: true });
    const client = new CodexAppServerClient(executable, clientOptions());

    await client.initialize();
    const thread = await client.startThread({ cwd: "/tmp/project" });
    const turn = await client.startTurn({
      threadId: thread.threadId,
      text: "synthetic prompt",
    });
    await client.interruptTurn(thread.threadId, turn.turnId);

    expect(client.protocolState().pendingRequests).toBe(0);
    await client.close();
    expect(client.protocolState().closed).toBe(true);
  });

  it("fails closed when one protocol line exceeds its byte limit", async () => {
    const executable = await makeFakeAppServer({ oversizedInitialize: true });
    const client = new CodexAppServerClient(executable, {
      ...clientOptions(),
      maxLineBytes: 256,
    });

    await expect(client.initialize()).rejects.toThrow("line exceeded");
    await client.close();
  });
});

function clientOptions() {
  return {
    cwd: "/tmp",
    env: process.env,
    requestTimeoutMs: 1_000,
    shutdownTimeoutMs: 200,
    maxLineBytes: 16 * 1_024,
    maxStderrBytes: 16 * 1_024,
  };
}

interface FakeAppServerOptions {
  readonly requestApproval?: boolean;
  readonly hangingTurn?: boolean;
  readonly oversizedInitialize?: boolean;
}

async function makeFakeAppServer(
  options: FakeAppServerOptions = {},
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codex-client-test-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "codex");
  const script = `#!/usr/bin/env node
const options = ${JSON.stringify(options)};
let buffer = "";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      if (options.oversizedInitialize) process.stdout.write("x".repeat(1024) + "\\n");
      else send({ id: message.id, result: { userAgent: "fake", platformFamily: "unix", platformOs: "test" } });
    } else if (message.method === "thread/start") {
      send({ id: message.id, result: { thread: { id: "thread-1" } } });
      send({ method: "thread/started", params: { thread: { id: "thread-1" } } });
      if (options.requestApproval) send({ id: 900, method: "item/commandExecution/requestApproval", params: { command: "synthetic" } });
    } else if (message.method === "turn/start") {
      send({ id: message.id, result: { turn: { id: "turn-1" } } });
      if (!options.hangingTurn) {
        send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "done" } });
        send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [], error: null } } });
      }
    } else if (message.method === "turn/interrupt") {
      send({ id: message.id, result: {} });
    } else if (message.id === 900 && message.result) {
      send({ method: "test/approvalHandled", params: message.result });
    }
  }
});
`;
  await writeFile(executable, script, "utf8");
  await chmod(executable, 0o755);
  return executable;
}

async function waitFor(
  condition: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
