import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";

import { MAX_REQUEST_BYTES } from "./limits.js";
import type { ValidationResult } from "./types.js";
import { failure, success } from "./validation.js";

const NEWLINE_BYTE = 0x0a;

export function encodeNdjson(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

export class NdjsonDecoder {
  readonly #maximumFrameBytes: number;
  #bufferedFrame = Buffer.alloc(0);
  #discardingOversizedFrame = false;

  constructor(maximumFrameBytes = MAX_REQUEST_BYTES) {
    if (!Number.isSafeInteger(maximumFrameBytes) || maximumFrameBytes < 1) {
      throw new RangeError("maximumFrameBytes must be a positive integer");
    }
    this.#maximumFrameBytes = maximumFrameBytes;
  }

  push(chunk: Uint8Array | string): readonly ValidationResult<unknown>[] {
    const bytes =
      typeof chunk === "string"
        ? Buffer.from(chunk, "utf8")
        : Buffer.from(chunk);
    const results: ValidationResult<unknown>[] = [];
    let segmentStart = 0;

    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== NEWLINE_BYTE) {
        continue;
      }
      this.#append(bytes.subarray(segmentStart, index), results);
      this.#completeFrame(results);
      segmentStart = index + 1;
    }

    this.#append(bytes.subarray(segmentStart), results);
    return results;
  }

  finish(): readonly ValidationResult<unknown>[] {
    if (this.#discardingOversizedFrame) {
      this.#resetFrame();
      return [];
    }
    if (this.#bufferedFrame.length === 0) {
      return [];
    }
    const result = this.#parseBufferedFrame();
    this.#resetFrame();
    return [result];
  }

  #append(segment: Uint8Array, results: ValidationResult<unknown>[]): void {
    if (segment.length === 0 || this.#discardingOversizedFrame) {
      return;
    }
    if (this.#bufferedFrame.length + segment.length > this.#maximumFrameBytes) {
      this.#bufferedFrame = Buffer.alloc(0);
      this.#discardingOversizedFrame = true;
      results.push(
        failure(
          "size-limit",
          "$",
          `NDJSON frame exceeds ${this.#maximumFrameBytes} UTF-8 bytes`,
        ),
      );
      return;
    }
    this.#bufferedFrame = Buffer.concat([
      this.#bufferedFrame,
      Buffer.from(segment),
    ]);
  }

  #completeFrame(results: ValidationResult<unknown>[]): void {
    if (this.#discardingOversizedFrame) {
      this.#resetFrame();
      return;
    }
    if (this.#bufferedFrame.length > 0) {
      results.push(this.#parseBufferedFrame());
    }
    this.#resetFrame();
  }

  #parseBufferedFrame(): ValidationResult<unknown> {
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        this.#bufferedFrame,
      );
    } catch {
      return failure("invalid-utf8", "$", "NDJSON frame is not valid UTF-8");
    }

    try {
      return success(JSON.parse(decoded) as unknown);
    } catch {
      return failure("invalid-json", "$", "NDJSON frame is not valid JSON");
    }
  }

  #resetFrame(): void {
    this.#bufferedFrame = Buffer.alloc(0);
    this.#discardingOversizedFrame = false;
  }
}
