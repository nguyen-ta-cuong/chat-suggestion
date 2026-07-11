import {
  MAX_CANDIDATE_BYTES,
  MAX_CANDIDATE_CHARACTERS,
  MAX_CANDIDATE_LINES,
} from "./limits.js";
import { utf8ByteLength } from "./utf8.js";

export function containsUnsafeTerminalText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAllowedWhitespace = codePoint === 0x09 || codePoint === 0x0a;
    const isC0 = codePoint <= 0x1f || codePoint === 0x7f;
    const isC1 = codePoint >= 0x80 && codePoint <= 0x9f;
    if ((!isAllowedWhitespace && isC0) || isC1) {
      return true;
    }
  }
  return false;
}

export function sanitizeSuggestionText(value: string): string {
  const safeCharacters: string[] = [];
  let lineCount = 1;

  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index) ?? 0;
    const character = String.fromCodePoint(codePoint);
    index += character.length;

    if (codePoint === 0x1b) {
      index = skipEscapeSequence(value, index);
      continue;
    }
    if (codePoint === 0x0a) {
      if (lineCount >= MAX_CANDIDATE_LINES) {
        break;
      }
      lineCount += 1;
    } else if (
      codePoint !== 0x09 &&
      (codePoint <= 0x1f || codePoint === 0x7f)
    ) {
      continue;
    } else if (codePoint >= 0x80 && codePoint <= 0x9f) {
      continue;
    }

    const candidate = safeCharacters.join("") + character;
    if (
      safeCharacters.length >= MAX_CANDIDATE_CHARACTERS ||
      utf8ByteLength(candidate) > MAX_CANDIDATE_BYTES
    ) {
      break;
    }
    safeCharacters.push(character);
  }

  return safeCharacters.join("");
}

function skipEscapeSequence(value: string, startIndex: number): number {
  const introducer = value[startIndex];
  if (introducer === "]") {
    return skipOperatingSystemCommand(value, startIndex + 1);
  }
  if (introducer === "[") {
    return skipControlSequence(value, startIndex + 1);
  }
  return Math.min(startIndex + 1, value.length);
}

function skipOperatingSystemCommand(value: string, startIndex: number): number {
  for (let index = startIndex; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x07) {
      return index + 1;
    }
    if (value.charCodeAt(index) === 0x1b && value[index + 1] === "\\") {
      return index + 2;
    }
  }
  return value.length;
}

function skipControlSequence(value: string, startIndex: number): number {
  for (let index = startIndex; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0x40 && codeUnit <= 0x7e) {
      return index + 1;
    }
  }
  return value.length;
}
