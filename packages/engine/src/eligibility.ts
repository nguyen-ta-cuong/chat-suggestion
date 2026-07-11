import { utf8ByteLength } from "@chat-suggestion/protocol";

import type { SuggestionConfiguration, SuggestionInput } from "./types.js";

export function isEligibleForSuggestion(
  input: SuggestionInput,
  configuration: Pick<SuggestionConfiguration, "minimumPrefixCharacters">,
): boolean {
  const { snapshot } = input;
  const capabilities = snapshot.capabilities;

  return (
    input.enabled &&
    input.focused &&
    input.hostIdle &&
    !input.imeComposing &&
    !input.nativeCompletionVisible &&
    !input.hiddenInput &&
    input.layoutKnown &&
    snapshot.selection === undefined &&
    snapshot.cursorByte === utf8ByteLength(snapshot.text) &&
    Array.from(snapshot.text.trim()).length >=
      configuration.minimumPrefixCharacters &&
    capabilities.bufferRead &&
    capabilities.cursorRead &&
    capabilities.atomicAcceptance &&
    capabilities.inlineRender !== "none" &&
    capabilities.transport !== "none"
  );
}

export function isSafeForManualSuggestion(input: SuggestionInput): boolean {
  return isEligibleForSuggestion(input, { minimumPrefixCharacters: 0 });
}
