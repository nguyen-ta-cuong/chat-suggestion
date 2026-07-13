import {
  MAX_SUGGESTION_TOKENS,
  PROTOCOL_VERSION,
  isWellFormedUnicode,
  parseSuggestionCandidate,
  sanitizeSuggestionText,
  type PromptSnapshot,
  type SuggestionCandidate,
} from "./suggestion.js";
import {
  streamSimple,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Message,
} from "@earendil-works/pi-ai/compat";
import {
  convertToLlm,
  sessionEntryToContextMessages,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { SuggestionBridge } from "./pi-suggestion-editor.js";

const SYSTEM_PROMPT = [
  "You provide inline prompt completions for a coding-agent editor.",
  "Use the earlier conversation to infer the user's intent.",
  "The final user message is the exact draft; return only the short text that should be inserted after it.",
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
      const conversationMessages = context.sessionManager
        .buildContextEntries()
        .flatMap((entry) => sessionEntryToContextMessages(entry));
      const request = {
        systemPrompt: SYSTEM_PROMPT,
        messages: [...convertToLlm(conversationMessages), message],
      };
      const requestOptions = {
        signal,
        maxTokens: 64,
        sessionId: context.sessionManager.getSessionId(),
        ...(auth.apiKey === undefined ? {} : { apiKey: auth.apiKey }),
        ...(auth.headers === undefined ? {} : { headers: auth.headers }),
        ...(auth.env === undefined ? {} : { env: auth.env }),
      };

      const textParts = new Map<number, string>();
      let lastSafeCandidate: SuggestionCandidate | null = null;
      try {
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
            if (
              candidate &&
              candidate.edit.text !== lastSafeCandidate?.edit.text
            ) {
              lastSafeCandidate = candidate;
              onUpdate?.(candidate);
            }
            continue;
          }

          if (event.type === "text_end") {
            textParts.set(event.contentIndex, event.content);
            continue;
          }

          if (event.type === "done") {
            return (
              candidateFromMessage(snapshot, requestId, event.message) ??
              lastSafeCandidate
            );
          }

          if (event.type === "error") return lastSafeCandidate;
        }
      } catch {
        return signal.aborted ? null : lastSafeCandidate;
      }

      return lastSafeCandidate;
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
    visibleTokenCount(completion.usage),
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
  if (
    text.includes("\n") ||
    text.includes("\r") ||
    !isWellFormedUnicode(text)
  ) {
    return null;
  }
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
  const candidate: SuggestionCandidate = {
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
  const parsed = parseSuggestionCandidate(candidate);
  return parsed.ok ? parsed.value : null;
}

function visibleTokenCount(
  usage: AssistantMessage["usage"] | undefined,
): number {
  const output = nonNegativeSafeInteger(usage?.output) ?? 0;
  const reasoning = nonNegativeSafeInteger(usage?.reasoning);
  const visibleOutput =
    reasoning === undefined ? output : Math.max(0, output - reasoning);
  return Math.min(visibleOutput, MAX_SUGGESTION_TOKENS);
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function joinTextParts(parts: ReadonlyMap<number, string>): string {
  return [...parts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text)
    .join("");
}
