/**
 * In-memory LtiGradeLinkStore.
 *
 * Holds the grade link captured at launch — a 1.1 Basic Outcomes service
 * (`{ serviceUrl, sourcedId }`) or a 1.3 AGS endpoint (`{ agsEndpoint }`) —
 * keyed by platform tuple + resource link + user, so the host can later push a
 * score via `sendScore()`. Process-local default; supply a durable
 * implementation (see `LtiGradeLinkModel.mongoose.ts`) to survive restarts.
 */

import type { LtiGradeLink, LtiGradeLinkStore, LtiPlatformContext } from '../types';

function keyOf(
  params: LtiPlatformContext & { resourceLinkId: string; userExternalId: string }
): string {
  return [
    params.issuer,
    params.clientId,
    params.deploymentId,
    params.contextId,
    params.resourceLinkId,
    params.userExternalId,
  ]
    .map((p) => String(p ?? ''))
    .join('|');
}

/** Create a process-local grade-link store. */
export function createInMemoryGradeLinkStore(): LtiGradeLinkStore {
  const links = new Map<string, LtiGradeLink>();
  return {
    async saveGradeLink(params): Promise<void> {
      links.set(keyOf(params), params.link);
    },
    async findGradeLink(params): Promise<LtiGradeLink | null> {
      return links.get(keyOf(params)) ?? null;
    },
  };
}
