import { describe, expect, it } from "vitest";

import {
  displayWidth,
  InputConfidenceTracker,
  renderDimSuggestion,
  sanitizeTerminalText,
  truncateToWidth,
} from "../src/index.js";

describe("sanitizeTerminalText", () => {
  it("removes CSI, OSC clipboard, DCS, carriage returns, and controls", () => {
    const input =
      "safe\u001b[31mred\u001b[0m\u001b]52;c;ZXZpbA==\u0007\u001bPprivate\u001b\\\r\0end";
    expect(sanitizeTerminalText(input)).toBe("saferedend");
    expect(sanitizeTerminalText("safe\u001b]52;c;unterminated")).toBe("safe");
  });

  it("enforces bytes, code points, lines, and grapheme boundaries", () => {
    expect(sanitizeTerminalText("e\u0301x", { maxBytes: 3 })).toBe("e\u0301");
    expect(sanitizeTerminalText("a\nb\nc", { maxLines: 2 })).toBe("a\nb");
    expect(sanitizeTerminalText("😀x", { maxCharacters: 1 })).toBe("😀");
  });
});

describe("terminal width", () => {
  it("measures ASCII, combining marks, emoji, and CJK", () => {
    expect(displayWidth("ae\u0301界😀")).toBe(6);
    expect(truncateToWidth("a界😀b", 4)).toBe("a界");
  });

  it("counts flag and keycap grapheme clusters as two terminal cells", () => {
    expect(displayWidth("🇺🇸")).toBe(2);
    expect(displayWidth("1️⃣")).toBe(2);
    expect(truncateToWidth("🇺🇸x", 1)).toBe("");
    expect(truncateToWidth("1️⃣x", 2)).toBe("1️⃣");
  });

  it("renders a bounded dim single line", () => {
    expect(renderDimSuggestion("界ab\nignored", 3)).toBe(
      "\u001b[2m界a\u001b[22m",
    );
    expect(renderDimSuggestion("bad\u001b[31m", 20)).toBe(
      "\u001b[2mbad\u001b[22m",
    );
    expect(renderDimSuggestion("bad\u0085text", 20)).toBe(
      "\u001b[2mbadtext\u001b[22m",
    );
  });
});

describe("InputConfidenceTracker", () => {
  it("tracks only append and backspace after a handshake", () => {
    const tracker = new InputConfidenceTracker();
    tracker.handshake();
    tracker.consumeInput("fix 😀");
    tracker.consumeInput("\u007f");
    expect(tracker.snapshot()).toMatchObject({
      state: "known-eol",
      draft: "fix ",
    });
    expect(tracker.canRenderSuggestion()).toBe(true);
  });

  it.each([
    ["cursor", () => "\u001b[A", "cursor-motion"],
    ["paste", () => "\u001b[200~", "bracketed-paste"],
    ["mouse", () => "\u001b[?1000h", "mouse-input"],
    ["unknown", () => "\u0001", "unknown-sequence"],
  ])("clears on ambiguous %s input", (_name, input, reason) => {
    const tracker = new InputConfidenceTracker();
    tracker.handshake();
    tracker.consumeInput("secret draft");
    tracker.consumeInput(input());
    expect(tracker.snapshot()).toMatchObject({
      state: "ambiguous",
      reason,
      draft: "",
    });
    expect(tracker.canRenderSuggestion()).toBe(false);
  });

  it("clears on output, alternate screen, hidden input, and resize", () => {
    const cases: readonly [string, string][] = [
      ["async output", "unexpected-output"],
      ["\u001b[?1049h", "alternate-screen"],
      ["Password: ", "hidden-input"],
      ["\u001b[2J", "full-redraw"],
    ];
    for (const [output, reason] of cases) {
      const tracker = new InputConfidenceTracker();
      tracker.handshake();
      tracker.consumeInput("private");
      tracker.observeOutput(output);
      expect(tracker.snapshot()).toMatchObject({ reason, draft: "" });
    }
    const tracker = new InputConfidenceTracker();
    tracker.handshake();
    tracker.resize();
    expect(tracker.snapshot()).toMatchObject({
      state: "suspended",
      reason: "resize",
      draft: "",
    });
  });
});
