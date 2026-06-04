/**
 * Drizzle schema for the two LTI-specific tables.
 *
 * Drop these into your project's schema directory (e.g. `src/db/schema/lti.ts`)
 * and run a migration. The foreign-key columns (`courseId`, `resourceId`,
 * `categoryId`, `createdBy`) should reference your existing tables — adjust
 * the `references()` calls and the imports below to match.
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

declare const users: any;
declare const courses: any;
declare const resources: any;
declare const categories: any;

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

    bindingType: text('binding_type').notNull().default('agent'), // 'agent' | 'category'

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
