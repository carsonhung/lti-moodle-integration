/**
 * LTI 1.3 Assignment & Grade Services (AGS) — score passback PROTOTYPE.
 *
 * EXPERIMENTAL. This is a thin wrapper over `ltijs`'s built-in Grade service so
 * we don't re-implement the OAuth2 client-credentials + signed-JWT token flow.
 * It is gated behind `agsPrototype` / `LTI_AGS_PROTOTYPE` (default OFF) and is a
 * smoke-test-grade implementation: minimal error handling, the exact ltijs
 * Grade API surface should be confirmed against the installed version, and it is
 * NOT intended for production until validated against a real platform.
 *
 * AGS reuses the tool's existing platform registration + keys (no new
 * credentials) — ltijs manages the access token against the platform's token
 * endpoint. The AGS endpoint claim is captured at launch into the grade-link
 * store; this wrapper rebuilds a minimal idtoken-shaped object from it.
 */

import { logInfo, logWarn } from '../logger';
import type { LtiAgsGradeLink, LtiPlatformContext } from '../types';

export interface AgsScoreInput {
  /** The ltijs Provider (passed in to avoid a core <-> grades import cycle). */
  provider: any;
  platform: LtiPlatformContext;
  userExternalId: string;
  link: LtiAgsGradeLink;
  scoreGiven: number;
  scoreMaximum: number;
  comment?: string;
}

export interface AgsScoreResult {
  success: boolean;
  message?: string;
}

/**
 * Submit a score for a 1.3 launch via ltijs's Grade service. Returns
 * `{ success: false }` with a message on any failure rather than throwing, so
 * the host's `sendScore()` call never crashes on the experimental path.
 */
export async function submitAgsScore(input: AgsScoreInput): Promise<AgsScoreResult> {
  const grade: any = input.provider?.Grade;
  if (!grade || typeof grade.submitScore !== 'function') {
    return { success: false, message: 'ltijs Grade service unavailable (AGS prototype)' };
  }

  const lineItemId = input.link.lineItem || input.link.lineItems;
  if (!lineItemId) {
    return { success: false, message: 'No AGS line item captured for this launch' };
  }

  // Minimal idtoken-shaped object ltijs uses to acquire an access token and
  // resolve the AGS endpoint. Reconstructed from the captured link + platform.
  const idtoken = {
    iss: input.platform.issuer,
    clientId: input.platform.clientId,
    platformId: input.platform.issuer,
    deploymentId: input.platform.deploymentId,
    user: input.userExternalId,
    platformContext: {
      context: { id: input.platform.contextId },
      endpoint: {
        scope: input.link.scopes,
        lineitem: input.link.lineItem,
        lineitems: input.link.lineItems,
      },
    },
  };

  const score = {
    userId: input.userExternalId,
    scoreGiven: input.scoreGiven,
    scoreMaximum: input.scoreMaximum,
    activityProgress: 'Completed',
    gradingProgress: 'FullyGraded',
    timestamp: new Date().toISOString(),
    ...(input.comment ? { comment: input.comment } : {}),
  };

  try {
    await grade.submitScore(idtoken, lineItemId, score);
    logInfo('[LTI AGS prototype] submitScore ok');
    return { success: true };
  } catch (e: any) {
    logWarn('[LTI AGS prototype] submitScore failed', { message: e?.message });
    return { success: false, message: e?.message };
  }
}
