/**
 * Drizzle schema for the two LTI-specific tables.
 *
 * Drop these into your project's schema directory (e.g. `src/db/schema/lti.ts`)
 * and run a migration. The foreign-key columns (`courseId`, `resourceId`,
 * `categoryId`, `groupId`, `createdBy`) should reference your existing tables —
 * adjust the `references()` calls and the imports below to match.
 *
 * ── `lti_resource_bindings` applies to the `deep-linking` flow only ──────────
 * The bindings table is ONLY used by the `deep-linking` connect mode (see
 * `LTI_CONNECT_MODES` in `shared/lti.ts`), where a teacher binds a specific
 * activity to a specific resource via Moodle's content picker.
 *
 * The HKU Group Signup Moodle deployment does NOT use Deep Linking. It runs in
 * `context-mapping` (a plain external-tool launch maps the Moodle course context
 * to a platform course; students then pick a grouping and group in-app) or
 * `login-only` mode. In those flows the `lti_course_maps` table is what's used —
 * nothing is bound at config time, so `lti_resource_bindings` is inactive on the
 * Moodle path. Keep it only if/when Deep Linking is enabled.
 *
 * The `agent` and `category` bindings are generic template examples. The `group`
 * binding is a domain-specific example showing how a deep-linked activity *would*
 * bind to a single group — a pattern, not wired into the context-mapping flow.
 *
 * A binding targets exactly ONE row (one agent, one category, or one group). To
 * launch MULTIPLE resources from a single activity, use the `category` binding:
 * point it at a category that contains the resources you want, rather than
 * binding the activity to many resources directly.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ── Replace these imports with your actual tables ────────────────────────────
// import { users } from './users';
// import { courses } from './courses';
// import { resources } from './resources';   // your Agent / Bot / Tool table
// import { categories } from './categories'; // optional, for category binding
// import { groups } from './groups';         // optional, for group binding

declare const users: any;
declare const courses: any;
declare const resources: any;
declare const categories: any;
declare const groups: any;

// ─── lti_course_maps ─────────────────────────────────────────────────────────

export const ltiCourseMaps = pgTable(
  'lti_course_maps',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    issuer: text('issuer').notNull(),
    clientId: text('client_id').notNull(),
    deploymentId: text('deployment_id').notNull(),
    contextId: text('context_id').notNull(),

    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),

    tenantId: text('tenant_id'),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    contextUnique: uniqueIndex('lti_course_maps_context_uq').on(
      table.issuer,
      table.clientId,
      table.deploymentId,
      table.contextId
    ),
  })
);

// ─── lti_resource_bindings ───────────────────────────────────────────────────

export const ltiResourceBindings = pgTable(
  'lti_resource_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    issuer: text('issuer').notNull(),
    clientId: text('client_id').notNull(),
    deploymentId: text('deployment_id').notNull(),
    contextId: text('context_id').notNull(),
    resourceLinkId: text('resource_link_id').notNull(),

    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),

    /** Set when bindingType='agent' */
    resourceId: uuid('resource_id').references(() => resources.id, { onDelete: 'cascade' }),

    /** Set when bindingType='category' */
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }),

    /** Set when bindingType='group' — domain-specific example (HKU Group Signup) */
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),

    bindingType: text('binding_type').notNull().default('agent'), // 'agent' | 'category' | 'group'

    tenantId: text('tenant_id'),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bindingUnique: uniqueIndex('lti_resource_bindings_link_uq').on(
      table.issuer,
      table.clientId,
      table.deploymentId,
      table.contextId,
      table.resourceLinkId
    ),
  })
);

// Suppress unused warnings for declared external tables used only via references
void users;
void courses;
void resources;
void categories;
void groups;
