/**
 * Unified host-callable grade-push facade.
 *
 * `sendScore()` is the single entry point the host app calls when it decides a
 * grade should post. It looks up the grade link captured at launch (in the
 * `LtiGradeLinkStore`) for the given user + activity and dispatches to either
 * LTI 1.1 Basic Outcomes (`replaceResult`) or the experimental 1.3 AGS
 * prototype, depending on the recorded launch protocol. No automatic scoring is
 * assumed — the host owns the trigger.
 *
 * The dependencies are registered by `initLti`; calling `sendScore` before
 * `initLti` (or with the LTI module disabled) returns a failed result.
 */

import type {
  LtiAdapter,
  LtiLoginOnlyAdapter,
  LtiConsumerStore,
  LtiGradeLinkStore,
  LtiPlatformContext,
} from '../types';
import { replaceResult } from '../legacy/outcomes';
import { submitAgsScore } from './ags';

interface SendScoreDeps {
  adapter: LtiAdapter | LtiLoginOnlyAdapter;
  consumerStore?: LtiConsumerStore;
  gradeLinkStore: LtiGradeLinkStore;
  agsPrototype: boolean;
  getProvider: () => any;
}

let deps: SendScoreDeps | null = null;

/** Called internally by `initLti` to wire the grade-push dependencies. */
export function registerSendScore(d: SendScoreDeps): void {
  deps = d;
}

export interface SendScoreParams {
  /**
   * The launch identifiers captured when the student launched (platform tuple +
   * resourceLinkId + their stable external id). These key the grade-link store.
   */
  platform: LtiPlatformContext;
  resourceLinkId: string;
  userExternalId: string;
  /**
   * Explicit score. If omitted, the optional `adapter.getStudentScore` hook is
   * used (requires `userId` + `courseId` + `resourceId`).
   */
  scoreGiven?: number;
  scoreMaximum?: number;
  comment?: string;
  /** App-domain ids for the `getStudentScore` fallback. */
  userId?: string;
  courseId?: string;
  resourceId?: string;
}

export interface SendScoreResult {
  success: boolean;
  protocol?: '1.1' | '1.3';
  message?: string;
}

export async function sendScore(params: SendScoreParams): Promise<SendScoreResult> {
  if (!deps) {
    return { success: false, message: 'LTI is not initialized (call initLti first).' };
  }

  const link = await deps.gradeLinkStore.findGradeLink({
    ...params.platform,
    resourceLinkId: params.resourceLinkId,
    userExternalId: params.userExternalId,
  });
  if (!link) {
    return { success: false, message: 'No grade link recorded for this user/activity.' };
  }

  let scoreGiven = params.scoreGiven;
  let scoreMaximum = params.scoreMaximum;
  let comment = params.comment;

  if ((scoreGiven == null || scoreMaximum == null) && params.userId && params.courseId && params.resourceId) {
    const adapter = deps.adapter as LtiAdapter;
    if (adapter.getStudentScore) {
      const fetched = await adapter.getStudentScore(params.userId, params.courseId, params.resourceId);
      if (fetched) {
        scoreGiven = fetched.scoreGiven;
        scoreMaximum = fetched.scoreMaximum;
        comment = comment ?? fetched.comment;
      }
    }
  }

  if (scoreGiven == null || scoreMaximum == null || !(scoreMaximum > 0)) {
    return {
      success: false,
      protocol: link.protocol,
      message: 'No score available (pass scoreGiven/scoreMaximum or implement adapter.getStudentScore).',
    };
  }

  if (link.protocol === '1.1') {
    if (!deps.consumerStore) {
      return { success: false, protocol: '1.1', message: 'No consumerStore configured.' };
    }
    const consumer = await deps.consumerStore.resolveConsumer(link.consumerKey);
    if (!consumer) {
      return { success: false, protocol: '1.1', message: 'Consumer key not found for outcome.' };
    }
    const normalized = scoreGiven / scoreMaximum;
    const result = await replaceResult(
      {
        serviceUrl: link.serviceUrl,
        sourcedId: link.sourcedId,
        consumerKey: consumer.key,
        consumerSecret: consumer.secret,
      },
      normalized
    );
    return { success: result.success, protocol: '1.1', message: result.message };
  }

  // 1.3 AGS prototype
  if (!deps.agsPrototype) {
    return {
      success: false,
      protocol: '1.3',
      message: 'AGS prototype is disabled (set agsPrototype/LTI_AGS_PROTOTYPE to enable).',
    };
  }
  const result = await submitAgsScore({
    provider: deps.getProvider(),
    platform: params.platform,
    userExternalId: params.userExternalId,
    link,
    scoreGiven,
    scoreMaximum,
    comment,
  });
  return { success: result.success, protocol: '1.3', message: result.message };
}
