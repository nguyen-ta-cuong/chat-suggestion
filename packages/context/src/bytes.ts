import { Buffer } from "node:buffer";

export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function truncateUtf8(value: string, maximumBytes: number): string {
  if (maximumBytes <= 0) {
    return "";
  }
  if (byteLength(value) <= maximumBytes) {
    return value;
  }

  let usedBytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = byteLength(character);
    if (usedBytes + characterBytes > maximumBytes) {
      break;
    }
    result += character;
    usedBytes += characterBytes;
  }
  return result;
}
