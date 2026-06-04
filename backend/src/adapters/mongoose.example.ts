/**
 * Mongoose Adapter — Reference implementation of LtiAdapter.
 *
 * This is a template you can copy into your project, then wire to your own
 * Mongoose models (User, Course, Agent, Category). Replace the placeholder
 * model imports at the top with your actual model paths.
 *
 * Notes
 * - All multi-tenant code paths are optional. For single-tenant apps,
 *   `resolveEffectiveTenant()` should return undefined and `tenantFilter()`
 *   should return `{}`.
 * - The `User.lastLoginType = 'lti'` line is convention; remove if your
 *   user schema doesn't track login source.
 * - The `externalId` parameter is the institutional ID extracted from the
 *   LTI launch (e.g. HKU UID). Use it to merge LTI users with existing
 *   accounts created via your university SSO before the email matched.
 */

import jwt from 'jsonwebtoken';
import type {
  LtiAdapter,
  LtiUser,
  LtiCourse,
  LtiResource,
  LtiCategory,
  LtiCourseMapping,
  LtiResourceBinding,
  LtiPlatformContext,
  LtiBindingType,
  LtiRole,
  LtiTenantMode,
} from '../types';
import { parseJwtExpireSeconds } from '../helpers';

// ── Replace these with YOUR Mongoose models ──────────────────────────────────
// import { UserModel as User } from '../../../models/UserModel';
// import { CourseModel as Course } from '../../../models/CourseModel';
// import { AgentModel as Agent } from '../../../models/AgentModel';
// import { CategoryModel as Category } from '../../../models/CategoryModel';
// import { LtiCourseMapModel } from '../models/LtiCourseMapModel';
// import { LtiResourceLinkBindingModel } from '../models/LtiResourceLinkBindingModel';

declare const User: any;
declare const Course: any;
declare const Agent: any;
declare const Category: any;
declare const LtiCourseMapModel: any;
declare const LtiResourceLinkBindingModel: any;

// ── Optional logger ──────────────────────────────────────────────────────────

function log(...args: any[]) {
  console.log('[LTI Adapter]', ...args);
}

// ── Tenant helpers (no-op for single-tenant; customize for multi-tenant) ────

function getDefaultTenant(): string | undefined {
  return process.env.DEFAULT_TENANT_ID || undefined;
}

function resolveEffectiveTenantId(tenantId?: string): string | undefined {
  if (tenantId) return tenantId;
  return getDefaultTenant();
}

function tenantFilter(tenantId?: string): Record<string, unknown> {
  const t = resolveEffectiveTenantId(tenantId);
  return t ? { tenantId: t } : {};
}

// ── Misc helpers ─────────────────────────────────────────────────────────────

function isAdmin(user: LtiUser): boolean {
  return user.roles?.includes('admin');
}

function toUser(doc: any): LtiUser {
  return {
    id: String(doc._id),
    email: doc.email,
    name: doc.name || '',
    roles: doc.roles || [],
  };
}

function toCourse(doc: any): LtiCourse {
  return {
    id: String(doc._id),
    name: doc.name || '',
    code: doc.code || '',
    courseId: doc.course_id,
    semester: doc.semester || '',
    year: doc.year || '',
    section: doc.section,
    tenantId: doc.tenantId,
  };
}

function escapeRegExp(s: string): string {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// ─── Mongoose Adapter ────────────────────────────────────────────────────────

export const mongooseAdapter: LtiAdapter = {
  // ── UI Customisation ───────────────────────────────────────────────

  deepLinkPageTitle: 'Configure Chatbot Activity',
  resourceLabel: 'Agent',
  customFieldPrefix: 'myapp', // custom param prefix → e.g. myapp_course_id

  // ── User Resolution ────────────────────────────────────────────────

  async resolveTeacherByEmail(email: string): Promise<LtiUser | null> {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return null;
    if (!user.roles?.includes('teacher') && !user.roles?.includes('admin')) return null;
    return toUser(user);
  },

  async resolveOrProvisionTeacher(
    email: string,
    name: string,
    role: LtiRole,
    externalId?: string
  ): Promise<LtiUser | null> {
    if (!email) return null;

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing && (existing.roles?.includes('teacher') || existing.roles?.includes('admin'))) {
      return toUser(existing);
    }

    if (role !== 'teacher') return null;

    const user = await this.upsertUser({ email, name, role: 'teacher', externalId });
    return user;
  },

  async upsertUser(params): Promise<LtiUser> {
    const email = params.email.toLowerCase();
    const name = String(params.name || '').trim() || email;
    const externalId = String(params.externalId || '').trim();

    let user: any = null;
    if (externalId && /^\d+$/.test(externalId)) {
      user = await User.findOne({ hkuno: externalId });
    }
    if (!user) {
      user = await User.findOne({ email });
    }

    if (!user) {
      const randomPassword = Math.random().toString(36).slice(-10);
      user = await User.create({
        name,
        email,
        hkuno: externalId && /^\d+$/.test(externalId) ? externalId : email,
        password: randomPassword,
        roles: [params.role],
        lastLoginType: 'lti',
      });
      return toUser(user);
    }

    user.lastLoginType = 'lti';
    if (name) user.name = name;
    if (email) user.email = email;
    if (externalId && /^\d+$/.test(externalId) && !user.hkuno) {
      user.hkuno = externalId;
    }
    if (!user.roles?.includes(params.role)) {
      user.roles = [...(user.roles || []), params.role];
    }

    await user.save();
    return toUser(user);
  },

  generateJwt(user: LtiUser): { token: string; expiresIn: number } {
    const expiresIn = parseJwtExpireSeconds(process.env.JWT_EXPIRE);
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'fallback-secret', {
      expiresIn: `${expiresIn}s`,
    });
    return { token, expiresIn };
  },

  // ── Course Operations ──────────────────────────────────────────────

  async listCoursesForTeacher(user: LtiUser, tenantId?: string): Promise<LtiCourse[]> {
    const tf = tenantFilter(tenantId);
    const docs = isAdmin(user)
      ? await Course.find(tf)
          .select('name code course_id semester year section teachers agents tenantId')
          .lean()
      : await Course.find({ teachers: user.id, ...tf })
          .select('name code course_id semester year section teachers agents tenantId')
          .lean();
    return docs.map(toCourse);
  },

  async getCourseForTeacher(
    user: LtiUser,
    courseId: string,
    tenantId?: string
  ): Promise<LtiCourse | null> {
    const course = await Course.findOne({ _id: courseId, ...tenantFilter(tenantId) }).lean();
    if (!course) return null;
    if (isAdmin(user)) return toCourse(course);
    const ok = course.teachers?.some((t: any) => String(t) === user.id);
    return ok ? toCourse(course) : null;
  },

  async getCourseById(courseId: string, tenantId?: string): Promise<LtiCourse | null> {
    const course = await Course.findOne({ _id: courseId, ...tenantFilter(tenantId) }).lean();
    return course ? toCourse(course) : null;
  },

  async findCourseByCourseId(courseIdValue: string, tenantId?: string): Promise<LtiCourse | null> {
    const v = String(courseIdValue ?? '').trim();
    if (!v) return null;
    const tf = tenantFilter(tenantId);

    if (/^[0-9a-fA-F]{24}$/.test(v)) {
      const byId = await Course.findOne({ _id: v, ...tf }).lean();
      if (byId) return toCourse(byId);
    }

    const exact = await Course.findOne({ course_id: v, ...tf }).lean();
    if (exact) return toCourse(exact);

    const byCode = await Course.find({ code: v, ...tf })
      .limit(2)
      .lean();
    if (byCode.length === 1) return toCourse(byCode[0]);

    const upper = v.toUpperCase();
    if (upper !== v) {
      const exactUpper = await Course.findOne({ course_id: upper, ...tf }).lean();
      if (exactUpper) return toCourse(exactUpper);
      const byCodeUpper = await Course.find({ code: upper, ...tf })
        .limit(2)
        .lean();
      if (byCodeUpper.length === 1) return toCourse(byCodeUpper[0]);
    }

    return null;
  },

  async findCourseByCourseIdForTeacher(
    user: LtiUser,
    courseIdValue: string,
    tenantId?: string
  ): Promise<LtiCourse | null> {
    if (!courseIdValue) return null;
    const tf = tenantFilter(tenantId);
    const doc = isAdmin(user)
      ? await Course.findOne({ course_id: courseIdValue, ...tf }).lean()
      : await Course.findOne({ teachers: user.id, course_id: courseIdValue, ...tf }).lean();
    return doc ? toCourse(doc) : null;
  },

  async suggestCourses(identifiers: string[], limit = 8, tenantId?: string): Promise<LtiCourse[]> {
    const candidates = Array.isArray(identifiers) ? identifiers : [];
    const uniq = Array.from(new Set(candidates.map((c) => norm(c)).filter(isProbablyIdentifier)));
    if (uniq.length === 0) return [];
    const tf = tenantFilter(tenantId);

    const or: any[] = [];
    for (const c of uniq.slice(0, 24)) {
      const upper = c.toUpperCase();
      const lower = c.toLowerCase();
      or.push({ course_id: c, ...tf });
      or.push({ code: c, ...tf });
      if (upper !== c) {
        or.push({ course_id: upper, ...tf });
        or.push({ code: upper, ...tf });
      }
      if (lower !== c) {
        or.push({ course_id: lower, ...tf });
        or.push({ code: lower, ...tf });
      }
      if (c.length >= 3 && /\d/.test(c)) {
        const r = new RegExp(escapeRegExp(c), 'i');
        or.push({ course_id: r, ...tf });
        or.push({ code: r, ...tf });
      }
      if (c.length >= 5) {
        const r = new RegExp(escapeRegExp(c), 'i');
        or.push({ name: r, ...tf });
      }
    }

    const pool: any[] = await Course.find({ $or: or })
      .select('name code course_id semester year section teachers tenantId')
      .limit(200)
      .lean();
    if (!pool || pool.length === 0) return [];

    const scored = pool
      .map((course: any) => {
        const courseObjId = String(course?._id ?? '');
        const c_courseId = norm(course?.course_id);
        const c_code = norm(course?.code);
        const c_name = norm(course?.name);

        let score = 0;
        for (const raw of uniq) {
          const cand = norm(raw);
          const candLower = cand.toLowerCase();
          if (candLower && candLower === courseObjId.toLowerCase()) score = Math.max(score, 96);
          if (candLower && candLower === c_courseId.toLowerCase()) score = Math.max(score, 100);
          if (candLower && candLower === c_code.toLowerCase()) score = Math.max(score, 90);
          if (candLower && candLower.length >= 3) {
            if (c_courseId.toLowerCase().includes(candLower)) score = Math.max(score, 70);
            if (c_code.toLowerCase().includes(candLower)) score = Math.max(score, 60);
            if (c_name.toLowerCase().includes(candLower)) score = Math.max(score, 35);
          }
        }
        return { course, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit));

    return scored.map((x) => toCourse(x.course));
  },

  // ── Resource Operations ────────────────────────────────────────────

  async listSelectableResources(
    user: LtiUser,
    course: LtiCourse,
    opts?: { query?: string; limit?: number }
  ): Promise<LtiResource[]> {
    const populated = await Course.findById(course.id).populate('agents');
    const courseAgents: any[] = Array.isArray((populated as any)?.agents)
      ? ((populated as any).agents as any[])
      : [];
    const q = String(opts?.query ?? '').trim();
    const publicLimit = Math.min(100, Math.max(1, Number(opts?.limit ?? 30)));

    const courseTenantId = course.tenantId;
    const publicFilter: any = {
      mode: 'public',
      status: 'active',
      isDeleted: { $ne: true },
      name: new RegExp(escapeRegExp(q), 'i'),
    };
    if (courseTenantId) publicFilter.tenantId = courseTenantId;

    const publicAgents: any[] =
      q && q.length >= 2 ? await Agent.find(publicFilter).sort({ name: 1 }).limit(publicLimit) : [];

    const merged = [...courseAgents];
    for (const a of publicAgents) {
      if (merged.findIndex((b) => String(b._id) === String(a._id)) < 0) merged.push(a);
    }

    const courseAgentIds = new Set(courseAgents.map((a) => String(a._id)));

    return merged
      .filter((a) => a && a.status !== 'draft' && !a.isDeleted)
      .map((a) => {
        const id = String(a._id);
        let source: 'course' | 'public' | 'other' = 'other';
        if (courseAgentIds.has(id)) source = 'course';
        else if (String(a?.mode ?? '') === 'public') source = 'public';
        return {
          id,
          name: a.name,
          description: a.description || undefined,
          source,
          iconUrl: a.image ? `/uploads/${a.image}` : undefined,
        };
      });
  },

  async getSelectableResourceForDeepLinking(
    user: LtiUser,
    course: LtiCourse,
    resourceId: string
  ): Promise<LtiResource | null> {
    const agent = await Agent.findById(resourceId);
    if (!agent) return null;
    if (agent.status === 'draft') return null;

    const base: LtiResource = {
      id: String(agent._id),
      name: agent.name,
      description: agent.description || undefined,
      iconUrl: agent.image ? `/uploads/${agent.image}` : undefined,
      thumbnailUrl: agent.image ? `/uploads/${agent.image}` : undefined,
    };

    if (isAdmin(user)) return base;

    if (String(agent.mode) === 'public') {
      if (!course.tenantId || String((agent as any)?.tenantId) === String(course.tenantId)) {
        return base;
      }
      return null;
    }

    const courseDoc = await Course.findById(course.id).select('agents').lean();
    const courseAgents: any[] = Array.isArray(courseDoc?.agents) ? courseDoc!.agents : [];
    if (courseAgents.some((a: any) => String(a) === String(agent._id))) {
      return base;
    }

    return null;
  },

  // ── Enrollment / Association ────────────────────────────────────────

  async ensureResourceInCourse(course: LtiCourse, resource: LtiResource): Promise<void> {
    const reloaded = await Course.findById(course.id);
    if (!reloaded) return;
    const hasAgent = reloaded.agents?.some((a: any) => String(a) === resource.id);
    if (!hasAgent) {
      reloaded.agents.push(resource.id);
      await reloaded.save();
    }
  },

  async ensureTeacherInCourse(course: LtiCourse, user: LtiUser): Promise<void> {
    const reloaded = await Course.findById(course.id);
    if (!reloaded) return;
    const hasTeacher = reloaded.teachers?.some((t: any) => String(t) === user.id);
    if (!hasTeacher) {
      reloaded.teachers.push(user.id);
      await reloaded.save();
    }
  },

  async ensureStudentInCourse(course: LtiCourse, user: LtiUser): Promise<void> {
    const reloaded = await Course.findById(course.id);
    if (!reloaded) return;
    const hasStudent = reloaded.students?.some((s: any) => String(s) === user.id);
    if (!hasStudent) {
      reloaded.students.push(user.id);
      await reloaded.save();
    }
  },

  // ── Mapping Persistence ────────────────────────────────────────────

  async findCourseMap(params: LtiPlatformContext): Promise<LtiCourseMapping | null> {
    const doc = await LtiCourseMapModel.findOne({
      issuer: params.issuer,
      clientId: params.clientId,
      deploymentId: params.deploymentId,
      contextId: params.contextId,
    });
    if (!doc) return null;
    return { courseId: String(doc.courseId), tenantId: doc.tenantId };
  },

  async upsertCourseMap(params): Promise<LtiCourseMapping> {
    const doc = await LtiCourseMapModel.findOneAndUpdate(
      {
        issuer: params.issuer,
        clientId: params.clientId,
        deploymentId: params.deploymentId,
        contextId: params.contextId,
      },
      {
        issuer: params.issuer,
        clientId: params.clientId,
        deploymentId: params.deploymentId,
        contextId: params.contextId,
        courseId: params.courseId,
        createdBy: params.createdBy,
        ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      },
      { upsert: true, new: true }
    );
    return { courseId: String(doc.courseId), tenantId: doc.tenantId };
  },

  async findResourceBinding(params): Promise<LtiResourceBinding | null> {
    const doc = await LtiResourceLinkBindingModel.findOne({
      issuer: params.issuer,
      clientId: params.clientId,
      deploymentId: params.deploymentId,
      contextId: params.contextId,
      resourceLinkId: params.resourceLinkId,
    });
    if (!doc) return null;
    return {
      courseId: String(doc.courseId),
      resourceId: doc.agentId ? String(doc.agentId) : '',
      categoryId: doc.categoryId ? String(doc.categoryId) : undefined,
      bindingType: (doc.bindingType as LtiBindingType) || 'agent',
      tenantId: doc.tenantId,
    };
  },

  async upsertResourceBinding(params): Promise<LtiResourceBinding> {
    const bindingType = params.bindingType || 'agent';
    const updatePayload: Record<string, unknown> = {
      issuer: params.issuer,
      clientId: params.clientId,
      deploymentId: params.deploymentId,
      contextId: params.contextId,
      resourceLinkId: params.resourceLinkId,
      courseId: params.courseId,
      createdBy: params.createdBy,
      bindingType,
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    };

    if (bindingType === 'category') {
      updatePayload.categoryId = params.categoryId;
      updatePayload.agentId = undefined;
    } else {
      updatePayload.agentId = params.resourceId;
      updatePayload.categoryId = undefined;
    }

    const doc = await LtiResourceLinkBindingModel.findOneAndUpdate(
      {
        issuer: params.issuer,
        clientId: params.clientId,
        deploymentId: params.deploymentId,
        contextId: params.contextId,
        resourceLinkId: params.resourceLinkId,
      },
      { $set: updatePayload },
      { upsert: true, new: true }
    );
    return {
      courseId: String(doc.courseId),
      resourceId: doc.agentId ? String(doc.agentId) : '',
      categoryId: doc.categoryId ? String(doc.categoryId) : undefined,
      bindingType: (doc.bindingType as LtiBindingType) || 'agent',
      tenantId: doc.tenantId,
    };
  },

  // ── Tenant Resolution ──────────────────────────────────────────────

  resolveEffectiveTenant(tenantId?: string): string | undefined {
    return resolveEffectiveTenantId(tenantId);
  },

  async resolveTenantFromBinding(binding: LtiResourceBinding): Promise<string | undefined> {
    if (binding.tenantId) return binding.tenantId;
    if (binding.resourceId) {
      const agent = await Agent.findById(binding.resourceId).select('tenantId').lean();
      if (agent?.tenantId) return agent.tenantId;
    }
    return undefined;
  },

  async grantTeacherTenantAccess(user: LtiUser, tenantId: string): Promise<void> {
    const userDoc = await User.findById(user.id);
    if (!userDoc) return;
    const currentTenants: string[] = userDoc.teacherTenants || [];
    if (!currentTenants.includes(tenantId)) {
      await User.updateOne({ _id: user.id }, { $addToSet: { teacherTenants: tenantId } });
      log('Auto-granted tenant access to teacher', { userId: user.id, tenantId });
    }
  },

  /**
   * Single-tenant apps: omit `getTenantMode` or return undefined.
   * Multi-tenant apps: return 'multi' to enable tenant labels in the UI.
   */
  getTenantMode(): LtiTenantMode | undefined {
    return undefined;
  },

  // ── Optional: Resource Lookup ──────────────────────────────────────

  async getResourceById(resourceId: string): Promise<LtiResource | null> {
    const agent = await Agent.findById(resourceId).select('name').lean();
    if (!agent) return null;
    return { id: String(agent._id), name: agent.name };
  },
};
