/**
 * Normalized launch handler — the single source of truth for the login-only
 * and context-mapping launch flows, shared by the LTI 1.3 `onConnect` handler
 * and the legacy 1.0a/1.1 router.
 *
 * Both protocols build a {@link NormalizedLaunch} and a transport-specific
 * {@link NormalizedLaunchContext} (redirect + respondHtml callbacks), so the
 * substantial branch logic for resolving the user, mapping the course, and
 * binding the activity lives here once rather than being duplicated per wire
 * format.
 */

import type {
  LtiAdapter,
  LtiUser,
  LtiContextSnapshot,
  NormalizedLaunch,
} from './types';
import { mintBindToken } from './bindToken';
import { logInfo, logWarn } from './logger';

/**
 * Resolve the platform course for a launch context, creating one if needed:
 *  1. existing course map for this platform tuple,
 *  2. else auto-map by fuzzy LMS identifiers (and attach the teacher),
 *  3. else provision a course stub from the LMS context claims.
 *
 * Persists the `contextId -> course` map and returns the resolved course id, or
 * `null` if nothing could be matched or provisioned. Shared by the
 * context-mapping launch flow (1.3 + 1.1) and the deep-link selection screen.
 *
 * Takes a pre-built {@link LtiContextSnapshot} (rather than an Express `res`)
 * so it is protocol-agnostic — the 1.3 path builds the snapshot from the ltijs
 * token, the 1.1 path from the OAuth-signed form params.
 */
export async function resolveOrProvisionCourseForContext(
  adapter: LtiAdapter,
  contextSnapshot: LtiContextSnapshot,
  teacher: LtiUser,
  params: {
    issuer: string;
    clientId: string;
    deploymentId: string;
    contextId: string;
    autoMapCourse: boolean;
  }
): Promise<{ courseId: string; created: boolean } | null> {
  const platform = {
    issuer: params.issuer,
    clientId: params.clientId,
    deploymentId: params.deploymentId,
    contextId: params.contextId,
  };
  const isAdminUser = teacher.roles?.includes('admin');

  let map = await adapter.findCourseMap(platform);

  if (!map && params.autoMapCourse) {
    const candidates = contextSnapshot.identifierCandidates;
    for (const candidate of candidates) {
      const found =
        (await adapter.findCourseByCourseIdForTeacher(teacher, candidate)) ||
        (await adapter.findCourseByCourseId(candidate));
      if (found) {
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
          ...platform,
          courseId: found.id,
          createdBy: teacher.id,
          ...(courseTenant ? { tenantId: courseTenant } : {}),
        });
        break;
      }
    }
    map = await adapter.findCourseMap(platform);
    if (!map) {
      logWarn(
        `[LTI] Course auto-map: no course matched LMS identifiers (contextId=${params.contextId}, candidates=${JSON.stringify(
          candidates.slice(0, 12)
        )})`
      );
    }
  }

  let created = false;
  if (!map && adapter.provisionCourseFromLtiContext) {
    const provisioned = await adapter.provisionCourseFromLtiContext({
      teacher,
      platform,
      context: contextSnapshot,
    });
    if (provisioned) {
      const courseTenant = provisioned.tenantId || adapter.resolveEffectiveTenant();
      await adapter.upsertCourseMap({
        ...platform,
        courseId: provisioned.id,
        createdBy: teacher.id,
        ...(courseTenant ? { tenantId: courseTenant } : {}),
      });
      map = await adapter.findCourseMap(platform);
      created = true;
      logInfo('[LTI] Course provisioned from LMS context', {
        courseId: provisioned.id,
        contextId: params.contextId,
      });
    }
  }

  if (!map) return null;

  if (!isAdminUser) {
    try {
      const mappedCourse = await adapter.getCourseById(map.courseId);
      if (mappedCourse) await adapter.ensureTeacherInCourse(mappedCourse, teacher);
    } catch (e: any) {
      logWarn('[LTI] Failed to auto-attach teacher to mapped course (continuing)', {
        userId: teacher.id,
        courseId: map.courseId,
        message: e?.message,
      });
    }
  }

  return { courseId: map.courseId, created };
}

// ─── Normalized launch handling ──────────────────────────────────────────────

/**
 * Transport-specific bridge supplied by each protocol's launch entry point.
 * `redirectToLaunch` sends the user to the SPA launch route (the underlying
 * implementation adds `lti=1`, and for 1.1 the signed session ticket);
 * `respondHtml` renders a plain dead-end/error message in place.
 */
export interface NormalizedLaunchContext {
  mode: 'login-only' | 'context-mapping';
  autoMapCourse: boolean;
  bindTokenSecret?: string;
  redirectToLaunch: (params: Record<string, string>) => unknown;
  respondHtml: (html: string) => unknown;
}

const NOT_AUTHORIZED_TEACHER_HTML =
  '<div style="font-family:system-ui;padding:24px;">Not authorized. Your LMS role must be Instructor and you need a teacher account.</div>';
const NO_COURSE_HTML =
  '<div style="font-family:system-ui;padding:24px;">Could not match or create a course for this Moodle course. Please create the course in the app first.</div>';
const STUDENT_NO_MAP_HTML =
  '<div style="font-family:system-ui;padding:24px;">This activity is not set up yet. Ask your teacher to open it once first.</div>';
const STUDENT_NOT_BOUND_HTML =
  '<div style="font-family:system-ui;padding:24px;">This activity has not been linked to a group sign-up yet. Please contact your teacher to set it up.</div>';

/**
 * Run the login-only or context-mapping launch flow for a normalized launch.
 * Behaviour mirrors the original 1.3 `onConnect` branches exactly; the only
 * difference is the transport (callbacks in `ctx`).
 */
export async function handleNormalizedLaunch(
  adapter: LtiAdapter,
  launch: NormalizedLaunch,
  ctx: NormalizedLaunchContext
): Promise<unknown> {
  const { email, name, role, externalId, platform, resourceLinkId } = launch;
  const { issuer, clientId, deploymentId, contextId } = platform;

  // Login-only mode: skip every resource / binding lookup and bounce the user
  // straight to the SPA bridge.
  if (ctx.mode === 'login-only') {
    logInfo('[LTI] launch — login-only redirect', { version: launch.version, email, role });
    return ctx.redirectToLaunch({});
  }

  // Context-mapping mode: the LMS course context maps to a platform course.
  logInfo('[LTI] launch — context-mapping', {
    version: launch.version,
    email,
    role,
    issuer,
    clientId,
    deploymentId,
    contextId,
    resourceLinkId,
  });

  const findBinding = () =>
    issuer && clientId && deploymentId && contextId && resourceLinkId
      ? adapter.findResourceBinding({ issuer, clientId, deploymentId, contextId, resourceLinkId })
      : Promise.resolve(null);

  const mintTokenFor = (courseId: string): string | null => {
    if (!ctx.bindTokenSecret) return null;
    if (!resourceLinkId) return null;
    return mintBindToken(ctx.bindTokenSecret, {
      issuer,
      clientId,
      deploymentId,
      contextId,
      resourceLinkId,
      courseId,
    });
  };

  if (role === 'teacher') {
    const teacher = await adapter.resolveOrProvisionTeacher(email, name, role, externalId);
    if (!teacher) {
      logWarn('[LTI] launch — context-mapping teacher not resolved', { email });
      return ctx.respondHtml(NOT_AUTHORIZED_TEACHER_HTML);
    }
    const resolved = await resolveOrProvisionCourseForContext(
      adapter,
      launch.contextSnapshot,
      teacher,
      { issuer, clientId, deploymentId, contextId, autoMapCourse: ctx.autoMapCourse }
    );
    if (!resolved) {
      logWarn('[LTI] launch — context-mapping could not resolve a course', { email, contextId });
      return ctx.respondHtml(NO_COURSE_HTML);
    }

    // A bind token always rides along on a teacher launch so the teacher can
    // bind an unbound link OR re-point an already-bound one in-app.
    const bindToken = mintTokenFor(resolved.courseId);
    const binding = await findBinding();

    if (binding?.resourceId) {
      logInfo('[LTI] launch — context-mapping teacher redirect to bound grouping', {
        email,
        courseId: resolved.courseId,
        groupingId: binding.resourceId,
      });
      return ctx.redirectToLaunch({
        courseId: resolved.courseId,
        groupingId: binding.resourceId,
        ...(bindToken ? { bindToken } : {}),
      });
    }

    logInfo('[LTI] launch — context-mapping teacher redirect (link unbound, bind prompt)', {
      email,
      courseId: resolved.courseId,
      created: resolved.created,
      hasBindToken: !!bindToken,
    });
    return ctx.redirectToLaunch({
      courseId: resolved.courseId,
      ...(bindToken ? { bindToken } : {}),
    });
  }

  // Student launch: resolve the course from the map the teacher created.
  const mapped =
    issuer && clientId && deploymentId && contextId
      ? await adapter.findCourseMap({ issuer, clientId, deploymentId, contextId })
      : null;
  if (!mapped) {
    logWarn('[LTI] launch — context-mapping student launch with no course map', {
      email,
      contextId,
    });
    return ctx.respondHtml(STUDENT_NO_MAP_HTML);
  }

  const binding = await findBinding();
  if (binding?.resourceId) {
    logInfo('[LTI] launch — context-mapping student redirect to bound grouping', {
      email,
      courseId: mapped.courseId,
      groupingId: binding.resourceId,
    });
    return ctx.redirectToLaunch({ courseId: mapped.courseId, groupingId: binding.resourceId });
  }

  logWarn('[LTI] launch — context-mapping student launch, link not bound to a grouping', {
    email,
    courseId: mapped.courseId,
    resourceLinkId,
  });
  return ctx.respondHtml(STUDENT_NOT_BOUND_HTML);
}
