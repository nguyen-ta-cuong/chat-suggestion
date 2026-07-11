import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { createPiModelSuggestionBridge } from "./pi-model-bridge.js";
import { createPiSuggestionExtension } from "./pi-extension.js";

/** Default Pi package entry point for model-backed suggestions. */
export default function productionExtension(pi: ExtensionAPI): void {
  let currentContext: ExtensionContext | undefined;
  const bridge = createPiModelSuggestionBridge({
    getContext: () => currentContext,
  });

  createPiSuggestionExtension({
    bridge,
    piVersion: VERSION,
  })(pi);

  pi.on("session_start", (_event, context) => {
    currentContext = context;
  });
  pi.on("model_select", (_event, context) => {
    currentContext = context;
  });
  pi.on("session_shutdown", () => {
    currentContext = undefined;
  });
}
