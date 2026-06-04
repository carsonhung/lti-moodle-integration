/**
 * LTI Adapter — Portable interface for integrating LTI 1.3 with any application.
 *
 * Implement this interface to connect the generic LTI orchestration (core.ts)
 * to your project's data layer (users, courses, resources). The adapter
 * abstracts all project-specific operations so the LTI core never depends
 * on a particular database, ORM, or domain model.
 *
 * See README.md for a full guide and example adapters (Mongoose, Supabase,
 * Drizzle).
 */

// ─── Shared Value Types ──────────────────────────────────────────────────────

export type LtiRole = 'student' | 'teacher';

/**
 * Tenant mode hint passed to the deep-link UI. The LTI core never inspects
 * this — it's purely a passthrough so multi-tenant apps can render tenant
 * labels in the course dropdown. Set to `undefined` for single-tenant apps.
 */
export type LtiTenantMode = 'single' | 'multi';

export interface LtiUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

export interface LtiCourse {
  id: string;
  name: string;
  code?: string;
  courseId?: string;
  semester?: string;
  year?: string;
  section?: string;
  tenantId?: string;
}

export interface LtiResource {
  id: string;
  name: string;
  description?: string;
  source?: 'course' | 'public' | 'other';
  iconUrl?: string;
  thumbnailUrl?: string;
}

export interface LtiCourseMapping {
  courseId: string;
  tenantId?: string;
}

export type LtiBindingType = 'agent' | 'category';

export interface LtiResourceBinding {
  courseId: string;
  resourceId: string;
  categoryId?: string;
  bindingType?: LtiBindingType;
  tenantId?: string;
}

export interface LtiCategory {
  id: string;
  name: string;
  description?: string;
  agentCount: number;
  isCourseStudentAgents: boolean;
  courseId?: string;
  source?: 'course' | 'other';
}

export interface LtiPlatformContext {
  issuer: string;
  clientId: string;
  deploymentId: string;
  contextId: string;
}

// ─── Deep Link Item Types ────────────────────────────────────────────────────

export interface LtiLineItem {
  scoreMaximum: number;
  label?: string;
  tag?: string;
  resourceId?: string;
}

export interface LtiDeepLinkItem {
  type: 'ltiResourceLink' | 'link' | 'file' | 'html' | 'image';
  title: string;
  url?: string;
  text?: string;
  custom?: Record<string, string>;
  lineItem?: LtiLineItem;
  available?: { startDateTime?: string; endDateTime?: string };
  submission?: { endDateTime?: string };
  iframe?: { width?: number; height?: number };
  icon?: { url: string; width?: number; height?: number };
  thumbnail?: { url: string; width?: number; height?: number };
}

// ─── Analytics Types ─────────────────────────────────────────────────────────

export interface LtiStudentUsage {
  name: string;
  email: string;
  topics: number;
  messages: number;
  lastActive?: string;
}

export interface LtiResourceAnalytics {
  totalTopics: number;
  totalMessages: number;
  activeStudents: number;
  totalStudents: number;
  messagesPerStudent: number;
  messagesPerTopic: number;
  students?: LtiStudentUsage[];
}

// ─── ltijs Database Plugin Shape ─────────────────────────────────────────────

/**
 * Structural type for the `ltijs` Database plugin contract. Any object that
 * implements these four async CRUD methods + `setup()` can be passed to
 * `initLti({ dbPlugin })` to back ltijs's internal state (registered
 * platforms, OIDC nonces, JWK keypair, idtoken cache, etc.) in something
 * other than its default MongoDB store.
 *
 * The official community plugin
 * [`ltijs-sequelize`](https://www.npmjs.com/package/ltijs-sequelize) implements
 * this contract over Postgres / MySQL / MariaDB / MSSQL / SQLite via Sequelize.
 *
 * Most projects don't need to inspect this type — pass a plugin instance
 * verbatim and let TypeScript widen.
 */
export interface LtiDatabasePlugin {
  setup(): Promise<unknown> | unknown;
  Get(
    isNew: false,
    collection: string,
    query?: Record<string, unknown>,
  ): Promise<unknown[] | false>;
  Insert(
    isNew: false,
    collection: string,
    item: Record<string, unknown>,
    index?: Record<string, unknown>,
  ): Promise<unknown>;
  Modify(
    isNew: false,
    collection: string,
    query: Record<string, unknown>,
    modification: Record<string, unknown>,
  ): Promise<unknown>;
  Delete(
    isNew: false,
    collection: string,
    query: Record<string, unknown>,
  ): Promise<unknown>;
}

// ─── LTI Adapter Interface ───────────────────────────────────────────────────

/**
 * Minimal adapter shape for projects that only use LTI as a login replacement
 * (e.g. Moodle-as-SSO). The full `LtiAdapter` requires ~25 methods to support
 * Deep Linking, course mapping, resource bindings, and tenant resolution —
 * but if you set `LtiInitOptions.skipDeepLinking = true`, the LTI core will
 * never invoke those methods, and you can ship just this subset.
 *
 * Pass an `LtiLoginOnlyAdapter` to `initLti(app, adapter, { skipDeepLinking: true })`
 * and the core won't register `/deeplink/*` routes or `/launch/manage`. The
 * only methods called are `upsertUser`, `generateJwt`, and
 * `resolveEffectiveTenant` (during the `/session` bridge), plus
 * `customFieldPrefix` for any custom-claim parsing.
 *
 * See `adapters/login-only.example.ts` for a complete working example.
 */
export interface LtiLoginOnlyAdapter {
  readonly customFieldPrefix: string;

  upsertUser(params: {
    email: string;
    name: string;
    role: LtiRole;
    externalId?: string;
  }): Promise<LtiUser>;

  generateJwt(user: LtiUser): { token: string; expiresIn: number };

  /**
   * Single-tenant apps return `undefined`. Multi-tenant apps return the
   * tenant ID that should be embedded in the issued JWT.
   */
  resolveEffectiveTenant(tenantId?: string): string | undefined;
}

export interface LtiAdapter {
  // ── UI Customisation ───────────────────────────────────────────────────

  readonly deepLinkPageTitle: string;
  readonly resourceLabel: string;
  readonly customFieldPrefix: string;

  // ── User Resolution ────────────────────────────────────────────────────

  resolveTeacherByEmail(email: string): Promise<LtiUser | null>;

  resolveOrProvisionTeacher(
    email: string,
    name: string,
    role: LtiRole,
    externalId?: string
  ): Promise<LtiUser | null>;

  upsertUser(params: {
    email: string;
    name: string;
    role: LtiRole;
    externalId?: string;
  }): Promise<LtiUser>;

  generateJwt(user: LtiUser): { token: string; expiresIn: number };

  // ── Course Operations ──────────────────────────────────────────────────

  listCoursesForTeacher(user: LtiUser, tenantId?: string): Promise<LtiCourse[]>;

  getCourseForTeacher(
    user: LtiUser,
    courseId: string,
    tenantId?: string
  ): Promise<LtiCourse | null>;

  getCourseById(courseId: string, tenantId?: string): Promise<LtiCourse | null>;

  suggestCourses(identifiers: string[], limit: number, tenantId?: string): Promise<LtiCourse[]>;

  findCourseByCourseId(courseIdValue: string, tenantId?: string): Promise<LtiCourse | null>;

  findCourseByCourseIdForTeacher(
    user: LtiUser,
    courseIdValue: string,
    tenantId?: string
  ): Promise<LtiCourse | null>;

  // ── Category Operations (optional) ─────────────────────────────────────

  listSelectableCategories?(
    user: LtiUser,
    course: LtiCourse,
    tenantId?: string
  ): Promise<LtiCategory[]>;

  getCategoryById?(categoryId: string, tenantId?: string): Promise<LtiCategory | null>;

  listCategoryAgents?(categoryId: string, tenantId?: string): Promise<LtiResource[]>;

  // ── Resource Operations ────────────────────────────────────────────────

  listSelectableResources(
    user: LtiUser,
    course: LtiCourse,
    opts?: { query?: string; limit?: number }
  ): Promise<LtiResource[]>;

  getSelectableResourceForDeepLinking(
    user: LtiUser,
    course: LtiCourse,
    resourceId: string
  ): Promise<LtiResource | null>;

  // ── Enrollment / Association ────────────────────────────────────────────

  ensureResourceInCourse(course: LtiCourse, resource: LtiResource): Promise<void>;
  ensureTeacherInCourse(course: LtiCourse, user: LtiUser): Promise<void>;
  ensureStudentInCourse(course: LtiCourse, user: LtiUser): Promise<void>;

  // ── Mapping Persistence ────────────────────────────────────────────────

  findCourseMap(params: LtiPlatformContext): Promise<LtiCourseMapping | null>;

  upsertCourseMap(
    params: LtiPlatformContext & {
      courseId: string;
      createdBy: string;
      tenantId?: string;
    }
  ): Promise<LtiCourseMapping>;

  findResourceBinding(
    params: LtiPlatformContext & { resourceLinkId: string }
  ): Promise<LtiResourceBinding | null>;

  upsertResourceBinding(
    params: LtiPlatformContext & {
      resourceLinkId: string;
      courseId: string;
      resourceId: string;
      createdBy: string;
      tenantId?: string;
      categoryId?: string;
      bindingType?: LtiBindingType;
    }
  ): Promise<LtiResourceBinding>;

  // ── Tenant Resolution (return undefined for single-tenant apps) ────────

  resolveEffectiveTenant(tenantId?: string): string | undefined;
  resolveTenantFromBinding(binding: LtiResourceBinding): Promise<string | undefined>;
  grantTeacherTenantAccess(user: LtiUser, tenantId: string): Promise<void>;

  /**
   * Optional: report the tenant mode to the deep-link UI so it can render
   * tenant labels alongside courses. Return `undefined` (or omit the method)
   * for single-tenant apps.
   */
  getTenantMode?(): LtiTenantMode | undefined;

  // ── Optional: Resource Lookup ───────────────────────────────────────

  getResourceById?(resourceId: string): Promise<LtiResource | null>;

  // ── Optional: Deep Link Item Enrichment ────────────────────────────────

  buildDeepLinkItems?(
    course: LtiCourse,
    resource: LtiResource,
    launchUrl: string
  ): LtiDeepLinkItem[];

  // ── Optional: Grade Passback ───────────────────────────────────────────

  getStudentScore?(
    userId: string,
    courseId: string,
    resourceId: string
  ): Promise<{ scoreGiven: number; scoreMaximum: number; comment?: string } | null>;

  // ── Optional: Teacher Analytics ────────────────────────────────────────

  getResourceAnalytics?(courseId: string, resourceId: string): Promise<LtiResourceAnalytics | null>;
}

// ─── Init Options ────────────────────────────────────────────────────────────

export interface LtiInitOptions {
  mountPath?: string;
  appRoute?: string;
  loginRoute?: string;
  keysetRoute?: string;
  encryptionKey?: string;
  /**
   * MongoDB connection URL. Used when no `dbPlugin` is supplied — falls
   * through to the env var `LTI_DB_URL` (or legacy `MONGO_URI`).
   */
  dbUrl?: string;
  /**
   * Custom Database plugin instance for backing ltijs's internal state in
   * something other than MongoDB. Set this OR `dbUrl` — if both are supplied
   * `dbPlugin` wins. The most common choice for SQL-based stacks is the
   * official [`ltijs-sequelize`](https://www.npmjs.com/package/ltijs-sequelize)
   * plugin (Postgres / MySQL / MariaDB / MSSQL / SQLite).
   *
   * Typed as `LtiDatabasePlugin | unknown` so plugin packages with looser
   * type definitions still compile cleanly when passed in verbatim.
   */
  dbPlugin?: LtiDatabasePlugin | unknown;
  /**
   * Disable Deep Linking entirely. When `true`, the core skips registering
   * `/deeplink/*`, `/launch/manage`, `/category/*` routes and never invokes
   * adapter methods related to courses, resources, categories, bindings, or
   * tenant grants. Use this when LTI is configured as a login replacement
   * only (no teacher activity picker). Lets you ship an `LtiLoginOnlyAdapter`
   * instead of the full `LtiAdapter`.
   *
   * Defaults to `false` so existing integrations are unaffected.
   */
  skipDeepLinking?: boolean;
  devMode?: boolean;
  ltiaas?: boolean;
  tokenMaxAge?: number | false;
  cookiesSecure?: boolean;
  cookiesSameSite?: string;
  /**
   * Where students are redirected after a successful launch.
   * - `app`: redirect to `/lti/launch?agentId=...&lti=1&embedded=1` in the frontend (full SPA shell).
   * - `embed`: redirect to `/embed/:resourceId` for a stripped-down iframe widget.
   */
  launchDestination?: 'embed' | 'app';
  /**
   * Optional override for the teacher post-launch redirect. Supports placeholders
   * `{courseId}` and `{resourceId}` (URL-encoded by the core). When omitted,
   * teachers are sent to the built-in `/launch/manage` page.
   */
  teacherLaunchUrl?: string;
  autoMapCourse?: boolean;
  autoEnrollStudents?: boolean;
  toolBaseUrl?: string;
  frontendBaseUrl?: string;
  /**
   * Path on the frontend that the LTI core should redirect launches to when
   * `skipDeepLinking` is `true`. The query string `?ltik=...` is appended so
   * the SPA can exchange the LTI token for an app JWT via `/session`.
   *
   * Defaults to `/lti/launch`.
   */
  loginOnlyLaunchPath?: string;
}
