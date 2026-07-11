import type { AdapterCapabilities } from "@chat-suggestion/protocol";

import type { ClaudeNativeEditorEvidence } from "./types.js";

export const HANDSHAKE_DIMENSIONS = [
  "semanticBufferRead",
  "cursorRead",
  "changeEvents",
  "styledDecoration",
  "nonSubmittingInsertion",
  "nativeCompletionAwareness",
  "disposal",
] as const satisfies readonly (keyof ClaudeNativeEditorEvidence)[];

export function missingHandshakeDimensions(
  evidence: ClaudeNativeEditorEvidence,
): readonly (keyof ClaudeNativeEditorEvidence)[] {
  return HANDSHAKE_DIMENSIONS.filter((dimension) => !evidence[dimension]);
}

export function unsupportedCapabilities(): AdapterCapabilities {
  return {
    transport: "none",
    inlineRender: "none",
    bufferRead: false,
    cursorRead: false,
    atomicAcceptance: false,
    cancellation: false,
    resizeAwareness: false,
    alternateScreenSafety: false,
    nativeCompletionAwareness: false,
    attachmentReferences: false,
  };
}

export function nativeCapabilities(): AdapterCapabilities {
  return {
    transport: "native",
    inlineRender: "arbitrary",
    bufferRead: true,
    cursorRead: true,
    atomicAcceptance: true,
    cancellation: true,
    resizeAwareness: true,
    alternateScreenSafety: true,
    nativeCompletionAwareness: true,
    attachmentReferences: false,
  };
}
