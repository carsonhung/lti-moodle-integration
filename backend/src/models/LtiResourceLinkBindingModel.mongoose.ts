/**
 * Mongoose model: LtiResourceLinkBinding
 *
 * Stores the binding between an LMS resource link (a single Moodle activity)
 * and either a single resource (agent/bot/tool) or a category of resources
 * in your application. Created when a teacher submits the Deep Linking form.
 *
 * Drop into your `src/models/` folder and adjust the `ref` targets to match
 * your domain model names.
 *
 * ── Applies to the `deep-linking` flow only ──────────────────────────────────
 * This model is ONLY used by the `deep-linking` connect mode (see
 * `LTI_CONNECT_MODES` in `shared/lti.ts`), where a teacher binds a specific
 * activity to a specific resource via Moodle's content picker.
 *
 * The HKU Group Signup Moodle deployment does NOT use Deep Linking. It runs in
 * `context-mapping` (a plain external-tool launch maps the Moodle course context
 * to a platform course; students then pick a grouping and group in-app) or
 * `login-only` mode. In those flows nothing is bound at config time, so this
 * model is inactive on the Moodle path — keep it only if/when Deep Linking is
 * enabled, or as a portable reference for other LMSs that do support it.
 *
 * The `agent` and `category` bindings are generic template examples shipped with
 * the portable package. The `group` binding is a domain-specific example showing
 * how a deep-linked activity *would* bind to a single Group so the launch drops
 * the student straight into that group's signup view — useful as a pattern, not
 * wired into the current Moodle (context-mapping) launch handler.
 *
 * A binding targets exactly ONE resource (one agent, one category, or one
 * group). To launch MULTIPLE resources from a single activity, use the
 * `category` binding: point it at a category that contains the resources you
 * want, rather than binding the activity to many resources directly.
 */

import { Schema, model, Document, Types } from 'mongoose';

export type LtiBindingType = 'agent' | 'category' | 'group';

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

  /**
   * Set when bindingType='group' — reference to the app's Group document.
   * Domain-specific example for HKU Group Signup: binds a Moodle activity to a
   * single group so the LTI launch lands on that group's signup view.
   */
  groupId?: Types.ObjectId;

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
    groupId: { type: Schema.Types.ObjectId, ref: 'Group' },
    bindingType: { type: String, enum: ['agent', 'category', 'group'], default: 'agent' },

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
