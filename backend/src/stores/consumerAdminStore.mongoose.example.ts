/**
 * Mongoose LtiConsumerAdminStore — reference implementation.
 *
 * CRUD over `LtiConsumerModel` for the consumer admin router. The secret is
 * write-only: it is stored but never included in `list`/`get` output. Copy into
 * your project and point the import at your model location. Excluded from the
 * package build (`*.example.ts`).
 */

import type { LtiConsumerAdminStore, LtiConsumerSummary } from '../types';

// ── Replace with YOUR model path ─────────────────────────────────────────────
// import { LtiConsumerModel } from '../models/LtiConsumerModel.mongoose';
declare const LtiConsumerModel: any;

function toSummary(doc: any): LtiConsumerSummary {
  return {
    id: String(doc._id),
    consumerKey: doc.consumerKey,
    label: doc.label || undefined,
    enabled: doc.enabled !== false,
    tenantId: doc.tenantId || undefined,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
  };
}

export const mongooseConsumerAdminStore: LtiConsumerAdminStore = {
  async list(tenantId?: string): Promise<LtiConsumerSummary[]> {
    const query: Record<string, unknown> = {};
    if (tenantId) query.tenantId = tenantId;
    const docs = await LtiConsumerModel.find(query).select('-secret').sort({ createdAt: -1 }).lean();
    return docs.map(toSummary);
  },

  async get(id: string): Promise<LtiConsumerSummary | null> {
    const doc = await LtiConsumerModel.findById(id).select('-secret').lean();
    return doc ? toSummary(doc) : null;
  },

  async create(params): Promise<LtiConsumerSummary> {
    const doc = await LtiConsumerModel.create({
      consumerKey: params.consumerKey,
      secret: params.secret,
      label: params.label,
      enabled: params.enabled !== false,
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    });
    return toSummary(doc);
  },

  async update(id, params): Promise<LtiConsumerSummary | null> {
    const set: Record<string, unknown> = {};
    if (params.secret) set.secret = params.secret;
    if (params.label !== undefined) set.label = params.label;
    if (params.enabled !== undefined) set.enabled = params.enabled;
    const doc = await LtiConsumerModel.findByIdAndUpdate(id, { $set: set }, { new: true })
      .select('-secret')
      .lean();
    return doc ? toSummary(doc) : null;
  },

  async remove(id): Promise<boolean> {
    const res = await LtiConsumerModel.findByIdAndDelete(id).lean();
    return !!res;
  },
};
