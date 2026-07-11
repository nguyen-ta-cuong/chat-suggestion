import { Buffer } from "node:buffer";

import {
  FAKE_REQUEST,
  PROTOCOL_VERSION,
  createFakeSuggestionCandidate,
  type PtyProfileDescriptor,
} from "@chat-suggestion/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  PtyDependencyError,
  PtyRunner,
  PtySuggestionController,
  compilePtyProfile,
  createNodePtyBackend,
} from "../src/index.js";
import {
  SyntheticPtyBackend,
  SyntheticSignals,
  SyntheticTerminal,
} from "./fixtures/synthetic-pty.js";

const DESCRIPTOR: PtyProfileDescriptor = {
  protocolVersion: PROTOCOL_VERSION,
  host: {
    executable: "fixture-agent",
    version: "1",
    sha256: "b".repeat(64),
  },
  detectors: ["output-mode", "cursor-motion", "hidden-input"],
  markers: ["prompt-start"],
  capabilities: {
    transport: "pty",
    inlineRender: "adjacent",
    bufferRead: true,
    cursorRead: true,
    atomicAcceptance: true,
    cancellation: true,
    resizeAwareness: true,
    alternateScreenSafety: false,
    nativeCompletionAwareness: true,
    attachmentReferences: false,
  },
};

function setup() {
  const compiled = compilePtyProfile(DESCRIPTOR, DESCRIPTOR.host);
  if (!compiled.ok) {
    throw new Error(compiled.error.message);
  }
  compiled.value.profile.observeMarker("prompt-start");
  compiled.value.profile.observeInput(
    Buffer.from(FAKE_REQUEST.snapshot.text, "utf8"),
  );
  const terminal = new SyntheticTerminal();
  const backend = new SyntheticPtyBackend();
  const signals = new SyntheticSignals();
  const surface = { show: vi.fn(), clear: vi.fn() };
  const controller = new PtySuggestionController(
    compiled.value.profile,
    surface,
  );
  const options = {
    backend,
    terminal,
    controller,
    executable: "fixture-agent",
    args: ["--fixture"],
    cwd: "/tmp",
    env: { TERM: "xterm-256color" },
    allowlistedExecutables: new Set(["fixture-agent"]),
    signals,
  };
  return { backend, controller, options, signals, surface, terminal };
}

describe("PtyRunner", () => {
  it("is byte-transparent while inactive and preserves child exit status", async () => {
    const { backend, options, terminal } = setup();
    const run = new PtyRunner().run(options);
    const input = Uint8Array.from([0x00, 0xff, 0x41, 0x0d]);
    const output = Uint8Array.from([0x1b, 0x5b, 0x32, 0x4a, 0xff]);
    terminal.emitData(input);
    backend.child.emitData(output);
    backend.child.emitExit({ exitCode: 23, signal: 15 });

    await expect(run).resolves.toEqual({ exitCode: 23, signal: 15 });
    expect(backend.child.writes).toEqual([input]);
    expect(terminal.output).toEqual([output]);
    expect(terminal.rawModeChanges).toEqual([true, false]);
  });

  it("inherits the parent environment when no override is supplied", async () => {
    const { backend, options } = setup();
    const { env: _env, ...withoutEnvironment } = options;
    const run = new PtyRunner().run(withoutEnvironment);
    backend.child.emitExit({ exitCode: 0 });
    await run;

    expect(backend.lastSpawnOptions?.env.PATH).toBe(process.env.PATH);
  });

  it("injects only accepted suffix bytes and never submit", async () => {
    const { backend, controller, options, terminal } = setup();
    const run = new PtyRunner().run(options);
    controller.show(FAKE_REQUEST, createFakeSuggestionCandidate(FAKE_REQUEST));
    terminal.emitData(Uint8Array.of(0x09));
    backend.child.emitExit({ exitCode: 0 });
    await run;

    expect(
      backend.child.writes.map((bytes) => Buffer.from(bytes).toString("utf8")),
    ).toEqual([" tests"]);
    expect(backend.child.writes[0]).not.toContain(0x0d);
  });

  it("forwards resize storms and signals, then removes every listener", async () => {
    const { backend, options, signals, terminal } = setup();
    const run = new PtyRunner().run(options);
    for (let index = 1; index <= 1_000; index += 1) {
      terminal.emitResize(40 + (index % 80), 10 + (index % 40));
    }
    signals.emit("SIGINT");
    signals.emit("SIGCONT");
    signals.emit("SIGTSTP");
    signals.emit("SIGTERM");
    backend.child.emitExit({ exitCode: 143 });
    await run;

    expect(backend.child.resizes).toHaveLength(1_000);
    expect(backend.child.signals).toEqual([
      "SIGINT",
      "SIGCONT",
      "SIGTSTP",
      "SIGTERM",
    ]);
    expect(terminal.isRaw).toBe(false);
    expect(terminal.listenerCount).toBe(0);
    expect(signals.listenerCount).toBe(0);
    expect(backend.child.listenerCount).toBe(0);
  });

  it("restores terminal state when allocation fails", async () => {
    const { backend, options, terminal } = setup();
    backend.spawnError = new Error("synthetic allocation failure");
    await expect(new PtyRunner().run(options)).rejects.toThrow(
      "synthetic allocation failure",
    );
    expect(terminal.rawModeChanges).toEqual([true, false]);
    expect(terminal.listenerCount).toBe(0);
  });

  it("kills the child and restores terminal state after a wrapper callback fault", async () => {
    const { backend, options, terminal } = setup();
    vi.spyOn(terminal, "write").mockImplementation(() => {
      throw new Error("synthetic wrapper fault");
    });
    const run = new PtyRunner().run(options);
    backend.child.emitData(Buffer.from("fault"));

    await expect(run).rejects.toThrow("synthetic wrapper fault");
    expect(backend.child.signals).toContain("SIGTERM");
    expect(backend.child.signals).toContain("SIGKILL");
    expect(terminal.isRaw).toBe(false);
    expect(terminal.listenerCount).toBe(0);
    expect(backend.child.listenerCount).toBe(0);
  });

  it("rejects commands outside the explicit allowlist before raw mode", async () => {
    const { options, terminal } = setup();
    await expect(
      new PtyRunner().run({ ...options, allowlistedExecutables: new Set() }),
    ).rejects.toThrow("not allowlisted");
    expect(terminal.rawModeChanges).toEqual([]);
  });

  it("reports unsupported platforms before loading the optional dependency", () => {
    expect(() => createNodePtyBackend("win32")).toThrow(PtyDependencyError);
    expect(() => createNodePtyBackend("win32")).toThrow(
      "supported only on darwin and linux",
    );
  });
});
