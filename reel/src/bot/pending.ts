import { randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 1000;

/** Short-lived in-memory state for questions the bot is waiting on (e.g. "which Dune?"). */
export class PendingStore<T> {
  readonly #entries = new Map<string, { expiresAt: number; value: T }>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  put(value: T): string {
    if (this.#entries.size >= MAX_ENTRIES) {
      const oldest = this.#entries.keys().next().value;
      if (oldest) this.#entries.delete(oldest);
    }
    const id = randomBytes(6).toString("base64url");
    this.#entries.set(id, { expiresAt: this.#now() + this.#ttlMs, value });
    return id;
  }

  take(id: string): T | undefined {
    const entry = this.#entries.get(id);
    this.#entries.delete(id);
    return entry && entry.expiresAt > this.#now() ? entry.value : undefined;
  }
}
