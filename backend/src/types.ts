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
 * The integration flow the core runs. Defined here so the package stays
 * self-contained (portable); the app mirrors these literals in `shared/lti.ts`.
 *
 * - `login-only`: launch is treated purely as SSO.
 * - `context-mapping`: plain external-tool launch (no Deep Linking) — the Moodle
 *   course context maps to a platform course; teachers manage groupings in-app
 *   and students self-pick a grouping then a group.
 * - `deep-linking`: teacher binds the activity to a grouping via the LMS content
 *   picker (requires Deep Linking).
 */
export type LtiConnectMode = 'login-only' | 'context-mapping' | 'deep-linking';

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

/** Moodle/LMS course context claims used for on-the-fly course provisioning. */
export interface LtiContextSnapshot {
  contextId: string;
  label?: string;
  title?: string;
  type?: string[];
  lisCourseOfferingSourcedId?: string;
  lisCourseSectionSourcedId?: string;
  /** Course id passed via a custom launch param, if the LMS sends one. */
  customCourseId?: string;
  identifierCandidates: string[];
}

// ─── Normalized Launch (protocol-agnostic) ───────────────────────────────────

/**
 * The LTI version a launch arrived on. `1.0a` and `1.1` share the OAuth 1.0a
 * legacy path; `1.3` is the OIDC/JWT path handled by ltijs.
 */
export type LtiLaunchVersion = '1.3' | '1.1' | '1.0a';

/**
 * A protocol-agnostic view of an LTI launch. Both the 1.3 `onConnect` handler
 * and the legacy 1.0a/1.1 router build one of these and hand it to
 * `handleNormalizedLaunch`, so the launch/SSO + course-mapping logic lives in
 * one place regardless of the wire format.
 */
export interface NormalizedLaunch {
  version: LtiLaunchVersion;
  email: string;
  name: string;
  role: LtiRole;
  externalId?: string;
  /** Platform tuple used to key course maps and resource bindings. */
  platform: LtiPlatformContext;
  resourceLinkId: string;
  /** Custom launch params (LTI custom claim / legacy `custom_*` params). */
  custom: Record<string, string>;
  /** LMS course-context snapshot for auto-mapping / provisioning. */
  contextSnapshot: LtiContextSnapshot;
}

// ─── Grade links (shared by 1.1 Basic Outcomes and 1.3 AGS) ──────────────────

/** A captured LTI 1.1 Basic Outcomes service link for a user + activity. */
export interface LtiOutcomeGradeLink {
  protocol: '1.1';
  /** `lis_outcome_service_url` — where `replaceResult` POX is POSTed. */
  serviceUrl: string;
  /** `lis_result_sourcedid` — opaque per-user-per-activity result handle. */
  sourcedId: string;
  /** The `oauth_consumer_key` the launch was signed with (to resolve secret). */
  consumerKey: string;
}

/** A captured LTI 1.3 AGS endpoint claim for a user + activity. */
export interface LtiAgsGradeLink {
  protocol: '1.3';
  /** AGS `lineitems` collection URL (the container endpoint). */
  lineItems?: string;
  /** AGS `lineitem` URL when the platform bound a single line item. */
  lineItem?: string;
  /** Granted AGS scopes. */
  scopes?: string[];
}

export type LtiGradeLink = LtiOutcomeGradeLink | LtiAgsGradeLink;

/**
 * Persists the grade link captured at launch (1.1 outcome service or 1.3 AGS
 * endpoint), keyed by platform tuple + user, so the host can later push a score
 * via `sendScore()` without the launch still being in flight. The core ships an
 * in-memory default; a durable deployment supplies a DB-backed implementation
 * (see `LtiGradeLinkModel.mongoose.ts`).
 */
export interface LtiGradeLinkStore {
  saveGradeLink(
    params: LtiPlatformContext & {
      resourceLinkId: string;
      userExternalId: string;
      link: LtiGradeLink;
    }
  ): Promise<void>;

  findGradeLink(
    params: LtiPlatformContext & {
      resourceLinkId: string;
      userExternalId: string;
    }
  ): Promise<LtiGradeLink | null>;
}

// ─── LTI 1.0a / 1.1 credential + replay stores ───────────────────────────────

/** A resolved OAuth 1.0a consumer credential (shared key/secret pair). */
export interface LtiConsumer {
  key: string;
  secret: string;
  tenantId?: string;
}

/**
 * Resolves the shared secret for an OAuth 1.0a `oauth_consumer_key`. The core
 * never stores secrets itself; supply a store backed by your DB (see
 * `consumerStore.mongoose.example.ts`). Return `null` for an unknown/disabled
 * key so the launch is rejected.
 */
export interface LtiConsumerStore {
  resolveConsumer(consumerKey: string, tenantId?: string): Promise<LtiConsumer | null>;
}

/** A consumer record as returned to admin UIs — the secret is NEVER included. */
export interface LtiConsumerSummary {
  id: string;
  consumerKey: string;
  label?: string;
  enabled: boolean;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Admin CRUD over OAuth 1.0a consumer credentials, backed by your DB. The
 * secret is write-only: it is accepted on create/update but never returned by
 * `list`/`get`. Wire a router over this with `createLtiConsumerAdminRouter`.
 */
export interface LtiConsumerAdminStore {
  list(tenantId?: string): Promise<LtiConsumerSummary[]>;
  get(id: string): Promise<LtiConsumerSummary | null>;
  create(params: {
    consumerKey: string;
    secret: string;
    label?: string;
    enabled?: boolean;
    tenantId?: string;
  }): Promise<LtiConsumerSummary>;
  update(
    id: string,
    params: { secret?: string; label?: string; enabled?: boolean }
  ): Promise<LtiConsumerSummary | null>;
  remove(id: string): Promise<boolean>;
}

/**
 * OAuth 1.0a nonce replay protection. `seen(nonce, timestamp)` returns `true`
 * if the nonce has already been used within the retention window (i.e. this is
 * a replay and the launch must be rejected); otherwise it records the nonce and
 * returns `false`. The core ships an in-memory TTL default; a distributed
 * deployment supplies a shared (e.g. Redis-backed) implementation.
 */
export interface LtiNonceStore {
  seen(nonce: string, timestampSeconds: number): Promise<boolean>;
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

  /**
   * Optional: create a course stub from LTI context claims when auto-map finds
   * no match. Return the new course (or null when provisioning is declined).
   */
  provisionCourseFromLtiContext?(params: {
    teacher: LtiUser;
    platform: LtiPlatformContext;
    context: LtiContextSnapshot;
  }): Promise<LtiCourse | null>;

  /**
   * Optional: create a selectable resource (e.g. a grouping) during deep-link
   * setup before binding the Moodle activity.
   */
  createSelectableResource?(params: {
    user: LtiUser;
    course: LtiCourse;
    name: string;
    description?: string;
    settings?: Record<string, unknown>;
  }): Promise<LtiResource | null>;

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
  /**
   * The integration flow this deployment runs. Lets the core adapt its launch
   * behaviour to what the LMS supports:
   *
   * - `login-only`: SSO only (equivalent to `skipDeepLinking: true`).
   * - `context-mapping`: plain external-tool launch (no Deep Linking). The
   *   Moodle course context is matched/provisioned to a platform course on the
   *   teacher launch; students resolve from that map and self-pick a grouping.
   * - `deep-linking`: teacher binds the activity to a grouping via Moodle's
   *   content picker (requires LMS Deep Linking).
   *
   * When omitted, the mode is derived from `skipDeepLinking` for backward
   * compatibility (`true` -> `login-only`, `false` -> `deep-linking`).
   */
  connectMode?: LtiConnectMode;
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
  /**
   * Secret used to sign the short-lived "bind token" minted on a context-mapping
   * teacher launch that has no grouping binding yet. The app's bind endpoint
   * verifies the token with the same secret before persisting the binding, so
   * the launch identity (platform tuple + resourceLinkId + courseId) cannot be
   * forged by the client. When omitted, the context-mapping flow skips minting
   * bind tokens (teachers still land on the course, but the in-app bind prompt
   * is unavailable).
   */
  bindTokenSecret?: string;

  // ── LTI 1.0a / 1.1 (legacy) support ────────────────────────────────────

  /**
   * Enable the LTI 1.0a / 1.1 (OAuth 1.0a-signed) launch path alongside the
   * 1.3 path. When `true`, the core mounts the legacy router under
   * `${mountPath}${legacyMountPath}` and a `consumerStore` is required. Falls
   * back to the env var `LTI_LEGACY_ENABLED`. Defaults to `false` so existing
   * 1.3-only deployments are unaffected.
   */
  legacyLti?: boolean;
  /**
   * Subpath (under `mountPath`) for the legacy 1.0a/1.1 router. The launch URL
   * given to the old LMS is `${toolBaseUrl}${mountPath}${legacyMountPath}/launch`.
   * Defaults to `/legacy` (env: `LTI_LEGACY_MOUNT`).
   */
  legacyMountPath?: string;
  /**
   * Resolves the shared secret for an OAuth 1.0a `oauth_consumer_key`. Required
   * when `legacyLti` is enabled — without it the legacy path cannot verify
   * signatures and stays disabled.
   */
  consumerStore?: LtiConsumerStore;
  /**
   * OAuth 1.0a nonce replay store. Defaults to the shipped in-memory TTL store
   * (fine for a single process; supply a shared store for multi-instance
   * deployments).
   */
  nonceStore?: LtiNonceStore;
  /**
   * Stores the grade link (1.1 outcome service or 1.3 AGS endpoint) captured at
   * launch so the host can later call `sendScore()`. Defaults to an in-memory
   * store. Supply a durable implementation to survive restarts.
   */
  gradeLinkStore?: LtiGradeLinkStore;
  /** OAuth 1.0a timestamp acceptance window, in seconds (env: `LTI_LEGACY_TIMESTAMP_WINDOW_S`). */
  legacyTimestampWindowSeconds?: number;
  /** In-memory nonce retention, in ms (env: `LTI_LEGACY_NONCE_TTL_MS`). */
  legacyNonceTtlMs?: number;
  /**
   * Enable LTI 1.1 Content-Item deep linking (teacher picks content; the tool
   * signs a return form back to the LMS). Only meaningful when `legacyLti` is
   * on. Defaults to `false`.
   */
  legacyDeepLinking?: boolean;
  /**
   * Secret used to sign the short-lived launch ticket minted after a valid 1.1
   * launch and exchanged by the SPA at the legacy `/session` endpoint. Defaults
   * to `bindTokenSecret` (env: `LTI_LAUNCH_TICKET_SECRET`).
   */
  launchTicketSecret?: string;

  // ── LTI 1.3 AGS prototype (experimental) ───────────────────────────────

  /**
   * Enable the experimental LTI 1.3 Assignment & Grade Services score-passback
   * prototype, built on ltijs's Grade service. Off by default; the 1.3 path's
   * behaviour is unchanged unless opted in (env: `LTI_AGS_PROTOTYPE`).
   */
  agsPrototype?: boolean;
}
