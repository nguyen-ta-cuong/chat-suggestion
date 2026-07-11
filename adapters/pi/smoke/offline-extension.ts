import {
  PROTOCOL_VERSION,
  type SuggestionCandidate,
} from "@chat-suggestion/protocol";
import { createPiSuggestionExtension } from "../src/index.js";

export default createPiSuggestionExtension({
  piVersion: "0.80.6",
  debounceMs: 150,
  bridge: {
    suggest(snapshot, requestId, signal): Promise<SuggestionCandidate | null> {
      if (signal.aborted || !snapshot.text.endsWith("fix auth")) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        revision: snapshot.revision,
        edit: {
          startByte: snapshot.cursorByte,
          endByte: snapshot.cursorByte,
          text: " tests and add a regression test",
        },
        tokenCount: 7,
      });
    },
  },
});
