/**
 * Mongoose LtiGradeLinkStore — reference implementation.
 *
 * Durable grade-link persistence backed by `LtiGradeLinkModel`. Copy into your
 * project and point the import at your model location. Survives restarts (the
 * shipped in-memory default does not). Excluded from the package build
 * (`*.example.ts`).
 */

import type { LtiGradeLink, LtiGradeLinkStore } from '../types';

// ── Replace with YOUR model path ─────────────────────────────────────────────
// import { LtiGradeLinkModel } from '../models/LtiGradeLinkModel.mongoose';
declare const LtiGradeLinkModel: any;

export const mongooseGradeLinkStore: LtiGradeLinkStore = {
  async saveGradeLink(params): Promise<void> {
    const filter = {
      issuer: params.issuer,
      clientId: params.clientId,
      deploymentId: params.deploymentId,
      contextId: params.contextId,
      resourceLinkId: params.resourceLinkId,
      userExternalId: params.userExternalId,
    };
    const link = params.link;
    const update: Record<string, unknown> = { ...filter, protocol: link.protocol };
    if (link.protocol === '1.1') {
      update.serviceUrl = link.serviceUrl;
      update.sourcedId = link.sourcedId;
      update.consumerKey = link.consumerKey;
    } else {
      update.lineItems = link.lineItems;
      update.lineItem = link.lineItem;
      update.scopes = link.scopes;
    }
    await LtiGradeLinkModel.findOneAndUpdate(filter, { $set: update }, { upsert: true, new: true });
  },

  async findGradeLink(params): Promise<LtiGradeLink | null> {
    const doc = await LtiGradeLinkModel.findOne({
      issuer: params.issuer,
      clientId: params.clientId,
      deploymentId: params.deploymentId,
      contextId: params.contextId,
      resourceLinkId: params.resourceLinkId,
      userExternalId: params.userExternalId,
    }).lean();
    if (!doc) return null;

    if (doc.protocol === '1.1') {
      return {
        protocol: '1.1',
        serviceUrl: doc.serviceUrl,
        sourcedId: doc.sourcedId,
        consumerKey: doc.consumerKey,
      };
    }
    return {
      protocol: '1.3',
      lineItems: doc.lineItems,
      lineItem: doc.lineItem,
      scopes: doc.scopes,
    };
  },
};
