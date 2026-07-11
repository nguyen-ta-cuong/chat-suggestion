interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export class BoundedMemoryCache<T> {
  readonly #entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly maximumEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= now) {
      this.#entries.delete(key);
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    if (this.maximumEntries < 1 || this.ttlMs < 1) {
      return;
    }
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: now + this.ttlMs });
    while (this.#entries.size > this.maximumEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.#entries.delete(oldestKey);
    }
  }
}
