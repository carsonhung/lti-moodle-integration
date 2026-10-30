/**
 * Durable, idempotent AGS score synchronization.
 *
 * One record per platform tuple + resource link + LTI user. Each new submission
 * updates the record (respecting the score policy), resets its retry budget,
 * and bumps `revision`. Publishing claims the record with a compare-and-set so
 * concurrent workers cannot double-post, and a submission that lands mid-publish
 * is re-sent rather than lost.
 */

import { createHash } from 'crypto';
import { logInfo, logWarn } from '../logger';
import type {
  LtiAgsScorePolicy,
  LtiAgsSyncCondition,
  LtiAgsSyncRecord,
  LtiAgsSyncStore,
} from '../types';
import {
  assertValidAgsScore,
  deriveLineItemsEndpoint,
  evaluateAgsAvailability,
  formatAgsError,
  isScorelessSubmission,
  publishAgsScore,
  type AgsTarget,
} from './ags';

export const AGS_DEFAULT_MAX_ATTEMPTS = 5;
/** A `publishing` claim older than this is assumed abandoned (crashed worker). */
export const AGS_STALE_PUBLISH_MS = 2 * 60 * 1000;

const isFullyGraded = (gradingProgress?: string) =>
  (gradingProgress || 'FullyGraded') === 'FullyGraded';

export function makeAgsIdempotencyKey(target: AgsTarget): string {
  return createHash('sha256')
    .update(
      [
        target.issuer,
        target.clientId,
        target.deploymentId,
        target.contextId,
        target.resourceLinkId,
        target.lmsUserId,
      ].join('|')
    )
    .digest('hex');
}

export interface AgsEnqueueInput {
  target: AgsTarget;
  scorePolicy?: LtiAgsScorePolicy;
  submissionId?: string;
  scoreGiven?: number;
  scoreMaximum: number;
  comment?: string;
  activityProgress?: string;
  gradingProgress?: string;
}

export interface AgsScoreSyncOptions {
  store: LtiAgsSyncStore;
  getProvider: () => any;
  enabled: boolean;
  maxAttempts?: number;
  /** Called when publication used a different line item than the launch claim. */
  onLineItemResolved?: (
    record: LtiAgsSyncRecord,
    lineItemUrl: string,
    lineItemsEndpoint?: string
  ) => Promise<void> | void;
  now?: () => Date;
}

export interface AgsScoreSync {
  enqueue(input: AgsEnqueueInput): Promise<LtiAgsSyncRecord>;
  attempt(syncId: string): Promise<LtiAgsSyncRecord | null>;
}

function ratio(record: { scoreGiven?: number; scoreMaximum: number }): number {
  return typeof record.scoreGiven === 'number' && record.scoreMaximum > 0
    ? record.scoreGiven / record.scoreMaximum
    : -1;
}

function targetOf(record: LtiAgsSyncRecord): AgsTarget {
  return {
    issuer: record.issuer,
    clientId: record.clientId,
    deploymentId: record.deploymentId,
    contextId: record.contextId,
    resourceLinkId: record.resourceLinkId,
    lmsUserId: record.lmsUserId,
    lineItemUrl: record.lineItemUrl,
    lineItemsEndpoint: record.lineItemsEndpoint || deriveLineItemsEndpoint(record.lineItemUrl),
    scopes: record.scopes ?? [],
    lineItemHint: record.lineItemHint,
  };
}

export function createAgsScoreSync(options: AgsScoreSyncOptions): AgsScoreSync {
  const { store, enabled } = options;
  const maxAttempts = options.maxAttempts ?? AGS_DEFAULT_MAX_ATTEMPTS;
  const now = options.now ?? (() => new Date());

  const availability = (record: Pick<AgsTarget, 'scopes' | 'lineItemUrl' | 'lineItemsEndpoint'>) =>
    evaluateAgsAvailability({
      enabled,
      scopes: record.scopes ?? [],
      lineItemUrl: record.lineItemUrl,
      lineItemsEndpoint: record.lineItemsEndpoint || deriveLineItemsEndpoint(record.lineItemUrl),
    });

  async function attempt(syncId: string): Promise<LtiAgsSyncRecord | null> {
    let record = await store.findById(syncId);
    if (!record || record.status === 'synced') return record;

    if (record.status === 'publishing') {
      const startedAt = record.lastAttemptAt ? new Date(record.lastAttemptAt).getTime() : 0;
      if (now().getTime() - startedAt < AGS_STALE_PUBLISH_MS) return record;
      record =
        (await store.update(
          syncId,
          { status: ['publishing'], revision: record.revision },
          { status: 'pending' }
        )) ?? (await store.findById(syncId));
      if (!record || record.status !== 'pending') return record;
    }

    const reason = availability(record);
    if (reason) {
      return store.update(syncId, {}, { status: 'unavailable', lastError: reason });
    }
    if (record.attempts >= maxAttempts) {
      return store.update(
        syncId,
        { status: ['pending', 'failed', 'unavailable'] },
        { status: 'failed', lastError: `AGS publication stopped after ${maxAttempts} attempts` }
      );
    }

    const claimed = await store.update(
      syncId,
      { status: ['pending', 'failed', 'unavailable'], attemptsBelow: maxAttempts },
      { status: 'publishing', lastAttemptAt: now() },
      { inc: { attempts: 1 } }
    );
    if (!claimed) return store.findById(syncId);

    const stillClaimed: LtiAgsSyncCondition = {
      status: ['publishing'],
      revision: claimed.revision,
    };
    try {
      const result = await publishAgsScore(options.getProvider(), targetOf(claimed), {
        scoreGiven: claimed.scoreGiven,
        scoreMaximum: claimed.scoreMaximum,
        comment: claimed.comment,
        activityProgress: claimed.activityProgress,
        gradingProgress: claimed.gradingProgress,
      });
      if (result.lineItemUrl !== claimed.lineItemUrl && options.onLineItemResolved) {
        try {
          await options.onLineItemResolved(claimed, result.lineItemUrl, result.lineItemsEndpoint);
        } catch (e: any) {
          logWarn('[LTI AGS] Failed to remember recovered line item', { message: e?.message });
        }
      }
      const done = await store.update(
        syncId,
        stillClaimed,
        {
          status: 'synced',
          syncedAt: now(),
          ...(result.scoreGiven === undefined ? {} : { scoreGiven: result.scoreGiven }),
          scoreMaximum: result.scoreMaximum,
          lineItemUrl: result.lineItemUrl,
          ...(result.lineItemsEndpoint ? { lineItemsEndpoint: result.lineItemsEndpoint } : {}),
        },
        { unset: ['lastError'] }
      );
      if (done) {
        logInfo('[LTI AGS] Score synced', {
          syncId,
          lineItemUrl: result.lineItemUrl,
          source: result.source,
          attempts: done.attempts,
        });
        return done;
      }
    } catch (error) {
      const message = formatAgsError(error);
      logWarn('[LTI AGS] Platform rejected score', { syncId, message });
      const failed = await store.update(syncId, stillClaimed, {
        status: 'failed',
        lastError: message.slice(0, 2000),
      });
      if (failed) return failed;
    }

    // A newer submission arrived while publishing; send that one.
    await store.update(syncId, { status: ['publishing'] }, { status: 'pending' });
    return attempt(syncId);
  }

  async function enqueue(input: AgsEnqueueInput): Promise<LtiAgsSyncRecord> {
    const { target } = input;
    if (!target.lmsUserId) throw new Error('AGS sync requires the LTI user id (sub)');
    assertValidAgsScore(input);

    const scorePolicy = input.scorePolicy ?? 'latest';
    const scoreless = isScorelessSubmission(input);
    const idempotencyKey = makeAgsIdempotencyKey(target);
    const existing = await store.findByKey(idempotencyKey);

    // A scoreless post clears the LMS grade; never let it replace a real one.
    if (
      scoreless &&
      existing &&
      isFullyGraded(existing.gradingProgress) &&
      existing.status !== 'unavailable'
    ) {
      return existing;
    }
    if (existing?.status === 'synced' && isFullyGraded(existing.gradingProgress)) {
      if (scorePolicy === 'first') {
        logInfo('[LTI AGS] First score already sent; keeping it', { syncId: existing.id });
        return existing;
      }
      if (scorePolicy === 'highest' && !scoreless && ratio(existing) >= ratio(input)) {
        return existing;
      }
    }

    const reason = availability(target);
    const publishing = existing?.status === 'publishing';
    const comment = input.comment?.trim().slice(0, 4000);
    const unset: Array<keyof LtiAgsSyncRecord> = [];
    if (!comment) unset.push('comment');
    if (scoreless) unset.push('scoreGiven');
    if (!reason) unset.push('lastError');

    const record = await store.upsertByKey(
      idempotencyKey,
      {
        issuer: target.issuer,
        clientId: target.clientId,
        deploymentId: target.deploymentId,
        contextId: target.contextId,
        resourceLinkId: target.resourceLinkId,
        lmsUserId: target.lmsUserId,
        lineItemUrl: target.lineItemUrl || existing?.lineItemUrl,
        lineItemsEndpoint:
          target.lineItemsEndpoint ||
          deriveLineItemsEndpoint(target.lineItemUrl) ||
          existing?.lineItemsEndpoint,
        ...(target.lineItemHint ? { lineItemHint: target.lineItemHint } : {}),
        scopes: target.scopes,
        scorePolicy,
        ...(input.submissionId ? { submissionId: input.submissionId } : {}),
        ...(scoreless ? {} : { scoreGiven: input.scoreGiven }),
        scoreMaximum: input.scoreMaximum,
        ...(comment ? { comment } : {}),
        activityProgress: input.activityProgress || 'Completed',
        gradingProgress: input.gradingProgress || 'FullyGraded',
        // A new submission gets a fresh retry budget.
        ...(publishing ? {} : { attempts: 0 }),
        status: reason ? 'unavailable' : publishing ? 'publishing' : 'pending',
        ...(reason ? { lastError: reason } : {}),
      },
      { unset, inc: { revision: 1 } }
    );

    if (reason) {
      logWarn('[LTI AGS] Grade not sent', { syncId: record.id, reason });
      return record;
    }
    return (await attempt(record.id)) ?? record;
  }

  return { enqueue, attempt };
}

// ─── In-memory store (single process, tests, development) ───────────────────

function matches(record: LtiAgsSyncRecord, when: LtiAgsSyncCondition): boolean {
  if (when.status && !when.status.includes(record.status)) return false;
  if (when.revision !== undefined && record.revision !== when.revision) return false;
  if (when.attemptsBelow !== undefined && !(record.attempts < when.attemptsBelow)) return false;
  return true;
}

function applyPatch(
  record: LtiAgsSyncRecord,
  set: Partial<LtiAgsSyncRecord>,
  unset: Array<keyof LtiAgsSyncRecord> = [],
  inc: Partial<Record<'attempts' | 'revision', number>> = {}
): LtiAgsSyncRecord {
  const next: any = { ...record, ...set };
  for (const key of unset) delete next[key];
  for (const [key, by] of Object.entries(inc)) next[key] = (Number(next[key]) || 0) + (by ?? 0);
  next.updatedAt = new Date();
  return next;
}

/** Process-local `LtiAgsSyncStore`. Records are lost on restart. */
export function createInMemoryAgsSyncStore(): LtiAgsSyncStore {
  const byId = new Map<string, LtiAgsSyncRecord>();
  const idByKey = new Map<string, string>();
  let seq = 0;
  const clone = (r: LtiAgsSyncRecord | undefined) => (r ? { ...r } : null);

  return {
    async findById(id) {
      return clone(byId.get(id));
    },
    async findByKey(key) {
      const id = idByKey.get(key);
      return id ? clone(byId.get(id)) : null;
    },
    async upsertByKey(key, set, opts) {
      let id = idByKey.get(key);
      const base: LtiAgsSyncRecord = id
        ? byId.get(id)!
        : ({
            id: (id = `ags_${++seq}`),
            idempotencyKey: key,
            attempts: 0,
            revision: 0,
            scopes: [],
            status: 'pending',
          } as unknown as LtiAgsSyncRecord);
      const next = applyPatch(base, set, opts?.unset, opts?.inc);
      byId.set(id, next);
      idByKey.set(key, id);
      return { ...next };
    },
    async update(id, when, set, opts) {
      const current = byId.get(id);
      if (!current || !matches(current, when)) return null;
      const next = applyPatch(current, set, opts?.unset, opts?.inc);
      byId.set(id, next);
      return { ...next };
    },
  };
}
