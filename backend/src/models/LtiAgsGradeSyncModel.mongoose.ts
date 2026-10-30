/**
 * Mongoose model: LtiAgsGradeSync
 *
 * One durable AGS score-sync record per platform tuple + resource link + LTI
 * user (`idempotencyKey`). Backs an `LtiAgsSyncStore` (see
 * `stores/agsSyncStore.mongoose.example.ts`). Only needed for LTI 1.3 AGS.
 */

import { Schema, model, Document } from 'mongoose';
import type { LtiAgsScorePolicy, LtiAgsSyncStatus } from '../types';

export interface LtiAgsGradeSyncInterface extends Document {
  idempotencyKey: string;
  issuer: string;
  clientId: string;
  deploymentId: string;
  contextId: string;
  resourceLinkId: string;
  lmsUserId: string;
  lineItemUrl?: string;
  lineItemsEndpoint?: string;
  lineItemHint?: { tag?: string; resourceId?: string; label?: string };
  scopes: string[];
  scorePolicy: LtiAgsScorePolicy;
  submissionId?: string;
  scoreGiven?: number;
  scoreMaximum: number;
  comment?: string;
  activityProgress: string;
  gradingProgress: string;
  status: LtiAgsSyncStatus;
  attempts: number;
  revision: number;
  lastError?: string;
  lastAttemptAt?: Date;
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LtiAgsGradeSyncSchema = new Schema(
  {
    idempotencyKey: { type: String, required: true, unique: true },
    issuer: { type: String, required: true },
    clientId: { type: String, required: true },
    deploymentId: { type: String, required: true },
    contextId: { type: String, required: true },
    resourceLinkId: { type: String, required: true },
    lmsUserId: { type: String, required: true },
    lineItemUrl: { type: String },
    lineItemsEndpoint: { type: String },
    lineItemHint: {
      tag: { type: String },
      resourceId: { type: String },
      label: { type: String },
    },
    scopes: { type: [String], default: [] },
    scorePolicy: { type: String, enum: ['latest', 'first', 'highest'], default: 'latest' },
    submissionId: { type: String },
    scoreGiven: { type: Number },
    scoreMaximum: { type: Number, required: true },
    comment: { type: String, maxlength: 4000 },
    activityProgress: { type: String, default: 'Completed' },
    gradingProgress: { type: String, default: 'FullyGraded' },
    status: {
      type: String,
      enum: ['pending', 'publishing', 'synced', 'failed', 'unavailable'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    revision: { type: Number, default: 0, min: 0 },
    lastError: { type: String, maxlength: 2000 },
    lastAttemptAt: { type: Date },
    syncedAt: { type: Date },
  },
  { timestamps: true }
);

LtiAgsGradeSyncSchema.index({ issuer: 1, clientId: 1, contextId: 1, resourceLinkId: 1 });

export const LtiAgsGradeSyncModel = model<LtiAgsGradeSyncInterface>(
  'LtiAgsGradeSync',
  LtiAgsGradeSyncSchema
);
