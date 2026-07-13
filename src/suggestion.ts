import { Buffer } from "node:buffer";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_DRAFT_BYTES = 8_192;
export const MAX_SUGGESTION_BYTES = 1_024;
export const MAX_SUGGESTION_CHARACTERS = 160;
export const MAX_SUGGESTION_TOKENS = 64;

export interface AdapterCapabilities {
  readonly transport: "native";
  readonly inlineRender: "eol-only";
  readonly bufferRead: true;
  readonly cursorRead: true;
  readonly atomicAcceptance: true;
  readonly cancellation: true;
  readonly resizeAwareness: true;
  readonly alternateScreenSafety: true;
  readonly nativeCompletionAwareness: true;
  readonly attachmentReferences: false;
}

export interface PromptSnapshot {
  readonly revision: number;
  readonly text: string;
  readonly cursorByte: number;
}

export interface SuggestionCandidate {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly revision: number;
  readonly edit: {
    readonly startByte: number;
    readonly endByte: number;
    readonly text: string;
  };
  /** Zero while partial; otherwise normalized, bounded visible-output tokens. */
  readonly tokenCount: number;
}

export type ClearReason =
  | "accepted"
  | "dismissed"
  | "edited"
  | "pasted"
  | "cursor-moved"
  | "submitted"
  | "stale"
  | "unsafe"
  | "layout-unknown"
  | "session-changed"
  | "disabled"
  | "provider-error";

export type ValidationResult =
  | { readonly ok: true; readonly value: SuggestionCandidate }
  | { readonly ok: false };

export function parseSuggestionCandidate(input: unknown): ValidationResult {
  if (!isRecord(input) || !hasOnlyKeys(input, CANDIDATE_KEYS)) {
    return { ok: false };
  }
  if (
    input.protocolVersion !== PROTOCOL_VERSION ||
    !isBoundedIdentifier(input.requestId, 128) ||
    !isNonNegativeInteger(input.revision) ||
    !isRecord(input.edit) ||
    !hasOnlyKeys(input.edit, EDIT_KEYS) ||
    !isNonNegativeInteger(input.edit.startByte) ||
    input.edit.startByte !== input.edit.endByte ||
    !isSafeSuggestion(input.edit.text) ||
    !isNonNegativeInteger(input.tokenCount) ||
    input.tokenCount > MAX_SUGGESTION_TOKENS
  ) {
    return { ok: false };
  }
  return { ok: true, value: input as unknown as SuggestionCandidate };
}

export function isSafeSuggestion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    isWellFormedUnicode(value) &&
    Array.from(value).length <= MAX_SUGGESTION_CHARACTERS &&
    utf8ByteLength(value) <= MAX_SUGGESTION_BYTES &&
    !value.includes("\n") &&
    !value.includes("\r") &&
    !value.includes("\t") &&
    !containsUnsafeTerminalText(value)
  );
}

export function containsUnsafeTerminalText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
    if (codePoint >= 0x80 && codePoint <= 0x9f) return true;
  }
  return false;
}

export function sanitizeSuggestionText(value: string): string {
  const safeCharacters: string[] = [];

  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index) ?? 0;
    const character = String.fromCodePoint(codePoint);
    index += character.length;

    if (codePoint === 0x1b) {
      index = skipEscapeSequence(value, index);
      continue;
    }
    if (codePoint === 0x0a || codePoint === 0x0d) break;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    if (codePoint <= 0x1f || codePoint === 0x7f) continue;
    if (codePoint >= 0x80 && codePoint <= 0x9f) continue;

    const candidate = `${safeCharacters.join("")}${character}`;
    if (
      safeCharacters.length >= MAX_SUGGESTION_CHARACTERS ||
      utf8ByteLength(candidate) > MAX_SUGGESTION_BYTES
    ) {
      break;
    }
    safeCharacters.push(character);
  }

  return safeCharacters.join("");
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function skipEscapeSequence(value: string, startIndex: number): number {
  const introducer = value[startIndex];
  if (introducer === "]") {
    for (let index = startIndex + 1; index < value.length; index += 1) {
      if (value.charCodeAt(index) === 0x07) return index + 1;
      if (value.charCodeAt(index) === 0x1b && value[index + 1] === "\\") {
        return index + 2;
      }
    }
    return value.length;
  }
  if (introducer === "[") {
    for (let index = startIndex + 1; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit >= 0x40 && codeUnit <= 0x7e) return index + 1;
    }
    return value.length;
  }
  return Math.min(startIndex + 1, value.length);
}

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedIdentifier(value: unknown, maximumLength: number): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}

const CANDIDATE_KEYS = [
  "protocolVersion",
  "requestId",
  "revision",
  "edit",
  "tokenCount",
] as const;
const EDIT_KEYS = ["startByte", "endByte", "text"] as const;
