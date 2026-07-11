import { utf8ByteLength } from "./utf8.js";
import {
  PROTOCOL_VERSION,
  type AdapterCapabilities,
  type SuggestionCandidate,
  type SuggestionRequest,
} from "./types.js";

export const FAKE_CAPABILITIES: AdapterCapabilities = {
  transport: "native",
  inlineRender: "eol-only",
  bufferRead: true,
  cursorRead: true,
  atomicAcceptance: true,
  cancellation: true,
  resizeAwareness: true,
  alternateScreenSafety: true,
  nativeCompletionAwareness: true,
  attachmentReferences: false,
};

export function createFakeSuggestionRequest(): SuggestionRequest {
  const text = "add unit";
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: "fixture-request-1",
    revision: 1,
    snapshot: {
      revision: 1,
      text,
      cursorByte: utf8ByteLength(text),
      host: { name: "fixture-host", version: "1.0.0" },
      capabilities: { ...FAKE_CAPABILITIES },
      workingDirectory: ".",
      sessionId: "fixture-session-1",
    },
    context: {
      contributions: [{ kind: "project", content: "language: TypeScript" }],
    },
  };
}

export function createFakeSuggestionCandidate(
  request = createFakeSuggestionRequest(),
): SuggestionCandidate {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: request.requestId,
    revision: request.revision,
    edit: {
      startByte: request.snapshot.cursorByte,
      endByte: request.snapshot.cursorByte,
      text: " tests",
    },
    tokenCount: 1,
  };
}

export const FAKE_REQUEST = createFakeSuggestionRequest();
export const FAKE_CANDIDATE = createFakeSuggestionCandidate(FAKE_REQUEST);
