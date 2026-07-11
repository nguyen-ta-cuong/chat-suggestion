import {
  MAX_CANDIDATE_BYTES,
  MAX_CANDIDATE_CHARACTERS,
  MAX_CANDIDATE_LINES,
  MAX_PROVIDER_TOKENS,
  containsUnsafeTerminalText,
  isWellFormedUnicode,
  type ProtocolVersion,
  type SuggestionCandidate,
  type SuggestionRequest,
  utf8ByteLength,
} from "@chat-suggestion/protocol";

import type { OutputProjection } from "./config.js";
import { ProviderError } from "./errors.js";

export function projectOutput(
  output: string,
  draft: string,
  projection: OutputProjection,
): string {
  if (projection === "suffix") return output;
  if (!output.startsWith(draft)) {
    throw new ProviderError(
      "invalid-response",
      "full-prompt output must begin with the exact draft",
    );
  }
  return output.slice(draft.length);
}

export function validateOutputText(output: string): void {
  if (output === "") {
    throw new ProviderError("invalid-response", "provider output is empty");
  }
  if (!isWellFormedUnicode(output)) {
    throw new ProviderError(
      "unsafe-output",
      "provider output is not well-formed Unicode",
    );
  }
  if (containsUnsafeTerminalText(output) || output.includes("\u001b")) {
    throw new ProviderError(
      "unsafe-output",
      "provider output contains terminal controls",
    );
  }
  if (utf8ByteLength(output) > MAX_CANDIDATE_BYTES) {
    throw new ProviderError(
      "unsafe-output",
      "provider output exceeds the byte limit",
    );
  }
  if (Array.from(output).length > MAX_CANDIDATE_CHARACTERS) {
    throw new ProviderError(
      "unsafe-output",
      "provider output exceeds the character limit",
    );
  }
  if (output.split("\n").length > MAX_CANDIDATE_LINES) {
    throw new ProviderError(
      "unsafe-output",
      "provider output exceeds the line limit",
    );
  }
}

export function createCandidate(
  request: SuggestionRequest,
  output: string,
  protocolVersion: ProtocolVersion,
  tokenCount = estimateTokenCount(output),
): SuggestionCandidate {
  return {
    protocolVersion,
    requestId: request.requestId,
    revision: request.revision,
    edit: {
      startByte: request.snapshot.cursorByte,
      endByte: request.snapshot.cursorByte,
      text: output,
    },
    tokenCount,
  };
}

function estimateTokenCount(output: string): number {
  const roughCount = Math.ceil(Array.from(output).length / 4);
  return Math.max(1, Math.min(MAX_PROVIDER_TOKENS, roughCount));
}
