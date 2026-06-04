/**
 * LTI Core — Generic ltijs orchestration layer.
 *
 * Handles ltijs setup, OIDC login, normal launches (onConnect),
 * deep linking (onDeepLinking), session bridging, and platform registration.
 *
 * All project-specific operations (user resolution, course/resource queries,
 * mapping persistence, JWT generation) are delegated to the LtiAdapter.
 */

import express from 'express';
import type {
  LtiAdapter,
  LtiLoginOnlyAdapter,
  LtiInitOptions,
  LtiDeepLinkItem,
  LtiCourse,
  LtiBindingType,
  LtiTenantMode,
} from './types';
import {
  truthy,
  parseTokenMaxAgeSeconds,
  safeStr,
  getIssuerFromLtiToken,
  getClientIdFromLtiToken,
  getDeploymentIdFromLtiToken,
  getEmailFromLtiToken,
  getNameFromLtiToken,
  getContextId,
  getResourceLinkId,
  getCustom,
  getToolBaseUrl,
  getFrontendBaseUrl,
  inferRoleFromLti,
  getExternalIdFromLti,
  guessLmsCourseIdentifiers,
} from './helpers';
import { renderDeepLinkLauncher, renderTeacherManagePage } from './deepLinkingUI';

// ltijs is CommonJS-first; keep it simple and typed as any.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lti: any = require('ltijs').Provider;

// ─── Logger (graceful fallback to console) ───────────────────────────────────

type Logger = {
  info: (...a: any[]) => void;
  warn: (...a: any[]) => void;
  error: (...a: any[]) => void;
};

let logger: Logger = { info: console.log, warn: console.warn, error: console.error };

/**
 * Inject a project-specific logger before calling initLti. The core wraps
 * structured metadata into a single string before forwarding so any logger
 * that accepts plain strings will work.
 */
export function setLtiLogger(custom: Logger): void {
  logger = custom;
}

function formatLogMeta(msg: string, meta?: any): string {
  if (!meta || (typeof meta === 'object' && Object.keys(meta).length === 0)) {
    return msg;
  }
  try {
    return `${msg} ${JSON.stringify(meta)}`;
  } catch {
    return `${msg} {"meta":"[unserializable]"}`;
  }
}

function logInfo(msg: string, meta?: any) {
  logger.info(formatLogMeta(msg, meta));
}
function logWarn(msg: string, meta?: any) {
  logger.warn(formatLogMeta(msg, meta));
}
function logError(msg: string, meta?: any) {
  logger.error(formatLogMeta(msg, meta));
}

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host || '(unknown)';
  } catch {
    return '(invalid-url)';
  }
}

/**
 * JSON.stringify that tolerates circular references (ltijs tokens can hold
 * back-references). Used only by the claims dump below.
 */
function safeStringify(value: any): string {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (_k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      },
      2
    );
  } catch {
    return '[unserializable]';
  }
}

/**
 * Log the full set of claims/items a platform (Moodle) sends in an LTI 1.3
 * launch. ltijs normalises the raw id_token into `token` (userInfo + platform-
 * Context) — we surface both a structured breakdown of the well-known claims
 * and, gated behind `LTI_DEBUG_CLAIMS=true`, the complete raw token JSON.
 *
 * `phase` identifies the call site (e.g. 'onConnect', '/session') so multiple
 * dumps in a single launch stay distinguishable in the log stream.
 */
function logLtiClaims(phase: string, token: any, res?: express.Response): void {
  const pc = token?.platformContext ?? {};
  const userInfo = token?.userInfo ?? {};
  const context = pc?.context ?? {};
  const lis = pc?.lis ?? {};
  const custom = res ? getCustom(res) : (pc?.custom ?? {});

  // The LTI 1.3 `context` claim is the course/section that launched the tool.
  // Moodle populates `id` (internal course id), `label` (short/course code),
  // `title` (full course name) and `type` (e.g. CourseOffering). We also pull
  // the LIS sourcedids and any course-flavoured custom params, plus the fuzzy
  // candidate identifiers the deep-link auto-mapper would try.
  const course = {
    contextId: safeStr(context?.id) || '(none)',
    label: safeStr(context?.label) || '(none)',
    title: safeStr(context?.title) || '(none)',
    type: context?.type ?? '(none)',
    lisCourseSectionSourcedId: safeStr(lis?.course_section_sourcedid) || '(none)',
    lisCourseOfferingSourcedId: safeStr(lis?.course_offering_sourcedid) || '(none)',
    customCourseId:
      safeStr(custom?.course_id || custom?.moodle_course_id || custom?.context_id || custom?.contextId) ||
      '(none)',
    candidateIdentifiers: res ? guessLmsCourseIdentifiers(res) : [],
  };

  logInfo(`[LTI] ${phase} — Moodle course / context`, course);

  logInfo(`[LTI] ${phase} — Moodle launch claims (structured)`, {
    issuer: getIssuerFromLtiToken(token) || '(none)',
    clientId: getClientIdFromLtiToken(token) || '(none)',
    deploymentId: getDeploymentIdFromLtiToken(token) || '(none)',
    user: {
      sub: safeStr(userInfo.sub || token?.user || pc?.user) || '(none)',
      name: getNameFromLtiToken(token) || '(none)',
      givenName: safeStr(userInfo.given_name) || '(none)',
      familyName: safeStr(userInfo.family_name) || '(none)',
      email: getEmailFromLtiToken(token) || '(none)',
    },
    inferredRole: res ? inferRoleFromLti(res) : '(no res)',
    rawRolesClaim: pc?.roles ?? token?.['https://purl.imsglobal.org/spec/lti/claim/roles'] ?? '(none)',
    context,
    resourceLink: pc?.resource ?? '(none)',
    launchPresentation: pc?.launchPresentation ?? pc?.presentation ?? '(none)',
    lis,
    custom,
    externalId: res ? (getExternalIdFromLti(res) || '(none)') : '(no res)',
    userInfoKeys: Object.keys(userInfo),
    platformContextKeys: Object.keys(pc),
    tokenTopLevelKeys: Object.keys(token ?? {}),
  });

  if (truthy(process.env.LTI_DEBUG_CLAIMS)) {
    logInfo(`[LTI] ${phase} — Moodle launch claims (raw token JSON, LTI_DEBUG_CLAIMS=true)`);
    logInfo(safeStringify(token));
  }
}

function setNoStoreHeaders(res: express.Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

// Expose the underlying ltijs Provider so adminRouter.ts (and project code)
// can call lti.registerPlatform / lti.getAllPlatforms / etc.
export function getLtiProvider(): any {
  return lti;
}

// ─── initLti ─────────────────────────────────────────────────────────────────

export async function initLti(
  app: express.Express,
  adapter: LtiAdapter | LtiLoginOnlyAdapter,
  options?: LtiInitOptions
): Promise<void> {
  const opts = options ?? {};

  if (!truthy(process.env.LTI_ENABLED)) {
    logInfo('[LTI] Disabled (set LTI_ENABLED=true to enable)');
    return;
  }

  // Login-only mode: skip deep-link route registration entirely and treat
  // the adapter as the minimal LtiLoginOnlyAdapter shape. The full LtiAdapter
  // shape is also acceptable (every login-only method is a subset).
  const skipDeepLinking =
    opts.skipDeepLinking ?? truthy(process.env.LTI_SKIP_DEEP_LINKING);
  const fullAdapter = adapter as LtiAdapter;
  const loginAdapter = adapter as LtiLoginOnlyAdapter;

  const encryptionKey = opts.encryptionKey || String(process.env.LTI_ENCRYPTION_KEY ?? '').trim();
  if (!encryptionKey) {
    logWarn('[LTI] Missing LTI_ENCRYPTION_KEY; LTI will not start');
    return;
  }

  const dbUrl =
    opts.dbUrl ||
    String(process.env.LTI_DB_URL ?? '').trim() ||
    String(process.env.MONGO_URI ?? '').trim();
  if (!dbUrl && !opts.dbPlugin) {
    logWarn('[LTI] Missing LTI_DB_URL (or MONGO_URI); LTI will not start');
    return;
  }

  const mountPath = opts.mountPath || String(process.env.LTI_MOUNT_PATH ?? '/lti').trim() || '/lti';
  const appRoute =
    opts.appRoute || String(process.env.LTI_APP_ROUTE ?? '/launch').trim() || '/launch';
  const loginRoute =
    opts.loginRoute || String(process.env.LTI_LOGIN_ROUTE ?? '/login').trim() || '/login';
  const keysetRoute =
    opts.keysetRoute || String(process.env.LTI_KEYSET_ROUTE ?? '/keys').trim() || '/keys';

  const devMode =
    opts.devMode ?? (truthy(process.env.LTI_DEV_MODE) || process.env.NODE_ENV !== 'production');
  const ltiaas = opts.ltiaas ?? truthy(process.env.LTI_LTIAAS_MODE);
  const tokenMaxAge =
    opts.tokenMaxAge !== undefined
      ? opts.tokenMaxAge
      : (parseTokenMaxAgeSeconds(process.env.LTI_TOKEN_MAX_AGE_SECONDS) ?? 60);
  const cookiesSecure =
    opts.cookiesSecure ??
    (truthy(process.env.LTI_COOKIES_SECURE) || (process.env.NODE_ENV === 'production' && !devMode));
  const cookiesSameSite =
    opts.cookiesSameSite || String(process.env.LTI_COOKIES_SAMESITE ?? '').trim() || 'None';

  const launchDestination =
    opts.launchDestination ||
    (String(process.env.LTI_LAUNCH_DESTINATION ?? 'app')
      .trim()
      .toLowerCase() as 'embed' | 'app');
  const autoMapCourse =
    opts.autoMapCourse ??
    String(process.env.LTI_AUTO_MAP_COURSE ?? 'true')
      .trim()
      .toLowerCase() === 'true';
  const autoEnrollStudents =
    opts.autoEnrollStudents ?? truthy(process.env.LTI_AUTO_ENROLL_STUDENTS);

  const prefix = adapter.customFieldPrefix;
  const launchRedirectPath = (opts.loginOnlyLaunchPath ?? '/lti/launch').trim() || '/lti/launch';

  // ── ltijs setup ──────────────────────────────────────────────────────

  const dbConfig = opts.dbPlugin ? { plugin: opts.dbPlugin } : { url: dbUrl };

  lti.setup(encryptionKey, dbConfig, {
    appRoute,
    loginRoute,
    keysetRoute,
    tokenMaxAge,
    cookies: { secure: cookiesSecure, sameSite: cookiesSameSite },
    devMode,
    ltiaas,
  });

  // ── onConnect — Normal launches ────────────────────────────────────

  lti.onConnect(async (token: any, req: express.Request, res: express.Response) => {
    try {
      // Dump everything Moodle sent in this launch (structured + optional raw).
      logLtiClaims('onConnect', token, res);

      const email = getEmailFromLtiToken(token);
      const ltiRole = inferRoleFromLti(res);
      const frontend = getFrontendBaseUrl(req, opts.frontendBaseUrl);

      // Login-only mode: skip every resource / binding lookup and bounce the
      // user straight to the SPA bridge. The frontend then calls /session to
      // swap the ltik for an app JWT (the only LTI claim consumed in this
      // mode is the user identity).
      if (skipDeepLinking) {
        const qs = new URLSearchParams();
        qs.set('lti', '1');
        const target = `${frontend}${launchRedirectPath}?${qs.toString()}`;
        logInfo('[LTI] onConnect — login-only redirect', {
          email,
          role: ltiRole,
          target,
        });
        return lti.redirect(res, target, { newResource: true });
      }

      const custom = getCustom(res);
      const courseIdFromCustom = safeStr(custom?.[`${prefix}_course_id`] || custom?.courseId);
      const resourceIdFromCustom = safeStr(
        custom?.[`${prefix}_resource_id`] || custom?.[`${prefix}_agent_id`] || custom?.agentId
      );

      const issuer = getIssuerFromLtiToken(token);
      const clientId = getClientIdFromLtiToken(token);
      const deploymentId = getDeploymentIdFromLtiToken(token);
      const contextId = getContextId(res);
      const resourceLinkId = getResourceLinkId(res);

      logInfo('[LTI] onConnect — launch received', {
        email,
        role: ltiRole,
        issuer,
        clientId,
        deploymentId,
        contextId,
        resourceLinkId,
        courseIdFromCustom: courseIdFromCustom || '(none)',
        resourceIdFromCustom: resourceIdFromCustom || '(none)',
        customKeys: Object.keys(custom),
      });

      const binding = await fullAdapter.findResourceBinding({
        issuer,
        clientId,
        deploymentId,
        contextId,
        resourceLinkId,
      });
      const resolvedResourceId = binding?.resourceId || resourceIdFromCustom;
      const resolvedCourseId = binding?.courseId || courseIdFromCustom;

      logInfo('[LTI] onConnect — resolution', {
        bindingFound: !!binding,
        bindingResourceId: binding?.resourceId || '(none)',
        bindingCourseId: binding?.courseId || '(none)',
        resolvedResourceId: resolvedResourceId || '(none)',
        resolvedCourseId: resolvedCourseId || '(none)',
        resolvedFrom: binding?.resourceId ? 'binding' : resourceIdFromCustom ? 'custom' : 'none',
      });

      // `frontend` is already computed above (top of onConnect); reuse it
      // instead of re-declaring — the binding-resolution block above doesn't
      // mutate req/opts, so the value is identical.

      if (ltiRole === 'teacher') {
        if (opts.teacherLaunchUrl && resolvedResourceId && resolvedCourseId) {
          const teacherUrl = opts.teacherLaunchUrl
            .replace('{courseId}', encodeURIComponent(resolvedCourseId))
            .replace('{resourceId}', encodeURIComponent(resolvedResourceId));
          logInfo('[LTI] onConnect — teacher redirect to teacherLaunchUrl', {
            email,
            teacherUrl,
          });
          return lti.redirect(res, teacherUrl, { newResource: true });
        }
        logInfo('[LTI] onConnect — teacher redirect to management page', {
          email,
          configured: !!(resolvedResourceId && resolvedCourseId),
        });
        return lti.redirect(res, `${mountPath}/launch/manage`, { newResource: true });
      }

      if (binding?.bindingType === 'category' && binding?.categoryId) {
        const qs = new URLSearchParams();
        qs.set('categoryId', binding.categoryId);
        qs.set('lti', '1');
        qs.set('embedded', '1');
        if (resolvedCourseId) qs.set('courseId', resolvedCourseId);
        const target = `${frontend}/lti/launch?${qs.toString()}`;
        logInfo('[LTI] onConnect — category binding redirect', {
          email,
          target,
          categoryId: binding.categoryId,
          courseId: resolvedCourseId,
        });
        return lti.redirect(res, target, { newResource: true });
      }

      if (!resolvedResourceId) {
        logWarn('[LTI] onConnect — no resource resolved, showing "not configured"', {
          email,
          role: ltiRole,
          contextId,
          resourceLinkId,
        });
        return res
          .status(200)
          .send(
            '<div style="font-family:system-ui;padding:24px;">This activity is not configured yet. Ask your teacher to set it up (Deep Linking).</div>'
          );
      }

      const target =
        launchDestination === 'app'
          ? (() => {
              const qs = new URLSearchParams();
              qs.set('agentId', resolvedResourceId);
              qs.set('lti', '1');
              qs.set('embedded', '1');
              if (ltiRole === 'student') qs.set('lock', '1');
              return `${frontend}/lti/launch?${qs.toString()}`;
            })()
          : `${frontend}/embed/${encodeURIComponent(resolvedResourceId)}`;

      logInfo('[LTI] onConnect — student redirect', {
        email,
        target,
        resourceId: resolvedResourceId,
        courseId: resolvedCourseId,
      });
      return lti.redirect(res, target, { newResource: true });
    } catch (e: any) {
      logError('[LTI] onConnect failed', { message: e?.message, stack: e?.stack });
      return res
        .status(200)
        .send(
          '<div style="font-family:system-ui;padding:24px;">LTI launch error. Please try again later.</div>'
        );
    }
  });

  // ── Session bridge — Exchange ltik for app JWT ─────────────────────

  lti.app.get('/session', async (req: express.Request, res: express.Response) => {
    try {
      const token = res.locals?.token;
      if (!token) {
        logWarn('[LTI] /session — missing LTI token');
        return res.status(401).json({ success: false, message: 'Missing LTI token' });
      }

      // Dump everything Moodle sent for this session bridge (structured + optional raw).
      logLtiClaims('/session', token, res);

      const email = getEmailFromLtiToken(token);
      if (!email) {
        logWarn('[LTI] /session — no email in LTI token', {
          hasUserInfo: !!token?.userInfo,
        });
        return res.status(400).json({
          success: false,
          message:
            'LTI launch did not include an email. Configure the LMS to send user email in LTI 1.3 launches.',
        });
      }

      const role = inferRoleFromLti(res);
      const name = getNameFromLtiToken(token) || email;
      const externalId = getExternalIdFromLti(res);

      logInfo('[LTI] /session — bridge request', {
        email,
        role,
        name,
        externalId: externalId || '(none)',
      });

      const user = await loginAdapter.upsertUser({ email, name, role, externalId });

      if (!skipDeepLinking && autoEnrollStudents && role === 'student') {
        const custom = getCustom(res);
        const issuer = getIssuerFromLtiToken(token);
        const clientId = getClientIdFromLtiToken(token);
        const deploymentId = getDeploymentIdFromLtiToken(token);
        const contextId = getContextId(res);
        const resourceLinkId = getResourceLinkId(res);

        let courseId = safeStr(
          custom?.[`${prefix}_course_id`] || custom?.courseId
        ).trim();
        let courseIdSource: string = courseId ? 'custom' : 'none';

        if (!courseId && issuer && clientId && deploymentId && contextId) {
          const mapped = await fullAdapter.findCourseMap({
            issuer,
            clientId,
            deploymentId,
            contextId,
          });
          if (mapped) {
            courseId = mapped.courseId;
            courseIdSource = 'courseMap';
          }
        }
        if (!courseId && issuer && clientId && deploymentId && contextId && resourceLinkId) {
          const binding = await fullAdapter.findResourceBinding({
            issuer,
            clientId,
            deploymentId,
            contextId,
            resourceLinkId,
          });
          if (binding) {
            courseId = binding.courseId;
            courseIdSource = 'binding';
          }
        }

        if (!courseId) {
          logWarn('[LTI] Auto-enroll enabled but no course mapping found for learner launch', {
            issuer,
            clientId,
            deploymentId,
            contextId,
            resourceLinkId,
          });
        } else {
          try {
            const course = await fullAdapter.getCourseById(courseId);
            if (!course) {
              logWarn('[LTI] Auto-enroll: course not found', { courseId, courseIdSource });
            } else {
              await fullAdapter.ensureStudentInCourse(course, user);
              logInfo('[LTI] Auto-enrolled learner into course', {
                userId: user.id,
                courseId,
                courseIdSource,
              });
            }
          } catch (e: any) {
            logWarn('[LTI] Auto-enroll failed (continuing)', {
              courseId,
              courseIdSource,
              message: e?.message,
            });
          }
        }
      }

      let tenant: string | undefined;
      let tenantSource: 'binding' | 'agent-backfill' | 'default' | 'none' = 'none';

      if (!skipDeepLinking) {
        const issuer = getIssuerFromLtiToken(token);
        const clientId = getClientIdFromLtiToken(token);
        const deploymentId = getDeploymentIdFromLtiToken(token);
        const contextId = getContextId(res);
        const resourceLinkId = getResourceLinkId(res);

        if (issuer && clientId && deploymentId && contextId && resourceLinkId) {
          const binding = await fullAdapter.findResourceBinding({
            issuer,
            clientId,
            deploymentId,
            contextId,
            resourceLinkId,
          });

          if (binding?.tenantId) {
            tenant = binding.tenantId;
            tenantSource = 'binding';
          } else if (binding) {
            const resolved = await fullAdapter.resolveTenantFromBinding(binding);
            if (resolved) {
              tenant = resolved;
              tenantSource = 'agent-backfill';
            }
          }
        }
      }

      if (!tenant) {
        const fallback = loginAdapter.resolveEffectiveTenant();
        if (fallback) {
          tenant = fallback;
          tenantSource = 'default';
        }
      }

      logInfo('[LTI] Session tenant resolved', {
        tenantId: tenant || '(none)',
        tenantSource,
        userId: user.id,
        email,
        role,
      });

      if (
        !skipDeepLinking &&
        tenant &&
        (tenantSource === 'binding' || tenantSource === 'agent-backfill') &&
        role === 'teacher' &&
        user.roles?.includes('teacher')
      ) {
        await fullAdapter.grantTeacherTenantAccess(user, tenant);
      }

      const jwt = loginAdapter.generateJwt(user);

      return res.status(200).json({
        success: true,
        token: jwt.token,
        expiresIn: jwt.expiresIn,
        role,
        tenant,
      });
    } catch (e: any) {
      logError('[LTI] /session failed', { message: e?.message, stack: e?.stack });
      return res.status(500).json({ success: false, message: 'LTI session bridge failed' });
    }
  });

  // ── Deep-linking surfaces (skipped entirely in login-only mode) ────

  if (!skipDeepLinking) {
    // Shadow the outer `adapter` (LtiAdapter | LtiLoginOnlyAdapter) with the
    // narrowed full-adapter type so the existing deep-link handlers below
    // type-check against the full method set without per-call casts.
    const adapter: LtiAdapter = fullAdapter;

  // ── onDeepLinking — Teacher configuring the activity ───────────────

  lti.onDeepLinking(async (token: any, req: express.Request, res: express.Response) => {
    try {
      const email = getEmailFromLtiToken(token);
      const role = inferRoleFromLti(res);
      const contextId = getContextId(res);
      const deepLinkSettings =
        token?.platformContext?.deepLinkingSettings ??
        res.locals?.token?.platformContext?.deepLinkingSettings;
      logInfo('[LTI] onDeepLinking — teacher configuring activity', {
        email,
        role,
        contextId,
        hasDeepLinkSettings: !!deepLinkSettings,
        hasReturnUrl: !!deepLinkSettings?.deep_link_return_url,
        redirectTo: `${mountPath}/deeplink?debug=1`,
      });
      // Do NOT use { newResource: true } — it creates a fresh context that
      // strips deepLinkingSettings, breaking the JWT creation on submit.
      return lti.redirect(res, `${mountPath}/deeplink?debug=1`);
    } catch (e: any) {
      logError('[LTI] onDeepLinking failed', { message: e?.message, stack: e?.stack });
      return res
        .status(200)
        .send(
          '<div style="font-family:system-ui;padding:24px;">LTI deep linking error. Please try again later.</div>'
        );
    }
  });

  // ── Deep link launcher (shown in the Moodle iframe) ────────────────

  lti.app.get('/deeplink/launcher', async (req: express.Request, res: express.Response) => {
    setNoStoreHeaders(res);
    const ltik = String(req.query?.ltik ?? '').trim();
    const deepLinkUrl = `${mountPath}/deeplink/popup?ltik=${encodeURIComponent(ltik)}`;
    const submitUrl = `${mountPath}/deeplink/submit?ltik=${encodeURIComponent(ltik)}`;
    logInfo('[LTI] /deeplink/launcher — rendering launcher page', {
      hasLtik: !!ltik,
      deepLinkUrl,
      submitUrl,
    });
    return res.status(200).send(
      renderDeepLinkLauncher({
        title: adapter.deepLinkPageTitle,
        deepLinkUrl,
        submitUrl,
      })
    );
  });

  // ── Deep link selection data ───────────────────────────────────────

  interface DeepLinkSelectionData {
    title: string;
    resourceLabel: string;
    email?: string;
    tenantMode?: LtiTenantMode;
    courses: Array<{
      _id: string;
      course_id?: string;
      name: string;
      code: string;
      semester: string;
      year: string;
      section?: string;
      tenantId?: string;
    }>;
    suggestedCourses?: Array<{
      _id: string;
      course_id?: string;
      name: string;
      code: string;
      semester: string;
      year: string;
      section?: string;
      tenantId?: string;
    }>;
    preselectedCourseId?: string;
    error?: string;
  }

  const gatherDeepLinkData = async (
    req: express.Request,
    res: express.Response
  ): Promise<DeepLinkSelectionData> => {
    const token = res.locals?.token;
    const email = getEmailFromLtiToken(token);
    const role = inferRoleFromLti(res);
    const name = getNameFromLtiToken(token) || email;
    const externalId = getExternalIdFromLti(res);

    logInfo('[LTI] deeplink selection — loading', {
      email,
      role,
      name,
      externalId: externalId || '(none)',
    });

    const teacher = await adapter.resolveOrProvisionTeacher(email, name, role, externalId);

    if (!teacher) {
      logWarn('[LTI] deeplink selection — teacher not resolved', {
        email,
        role,
        reason: email ? 'not authorized' : 'missing email',
      });
      return {
        title: adapter.deepLinkPageTitle,
        resourceLabel: adapter.resourceLabel,
        email,
        courses: [],
        error: email
          ? 'Not authorized to configure this activity. (LMS role must be Instructor; teacher/admin account required.)'
          : 'Missing email in LTI launch; cannot map to an account.',
      };
    }

    logInfo('[LTI] deeplink selection — teacher resolved', {
      teacherId: teacher.id,
      email,
      isAdmin: teacher.roles?.includes('admin'),
    });

    const isAdminUser = teacher.roles?.includes('admin');
    const issuer = getIssuerFromLtiToken(token);
    const clientId = getClientIdFromLtiToken(token);
    const deploymentId = getDeploymentIdFromLtiToken(token);
    const contextId = getContextId(res);

    const existingMap = await adapter.findCourseMap({ issuer, clientId, deploymentId, contextId });

    if (!existingMap && autoMapCourse) {
      const candidates = guessLmsCourseIdentifiers(res);
      let matched = false;
      for (const candidate of candidates) {
        const found =
          (await adapter.findCourseByCourseIdForTeacher(teacher, candidate)) ||
          (await adapter.findCourseByCourseId(candidate));
        if (found) {
          matched = true;
          if (!isAdminUser) {
            try {
              await adapter.ensureTeacherInCourse(found, teacher);
            } catch (e: any) {
              logWarn('[LTI] Failed to auto-attach teacher to course (continuing)', {
                userId: teacher.id,
                courseId: found.id,
                message: e?.message,
              });
            }
          }
          const courseTenant = found.tenantId || adapter.resolveEffectiveTenant();
          await adapter.upsertCourseMap({
            issuer,
            clientId,
            deploymentId,
            contextId,
            courseId: found.id,
            createdBy: teacher.id,
            ...(courseTenant ? { tenantId: courseTenant } : {}),
          });
          break;
        }
      }
      if (!matched) {
        logWarn(
          `[LTI] Course auto-map: no course matched LMS identifiers (contextId=${contextId}, candidates=${JSON.stringify(candidates.slice(0, 12))})`
        );
      }
    }

    const finalMap = await adapter.findCourseMap({ issuer, clientId, deploymentId, contextId });

    if (finalMap && !isAdminUser) {
      try {
        const mappedCourse = await adapter.getCourseById(finalMap.courseId);
        if (mappedCourse) {
          await adapter.ensureTeacherInCourse(mappedCourse, teacher);
        }
      } catch (e: any) {
        logWarn('[LTI] Failed to auto-attach teacher to mapped course (continuing)', {
          userId: teacher.id,
          courseId: finalMap?.courseId,
          message: e?.message,
        });
      }
    }

    const courses = await adapter.listCoursesForTeacher(teacher);

    const suggestedCoursesRaw = finalMap
      ? []
      : await adapter.suggestCourses(guessLmsCourseIdentifiers(res), 8);
    const suggestedCourseIds = new Set(suggestedCoursesRaw.map((c) => c.id));

    const requestedCourseId = String(req.query.courseId ?? '').trim();
    const requestedCourseOk =
      !!requestedCourseId &&
      (courses.some((c) => c.id === requestedCourseId) ||
        suggestedCourseIds.has(requestedCourseId));

    const mapCourse = (c: LtiCourse) => ({
      _id: c.id,
      course_id: c.courseId,
      name: c.name,
      code: c.code || '',
      semester: c.semester || '',
      year: c.year || '',
      section: c.section,
      tenantId: c.tenantId,
    });

    logInfo('[LTI] deeplink selection — data gathered', {
      teacherId: teacher.id,
      courseCount: courses.length,
      suggestedCount: suggestedCoursesRaw.length,
      preselectedCourseId: requestedCourseOk ? requestedCourseId : finalMap?.courseId || '(none)',
    });

    const tenantMode = adapter.getTenantMode ? adapter.getTenantMode() : undefined;

    return {
      title: adapter.deepLinkPageTitle,
      resourceLabel: adapter.resourceLabel,
      email,
      tenantMode,
      courses: courses.map(mapCourse),
      suggestedCourses: suggestedCoursesRaw.length ? suggestedCoursesRaw.map(mapCourse) : undefined,
      preselectedCourseId: requestedCourseOk
        ? requestedCourseId
        : finalMap
          ? finalMap.courseId
          : undefined,
    };
  };

  lti.app.get('/deeplink/data', async (req: express.Request, res: express.Response) => {
    setNoStoreHeaders(res);
    try {
      const data = await gatherDeepLinkData(req, res);
      return res.json({ success: true, data });
    } catch (e: any) {
      logError('[LTI] /deeplink/data failed', { message: e?.message, stack: e?.stack });
      return res.status(500).json({ success: false, error: 'Failed to load deep link data.' });
    }
  });

  // Redirect to the Vue frontend for deep link selection.
  // The frontend uses HTML5 history mode, so the path is /lti/deeplink (no #/ prefix).
  // Query params are appended manually to avoid URL() placing them before a hash fragment.
  lti.app.get('/deeplink', async (req: express.Request, res: express.Response) => {
    setNoStoreHeaders(res);
    const ltik = String(req.query?.ltik ?? '').trim();
    const frontend = getFrontendBaseUrl(req, opts.frontendBaseUrl);
    const createdAgentId = String(req.query?.createdAgentId ?? '').trim();
    const qs = new URLSearchParams();
    if (ltik) qs.set('ltik', ltik);
    if (createdAgentId) qs.set('createdAgentId', createdAgentId);
    const qsStr = qs.toString();
    const vueUrl = `${frontend}/lti/deeplink${qsStr ? `?${qsStr}` : ''}`;
    return res.redirect(vueUrl);
  });

  lti.app.get('/deeplink/popup', async (req: express.Request, res: express.Response) => {
    setNoStoreHeaders(res);
    const ltik = String(req.query?.ltik ?? '').trim();
    const frontend = getFrontendBaseUrl(req, opts.frontendBaseUrl);
    const qs = new URLSearchParams();
    if (ltik) qs.set('ltik', ltik);
    qs.set('popup', '1');
    const vueUrl = `${frontend}/lti/deeplink?${qs.toString()}`;
    return res.redirect(vueUrl);
  });

  lti.app.post(
    '/deeplink/diag',
    express.json({ limit: '64kb' }),
    async (req: express.Request, res: express.Response) => {
      const token = res.locals?.token;
      const email = getEmailFromLtiToken(token);
      const payload = req.body ?? {};
      logInfo('[LTI] /deeplink/diag — browser event', {
        email: email || '(unknown)',
        event: String(payload.event ?? '(none)'),
        data: payload.data ?? null,
        href: String(payload.href ?? '(none)'),
        top: Boolean(payload.top),
        ts: Number(payload.ts ?? 0),
      });
      return res.status(204).end();
    }
  );

  // ── Deep link: load resources for a course ─────────────────────────

  lti.app.get(
    '/deeplink/course/:courseId/agents',
    async (req: express.Request, res: express.Response) => {
      const email = getEmailFromLtiToken(res.locals?.token);
      const role = inferRoleFromLti(res);
      const name = getNameFromLtiToken(res.locals?.token) || email;
      const externalId = getExternalIdFromLti(res);
      const courseId = String(req.params.courseId ?? '').trim();
      const q = String((req.query as any)?.q ?? '').trim();

      logInfo('[LTI] /deeplink/course/:courseId/agents — loading agents', {
        email,
        role,
        courseId,
        query: q || '(none)',
      });

      const teacher = await adapter.resolveOrProvisionTeacher(email, name, role, externalId);
      if (!teacher) {
        logWarn('[LTI] /deeplink/course/:courseId/agents — teacher not resolved', {
          email,
          role,
        });
        return res.status(403).json({ status: 'fail', message: 'Not authorized' });
      }

      let course = await adapter.getCourseForTeacher(teacher, courseId);
      let courseSource = course ? 'teacher-owned' : 'none';

      if (!course) {
        const isAdminUser = teacher.roles?.includes('admin');
        if (isAdminUser) {
          course = await adapter.getCourseById(courseId);
          if (course) courseSource = 'admin-lookup';
        } else {
          const suggested = await adapter.suggestCourses(guessLmsCourseIdentifiers(res), 12);
          const allowed = suggested.some((c) => c.id === courseId);
          if (allowed) {
            course = await adapter.getCourseById(courseId);
            if (course) {
              await adapter.ensureTeacherInCourse(course, teacher);
              courseSource = 'suggested-match';
            }
          }
        }
      }

      if (!course) {
        logWarn('[LTI] /deeplink/course/:courseId/agents — course not found', {
          email,
          courseId,
          teacherId: teacher.id,
        });
        return res.status(404).json({ status: 'fail', message: 'Course not found' });
      }

      const resources = await adapter.listSelectableResources(teacher, course, {
        query: q,
        limit: 30,
      });

      const agents = resources.map((a) => ({
        _id: a.id,
        name: a.name,
        source: a.source || 'other',
      }));

      logInfo('[LTI] /deeplink/course/:courseId/agents — loaded', {
        email,
        courseId,
        courseName: course.name,
        courseSource,
        agentCount: agents.length,
        agentSources: agents.reduce(
          (acc, a) => {
            acc[a.source] = (acc[a.source] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        ),
      });

      return res.status(200).json({ status: 'success', agents });
    }
  );

  // ── Deep link: load categories for a course ─────────────────────────

  lti.app.get(
    '/deeplink/course/:courseId/categories',
    async (req: express.Request, res: express.Response) => {
      if (!adapter.listSelectableCategories) {
        return res.status(404).json({ status: 'fail', message: 'Category binding not supported' });
      }

      const email = getEmailFromLtiToken(res.locals?.token);
      const role = inferRoleFromLti(res);
      const name = getNameFromLtiToken(res.locals?.token) || email;
      const externalId = getExternalIdFromLti(res);
      const courseId = String(req.params.courseId ?? '').trim();

      const teacher = await adapter.resolveOrProvisionTeacher(email, name, role, externalId);
      if (!teacher) {
        return res.status(403).json({ status: 'fail', message: 'Not authorized' });
      }

      let course = await adapter.getCourseForTeacher(teacher, courseId);
      if (!course) {
        const isAdminUser = teacher.roles?.includes('admin');
        if (isAdminUser) {
          course = await adapter.getCourseById(courseId);
        } else {
          const suggested = await adapter.suggestCourses(guessLmsCourseIdentifiers(res), 12);
          const allowed = suggested.some((c) => c.id === courseId);
          if (allowed) {
            course = await adapter.getCourseById(courseId);
            if (course) await adapter.ensureTeacherInCourse(course, teacher);
          }
        }
      }

      if (!course) {
        return res.status(404).json({ status: 'fail', message: 'Course not found' });
      }

      const categories = await adapter.listSelectableCategories(teacher, course);

      logInfo('[LTI] /deeplink/course/:courseId/categories — loaded', {
        email,
        courseId,
        categoryCount: categories.length,
      });

      return res.status(200).json({
        status: 'success',
        categories: categories.map((c) => ({
          _id: c.id,
          name: c.name,
          description: c.description,
          agentCount: c.agentCount,
          isCourseStudentAgents: c.isCourseStudentAgents,
          source: c.source,
        })),
      });
    }
  );

  // ── Deep link submit — Build and return LTI deep link response ─────

  lti.app.post(
    '/deeplink/submit',
    express.urlencoded({ extended: true }),
    express.json({ limit: '64kb' }),
    async (req: express.Request, res: express.Response) => {
      const token = res.locals?.token;
      const email = getEmailFromLtiToken(token);
      const role = inferRoleFromLti(res);
      const name = getNameFromLtiToken(token) || email;
      const externalId = getExternalIdFromLti(res);

      const courseId = String(req.body?.courseId ?? '').trim();
      const resourceId = String(req.body?.agentId ?? '').trim();
      const categoryId = String(req.body?.categoryId ?? '').trim();
      const bindingTypeReq: LtiBindingType = categoryId ? 'category' : 'agent';

      const wantsJson =
        req.headers.accept?.includes('application/json') || req.query.format === 'json';

      const sendErr = (msg: string) => {
        if (wantsJson) return res.status(400).json({ error: msg });
        return res
          .status(200)
          .send(`<div style="font-family:system-ui;padding:24px;">${msg}</div>`);
      };

      try {
        logInfo('[LTI] /deeplink/submit — received', {
          email,
          role,
          courseId: courseId || '(none)',
          agentId: resourceId || '(none)',
          categoryId: categoryId || '(none)',
          bindingType: bindingTypeReq,
          format: wantsJson ? 'json' : 'html',
        });

        const teacher = await adapter.resolveOrProvisionTeacher(email, name, role, externalId);
        if (!teacher) {
          logWarn('[LTI] /deeplink/submit — teacher not resolved', { email, role });
          return sendErr('Not authorized to configure this activity.');
        }

        if (!courseId) {
          return sendErr('Missing course.');
        }

        let course = await adapter.getCourseForTeacher(teacher, courseId);
        if (!course) {
          const isAdminUser = teacher.roles?.includes('admin');
          if (isAdminUser) {
            course = await adapter.getCourseById(courseId);
          } else {
            const suggested = await adapter.suggestCourses(guessLmsCourseIdentifiers(res), 12);
            const allowed = suggested.some((c) => c.id === courseId);
            if (allowed) {
              course = await adapter.getCourseById(courseId);
              if (course) await adapter.ensureTeacherInCourse(course, teacher);
            }
          }
        }
        if (!course) {
          return sendErr('Course not found.');
        }

        const issuer = getIssuerFromLtiToken(token);
        const clientId = getClientIdFromLtiToken(token);
        const deploymentId = getDeploymentIdFromLtiToken(token);
        const contextId = getContextId(res);
        const resourceLinkId = getResourceLinkId(res);
        const bindingTenant = course.tenantId || adapter.resolveEffectiveTenant();

        await adapter.upsertCourseMap({
          issuer,
          clientId,
          deploymentId,
          contextId,
          courseId: course.id,
          createdBy: teacher.id,
          ...(bindingTenant ? { tenantId: bindingTenant } : {}),
        });

        // ── Category binding path ──
        if (bindingTypeReq === 'category') {
          if (!categoryId) {
            return sendErr('Please select a category.');
          }
          if (!adapter.getCategoryById) {
            return sendErr('Category binding not supported.');
          }
          const cat = await adapter.getCategoryById(categoryId);
          if (!cat) {
            return sendErr('Category not found.');
          }

          await adapter.upsertResourceBinding({
            issuer,
            clientId,
            deploymentId,
            contextId,
            resourceLinkId,
            courseId: course.id,
            resourceId: '',
            createdBy: teacher.id,
            categoryId,
            bindingType: 'category',
            ...(bindingTenant ? { tenantId: bindingTenant } : {}),
          });

          const toolBase = getToolBaseUrl(req, opts.toolBaseUrl);
          const catLaunchUrl = `${toolBase}${mountPath}${appRoute}`.replace(/\/+$/g, '');

          const catItem: LtiDeepLinkItem = {
            type: 'ltiResourceLink',
            title: `${cat.name} (${cat.agentCount} agents)`,
            url: catLaunchUrl,
            custom: {
              [`${prefix}_course_id`]: course.id,
              [`${prefix}_category_id`]: categoryId,
            },
          };
          if (cat.description) catItem.text = cat.description;

          logInfo('[LTI] /deeplink/submit — category binding saved', {
            teacherId: teacher.id,
            courseId: course.id,
            categoryId,
            categoryName: cat.name,
          });

          const catDlOptions = {
            message: 'Activity configured successfully.',
            log: `${prefix}_activity_configured`,
          };

          const deepLinkSettingsCat =
            res.locals.token?.platformContext?.deepLinkingSettings ??
            token?.platformContext?.deepLinkingSettings;
          const hasDeepLinkReturnCat = !!deepLinkSettingsCat?.deep_link_return_url;

          if (wantsJson) {
            if (hasDeepLinkReturnCat) {
              const jwtToken = await lti.DeepLinking.createDeepLinkingMessage(
                res.locals.token,
                [catItem],
                catDlOptions
              );
              return res.json({
                jwt: jwtToken,
                returnUrl: deepLinkSettingsCat.deep_link_return_url,
              });
            }
            return res.json({
              success: true,
              courseId: course.id,
              categoryId,
              bindingType: 'category',
            });
          }

          if (hasDeepLinkReturnCat) {
            const form = await lti.DeepLinking.createDeepLinkingForm(
              res.locals.token,
              [catItem],
              catDlOptions
            );
            return res.status(200).send(form);
          }

          return res
            .status(200)
            .send(
              '<div style="font-family:system-ui;padding:24px;">Configuration saved. You can close this window.</div>'
            );
        }

        // ── Agent (single resource) binding path ──
        if (!resourceId) {
          return sendErr(
            `Please select ${adapter.resourceLabel === 'Agent' ? 'an' : 'a'} ${adapter.resourceLabel.toLowerCase()}.`
          );
        }

        const resource = await adapter.getSelectableResourceForDeepLinking(
          teacher,
          course,
          resourceId
        );
        if (!resource) {
          return sendErr(`${adapter.resourceLabel} not found or not permitted.`);
        }

        await adapter.ensureResourceInCourse(course, resource);

        await adapter.upsertResourceBinding({
          issuer,
          clientId,
          deploymentId,
          contextId,
          resourceLinkId,
          courseId: course.id,
          resourceId: resource.id,
          createdBy: teacher.id,
          bindingType: 'agent',
          ...(bindingTenant ? { tenantId: bindingTenant } : {}),
        });

        const toolBase = getToolBaseUrl(req, opts.toolBaseUrl);
        const launchUrl = `${toolBase}${mountPath}${appRoute}`.replace(/\/+$/g, '');

        let items: LtiDeepLinkItem[];
        if (adapter.buildDeepLinkItems) {
          items = adapter.buildDeepLinkItems(course, resource, launchUrl);
        } else {
          const toolBase2 = getToolBaseUrl(req, opts.toolBaseUrl);
          const toAbsolute = (url: string) =>
            url.startsWith('http') ? url : `${toolBase2}${url.startsWith('/') ? '' : '/'}${url}`;

          const item: LtiDeepLinkItem = {
            type: 'ltiResourceLink',
            title: resource.name,
            url: launchUrl,
            custom: {
              [`${prefix}_course_id`]: course.id,
              [`${prefix}_resource_id`]: resource.id,
            },
          };
          if (resource.description) {
            item.text = resource.description;
          }
          if (resource.iconUrl) {
            item.icon = { url: toAbsolute(resource.iconUrl), width: 64, height: 64 };
          }
          if (resource.thumbnailUrl) {
            item.thumbnail = { url: toAbsolute(resource.thumbnailUrl), width: 200, height: 200 };
          }
          items = [item];
        }

        logInfo('[LTI] /deeplink/submit — binding saved', {
          teacherId: teacher.id,
          courseId: course.id,
          courseName: course.name,
          resourceId: resource.id,
          resourceName: resource.name,
          launchUrl,
          itemCount: items.length,
        });

        const dlOptions = {
          message: 'Activity configured successfully.',
          log: `${prefix}_activity_configured`,
        };

        const deepLinkSettings =
          res.locals.token?.platformContext?.deepLinkingSettings ??
          token?.platformContext?.deepLinkingSettings;
        const hasDeepLinkReturn = !!deepLinkSettings?.deep_link_return_url;

        if (wantsJson) {
          if (hasDeepLinkReturn) {
            const jwt = await lti.DeepLinking.createDeepLinkingMessage(
              res.locals.token,
              items,
              dlOptions
            );
            const returnUrl = deepLinkSettings.deep_link_return_url;
            logInfo('[LTI] /deeplink/submit — returning JWT + returnUrl (JSON)', {
              teacherId: teacher.id,
              resourceId: resource.id,
              returnUrl,
              returnHost: safeUrlHost(returnUrl),
            });
            return res.json({ jwt, returnUrl });
          }

          logInfo(
            '[LTI] /deeplink/submit — no deep link settings (popup reconfig), returning success',
            {
              teacherId: teacher.id,
              courseId: course.id,
              resourceId: resource.id,
            }
          );
          return res.json({
            success: true,
            courseId: course.id,
            resourceId: resource.id,
          });
        }

        if (hasDeepLinkReturn) {
          const form = await lti.DeepLinking.createDeepLinkingForm(
            res.locals.token,
            items,
            dlOptions
          );
          logInfo('[LTI] /deeplink/submit — deep link response sent to Moodle', {
            teacherId: teacher.id,
            resourceId: resource.id,
          });
          return res.status(200).send(form);
        }

        return res
          .status(200)
          .send(
            '<div style="font-family:system-ui;padding:24px;">Configuration saved. You can close this window.</div>'
          );
      } catch (e: any) {
        logError('[LTI] /deeplink/submit failed', { message: e?.message, stack: e?.stack });
        return sendErr('Failed to save configuration. Please try again.');
      }
    }
  );

  // ── Student: category agent picker ──────────────────────────────────

  lti.app.get(
    '/category/:categoryId/agents',
    async (req: express.Request, res: express.Response) => {
      try {
        if (!adapter.getCategoryById || !adapter.listCategoryAgents) {
          return res
            .status(404)
            .json({ status: 'fail', message: 'Category binding not supported' });
        }

        const categoryId = String(req.params.categoryId ?? '').trim();
        if (!categoryId) {
          return res.status(400).json({ status: 'fail', message: 'Missing categoryId' });
        }

        const cat = await adapter.getCategoryById(categoryId);
        if (!cat) {
          return res.status(404).json({ status: 'fail', message: 'Category not found' });
        }

        const agents = await adapter.listCategoryAgents(categoryId);

        return res.status(200).json({
          status: 'success',
          category: {
            _id: cat.id,
            name: cat.name,
            description: cat.description,
            agentCount: cat.agentCount,
            isCourseStudentAgents: cat.isCourseStudentAgents,
            courseId: cat.courseId,
          },
          agents: agents.map((a) => ({
            _id: a.id,
            name: a.name,
            description: a.description,
            iconUrl: a.iconUrl,
            owner: (a as any).owner || undefined,
          })),
        });
      } catch (e: any) {
        logError('[LTI] /category/:categoryId/agents failed', {
          message: e?.message,
          stack: e?.stack,
        });
        return res.status(500).json({ status: 'fail', message: 'Failed to load category agents' });
      }
    }
  );

  // ── Teacher management page — shown on normal launch for teachers ──

  lti.app.get('/launch/manage', async (req: express.Request, res: express.Response) => {
    try {
      setNoStoreHeaders(res);
      const token = res.locals?.token;
      const email = getEmailFromLtiToken(token);
      const role = inferRoleFromLti(res);
      const name = getNameFromLtiToken(token) || email;
      const externalId = getExternalIdFromLti(res);
      const ltik = String(req.query?.ltik ?? '').trim();

      logInfo('[LTI] /launch/manage — loading management page', {
        email,
        role,
        hasLtik: !!ltik,
      });

      const teacher = await adapter.resolveOrProvisionTeacher(email, name, role, externalId);
      if (!teacher) {
        logWarn('[LTI] /launch/manage — teacher not resolved', { email, role });
        return res
          .status(200)
          .send(
            '<div style="font-family:system-ui;padding:24px;">Not authorized. LMS role must be Instructor.</div>'
          );
      }

      const issuer = getIssuerFromLtiToken(token);
      const clientId = getClientIdFromLtiToken(token);
      const deploymentId = getDeploymentIdFromLtiToken(token);
      const contextId = getContextId(res);
      const resourceLinkId = getResourceLinkId(res);

      const binding = await adapter.findResourceBinding({
        issuer,
        clientId,
        deploymentId,
        contextId,
        resourceLinkId,
      });

      let courseName: string | undefined;
      let agentName: string | undefined;
      let categoryName: string | undefined;
      let agentCount: number | undefined;
      let previewUrl: string | undefined;
      const bindingType = binding?.bindingType || 'agent';

      if (binding?.courseId) {
        const course = await adapter.getCourseById(binding.courseId);
        courseName = course?.name;
      }

      const frontend = getFrontendBaseUrl(req, opts.frontendBaseUrl);

      if (bindingType === 'category' && binding?.categoryId && adapter.getCategoryById) {
        const cat = await adapter.getCategoryById(binding.categoryId);
        categoryName = cat?.name;
        agentCount = cat?.agentCount;
        const qs = new URLSearchParams();
        qs.set('categoryId', binding.categoryId);
        qs.set('lti', '1');
        qs.set('embedded', '1');
        if (binding.courseId) qs.set('courseId', binding.courseId);
        qs.set('ltik', ltik);
        previewUrl = `${frontend}/lti/launch?${qs.toString()}`;
      } else if (binding?.resourceId) {
        if (adapter.getResourceById) {
          const resource = await adapter.getResourceById(binding.resourceId);
          agentName = resource?.name;
        }
        previewUrl =
          launchDestination === 'app'
            ? `${frontend}/lti/launch?agentId=${encodeURIComponent(binding.resourceId)}&lti=1&embedded=1&ltik=${encodeURIComponent(ltik)}`
            : `${frontend}/embed/${encodeURIComponent(binding.resourceId)}`;
      }

      const configured =
        bindingType === 'category'
          ? !!(binding?.categoryId && binding?.courseId)
          : !!(binding?.resourceId && binding?.courseId);
      const deepLinkUrl = `${frontend}/lti/deeplink?ltik=${encodeURIComponent(ltik)}`;
      const updateUrl = `${mountPath}/launch/manage/update?ltik=${encodeURIComponent(ltik)}`;
      const showSuccess = String(req.query?.updated ?? '').trim() === '1';

      logInfo('[LTI] /launch/manage — rendering', {
        teacherId: teacher.id,
        email,
        configured,
        bindingType,
      });

      return res.status(200).send(
        renderTeacherManagePage({
          title: adapter.deepLinkPageTitle,
          resourceLabel: adapter.resourceLabel,
          email,
          courseName,
          agentName: categoryName || agentName,
          configured,
          deepLinkUrl,
          previewUrl,
          updateUrl,
          success: showSuccess,
          bindingType,
          agentCount,
        })
      );
    } catch (e: any) {
      logError('[LTI] /launch/manage failed', { message: e?.message, stack: e?.stack });
      return res
        .status(200)
        .send(
          '<div style="font-family:system-ui;padding:24px;">Failed to load management page. Please re-launch from Moodle.</div>'
        );
    }
  });

  // ── Teacher management: update binding ────────────────────────────

  lti.app.post(
    '/launch/manage/update',
    express.urlencoded({ extended: true }),
    async (req: express.Request, res: express.Response) => {
      try {
        const token = res.locals?.token;
        const email = getEmailFromLtiToken(token);
        const role = inferRoleFromLti(res);
        const name = getNameFromLtiToken(token) || email;
        const externalId = getExternalIdFromLti(res);
        const ltik = String(req.query?.ltik ?? '').trim();

        const courseId = String(req.body?.courseId ?? '').trim();
        const resourceId = String(req.body?.agentId ?? '').trim();

        logInfo('[LTI] /launch/manage/update — received', {
          email,
          role,
          courseId: courseId || '(none)',
          agentId: resourceId || '(none)',
        });

        const teacher = await adapter.resolveOrProvisionTeacher(email, name, role, externalId);
        if (!teacher) {
          return res
            .status(200)
            .send(
              '<div style="font-family:system-ui;padding:24px;">Not authorized to configure this activity.</div>'
            );
        }

        if (!courseId || !resourceId) {
          return res
            .status(200)
            .send(
              '<div style="font-family:system-ui;padding:24px;">Missing course or agent selection.</div>'
            );
        }

        let course = await adapter.getCourseForTeacher(teacher, courseId);
        if (!course) {
          const isAdminUser = teacher.roles?.includes('admin');
          if (isAdminUser) {
            course = await adapter.getCourseById(courseId);
          } else {
            const suggested = await adapter.suggestCourses(guessLmsCourseIdentifiers(res), 12);
            const allowed = suggested.some((c) => c.id === courseId);
            if (allowed) {
              course = await adapter.getCourseById(courseId);
              if (course) await adapter.ensureTeacherInCourse(course, teacher);
            }
          }
        }
        if (!course) {
          return res
            .status(200)
            .send('<div style="font-family:system-ui;padding:24px;">Course not found.</div>');
        }

        const resource = await adapter.getSelectableResourceForDeepLinking(
          teacher,
          course,
          resourceId
        );
        if (!resource) {
          return res
            .status(200)
            .send(
              `<div style="font-family:system-ui;padding:24px;">${adapter.resourceLabel} not found or not permitted.</div>`
            );
        }

        await adapter.ensureResourceInCourse(course, resource);

        const issuer = getIssuerFromLtiToken(token);
        const clientId = getClientIdFromLtiToken(token);
        const deploymentId = getDeploymentIdFromLtiToken(token);
        const contextId = getContextId(res);
        const resourceLinkId = getResourceLinkId(res);
        const bindingTenant = course.tenantId || adapter.resolveEffectiveTenant();

        await adapter.upsertCourseMap({
          issuer,
          clientId,
          deploymentId,
          contextId,
          courseId: course.id,
          createdBy: teacher.id,
          ...(bindingTenant ? { tenantId: bindingTenant } : {}),
        });

        await adapter.upsertResourceBinding({
          issuer,
          clientId,
          deploymentId,
          contextId,
          resourceLinkId,
          courseId: course.id,
          resourceId: resource.id,
          createdBy: teacher.id,
          ...(bindingTenant ? { tenantId: bindingTenant } : {}),
        });

        logInfo('[LTI] Teacher reconfigured activity binding', {
          teacherId: teacher.id,
          courseId: course.id,
          resourceId: resource.id,
          contextId,
          resourceLinkId,
        });

        const redirectUrl = `${mountPath}/launch/manage?ltik=${encodeURIComponent(ltik)}&updated=1`;
        return lti.redirect(res, redirectUrl, { newResource: true });
      } catch (e: any) {
        logError('[LTI] /launch/manage/update failed', {
          message: e?.message,
          stack: e?.stack,
        });
        return res
          .status(200)
          .send(
            '<div style="font-family:system-ui;padding:24px;">Failed to update configuration. Please try again.</div>'
          );
      }
    }
  );

  } // end if (!skipDeepLinking) — deep-linking surfaces

  // ── Deploy ltijs & register platform from env ──────────────────────

  await lti.deploy({ serverless: true });

  const platformUrl = String(process.env.LTI_PLATFORM_URL ?? '').trim();
  const platformClientId = String(process.env.LTI_PLATFORM_CLIENT_ID ?? '').trim();
  const platformAuthEndpoint = String(process.env.LTI_PLATFORM_AUTH_ENDPOINT ?? '').trim();
  const platformTokenEndpoint = String(process.env.LTI_PLATFORM_TOKEN_ENDPOINT ?? '').trim();
  const platformKeysetUrl = String(process.env.LTI_PLATFORM_KEYSET_URL ?? '').trim();
  const platformName = String(process.env.LTI_PLATFORM_NAME ?? 'Moodle').trim();

  if (
    platformUrl &&
    platformClientId &&
    platformAuthEndpoint &&
    platformTokenEndpoint &&
    platformKeysetUrl
  ) {
    try {
      await lti.registerPlatform(
        {
          url: platformUrl,
          name: platformName,
          clientId: platformClientId,
          authenticationEndpoint: platformAuthEndpoint,
          accesstokenEndpoint: platformTokenEndpoint,
          authConfig: { method: 'JWK_SET', key: platformKeysetUrl },
        },
        lti.getPlatform?.bind(lti),
        undefined,
        lti.Database
      );
      logInfo('[LTI] Platform registered/updated from env', {
        url: platformUrl,
        clientId: platformClientId,
      });
    } catch (e: any) {
      logWarn('[LTI] Failed to register platform from env', {
        url: platformUrl,
        clientId: platformClientId,
        message: e?.message,
      });
    }
  } else if (
    platformUrl ||
    platformClientId ||
    platformAuthEndpoint ||
    platformTokenEndpoint ||
    platformKeysetUrl
  ) {
    logWarn('[LTI] Platform env vars partially set; skipping platform registration');
  }

  // Catch-all error handler inside lti.app — prevents ltijs middleware errors
  // from becoming unhandled rejections that crash the server.
  lti.app.use(
    (err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      logError('[LTI] Error caught by LTI error handler', {
        message: err?.message,
        stack: err?.stack,
        path: _req?.path,
        method: _req?.method,
      });
      if (!res.headersSent) {
        return res
          .status(500)
          .send(
            '<div style="font-family:system-ui;padding:24px;">LTI internal error. Please re-launch from Moodle.</div>'
          );
      }
      next(err);
    }
  );

  app.use(mountPath, lti.app);

  logInfo('[LTI] Enabled', {
    mountPath,
    loginUrl: `${mountPath}${loginRoute}`,
    keysetUrl: `${mountPath}${keysetRoute}`,
    launchUrl: `${mountPath}${appRoute}`,
    devMode,
    ltiaas,
    tokenMaxAge,
    cookiesSecure,
    cookiesSameSite,
    skipDeepLinking,
    loginOnlyLaunchPath: skipDeepLinking ? launchRedirectPath : '(deep-linking enabled)',
    autoMapCourse: skipDeepLinking ? '(n/a)' : autoMapCourse,
    autoEnrollStudents: skipDeepLinking ? '(n/a)' : autoEnrollStudents,
    dbBackend: opts.dbPlugin ? 'plugin' : 'mongo-url',
  });
}
