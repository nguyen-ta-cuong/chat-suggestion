import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  CONTEXT_SOURCE_BYTE_LIMITS,
  FAKE_CANDIDATE,
  FAKE_REQUEST,
  MAX_REQUEST_BYTES,
  NdjsonDecoder,
  PROTOCOL_VERSION,
  createFakeSuggestionCandidate,
  createFakeSuggestionRequest,
  encodeNdjson,
  parsePtyProfileDescriptor,
  parseSuggestionCandidate,
  parseSuggestionRequest,
  sanitizeSuggestionText,
  sha256Prefix,
  utf8ByteLength,
  validateCandidateForRequest,
} from "../src/index.js";

describe("protocol version 1", () => {
  it("round-trips a request through arbitrarily split NDJSON chunks", () => {
    const request = createFakeSuggestionRequest();
    const frame = encodeNdjson(request);
    const decoder = new NdjsonDecoder();
    const decoded = Array.from(frame).flatMap((byte) =>
      decoder.push(Uint8Array.of(byte)),
    );

    expect(decoded).toEqual([{ ok: true, value: request }]);
    const parsed = parseSuggestionRequest(
      decoded[0]?.ok ? decoded[0].value : undefined,
    );
    expect(parsed).toEqual({ ok: true, value: request });
  });

  it("decodes multiple frames and a final frame without a newline", () => {
    const first = createFakeSuggestionRequest();
    const second = { ...first, requestId: "fixture-request-2" };
    const decoder = new NdjsonDecoder();
    const bytes = Buffer.concat([
      Buffer.from(encodeNdjson(first)),
      Buffer.from(JSON.stringify(second), "utf8"),
    ]);

    expect(decoder.push(bytes)).toEqual([{ ok: true, value: first }]);
    expect(decoder.finish()).toEqual([{ ok: true, value: second }]);
  });

  it("rejects unknown protocol versions", () => {
    const result = parseSuggestionRequest({
      ...createFakeSuggestionRequest(),
      protocolVersion: 2,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "unsupported-version", path: "$.protocolVersion" },
    });
  });

  it("rejects oversized NDJSON frames while keeping its buffer bounded", () => {
    const decoder = new NdjsonDecoder(MAX_REQUEST_BYTES);
    const results = decoder.push(`"${"x".repeat(MAX_REQUEST_BYTES)}"\n`);

    expect(results).toMatchObject([
      { ok: false, error: { code: "size-limit" } },
    ]);
    expect(decoder.finish()).toEqual([]);
  });

  it("rejects context over a source budget", () => {
    const request = createFakeSuggestionRequest();
    const result = parseSuggestionRequest({
      ...request,
      context: {
        contributions: [
          {
            kind: "attachment",
            content: "x".repeat(CONTEXT_SOURCE_BYTE_LIMITS.attachment + 1),
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "size-limit", path: "$.context.contributions[0].content" },
    });
  });

  it("rejects a cursor inside a multibyte code point", () => {
    const request = createFakeSuggestionRequest();
    const text = "fix 🐛";
    const result = parseSuggestionRequest({
      ...request,
      snapshot: {
        ...request.snapshot,
        text,
        cursorByte: utf8ByteLength("fix ") + 1,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-offset", path: "$.snapshot.cursorByte" },
    });
  });

  it("rejects malformed Unicode before measuring offsets", () => {
    const request = createFakeSuggestionRequest();
    const result = parseSuggestionRequest({
      ...request,
      snapshot: {
        ...request.snapshot,
        text: "unfinished surrogate \ud800",
        cursorByte: 0,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-utf8", path: "$.snapshot.text" },
    });
  });

  it("treats the serialized request size as authoritative", () => {
    const request = createFakeSuggestionRequest();
    const maximumDraft = "x".repeat(8_192);
    const result = parseSuggestionRequest({
      ...request,
      snapshot: {
        ...request.snapshot,
        text: maximumDraft,
        cursorByte: utf8ByteLength(maximumDraft),
        workingDirectory: "😀".repeat(4_096),
      },
      context: {
        contributions: Object.entries(CONTEXT_SOURCE_BYTE_LIMITS).map(
          ([kind, byteLimit]) => ({ kind, content: "x".repeat(byteLimit) }),
        ),
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "size-limit", path: "$" },
    });
  });

  it("rejects unsafe candidate output and strips it when explicitly sanitized", () => {
    const candidate = createFakeSuggestionCandidate();
    const unsafeText = " tests\u001b]52;c;payload\u0007";
    const result = parseSuggestionCandidate({
      ...candidate,
      edit: { ...candidate.edit, text: unsafeText },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "unsafe-text", path: "$.edit.text" },
    });
    expect(sanitizeSuggestionText(unsafeText)).toBe(" tests");
  });

  it("rejects stale request IDs and revisions before rendering or acceptance", () => {
    const request = createFakeSuggestionRequest();
    const wrongRequest = {
      ...createFakeSuggestionCandidate(request),
      requestId: "older-request",
    };
    const wrongRevision = {
      ...createFakeSuggestionCandidate(request),
      revision: request.revision - 1,
    };

    expect(validateCandidateForRequest(wrongRequest, request)).toMatchObject({
      ok: false,
      error: { code: "stale-result" },
    });
    expect(validateCandidateForRequest(wrongRevision, request)).toMatchObject({
      ok: false,
      error: { code: "stale-result" },
    });
  });

  it("enforces insertion-only edits at the snapshot cursor", () => {
    const request = createFakeSuggestionRequest();
    const replacement = {
      ...createFakeSuggestionCandidate(request),
      edit: { startByte: 0, endByte: 1, text: "a" },
    };
    const otherCursor = {
      ...createFakeSuggestionCandidate(request),
      edit: { startByte: 0, endByte: 0, text: "a" },
    };

    expect(parseSuggestionCandidate(replacement)).toMatchObject({
      ok: false,
      error: { code: "invalid-offset" },
    });
    expect(validateCandidateForRequest(otherCursor, request)).toMatchObject({
      ok: false,
      error: { code: "invalid-offset" },
    });
  });

  it("enforces candidate line, character, byte, and token limits", () => {
    const candidate = createFakeSuggestionCandidate();
    const withText = (text: string) => ({
      ...candidate,
      edit: { ...candidate.edit, text },
    });

    expect(parseSuggestionCandidate(withText("a\nb\nc"))).toMatchObject({
      ok: false,
      error: { code: "size-limit" },
    });
    expect(parseSuggestionCandidate(withText("a".repeat(161)))).toMatchObject({
      ok: false,
      error: { code: "size-limit" },
    });
    expect(parseSuggestionCandidate(withText("😀".repeat(161)))).toMatchObject({
      ok: false,
      error: { code: "size-limit" },
    });
    expect(
      parseSuggestionCandidate({ ...candidate, tokenCount: 65 }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-value", path: "$.tokenCount" },
    });
  });

  it("provides deterministic fake request and candidate fixtures", () => {
    expect(FAKE_REQUEST).toEqual(createFakeSuggestionRequest());
    expect(FAKE_CANDIDATE).toEqual(createFakeSuggestionCandidate(FAKE_REQUEST));
    expect(FAKE_CANDIDATE.edit.text).toBe(" tests");
    expect(FAKE_REQUEST.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("hashes content without exposing it", () => {
    expect(sha256Prefix("fixture content")).toBe("77832764857e");
    expect(() => sha256Prefix("fixture content", 0)).toThrow(RangeError);
  });

  it("validates data-only PTY profiles and requires PTY transport", () => {
    const result = parsePtyProfileDescriptor({
      protocolVersion: PROTOCOL_VERSION,
      host: {
        executable: "fixture-agent",
        version: "1.0.0",
        sha256: "a".repeat(64),
      },
      detectors: ["hidden-input", "alternate-screen"],
      markers: ["prompt-start"],
      capabilities: {
        ...FAKE_REQUEST.snapshot.capabilities,
        transport: "pty",
        inlineRender: "adjacent",
      },
      downgrade: {
        code: "adjacent-only",
        message: "Inline layout is not verified.",
      },
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("reports malformed final NDJSON and invalid UTF-8 as structured errors", () => {
    const malformedDecoder = new NdjsonDecoder();
    malformedDecoder.push("{");
    expect(malformedDecoder.finish()).toMatchObject([
      { ok: false, error: { code: "invalid-json" } },
    ]);

    const utf8Decoder = new NdjsonDecoder();
    expect(utf8Decoder.push(Uint8Array.from([0xc3, 0x28, 0x0a]))).toMatchObject(
      [{ ok: false, error: { code: "invalid-utf8" } }],
    );
  });
});
