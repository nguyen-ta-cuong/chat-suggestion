import { createHash } from "node:crypto";

export function sha256Prefix(value: string, prefixLength = 12): string {
  if (
    !Number.isSafeInteger(prefixLength) ||
    prefixLength < 1 ||
    prefixLength > 64
  ) {
    throw new RangeError("prefixLength must be an integer between 1 and 64");
  }
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex")
    .slice(0, prefixLength);
}
