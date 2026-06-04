/**
 * Drizzle ORM Adapter — Reference implementation of LtiAdapter using
 * Drizzle ORM with Neon Postgres (or any Postgres database).
 *
 * Copy this file into your project, then replace the placeholder schema
 * imports with your actual Drizzle schemas. See `models/drizzle-schema.example.ts`
 * for the SQL/Drizzle definitions of the two LTI-specific tables.
 *
 * Notes
 * - This adapter assumes you have `users`, `courses`, and `resources` tables
 *   with the columns named in the placeholder imports. Rename freely.
 * - Single-tenant by default. Multi-tenant apps should populate `tenantId`
 *   columns and adjust the filters.
 */

import jwt from 'jsonwebtoken';
import { eq, and, or, ilike, sql, inArray } from 'drizzle-orm';
import type {
  LtiAdapter,
  LtiUser,
  LtiCourse,
  LtiResource,
  LtiCourseMapping,
  LtiResourceBinding,
  LtiPlatformContext,
  LtiBindingType,
  LtiRole,
  LtiTenantMode,
} from '../types';
import { parseJwtExpireSeconds } from '../helpers';

// ── Replace these with YOUR Drizzle DB instance + schemas ──────────────────
// import { db } from '../../../db';
// import { users, courses, resources, courseTeachers, courseStudents, courseResources } from '../../../db/schema';
// import { ltiCourseMaps, ltiResourceBindings } from '../models/drizzle-schema.example';

declare const db: any;
declare const users: any;
declare const courses: any;
declare const resources: any;
declare const courseTeachers: any;
declare const courseStudents: any;
declare const courseResources: any;
declare const ltiCourseMaps: any;
declare const ltiResourceBindings: any;

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(...args: any[]) {
  console.log('[LTI Adapter]', ...args);
}

function isAdmin(user: LtiUser): boolean {
  return user.roles?.includes('admin');
}

function toUser(row: any): LtiUser {
  return {
    id: String(row.id),
    email: row.email,
    name: row.name || '',
    roles: row.roles || [],
  };
}

function toCourse(row: any): LtiCourse {
  return {
    id: String(row.id),
    name: row.name || '',
    code: row.code || '',
    courseId: row.courseId || row.course_id,
    semester: row.semester || '',
    year: row.year || '',
    section: row.section,
    tenantId: row.tenantId,
  };
}

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

function isProbablyIdentifier(s: string): boolean {
  const v = norm(s);
  if (!v || v.length < 2 || v.length > 128) return false;
  if (/^[a-z]+$/i.test(v) && v.length < 4) return false;
  return true;
}

// ─── Drizzle Adapter ─────────────────────────────────────────────────────────

export const drizzleAdapter: LtiAdapter = {
  // ── UI Customisation ───────────────────────────────────────────────

  deepLinkPageTitle: 'Configure Activity',
  resourceLabel: 'Resource',
  customFieldPrefix: 'app',

  // ── User Resolution ────────────────────────────────────────────────

  async resolveTeacherByEmail(email: string): Promise<LtiUser | null> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (!row.roles?.includes('teacher') && !row.roles?.includes('admin')) return null;
    return toUser(row);
  },

  async resolveOrProvisionTeacher(
    email: string,
    name: string,
    role: LtiRole,
    externalId?: string
  ): Promise<LtiUser | null> {
    if (!email) return null;

    const existing = await this.resolveTeacherByEmail(email);
    if (existing) return existing;

    if (role !== 'teacher') return null;

    return this.upsertUser({ email, name, role: 'teacher', externalId });
  },

  async upsertUser(params): Promise<LtiUser> {
    const email = params.email.toLowerCase();
    const name = norm(params.name) || email;

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const row = existing[0];

    if (row) {
      const currentRoles: string[] = row.roles || [];
      const nextRoles = currentRoles.includes(params.role)
        ? currentRoles
        : [...currentRoles, params.role];
      await db
        .update(users)
        .set({
          name,
          roles: nextRoles,
          lastLoginType: 'lti',
          ...(params.externalId && /^\d+$/.test(params.externalId) && !row.externalId
            ? { externalId: params.externalId }
            : {}),
        })
        .where(eq(users.id, row.id));
      return toUser({ ...row, name, roles: nextRoles });
    }

    const created = await db
      .insert(users)
      .values({
        email,
        name,
        roles: [params.role],
        externalId: params.externalId || null,
        lastLoginType: 'lti',
      })
      .returning();
    return toUser(created[0]);
  },

  generateJwt(user: LtiUser): { token: string; expiresIn: number } {
    const expiresIn = parseJwtExpireSeconds(process.env.JWT_EXPIRE);
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'fallback-secret', {
      expiresIn: `${expiresIn}s`,
    });
    return { token, expiresIn };
  },

  // ── Course Operations ──────────────────────────────────────────────

  async listCoursesForTeacher(user: LtiUser): Promise<LtiCourse[]> {
    if (isAdmin(user)) {
      const rows = await db.select().from(courses);
      return rows.map(toCourse);
    }
    // Assumes `courseTeachers` is a join table with `courseId`, `userId`.
    const rows = await db
      .select({ course: courses })
      .from(courses)
      .innerJoin(courseTeachers, eq(courses.id, courseTeachers.courseId))
      .where(eq(courseTeachers.userId, user.id));
    return rows.map((r: any) => toCourse(r.course));
  },

  async getCourseForTeacher(user: LtiUser, courseId: string): Promise<LtiCourse | null> {
    const rows = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    const course = rows[0];
    if (!course) return null;
    if (isAdmin(user)) return toCourse(course);

    const teach = await db
      .select()
      .from(courseTeachers)
      .where(and(eq(courseTeachers.courseId, courseId), eq(courseTeachers.userId, user.id)))
      .limit(1);
    return teach[0] ? toCourse(course) : null;
  },

  async getCourseById(courseId: string): Promise<LtiCourse | null> {
    const rows = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    return rows[0] ? toCourse(rows[0]) : null;
  },

  async findCourseByCourseId(courseIdValue: string): Promise<LtiCourse | null> {
    const v = norm(courseIdValue);
    if (!v) return null;

    const rows = await db
      .select()
      .from(courses)
      .where(or(eq(courses.courseId, v), eq(courses.code, v)))
      .limit(2);
    if (rows.length === 1) return toCourse(rows[0]);

    const upper = v.toUpperCase();
    if (upper !== v) {
      const rowsU = await db
        .select()
        .from(courses)
        .where(or(eq(courses.courseId, upper), eq(courses.code, upper)))
        .limit(2);
      if (rowsU.length === 1) return toCourse(rowsU[0]);
    }
    return null;
  },

  async findCourseByCourseIdForTeacher(
    user: LtiUser,
    courseIdValue: string
  ): Promise<LtiCourse | null> {
    if (!courseIdValue) return null;
    if (isAdmin(user)) return this.findCourseByCourseId(courseIdValue);

    const rows = await db
      .select({ course: courses })
      .from(courses)
      .innerJoin(courseTeachers, eq(courses.id, courseTeachers.courseId))
      .where(
        and(eq(courseTeachers.userId, user.id), eq(courses.courseId, courseIdValue))
      )
      .limit(1);
    return rows[0] ? toCourse(rows[0].course) : null;
  },

  async suggestCourses(identifiers: string[], limit = 8): Promise<LtiCourse[]> {
    const uniq = Array.from(
      new Set((identifiers || []).map((c) => norm(c)).filter(isProbablyIdentifier))
    );
    if (uniq.length === 0) return [];

    const conditions = uniq.slice(0, 24).flatMap((c) => {
      const upper = c.toUpperCase();
      const arr = [eq(courses.courseId, c), eq(courses.code, c)];
      if (upper !== c) arr.push(eq(courses.courseId, upper), eq(courses.code, upper));
      if (c.length >= 3 && /\d/.test(c)) {
        arr.push(ilike(courses.courseId, `%${c}%`), ilike(courses.code, `%${c}%`));
      }
      if (c.length >= 5) {
        arr.push(ilike(courses.name, `%${c}%`));
      }
      return arr;
    });

    const pool = await db.select().from(courses).where(or(...conditions)).limit(200);
    if (!pool.length) return [];

    const scored = pool
      .map((course: any) => {
        const c_courseId = norm(course.courseId);
        const c_code = norm(course.code);
        const c_name = norm(course.name);
        let score = 0;
        for (const raw of uniq) {
          const candLower = norm(raw).toLowerCase();
          if (!candLower) continue;
          if (candLower === c_courseId.toLowerCase()) score = Math.max(score, 100);
          if (candLower === c_code.toLowerCase()) score = Math.max(score, 90);
          if (candLower.length >= 3) {
            if (c_courseId.toLowerCase().includes(candLower)) score = Math.max(score, 70);
            if (c_code.toLowerCase().includes(candLower)) score = Math.max(score, 60);
            if (c_name.toLowerCase().includes(candLower)) score = Math.max(score, 35);
          }
        }
        return { course, score };
      })
      .filter((x: any) => x.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, Math.max(1, limit));

    return scored.map((x: any) => toCourse(x.course));
  },

  // ── Resource Operations ────────────────────────────────────────────

  async listSelectableResources(
    user: LtiUser,
    course: LtiCourse,
    opts?: { query?: string; limit?: number }
  ): Promise<LtiResource[]> {
    const q = norm(opts?.query ?? '');
    const limit = Math.min(100, Math.max(1, Number(opts?.limit ?? 30)));

    // Course-attached resources
    const courseAttached = await db
      .select({ r: resources })
      .from(resources)
      .innerJoin(courseResources, eq(resources.id, courseResources.resourceId))
      .where(eq(courseResources.courseId, course.id));

    // Public resources matching the query
    const publicHits =
      q && q.length >= 2
        ? await db
            .select()
            .from(resources)
            .where(and(eq(resources.mode, 'public'), ilike(resources.name, `%${q}%`)))
            .limit(limit)
        : [];

    const courseIds = new Set(courseAttached.map((r: any) => String(r.r.id)));

    const out: LtiResource[] = [];
    for (const r of courseAttached) {
      out.push({
        id: String(r.r.id),
        name: r.r.name,
        description: r.r.description || undefined,
        source: 'course',
        iconUrl: r.r.iconUrl || undefined,
      });
    }
    for (const r of publicHits) {
      if (courseIds.has(String(r.id))) continue;
      out.push({
        id: String(r.id),
        name: r.name,
        description: r.description || undefined,
        source: 'public',
        iconUrl: r.iconUrl || undefined,
      });
    }
    return out;
  },

  async getSelectableResourceForDeepLinking(
    user: LtiUser,
    course: LtiCourse,
    resourceId: string
  ): Promise<LtiResource | null> {
    const rows = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
    const r = rows[0];
    if (!r) return null;

    if (isAdmin(user)) {
      return { id: String(r.id), name: r.name, description: r.description, iconUrl: r.iconUrl };
    }

    if (r.mode === 'public') {
      return { id: String(r.id), name: r.name, description: r.description, iconUrl: r.iconUrl };
    }

    const attached = await db
      .select()
      .from(courseResources)
      .where(
        and(eq(courseResources.courseId, course.id), eq(courseResources.resourceId, resourceId))
      )
      .limit(1);
    if (!attached[0]) return null;

    return { id: String(r.id), name: r.name, description: r.description, iconUrl: r.iconUrl };
  },

  // ── Enrollment / Association ────────────────────────────────────────

  async ensureResourceInCourse(course: LtiCourse, resource: LtiResource): Promise<void> {
    await db
      .insert(courseResources)
      .values({ courseId: course.id, resourceId: resource.id })
      .onConflictDoNothing();
  },

  async ensureTeacherInCourse(course: LtiCourse, user: LtiUser): Promise<void> {
    await db
      .insert(courseTeachers)
      .values({ courseId: course.id, userId: user.id })
      .onConflictDoNothing();
  },

  async ensureStudentInCourse(course: LtiCourse, user: LtiUser): Promise<void> {
    await db
      .insert(courseStudents)
      .values({ courseId: course.id, userId: user.id })
      .onConflictDoNothing();
  },

  // ── Mapping Persistence ────────────────────────────────────────────

  async findCourseMap(params: LtiPlatformContext): Promise<LtiCourseMapping | null> {
    const rows = await db
      .select()
      .from(ltiCourseMaps)
      .where(
        and(
          eq(ltiCourseMaps.issuer, params.issuer),
          eq(ltiCourseMaps.clientId, params.clientId),
          eq(ltiCourseMaps.deploymentId, params.deploymentId),
          eq(ltiCourseMaps.contextId, params.contextId)
        )
      )
      .limit(1);
    if (!rows[0]) return null;
    return { courseId: rows[0].courseId, tenantId: rows[0].tenantId };
  },

  async upsertCourseMap(params): Promise<LtiCourseMapping> {
    const [row] = await db
      .insert(ltiCourseMaps)
      .values({
        issuer: params.issuer,
        clientId: params.clientId,
        deploymentId: params.deploymentId,
        contextId: params.contextId,
        courseId: params.courseId,
        createdBy: params.createdBy,
        tenantId: params.tenantId || null,
      })
      .onConflictDoUpdate({
        target: [
          ltiCourseMaps.issuer,
          ltiCourseMaps.clientId,
          ltiCourseMaps.deploymentId,
          ltiCourseMaps.contextId,
        ],
        set: {
          courseId: params.courseId,
          tenantId: params.tenantId || null,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return { courseId: row.courseId, tenantId: row.tenantId };
  },

  async findResourceBinding(params): Promise<LtiResourceBinding | null> {
    const rows = await db
      .select()
      .from(ltiResourceBindings)
      .where(
        and(
          eq(ltiResourceBindings.issuer, params.issuer),
          eq(ltiResourceBindings.clientId, params.clientId),
          eq(ltiResourceBindings.deploymentId, params.deploymentId),
          eq(ltiResourceBindings.contextId, params.contextId),
          eq(ltiResourceBindings.resourceLinkId, params.resourceLinkId)
        )
      )
      .limit(1);
    if (!rows[0]) return null;
    return {
      courseId: rows[0].courseId,
      resourceId: rows[0].resourceId || '',
      categoryId: rows[0].categoryId || undefined,
      bindingType: (rows[0].bindingType as LtiBindingType) || 'agent',
      tenantId: rows[0].tenantId,
    };
  },

  async upsertResourceBinding(params): Promise<LtiResourceBinding> {
    const bindingType = params.bindingType || 'agent';
    const [row] = await db
      .insert(ltiResourceBindings)
      .values({
        issuer: params.issuer,
        clientId: params.clientId,
        deploymentId: params.deploymentId,
        contextId: params.contextId,
        resourceLinkId: params.resourceLinkId,
        courseId: params.courseId,
        resourceId: bindingType === 'agent' ? params.resourceId : null,
        categoryId: bindingType === 'category' ? params.categoryId : null,
        bindingType,
        createdBy: params.createdBy,
        tenantId: params.tenantId || null,
      })
      .onConflictDoUpdate({
        target: [
          ltiResourceBindings.issuer,
          ltiResourceBindings.clientId,
          ltiResourceBindings.deploymentId,
          ltiResourceBindings.contextId,
          ltiResourceBindings.resourceLinkId,
        ],
        set: {
          courseId: params.courseId,
          resourceId: bindingType === 'agent' ? params.resourceId : null,
          categoryId: bindingType === 'category' ? params.categoryId : null,
          bindingType,
          tenantId: params.tenantId || null,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return {
      courseId: row.courseId,
      resourceId: row.resourceId || '',
      categoryId: row.categoryId || undefined,
      bindingType: (row.bindingType as LtiBindingType) || 'agent',
      tenantId: row.tenantId,
    };
  },

  // ── Tenant Resolution ──────────────────────────────────────────────

  resolveEffectiveTenant(): string | undefined {
    return process.env.DEFAULT_TENANT_ID || undefined;
  },

  async resolveTenantFromBinding(binding: LtiResourceBinding): Promise<string | undefined> {
    return binding.tenantId;
  },

  async grantTeacherTenantAccess(): Promise<void> {
    // No-op for single-tenant apps. Extend with a teacher_tenants table for multi-tenant.
  },

  getTenantMode(): LtiTenantMode | undefined {
    return undefined; // single-tenant default
  },

  // ── Optional: Resource Lookup ──────────────────────────────────────

  async getResourceById(resourceId: string): Promise<LtiResource | null> {
    const rows = await db
      .select({ id: resources.id, name: resources.name })
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1);
    return rows[0] ? { id: String(rows[0].id), name: rows[0].name } : null;
  },
};

// Suppress unused-warning for type-only imports referenced in JSDoc
void inArray;
