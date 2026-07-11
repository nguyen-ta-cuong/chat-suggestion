import {
  PROTOCOL_VERSION,
  containsUnsafeTerminalText,
  sanitizeSuggestionText,
  type PromptSnapshot,
  type SuggestionCandidate,
} from "@chat-suggestion/protocol";
import { completeSimple, type Message } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SuggestionBridge } from "./pi-suggestion-editor.js";

const SYSTEM_PROMPT = [
  "You provide inline prompt completions for a coding-agent editor.",
  "Return only the short text that should be inserted after the exact draft.",
  "Do not repeat any part of the draft, add quotes, explain your answer, or use markdown.",
  "Return one plain-text line and keep it under 160 characters.",
].join(" ");

type Completion = Awaited<ReturnType<typeof completeSimple>>;
export type PiModelComplete = (
  model: unknown,
  context: { systemPrompt: string; messages: Message[] },
  options: {
    signal: AbortSignal;
    maxTokens: number;
    temperature: number;
    apiKey?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
  },
) => Promise<Completion>;

export interface PiModelBridgeOptions {
  readonly getContext: () => ExtensionContext | undefined;
  readonly complete?: PiModelComplete;
}

/**
 * Uses only Pi's selected model and credential resolver. A missing model or
 * unresolved auth deliberately produces no candidate, leaving the editor
 * untouched instead of inventing an offline completion.
 */
export function createPiModelSuggestionBridge(
  options: PiModelBridgeOptions,
): SuggestionBridge {
  const complete = options.complete ?? completeSimple;

  return {
    async suggest(
      snapshot: PromptSnapshot,
      requestId: string,
      signal: AbortSignal,
    ): Promise<SuggestionCandidate | null> {
      if (signal.aborted) return null;

      const context = options.getContext();
      if (context?.mode !== "tui" || !context.model) return null;

      const auth = await context.modelRegistry.getApiKeyAndHeaders(
        context.model,
      );
      if (signal.aborted || !auth.ok) return null;

      const message: Message = {
        role: "user",
        content: snapshot.text,
        timestamp: Date.now(),
      };
      const completion = await complete(
        context.model,
        { systemPrompt: SYSTEM_PROMPT, messages: [message] },
        {
          signal,
          maxTokens: 64,
          temperature: 0.2,
          ...(auth.apiKey === undefined ? {} : { apiKey: auth.apiKey }),
          ...(auth.headers === undefined ? {} : { headers: auth.headers }),
          ...(auth.env === undefined ? {} : { env: auth.env }),
        },
      );
      if (signal.aborted || completion.stopReason === "aborted") return null;

      const text = completion.content
        .filter((part): part is { type: "text"; text: string } => {
          return part.type === "text" && typeof part.text === "string";
        })
        .map((part) => part.text)
        .join("");
      const boundedText = sanitizeSuggestionText(text);
      const suffix = boundedText.startsWith(snapshot.text)
        ? boundedText.slice(snapshot.text.length)
        : boundedText;
      if (
        suffix.length === 0 ||
        suffix.includes("\n") ||
        suffix.includes("\r") ||
        suffix.includes("\t") ||
        containsUnsafeTerminalText(suffix)
      ) {
        return null;
      }

      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        revision: snapshot.revision,
        edit: {
          startByte: snapshot.cursorByte,
          endByte: snapshot.cursorByte,
          text: suffix,
        },
        tokenCount: completion.usage?.output ?? 0,
      };
    },
  };
}
