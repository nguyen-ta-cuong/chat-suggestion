import {
  MAX_CANDIDATE_BYTES,
  MAX_CANDIDATE_CHARACTERS,
  MAX_CANDIDATE_LINES,
} from "@chat-suggestion/protocol";

import { graphemes } from "./width.js";

export interface SanitizeLimits {
  readonly maxBytes?: number;
  readonly maxCharacters?: number;
  readonly maxLines?: number;
}

const ESCAPE_SEQUENCE =
  // eslint-disable-next-line no-control-regex -- terminal escape parsing intentionally matches control bytes
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\|$)|P[^\u001b]*(?:\u001b\\|$)|[@-_]?)/gu;

export function sanitizeTerminalText(
  input: string,
  limits: SanitizeLimits = {},
): string {
  const maxBytes = limits.maxBytes ?? MAX_CANDIDATE_BYTES;
  const maxCharacters = limits.maxCharacters ?? MAX_CANDIDATE_CHARACTERS;
  const maxLines = limits.maxLines ?? MAX_CANDIDATE_LINES;
  const withoutSequences = input.replace(ESCAPE_SEQUENCE, "");
  let output = "";
  let characters = 0;
  let lines = 1;

  for (const grapheme of graphemes(withoutSequences)) {
    const filtered = filterControls(grapheme);
    if (filtered.length === 0) continue;
    const addedLines = countNewlines(filtered);
    if (lines + addedLines > maxLines) break;
    const nextCharacters = characters + Array.from(filtered).length;
    if (nextCharacters > maxCharacters) break;
    if (Buffer.byteLength(output + filtered, "utf8") > maxBytes) break;
    output += filtered;
    characters = nextCharacters;
    lines += addedLines;
  }
  return output;
}

function filterControls(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0x0a || codePoint === 0x09) result += character;
    else if (
      codePoint > 0x1f &&
      codePoint !== 0x7f &&
      !(codePoint >= 0x80 && codePoint <= 0x9f)
    ) {
      result += character;
    }
  }
  return result;
}

function countNewlines(value: string): number {
  return Array.from(value).filter((character) => character === "\n").length;
}
