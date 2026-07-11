import { ProviderError } from "./errors.js";

const HOUR_MS = 3_600_000;

export class TokenBucket {
  readonly #capacity: number;
  readonly #now: () => number;
  #tokens: number;
  #lastRefillMs: number;

  constructor(capacity: number, now: () => number) {
    this.#capacity = capacity;
    this.#tokens = capacity;
    this.#now = now;
    this.#lastRefillMs = now();
  }

  take(): void {
    this.#refill();
    if (this.#tokens < 1) {
      throw new ProviderError(
        "rate-limited",
        "remote request budget exhausted",
      );
    }
    this.#tokens -= 1;
  }

  #refill(): void {
    const now = this.#now();
    const elapsedMs = Math.max(0, now - this.#lastRefillMs);
    this.#tokens = Math.min(
      this.#capacity,
      this.#tokens + (elapsedMs * this.#capacity) / HOUR_MS,
    );
    this.#lastRefillMs = now;
  }
}

export class FailureCooldown {
  readonly #now: () => number;
  readonly #baseMs: number;
  #consecutiveFailures = 0;
  #cooldownLevel = 0;
  #cooldownUntilMs = 0;

  constructor(now: () => number, baseMs = 1_000) {
    this.#now = now;
    this.#baseMs = baseMs;
  }

  assertAvailable(): void {
    if (this.#now() < this.#cooldownUntilMs) {
      throw new ProviderError("cooldown", "remote provider is cooling down");
    }
  }

  success(): void {
    this.#consecutiveFailures = 0;
    this.#cooldownLevel = 0;
    this.#cooldownUntilMs = 0;
  }

  failure(rateLimited = false): void {
    this.#consecutiveFailures += 1;
    if (!rateLimited && this.#consecutiveFailures < 5) return;
    const delayMs = Math.min(this.#baseMs * 2 ** this.#cooldownLevel, 60_000);
    this.#cooldownUntilMs = this.#now() + delayMs;
    this.#cooldownLevel += 1;
  }
}
