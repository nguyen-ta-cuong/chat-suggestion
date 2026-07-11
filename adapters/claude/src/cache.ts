import { probeClaude } from "./probe.js";
import type { ClaudeCapabilityReport, ClaudeProbeOptions } from "./types.js";

interface CacheEntry {
  readonly expiresAt: number;
  readonly report: ClaudeCapabilityReport;
}

export class ClaudeCapabilityProbeCache {
  readonly #entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async probe(
    options: ClaudeProbeOptions = {},
  ): Promise<ClaudeCapabilityReport> {
    if (
      options.nativeHandshake !== undefined ||
      options.testedPtyProfiles !== undefined
    ) {
      return await probeClaude(options);
    }
    const key = `${options.executablePath ?? "PATH"}\0${options.pathEnvironment ?? process.env.PATH ?? ""}`;
    const cached = this.#entries.get(key);
    if (cached !== undefined && cached.expiresAt > this.now()) {
      return cached.report;
    }
    const report = await probeClaude(options);
    this.#entries.set(key, {
      report,
      expiresAt: this.now() + this.ttlMs,
    });
    return report;
  }

  clear(): void {
    this.#entries.clear();
  }
}
