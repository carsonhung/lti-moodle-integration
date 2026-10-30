/**
 * Mongoose LtiAgsSyncStore — reference implementation.
 *
 * Durable AGS sync records backed by `LtiAgsGradeSyncModel`. `update` maps to a
 * conditional `findOneAndUpdate`, which is atomic per document, so concurrent
 * workers cannot both claim a record. Copy into your project and point the
 * import at your model location. Excluded from the package build
 * (`*.example.ts`).
 *
 * @example
 * await initLti(app, adapter, { agsEnabled: true, agsSyncStore: mongooseAgsSyncStore });
 */

import type { LtiAgsSyncCondition, LtiAgsSyncRecord, LtiAgsSyncStore } from '../types';

// ── Replace with YOUR model path ─────────────────────────────────────────────
// import { LtiAgsGradeSyncModel } from '../models/LtiAgsGradeSyncModel.mongoose';
declare const LtiAgsGradeSyncModel: any;

function toRecord(doc: any): LtiAgsSyncRecord | null {
  if (!doc) return null;
  const { _id, __v, createdAt, ...rest } = doc;
  return { ...rest, id: String(_id) } as LtiAgsSyncRecord;
}

function buildUpdate(
  set: Record<string, unknown>,
  unset: string[] = [],
  inc: Record<string, number | undefined> = {}
): Record<string, unknown> {
  const update: Record<string, unknown> = { $set: set };
  if (unset.length) update.$unset = Object.fromEntries(unset.map((key) => [key, 1]));
  const incEntries = Object.entries(inc).filter(([, by]) => by);
  if (incEntries.length) update.$inc = Object.fromEntries(incEntries);
  return update;
}

function buildFilter(id: string, when: LtiAgsSyncCondition): Record<string, unknown> {
  const filter: Record<string, unknown> = { _id: id };
  if (when.status) filter.status = { $in: when.status };
  if (when.revision !== undefined) filter.revision = when.revision;
  if (when.attemptsBelow !== undefined) filter.attempts = { $lt: when.attemptsBelow };
  return filter;
}

export const mongooseAgsSyncStore: LtiAgsSyncStore = {
  async findById(id) {
    return toRecord(await LtiAgsGradeSyncModel.findById(id).lean());
  },

  async findByKey(idempotencyKey) {
    return toRecord(await LtiAgsGradeSyncModel.findOne({ idempotencyKey }).lean());
  },

  async upsertByKey(idempotencyKey, set, opts) {
    const doc = await LtiAgsGradeSyncModel.findOneAndUpdate(
      { idempotencyKey },
      buildUpdate(set as Record<string, unknown>, opts?.unset as string[], opts?.inc),
      { upsert: true, new: true }
    ).lean();
    return toRecord(doc)!;
  },

  async update(id, when, set, opts) {
    const doc = await LtiAgsGradeSyncModel.findOneAndUpdate(
      buildFilter(id, when),
      buildUpdate(set as Record<string, unknown>, opts?.unset as string[], opts?.inc),
      { new: true }
    ).lean();
    return toRecord(doc);
  },
};
