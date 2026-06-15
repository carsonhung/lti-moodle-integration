/**
 * LTI Frontend API — Axios-based handlers for the LTI 1.3 endpoints.
 *
 * Two categories of endpoints:
 *  - Tool routes (mounted under LTI_MOUNT_PATH, e.g. `/api/v1/lti` or `/lti`):
 *      `/lti/session`, `/lti/deeplink/data`, `/lti/deeplink/submit`, etc.
 *      These use the `ltik` query parameter for authentication.
 *  - Admin routes (mounted by `createLtiAdminRouter`, typically also under
 *      `/api/v1/lti`): `/lti/platforms` GET/POST/DELETE. These use the app's
 *      Bearer JWT token (set globally on axios defaults by your auth layer).
 *
 * The `ltiBase` and `apiBase` paths are configurable so the same components
 * work whether the backend mounts LTI at `/lti` or `/api/v1/lti`.
 */

import axios from 'axios';

let ltiBase = '/api/v1/lti';
let apiBase = '/api/v1';
let legacyBase = '';

/**
 * Configure the API base paths once at app startup, before any LTI views
 * mount. Pass the same path you mounted ltijs under (the value of
 * `LTI_MOUNT_PATH` env var). `legacyBase` is the LTI 1.0a/1.1 router mount
 * (defaults to `${ltiBase}/legacy`, matching `LTI_LEGACY_MOUNT`).
 */
export function configureLtiApi(options: {
  ltiBase?: string;
  apiBase?: string;
  legacyBase?: string;
}) {
  if (options.ltiBase) ltiBase = options.ltiBase.replace(/\/+$/, '');
  if (options.apiBase) apiBase = options.apiBase.replace(/\/+$/, '');
  if (options.legacyBase) legacyBase = options.legacyBase.replace(/\/+$/, '');
}

export function getLtiBase(): string {
  return ltiBase;
}

export function getLtiLegacyBase(): string {
  return legacyBase || `${ltiBase}/legacy`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface LtiPlatform {
  platformId?: string;
  name: string;
  url: string;
  clientId: string;
  authenticationEndpoint: string;
  accesstokenEndpoint: string;
  authConfigMethod: string;
  authConfigKey?: string;
  active?: boolean;
}

export interface LtiSessionResponse {
  success: boolean;
  token: string;
  expiresIn: number;
  message?: string;
  /** Role inferred from the LTI launch ('student' | 'teacher'). */
  role?: 'student' | 'teacher';
  /** Tenant id resolved from the binding / agent (or undefined). */
  tenant?: string;
}

export interface DeepLinkCourse {
  _id: string;
  course_id?: string;
  name: string;
  code: string;
  semester: string;
  year: string;
  section?: string;
  tenantId?: string;
}

export interface DeepLinkAgent {
  _id: string;
  name: string;
  description?: string;
  source?: 'course' | 'public' | 'other';
  iconUrl?: string;
}

export interface DeepLinkCategory {
  _id: string;
  name: string;
  description?: string;
  agentCount: number;
  isCourseStudentAgents: boolean;
  source?: 'course' | 'other';
}

export interface DeepLinkData {
  title: string;
  resourceLabel: string;
  email?: string;
  tenantMode?: 'single' | 'multi';
  courses: DeepLinkCourse[];
  suggestedCourses?: DeepLinkCourse[];
  preselectedCourseId?: string;
  lmsContext?: { title?: string; label?: string; contextId?: string };
  provision?: { courseId: string; created: boolean; needsConfirmation: boolean };
  error?: string;
}

export interface DeepLinkSubmitResult {
  jwt?: string;
  returnUrl?: string;
  success?: boolean;
  courseId?: string;
  resourceId?: string;
  categoryId?: string;
  bindingType?: string;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Session Bridge                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Exchange an LTI launch token (`ltik`) for an application JWT.
 * `withCredentials` is forced false to avoid cross-site cookie issues in
 * embedded Moodle iframes.
 */
export async function getLtiSession(ltik: string): Promise<LtiSessionResponse> {
  const { data } = await axios.get(`${ltiBase}/session`, {
    params: { ltik },
    withCredentials: false,
  });
  if (!data?.success || !data?.token || !data?.expiresIn) {
    throw new Error(data?.message || 'Failed to bridge LTI launch to an application session.');
  }
  return data;
}

/**
 * Exchange a short-lived LTI 1.0a/1.1 launch ticket (`ticket` query param,
 * present only on legacy launches) for an application JWT via the legacy
 * `/session` endpoint. The 1.1 flow has no ltijs `ltik`; the signed ticket is
 * minted server-side after a valid OAuth 1.0a launch.
 */
export async function getLtiSessionByTicket(ticket: string): Promise<LtiSessionResponse> {
  const { data } = await axios.get(`${getLtiLegacyBase()}/session`, {
    params: { ticket },
    withCredentials: false,
  });
  if (!data?.success || !data?.token || !data?.expiresIn) {
    throw new Error(data?.message || 'Failed to bridge LTI 1.1 launch to an application session.');
  }
  return data;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Deep Linking                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export async function getDeepLinkData(ltik: string): Promise<DeepLinkData> {
  const { data } = await axios.get(`${ltiBase}/deeplink/data`, {
    params: { ltik },
    withCredentials: false,
  });
  if (!data?.success) {
    throw new Error(data?.error || 'Failed to load deep link data.');
  }
  return data.data;
}

export async function getDeepLinkAgents(
  ltik: string,
  courseId: string,
  query?: string
): Promise<DeepLinkAgent[]> {
  const params: Record<string, string> = { ltik };
  if (query && query.length >= 2) params.q = query;
  const { data } = await axios.get(`${ltiBase}/deeplink/course/${courseId}/agents`, {
    params,
    withCredentials: false,
  });
  return Array.isArray(data?.agents) ? data.agents : [];
}

export async function getDeepLinkCategories(
  ltik: string,
  courseId: string
): Promise<DeepLinkCategory[]> {
  const { data } = await axios.get(`${ltiBase}/deeplink/course/${courseId}/categories`, {
    params: { ltik },
    withCredentials: false,
  });
  return Array.isArray(data?.categories) ? data.categories : [];
}

export interface DeepLinkNewGrouping {
  name: string;
  description?: string;
  settings?: Record<string, unknown>;
}

export async function submitDeepLink(
  ltik: string,
  courseId: string,
  agentId?: string,
  categoryId?: string,
  newGrouping?: DeepLinkNewGrouping
): Promise<DeepLinkSubmitResult> {
  const body: Record<string, unknown> = { courseId };
  if (categoryId) body.categoryId = categoryId;
  else if (newGrouping) body.newGrouping = newGrouping;
  else if (agentId) body.agentId = agentId;

  const { data } = await axios.post(`${ltiBase}/deeplink/submit`, body, {
    params: { ltik, format: 'json' },
    withCredentials: false,
    headers: { 'Content-Type': 'application/json' },
  });
  if (data?.error) {
    throw new Error(data.error);
  }
  return {
    jwt: data?.jwt,
    returnUrl: data?.returnUrl,
    success: data?.success,
    courseId: data?.courseId,
    resourceId: data?.resourceId,
    categoryId: data?.categoryId,
    bindingType: data?.bindingType,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Platforms (Admin)                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Lists registered LTI platforms. Requires admin Bearer token on axios.
 */
export async function listLtiPlatforms(): Promise<LtiPlatform[]> {
  const { data } = await axios.get(`${apiBase}/lti/platforms`);
  return Array.isArray(data?.platforms) ? data.platforms : [];
}

export async function saveLtiPlatform(
  platform: Omit<LtiPlatform, 'platformId' | 'active'>
): Promise<void> {
  await axios.post(`${apiBase}/lti/platforms`, platform);
}

/**
 * Updates an existing registered platform. `platformId` is required to locate
 * the record; any other field present is updated (empty strings are ignored by
 * the backend so identity/endpoints are not clobbered). Pass `active` to toggle
 * the platform on/off. Requires admin Bearer token on axios.
 */
export async function updateLtiPlatform(
  platform: Partial<Omit<LtiPlatform, 'platformId'>> & { platformId: string }
): Promise<void> {
  await axios.put(`${apiBase}/lti/platforms`, platform);
}

export async function deleteLtiPlatform(platform: {
  platformId: string;
  url: string;
  clientId: string;
}): Promise<void> {
  await axios.delete(`${apiBase}/lti/platforms`, { data: platform });
}

export interface LtiConnectionCheck {
  id: 'keyset' | 'authentication' | 'accesstoken';
  label: string;
  url: string;
  ok: boolean;
  status?: number;
  message: string;
}

export interface LtiConnectionTestResult {
  success: boolean;
  checks: LtiConnectionCheck[];
}

/**
 * Runs a launch-free connectivity / config probe against a platform's keyset
 * and OIDC / token endpoints. Pass `platformId` to test a registered platform,
 * or the endpoint fields to test an unsaved form. Requires admin Bearer token.
 */
export async function testLtiPlatform(
  payload:
    | { platformId: string }
    | Pick<
        LtiPlatform,
        'authenticationEndpoint' | 'accesstokenEndpoint' | 'authConfigKey' | 'authConfigMethod'
      >
): Promise<LtiConnectionTestResult> {
  const { data } = await axios.post(`${apiBase}/lti/platforms/test`, payload);
  return {
    success: !!data?.success,
    checks: Array.isArray(data?.checks) ? data.checks : [],
  };
}
