/**
 * Mongoose model: LtiGradeLink
 *
 * Persists the grade link captured at launch so the host can push a score
 * later via `sendScore()`, keyed by platform tuple + resource link + user.
 * Holds EITHER an LTI 1.1 Basic Outcomes service (`protocol: '1.1'`) or an
 * LTI 1.3 AGS endpoint (`protocol: '1.3'`).
 *
 * Drop into your `src/models/` folder and back an `LtiGradeLinkStore` with it
 * (see `stores/gradeLinkStore.mongoose.example.ts`). Only relevant when grade
 * passback (1.1 outcomes or the 1.3 AGS prototype) is used.
 */

import { Schema, model, Document } from 'mongoose';

export interface LtiGradeLinkInterface extends Document {
  tenantId?: string;
  issuer: string;
  clientId: string;
  deploymentId: string;
  contextId: string;
  resourceLinkId: string;
  /** Stable per-user external id (e.g. LIS person sourcedid / `user_id`). */
  userExternalId: string;

  protocol: '1.1' | '1.3';

  // ── LTI 1.1 Basic Outcomes ──
  /** `lis_outcome_service_url` */
  serviceUrl?: string;
  /** `lis_result_sourcedid` */
  sourcedId?: string;
  /** `oauth_consumer_key` the launch was signed with. */
  consumerKey?: string;

  // ── LTI 1.3 AGS ──
  /** AGS line-items collection URL. */
  lineItems?: string;
  /** AGS single line-item URL (when bound). */
  lineItem?: string;
  /** Granted AGS scopes. */
  scopes?: string[];

  createdAt: Date;
  updatedAt: Date;
}

const LtiGradeLinkSchema = new Schema(
  {
    tenantId: { type: String, index: true },
    issuer: { type: String, required: true },
    clientId: { type: String, required: true },
    deploymentId: { type: String, required: true },
    contextId: { type: String, required: true },
    resourceLinkId: { type: String, required: true },
    userExternalId: { type: String, required: true },

    protocol: { type: String, enum: ['1.1', '1.3'], required: true },

    serviceUrl: { type: String },
    sourcedId: { type: String },
    consumerKey: { type: String },

    lineItems: { type: String },
    lineItem: { type: String },
    scopes: { type: [String], default: undefined },
  },
  { timestamps: true }
);

LtiGradeLinkSchema.index(
  { issuer: 1, clientId: 1, deploymentId: 1, contextId: 1, resourceLinkId: 1, userExternalId: 1 },
  { unique: true }
);

export const LtiGradeLinkModel = model<LtiGradeLinkInterface>('LtiGradeLink', LtiGradeLinkSchema);
