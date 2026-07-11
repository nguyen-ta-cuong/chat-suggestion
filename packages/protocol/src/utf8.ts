import { Buffer } from "node:buffer";

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return false;
      }
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function isUtf8Boundary(value: string, byteOffset: number): boolean {
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) {
    return false;
  }

  let currentOffset = 0;
  if (byteOffset === currentOffset) {
    return true;
  }

  for (const character of value) {
    currentOffset += utf8ByteLength(character);
    if (byteOffset === currentOffset) {
      return true;
    }
    if (byteOffset < currentOffset) {
      return false;
    }
  }
  return false;
}
