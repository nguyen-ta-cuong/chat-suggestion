import type { CodexCapabilityReport } from "./types.js";

export interface CodexProbeCacheOptions {
  readonly ttlMs: number;
  readonly maxEntries: number;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly report: CodexCapabilityReport;
}

export class CodexProbeCache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #maxEntries: number;
  readonly #ttlMs: number;

  constructor(options: CodexProbeCacheOptions) {
    if (options.ttlMs <= 0 || options.maxEntries <= 0) {
      throw new RangeError("Cache limits must be positive.");
    }
    this.#ttlMs = options.ttlMs;
    this.#maxEntries = options.maxEntries;
  }

  get(key: string): CodexCapabilityReport | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.report;
  }

  set(key: string, report: CodexCapabilityReport): void {
    this.#entries.delete(key);
    this.#entries.set(key, {
      expiresAt: Date.now() + this.#ttlMs,
      report,
    });
    while (this.#entries.size > this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) return;
      this.#entries.delete(oldestKey);
    }
  }
}
