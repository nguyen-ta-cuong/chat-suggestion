import {
  PROTOCOL_VERSION,
  containsUnsafeTerminalText,
  sanitizeSuggestionText,
  type PromptSnapshot,
  type SuggestionCandidate,
} from "@chat-suggestion/protocol";
import {
  streamSimple,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Message,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SuggestionBridge } from "./pi-suggestion-editor.js";

const SYSTEM_PROMPT = [
  "You provide inline prompt completions for a coding-agent editor.",
  "Return only the short text that should be inserted after the exact draft.",
  "Do not repeat any part of the draft, add quotes, explain your answer, or use markdown.",
  "Return one plain-text line and keep it under 160 characters.",
].join(" ");

export interface PiModelRequestOptions {
  readonly signal: AbortSignal;
  readonly maxTokens: number;
  readonly sessionId?: string;
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  readonly env?: Record<string, string>;
}

export type PiModelStream = (
  model: unknown,
  context: { systemPrompt: string; messages: Message[] },
  options: PiModelRequestOptions,
) => AsyncIterable<AssistantMessageEvent>;

export interface PiModelBridgeOptions {
  readonly getContext: () => ExtensionContext | undefined;
  readonly stream?: PiModelStream;
}

/**
 * Uses only Pi's selected model and credential resolver. A missing model or
 * unresolved auth deliberately produces no candidate, leaving the editor
 * untouched instead of inventing an offline completion.
 */
export function createPiModelSuggestionBridge(
  options: PiModelBridgeOptions,
): SuggestionBridge {
  const stream = options.stream ?? (streamSimple as PiModelStream);

  return {
    async suggest(
      snapshot: PromptSnapshot,
      requestId: string,
      signal: AbortSignal,
      onUpdate?: (candidate: SuggestionCandidate) => void,
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
      // Keep suggestion traffic separate from Pi's agent conversation while
      // still allowing providers to reuse session-scoped transports.
      const suggestionSessionId = `chat-suggestion:${snapshot.sessionId}`;
      const request = { systemPrompt: SYSTEM_PROMPT, messages: [message] };
      const requestOptions = {
        signal,
        maxTokens: 64,
        sessionId: suggestionSessionId,
        ...(auth.apiKey === undefined ? {} : { apiKey: auth.apiKey }),
        ...(auth.headers === undefined ? {} : { headers: auth.headers }),
        ...(auth.env === undefined ? {} : { env: auth.env }),
      };

      const textParts = new Map<number, string>();
      let lastPublishedText = "";
      for await (const event of stream(
        context.model,
        request,
        requestOptions,
      )) {
        if (signal.aborted) return null;

        if (event.type === "text_delta") {
          textParts.set(
            event.contentIndex,
            `${textParts.get(event.contentIndex) ?? ""}${event.delta}`,
          );
          const candidate = candidateFromText(
            snapshot,
            requestId,
            joinTextParts(textParts),
            0,
            true,
          );
          if (candidate && candidate.edit.text !== lastPublishedText) {
            lastPublishedText = candidate.edit.text;
            onUpdate?.(candidate);
          }
          continue;
        }

        if (event.type === "text_end") {
          textParts.set(event.contentIndex, event.content);
          continue;
        }

        if (event.type === "done") {
          return candidateFromMessage(snapshot, requestId, event.message);
        }

        if (event.type === "error") return null;
      }

      return null;
    },
  };
}

function candidateFromMessage(
  snapshot: PromptSnapshot,
  requestId: string,
  completion: AssistantMessage,
): SuggestionCandidate | null {
  const text = completion.content
    .filter((part): part is { type: "text"; text: string } => {
      return part.type === "text" && typeof part.text === "string";
    })
    .map((part) => part.text)
    .join("");
  return candidateFromText(
    snapshot,
    requestId,
    text,
    completion.usage?.output ?? 0,
    false,
  );
}

function candidateFromText(
  snapshot: PromptSnapshot,
  requestId: string,
  text: string,
  tokenCount: number,
  partial: boolean,
): SuggestionCandidate | null {
  const boundedText = sanitizeSuggestionText(text);
  if (
    partial &&
    boundedText.length < snapshot.text.length &&
    snapshot.text.startsWith(boundedText)
  ) {
    return null;
  }
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
    tokenCount,
  };
}

function joinTextParts(parts: ReadonlyMap<number, string>): string {
  return [...parts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text)
    .join("");
}
