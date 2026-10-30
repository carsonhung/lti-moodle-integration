/**
 * In-memory OAuth 1.0a nonce store (replay protection).
 *
 * Records each `(nonce)` seen within a TTL window and rejects repeats. This
 * default is process-local — fine for a single instance. Multi-instance
 * deployments should supply a shared implementation (e.g. Redis) of
 * {@link LtiNonceStore} via `initLti({ nonceStore })`.
 */

import type { LtiNonceStore } from '../types';
import { DEFAULT_LEGACY_NONCE_TTL_MS, NONCE_STORE_SWEEP_INTERVAL_MS } from '../constants';

export interface InMemoryNonceStore extends LtiNonceStore {
  /** Stop the background sweep timer (useful in tests / graceful shutdown). */
  stop(): void;
}

/**
 * Create an in-memory nonce store. A nonce seen within `ttlMs` is treated as a
 * replay. The sweep timer is `unref`'d so it never keeps the process alive.
 */
export function createInMemoryNonceStore(
  ttlMs: number = DEFAULT_LEGACY_NONCE_TTL_MS
): InMemoryNonceStore {
  const seenAt = new Map<string, number>();

  const sweep = () => {
    const cutoff = Date.now() - ttlMs;
    for (const [nonce, ts] of seenAt) {
      if (ts < cutoff) seenAt.delete(nonce);
    }
  };

  const timer = setInterval(sweep, NONCE_STORE_SWEEP_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    async seen(nonce: string): Promise<boolean> {
      const now = Date.now();
      const existing = seenAt.get(nonce);
      if (existing !== undefined && existing >= now - ttlMs) {
        return true;
      }
      seenAt.set(nonce, now);
      return false;
    },
    stop(): void {
      clearInterval(timer);
    },
  };
}
