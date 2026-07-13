import {
  PROTOCOL_VERSION,
  type SuggestionCandidate,
} from "../src/suggestion.js";
import { createPiSuggestionExtension } from "../src/index.js";
import type { SuggestionBridge } from "../src/pi-suggestion-editor.js";

const OFFLINE_MINIMUM_CHARACTERS = 3;
const OFFLINE_SUFFIX = " tests and add a regression test";

export function createOfflineSuggestionBridge(): SuggestionBridge {
  return {
    suggest(snapshot, requestId, signal): Promise<SuggestionCandidate | null> {
      if (
        signal.aborted ||
        Array.from(snapshot.text.trim()).length < OFFLINE_MINIMUM_CHARACTERS
      ) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        revision: snapshot.revision,
        edit: {
          startByte: snapshot.cursorByte,
          endByte: snapshot.cursorByte,
          text: OFFLINE_SUFFIX,
        },
        tokenCount: 7,
      });
    },
  };
}

export default createPiSuggestionExtension({
  debounceMs: 150,
  bridge: createOfflineSuggestionBridge(),
});
