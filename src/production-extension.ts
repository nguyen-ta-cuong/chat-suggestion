import { createRequire } from "node:module";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createPiModelSuggestionBridge } from "./pi-model-bridge.js";
import { createPiSuggestionExtension } from "./pi-extension.js";

const packageManifest = createRequire(import.meta.url)("../package.json") as {
  readonly version: string;
};

export const CHAT_SUGGESTION_VERSION = packageManifest.version;

/** Default Pi package entry point for model-backed suggestions. */
export default function productionExtension(pi: ExtensionAPI): void {
  let currentContext: ExtensionContext | undefined;
  const bridge = createPiModelSuggestionBridge({
    getContext: () => currentContext,
  });

  createPiSuggestionExtension({
    bridge,
    version: CHAT_SUGGESTION_VERSION,
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
