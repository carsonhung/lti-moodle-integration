/**
 * Login-only LTI adapter — reference implementation.
 *
 * This is the minimal adapter shape for projects that use LTI 1.3 purely as
 * a login replacement (Moodle-as-SSO). It implements the `LtiLoginOnlyAdapter`
 * interface — just three methods plus `customFieldPrefix` — instead of the
 * full ~25-method `LtiAdapter`. To use it, pass `skipDeepLinking: true` to
 * `initLti`:
 *
 * ```ts
 * import { initLti } from 'lti-moodle-integration/backend';
 * import { loginOnlyAdapter } from './lti-adapter';
 *
 * await initLti(app, loginOnlyAdapter, {
 *   mountPath: '/api/lti',
 *   skipDeepLinking: true,
 *   loginOnlyLaunchPath: '/lti/launch', // where the SPA bridge lives
 *   resolveLoginSession,                // verified host routing/linkage hook
 *   dbPlugin: myLtijsSequelizePlugin,   // or set LTI_DB_URL for Mongo
 * });
 * ```
 *
 * The LTI core will NOT register any of the `/deeplink/*`, `/launch/manage`,
 * or `/category/*` routes, and it will NOT invoke any adapter methods related
 * to courses, resources, categories, bindings, or tenant grants. The only
 * methods called are the ones implemented below.
 *
 * Replace the placeholder model + JWT helper imports at the top with your
 * project's real ones. The structure of `upsertUser` should mirror your
 * existing SSO provisioning path (CAS, OpenID Connect, etc.) so an LTI
 * launch lands in the same `users` row as the rest of your auth surface.
 */

import type {
  LtiLoginOnlyAdapter,
  LtiLoginSessionContext,
  LtiLoginSessionResolution,
  LtiUser,
  LtiRole,
} from '../types';

// ─── Project-specific imports (swap with yours) ───────────────────────────

// import { UserModel } from '../../../models/User';
// import { signToken } from '../../../lib/jwt';
// import { config } from '../../../config';

// Minimal placeholders so this file type-checks as an example. Delete these
// when wiring into a real project.
declare const UserModel: {
  findOrCreate(input: {
    hkuNo?: string;
    email: string;
    name: string;
    roles?: string[];
  }): Promise<{ id: string; email: string; name: string; roles: string[] }>;
};
declare function signToken(user: {
  id: string;
  email: string;
  roles: string[];
}): { token: string; expiresIn: number };
declare function handleVerifiedTeacherLaunch(input: {
  user: LtiUser;
  staffId?: string;
  platformId: string;
  contextId: string;
  courseCode: string;
  launchMetadata: Readonly<Record<string, string>>;
}): Promise<{ user?: LtiUser; requestId?: string }>;

// ─── Role mapping ─────────────────────────────────────────────────────────

/**
 * Map ltijs's normalised `LtiRole` ('student' | 'teacher') onto the role
 * names used in your project's `users.roles` column. Customise as needed —
 * e.g. if you have a `faculty_admin` role, treat it like `teacher`.
 *
 * The LTI core derives `role` from the LTI 1.3 `roles` claim:
 *   - Anything containing 'Instructor', 'ContentDeveloper', or 'Administrator'
 *     in the membership IRI maps to 'teacher'.
 *   - Everything else (including 'Learner' / 'Student') maps to 'student'.
 */
function mapLtiRoleToProjectRoles(role: LtiRole): string[] {
  switch (role) {
    case 'teacher':
      return ['teacher'];
    case 'student':
    default:
      return ['student'];
  }
}

// Replace this with your institution's strict, fail-closed course convention.
function firstVerifiedCourseCode(session: LtiLoginSessionContext): string | undefined {
  const candidates = [
    session.contextSnapshot.label,
    ...session.courseHints,
    session.lis.courseSectionSourcedId,
    session.lis.courseOfferingSourcedId,
    session.contextSnapshot.customCourseId,
    ...Object.values(session.custom),
  ];
  return candidates.find((value) => typeof value === 'string' && /^[A-Z]{4}\d{4}$/.test(value));
}

/**
 * Runs after the launch has been cryptographically verified and the adapter has
 * upserted the user, but before the app JWT is signed. Never supplement this
 * input with course/context values posted by the browser.
 */
export async function resolveLoginSession(
  session: LtiLoginSessionContext,
): Promise<LtiLoginSessionResolution> {
  const fallback = '/dashboard';
  const courseCode = firstVerifiedCourseCode(session);
  const contextId = session.contextSnapshot.contextId;
  const verifiedContext = Boolean(
    contextId && contextId === session.identity.platform.contextId,
  );
  if (!courseCode || !verifiedContext) return { target: fallback };

  if (session.role === 'student') {
    return { target: `/courses/${encodeURIComponent(courseCode)}` };
  }

  // Institutional identity is present only when `institutionalIdClaim` was
  // explicitly configured. Treat it as optional and let host policy validate it.
  const linked = await handleVerifiedTeacherLaunch({
    user: session.user,
    staffId: session.identity.institutionalIdentity?.value,
    platformId: session.identity.platformId,
    contextId,
    courseCode,
    launchMetadata: Object.freeze({
      version: session.version,
      resourceLinkId: session.resourceLinkId,
    }),
  });
  return {
    user: linked.user ?? session.user,
    target: linked.requestId
      ? `/teacher/linkage/${encodeURIComponent(linked.requestId)}`
      : fallback,
    launchMetadata: { courseCode, teacherLinkageRequested: Boolean(linked.requestId) },
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────

export const loginOnlyAdapter: LtiLoginOnlyAdapter = {
  /**
   * Prefix for LTI custom-claim keys this adapter recognises. Even in
   * login-only mode the LTI core inspects `custom.<prefix>_*` for a few
   * optional keys — keep this stable across deploys so existing LMS-side
   * configurations don't break.
   */
  customFieldPrefix: 'myapp',

  /**
   * Resolve (or create) the project user that matches the LTI launch's
   * email. This is the only side effect of an LTI launch in login-only
   * mode — find by email (or HKU number, or your platform's preferred
   * stable identifier), create with the LTI-derived role + name if missing,
   * and return the canonical user shape.
   *
   * The `externalId` parameter carries the LTI 1.3 `sub` claim — the
   * stable per-platform user identifier. Save it on the user row if you
   * want future launches from the same Moodle user to match without
   * relying on email (e.g. if the LMS lets users change their email).
   */
  async upsertUser({ email, name, role, externalId }): Promise<LtiUser> {
    // Mirror your existing SSO findOrCreate exactly. The LTI launch is just
    // another SSO provider as far as account provisioning is concerned.
    const user = await UserModel.findOrCreate({
      email,
      name,
      roles: mapLtiRoleToProjectRoles(role),
      // hkuNo: ...   // pull from `externalId` if your LMS sets sub = HKU UID
    });

    // (Optional) persist the LTI subject + platform pairing here if you've
    // added columns for it, so subsequent launches can match by subject
    // directly instead of falling through to email.
    void externalId;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
    };
  },

  /**
   * Issue your project's standard app JWT for the resolved user. Use the
   * same signing function your CAS / OpenID controllers use so the LTI
   * launch lands in an indistinguishable session.
   */
  generateJwt(user: LtiUser): { token: string; expiresIn: number } {
    return signToken({ id: user.id, email: user.email, roles: user.roles });
  },

  /**
   * Single-tenant apps return `undefined`. Multi-tenant apps return the
   * tenant ID that should be embedded in the issued JWT — typically read
   * from a config field or derived from the LTI issuer.
   */
  resolveEffectiveTenant(): string | undefined {
    return undefined;
  },
};
