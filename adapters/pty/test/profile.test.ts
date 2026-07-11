import { Buffer } from "node:buffer";

import {
  FAKE_REQUEST,
  PROTOCOL_VERSION,
  createFakeSuggestionCandidate,
  type PtyHostFingerprint,
  type PtyProfileDescriptor,
} from "@chat-suggestion/protocol";
import { describe, expect, it } from "vitest";

import {
  PtySuggestionController,
  compilePtyProfile,
  type AdjacentSuggestionSurface,
} from "../src/index.js";

const HOST: PtyHostFingerprint = {
  executable: "fixture-agent",
  version: "1.2.3",
  sha256: "a".repeat(64),
};

const DESCRIPTOR: PtyProfileDescriptor = {
  protocolVersion: PROTOCOL_VERSION,
  host: HOST,
  detectors: [
    "alternate-screen",
    "bracketed-paste",
    "completion-ui",
    "cursor-motion",
    "hidden-input",
    "output-mode",
    "redraw",
  ],
  markers: [
    "prompt-start",
    "prompt-end",
    "hidden-input-start",
    "hidden-input-end",
  ],
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
  downgrade: {
    code: "experimental-adjacent",
    message: "PTY suggestions are adjacent and experimental.",
  },
};

function compile(host = HOST) {
  const result = compilePtyProfile(DESCRIPTOR, host);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function handshake(profile: ReturnType<typeof compile>["profile"]): void {
  profile.observeMarker("prompt-start");
  profile.observeMarker("prompt-end");
}

describe("PtyProfile", () => {
  it("requires an exact fingerprint and explicit prompt handshake", () => {
    const exact = compile();
    expect(exact.matched).toBe(true);
    expect(exact.profile.capabilities().inlineRender).toBe("none");

    exact.profile.observeMarker("prompt-start");
    expect(exact.profile.state.kind).toBe("untrusted");
    exact.profile.observeMarker("prompt-end");
    expect(exact.profile.state).toEqual({ kind: "ready" });
    expect(exact.profile.capabilities().inlineRender).toBe("adjacent");

    const mismatch = compile({ ...HOST, version: "1.2.4" });
    mismatch.profile.observeMarker("prompt-start");
    mismatch.profile.observeMarker("prompt-end");
    expect(mismatch.matched).toBe(false);
    expect(mismatch.downgrade?.code).toBe("profile-mismatch");
    expect(mismatch.profile.capabilities().inlineRender).toBe("none");
  });

  it("derives split prompt handshake markers from the child output stream", () => {
    const { profile } = compile();

    for (const chunk of [
      "\u001b",
      "]13",
      "3;A",
      "\u0007\u001b]",
      "133;B\u0007",
    ]) {
      profile.observeOutput(Buffer.from(chunk, "latin1"));
    }

    expect(profile.state).toEqual({ kind: "ready" });
  });

  it("tracks only printable append/backspace and fails closed on ambiguity", () => {
    const { profile } = compile();
    handshake(profile);
    profile.observeInput(Buffer.from("fix 🐛", "utf8"));
    profile.observeInput(Uint8Array.of(0x7f));
    expect(profile.draft).toBe("fix ");

    profile.observeInput(Buffer.from("\u001b[A", "latin1"));
    expect(profile.state).toEqual({
      kind: "suspended",
      reason: "cursor-motion",
    });
    expect(profile.draft).toBe("");
  });

  it.each([
    ["paste", Buffer.from("\u001b[200~secret", "latin1"), "bracketed-paste"],
    ["unknown escape", Buffer.from("\u001b", "latin1"), "unknown-sequence"],
    ["completion Tab", Uint8Array.of(0x09), "completion-ownership-unknown"],
    ["submit", Uint8Array.of(0x0d), "submitted"],
  ])("suspends on %s", (_name, bytes, reason) => {
    const { profile } = compile();
    handshake(profile);
    profile.observeInput(bytes);
    expect(profile.state).toEqual({ kind: "suspended", reason });
  });

  it("fails closed as soon as a split escape sequence becomes ambiguous", () => {
    const { profile } = compile();
    handshake(profile);
    profile.observeInput(Uint8Array.of(0x1b));
    profile.observeInput(Buffer.from("[A", "latin1"));
    expect(profile.state).toEqual({
      kind: "suspended",
      reason: "unknown-sequence",
    });
  });

  it("suppresses request eligibility throughout hidden input", () => {
    const { profile } = compile();
    handshake(profile);
    profile.observeMarker("hidden-input-start");
    expect(profile.canRequestSuggestion).toBe(false);
    expect(profile.state).toEqual({
      kind: "suspended",
      reason: "hidden-input",
    });
    profile.observeMarker("hidden-input-end");
    expect(profile.state.kind).toBe("untrusted");
    handshake(profile);
    expect(profile.canRequestSuggestion).toBe(true);
  });

  it.each([
    ["ordinary output", Buffer.from("echo", "utf8"), "host-output"],
    [
      "alternate screen",
      Buffer.from("\u001b[?1049h", "latin1"),
      "alternate-screen",
    ],
    ["redraw", Buffer.from("\u001b[2J", "latin1"), "redraw"],
  ])("clears on %s", (_name, bytes, reason) => {
    const { profile } = compile();
    handshake(profile);
    profile.observeOutput(bytes);
    expect(profile.state).toEqual({ kind: "suspended", reason });
  });
});

describe("PtySuggestionController", () => {
  function setup() {
    const { profile } = compile();
    handshake(profile);
    const shown: string[] = [];
    const cleared: string[] = [];
    const surface: AdjacentSuggestionSurface = {
      show: (text) => shown.push(text),
      clear: (reason) => cleared.push(reason),
    };
    profile.observeInput(Buffer.from(FAKE_REQUEST.snapshot.text, "utf8"));
    return {
      profile,
      shown,
      cleared,
      controller: new PtySuggestionController(profile, surface),
    };
  }

  it("accepts a current suffix exactly once without Enter", () => {
    const { controller, profile, shown, cleared } = setup();
    const candidate = createFakeSuggestionCandidate(FAKE_REQUEST);
    const writes: Uint8Array[] = [];
    expect(controller.show(FAKE_REQUEST, candidate)).toBe(true);
    expect(shown).toEqual([" tests"]);

    controller.handleInput(Uint8Array.of(0x09), (bytes) => writes.push(bytes));
    expect(profile.draft).toBe(`${FAKE_REQUEST.snapshot.text} tests`);
    controller.handleInput(Uint8Array.of(0x09), (bytes) => writes.push(bytes));

    expect(writes.map((bytes) => Buffer.from(bytes).toString("utf8"))).toEqual([
      " tests",
      "\t",
    ]);
    expect(writes[0]).not.toContain(0x0d);
    expect(writes[0]).not.toContain(0x0a);
    expect(cleared[0]).toBe("accepted");
  });

  it("rejects stale candidates and passes Tab through", () => {
    const { controller } = setup();
    const writes: Uint8Array[] = [];
    expect(
      controller.show(FAKE_REQUEST, {
        ...createFakeSuggestionCandidate(FAKE_REQUEST),
        requestId: "stale",
      }),
    ).toBe(false);
    controller.handleInput(Uint8Array.of(0x09), (bytes) => writes.push(bytes));
    expect(writes).toEqual([Uint8Array.of(0x09)]);
  });

  it("rejects a candidate for a snapshot that differs from the tracked draft", () => {
    const { controller } = setup();
    const mismatchedRequest = {
      ...FAKE_REQUEST,
      snapshot: {
        ...FAKE_REQUEST.snapshot,
        text: "different",
        cursorByte: Buffer.byteLength("different"),
      },
    };
    expect(
      controller.show(
        mismatchedRequest,
        createFakeSuggestionCandidate(mismatchedRequest),
      ),
    ).toBe(false);
  });

  it("clears candidate on edit, output, and resize", () => {
    const scenarios = [
      (controller: PtySuggestionController) => {
        controller.handleInput(Buffer.from("x"), () => undefined);
      },
      (controller: PtySuggestionController) => {
        controller.observeOutput(Buffer.from("output"));
      },
      (controller: PtySuggestionController) => {
        controller.resize();
      },
    ];
    for (const trigger of scenarios) {
      const { controller, cleared } = setup();
      controller.show(
        FAKE_REQUEST,
        createFakeSuggestionCandidate(FAKE_REQUEST),
      );
      trigger(controller);
      expect(cleared).toHaveLength(1);
    }
  });
});
