/**
 * Mongoose model: LtiResourceLinkBinding
 *
 * Stores the binding between an LMS resource link (a single Moodle activity)
 * and either a single resource (agent/bot/tool) or a category of resources
 * in your application. Created when a teacher submits the Deep Linking form.
 *
 * Drop into your `src/models/` folder and adjust the `ref` targets to match
 * your domain model names.
 */

import { Schema, model, Document, Types } from 'mongoose';

export type LtiBindingType = 'agent' | 'category';

export interface LtiResourceLinkBindingInterface extends Document {
  tenantId?: string;
  issuer: string;
  clientId: string;
  deploymentId: string;
  contextId: string;
  resourceLinkId: string;

  /** Reference to the app's Course document */
  courseId: Types.ObjectId;

  /** Set when bindingType='agent' — reference to the single resource (Agent/Bot/Tool) */
  agentId?: Types.ObjectId;

  /** Set when bindingType='category' — reference to the Category document */
  categoryId?: Types.ObjectId;

  bindingType: LtiBindingType;

  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LtiResourceLinkBindingSchema = new Schema(
  {
    tenantId: { type: String, index: true },
    issuer: { type: String, required: true },
    clientId: { type: String, required: true },
    deploymentId: { type: String, required: true },
    contextId: { type: String, required: true },
    resourceLinkId: { type: String, required: true },

    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent' },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    bindingType: { type: String, enum: ['agent', 'category'], default: 'agent' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

LtiResourceLinkBindingSchema.index(
  { issuer: 1, clientId: 1, deploymentId: 1, contextId: 1, resourceLinkId: 1 },
  { unique: true }
);

export const LtiResourceLinkBindingModel = model<LtiResourceLinkBindingInterface>(
  'LtiResourceLinkBinding',
  LtiResourceLinkBindingSchema
);
