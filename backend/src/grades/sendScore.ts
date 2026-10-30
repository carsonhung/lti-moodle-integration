/**
 * Unified host-callable grade-push facade.
 *
 * `sendScore()` is the single entry point the host app calls when it decides a
 * grade should post. It looks up the grade link captured at launch (in the
 * `LtiGradeLinkStore`) for the given user + activity and dispatches to either
 * LTI 1.1 Basic Outcomes (`replaceResult`) or LTI 1.3 AGS, depending on the
 * recorded launch protocol. 1.3 scores go through the durable AGS sync layer
 * (idempotent, retried, score-policy aware). No automatic scoring is assumed —
 * the host owns the trigger.
 *
 * The dependencies are registered by `initLti`; calling `sendScore` before
 * `initLti` (or with the LTI module disabled) returns a failed result.
 */

import type {
  LtiAdapter,
  LtiLoginOnlyAdapter,
  LtiAgsLineItemHint,
  LtiAgsScorePolicy,
  LtiAgsSyncStatus,
  LtiConsumerStore,
  LtiGradeLinkStore,
  LtiPlatformContext,
} from '../types';
import { replaceResult } from '../legacy/outcomes';
import { deriveLineItemsEndpoint, isScorelessSubmission } from './ags';
import type { AgsScoreSync } from './agsSync';

interface SendScoreDeps {
  adapter: LtiAdapter | LtiLoginOnlyAdapter;
  consumerStore?: LtiConsumerStore;
  gradeLinkStore: LtiGradeLinkStore;
  agsEnabled: boolean;
  agsSync: AgsScoreSync;
}

let deps: SendScoreDeps | null = null;

/** Called internally by `initLti` to wire the grade-push dependencies. */
export function registerSendScore(d: SendScoreDeps): void {
  deps = d;
}

export interface SendScoreParams {
  /**
   * The launch identifiers captured when the student launched (platform tuple +
   * resourceLinkId + the user id). These key the grade-link store.
   */
  platform: LtiPlatformContext;
  resourceLinkId: string;
  /**
   * For 1.3 launches, the LTI `sub` (the `platformSubject` passed to
   * `upsertUser`). The LIS `person_sourcedid` is also accepted for backward
   * compatibility. For 1.1 launches, the launch `user_id`.
   */
  userExternalId: string;
  /**
   * Explicit score. If omitted, the optional `adapter.getStudentScore` hook is
   * used (requires `userId` + `courseId` + `resourceId`). 1.3 may omit it for
   * a scoreless submission (`gradingProgress` other than `FullyGraded`).
   */
  scoreGiven?: number;
  scoreMaximum?: number;
  comment?: string;
  /** App-domain ids for the `getStudentScore` fallback. */
  userId?: string;
  courseId?: string;
  resourceId?: string;
  /** 1.3 only. Defaults to `latest`. */
  scorePolicy?: LtiAgsScorePolicy;
  /** 1.3 only. Defaults to `Completed`. */
  activityProgress?: string;
  /** 1.3 only. Defaults to `FullyGraded`; use `PendingManual` for teacher-graded work. */
  gradingProgress?: string;
  /** 1.3 only. Host submission id stored on the sync record. */
  submissionId?: string;
  /**
   * 1.3 only. Identifies the grade column if the launch line item is gone.
   * Assignment deep links use `{ tag: '<prefix>:assignment:<id>', resourceId: '<id>' }`.
   */
  lineItem?: LtiAgsLineItemHint;
}

export interface SendScoreResult {
  success: boolean;
  protocol?: '1.1' | '1.3';
  message?: string;
  /** 1.3 only: sync record id, usable with `retryAgsScore`. */
  syncId?: string;
  status?: LtiAgsSyncStatus;
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

  const scoreless =
    link.protocol === '1.3' &&
    isScorelessSubmission({ scoreGiven, gradingProgress: params.gradingProgress });
  if (
    (!scoreless && scoreGiven == null) ||
    scoreMaximum == null ||
    !(scoreMaximum > 0)
  ) {
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
    const normalized = scoreGiven! / scoreMaximum;
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

  if (!deps.agsEnabled) {
    return {
      success: false,
      protocol: '1.3',
      message: 'LTI AGS is disabled (set agsEnabled / LTI_AGS_ENABLED to enable).',
    };
  }
  try {
    const record = await deps.agsSync.enqueue({
      target: {
        ...params.platform,
        resourceLinkId: params.resourceLinkId,
        lmsUserId: link.userId || params.userExternalId,
        lineItemUrl: link.lineItem,
        lineItemsEndpoint: link.lineItems || deriveLineItemsEndpoint(link.lineItem),
        scopes: link.scopes ?? [],
        lineItemHint: params.lineItem,
      },
      scorePolicy: params.scorePolicy,
      submissionId: params.submissionId,
      scoreGiven,
      scoreMaximum,
      comment,
      activityProgress: params.activityProgress,
      gradingProgress: params.gradingProgress,
    });
    return {
      success: record.status === 'synced',
      protocol: '1.3',
      syncId: record.id,
      status: record.status,
      ...(record.lastError ? { message: record.lastError } : {}),
    };
  } catch (e: any) {
    return { success: false, protocol: '1.3', message: e?.message ?? String(e) };
  }
}

/** Re-attempt a `failed`/`pending`/`unavailable` AGS sync record. */
export async function retryAgsScore(syncId: string): Promise<SendScoreResult> {
  if (!deps) {
    return { success: false, message: 'LTI is not initialized (call initLti first).' };
  }
  const record = await deps.agsSync.attempt(syncId);
  if (!record) return { success: false, protocol: '1.3', message: 'AGS sync record not found.' };
  return {
    success: record.status === 'synced',
    protocol: '1.3',
    syncId: record.id,
    status: record.status,
    ...(record.lastError ? { message: record.lastError } : {}),
  };
}
