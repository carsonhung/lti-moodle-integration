/**
 * Mongoose LtiConsumerStore — reference implementation.
 *
 * Resolves the OAuth 1.0a shared secret for an inbound LTI 1.0a / 1.1 launch by
 * `oauth_consumer_key`. Copy into your project and point the import at your own
 * `LtiConsumerModel` location. Returns `null` for unknown or disabled keys so
 * the legacy router rejects the launch.
 *
 * Excluded from the package build (`*.example.ts`) — it's a template, not
 * shipped runtime code.
 */

import type { LtiConsumer, LtiConsumerStore } from '../types';

// ── Replace with YOUR model path ─────────────────────────────────────────────
// import { LtiConsumerModel } from '../models/LtiConsumerModel.mongoose';
declare const LtiConsumerModel: any;

export const mongooseConsumerStore: LtiConsumerStore = {
  async resolveConsumer(consumerKey: string, tenantId?: string): Promise<LtiConsumer | null> {
    const key = String(consumerKey ?? '').trim();
    if (!key) return null;

    const query: Record<string, unknown> = { consumerKey: key, enabled: true };
    if (tenantId) query.tenantId = tenantId;

    const doc = await LtiConsumerModel.findOne(query).lean();
    if (!doc || !doc.secret) return null;

    return {
      key: doc.consumerKey,
      secret: doc.secret,
      tenantId: doc.tenantId,
    };
  },
};
