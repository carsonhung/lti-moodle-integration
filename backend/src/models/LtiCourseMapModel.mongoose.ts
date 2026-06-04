/**
 * Mongoose model: LtiCourseMap
 *
 * Stores the mapping between an LMS course context (issuer + clientId +
 * deploymentId + contextId) and a course in your application. One row per
 * (issuer, clientId, deploymentId, contextId).
 *
 * Drop into your `src/models/` folder (or wherever your Mongoose models
 * live) and adjust the foreign-key `ref` targets to your model names.
 */

import { Schema, model, Document, Types } from 'mongoose';

export interface LtiCourseMapInterface extends Document {
  /** Optional — set if you're running a multi-tenant app */
  tenantId?: string;
  issuer: string;
  clientId: string;
  deploymentId: string;
  contextId: string;

  /** Reference to the app's Course document */
  courseId: Types.ObjectId;

  /** Teacher/admin who created the mapping (via deep linking) */
  createdBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const LtiCourseMapSchema = new Schema(
  {
    tenantId: { type: String, index: true }, // optional; set for multi-tenant apps
    issuer: { type: String, required: true },
    clientId: { type: String, required: true },
    deploymentId: { type: String, required: true },
    contextId: { type: String, required: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

LtiCourseMapSchema.index(
  { issuer: 1, clientId: 1, deploymentId: 1, contextId: 1 },
  { unique: true }
);

export const LtiCourseMapModel = model<LtiCourseMapInterface>('LtiCourseMap', LtiCourseMapSchema);
