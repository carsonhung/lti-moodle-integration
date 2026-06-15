/**
 * Mongoose model: LtiConsumer
 *
 * Stores an OAuth 1.0a shared credential (consumer key + secret) used to verify
 * inbound LTI 1.0a / 1.1 launches and to sign outbound Content-Item returns and
 * Basic Outcomes calls. One row per consumer key.
 *
 * ── Applies to the legacy (1.0a/1.1) flow only ───────────────────────────────
 * This model is unused on the LTI 1.3 path. It only matters when
 * `LTI_LEGACY_ENABLED` / `legacyLti` is on. Drop it into your `src/models/`
 * folder and back the `LtiConsumerStore` with it (see
 * `stores/consumerStore.mongoose.example.ts`).
 *
 * SECURITY: `secret` is the OAuth shared secret. Treat it like a password —
 * never return it in an API response (the admin CRUD is write-only for it).
 */

import { Schema, model, Document } from 'mongoose';

export interface LtiConsumerInterface extends Document {
  /** Optional — set for multi-tenant apps. */
  tenantId?: string;
  /** OAuth `oauth_consumer_key` (unique). */
  consumerKey: string;
  /** OAuth shared secret — write-only; never expose in API responses. */
  secret: string;
  /** Friendly label shown in admin UIs. */
  label?: string;
  /** Disable without deleting; a disabled consumer rejects launches. */
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LtiConsumerSchema = new Schema(
  {
    tenantId: { type: String, index: true },
    consumerKey: { type: String, required: true, unique: true },
    secret: { type: String, required: true },
    label: { type: String },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const LtiConsumerModel = model<LtiConsumerInterface>('LtiConsumer', LtiConsumerSchema);
