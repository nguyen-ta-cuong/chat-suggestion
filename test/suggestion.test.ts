import { describe, expect, it } from "vitest";
import {
  MAX_SUGGESTION_BYTES,
  PROTOCOL_VERSION,
  parseSuggestionCandidate,
  sanitizeSuggestionText,
  utf8ByteLength,
} from "../src/suggestion.js";

describe("suggestion safety contract", () => {
  it("accepts a zero-token streamed partial", () => {
    expect(
      parseSuggestionCandidate({
        protocolVersion: PROTOCOL_VERSION,
        requestId: "pi-1-1",
        revision: 1,
        edit: { startByte: 3, endByte: 3, text: " tests" },
        tokenCount: 0,
      }).ok,
    ).toBe(true);
  });

  it.each([
    ["replacement", { startByte: 1, endByte: 2, text: "x" }],
    ["control sequence", { startByte: 1, endByte: 1, text: "\u001b[31mx" }],
    ["multiline", { startByte: 1, endByte: 1, text: "x\ny" }],
  ])("rejects an unsafe %s candidate", (_name, edit) => {
    expect(
      parseSuggestionCandidate({
        protocolVersion: PROTOCOL_VERSION,
        requestId: "unsafe",
        revision: 1,
        edit,
        tokenCount: 1,
      }).ok,
    ).toBe(false);
  });

  it("rejects and strips unpaired Unicode surrogates", () => {
    expect(
      parseSuggestionCandidate({
        protocolVersion: PROTOCOL_VERSION,
        requestId: "malformed-unicode",
        revision: 1,
        edit: { startByte: 1, endByte: 1, text: "safe\ud800" },
        tokenCount: 1,
      }).ok,
    ).toBe(false);
    expect(sanitizeSuggestionText("safe\ud800")).toBe("safe");
    expect(sanitizeSuggestionText("safe 😀")).toBe("safe 😀");
  });

  it("strips terminal escapes and stops at the first line", () => {
    expect(sanitizeSuggestionText("\u001b[31msafe\u001b[0m\nignored")).toBe(
      "safe",
    );
  });

  it("bounds sanitized output by UTF-8 bytes", () => {
    const output = sanitizeSuggestionText("界".repeat(1_000));
    expect(utf8ByteLength(output)).toBeLessThanOrEqual(MAX_SUGGESTION_BYTES);
  });
});
