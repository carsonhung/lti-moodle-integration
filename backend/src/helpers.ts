/**
 * LTI Helpers — Generic utility functions for LTI 1.3 token parsing,
 * URL resolution, LMS identifier extraction, and role inference.
 *
 * These helpers are project-agnostic and consumed by core.ts. Pure functions
 * only — no side effects, no database access, no logger dependency.
 */

import type express from 'express';
import type { LtiRole } from './types';

// ─── Standard LTI Claim URIs ─────────────────────────────────────────────────

const LTI_DEPLOYMENT_ID_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/deployment_id';
const LTI_CUSTOM_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/custom';
const LTI_CONTEXT_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/context';
const LTI_RESOURCE_LINK_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/resource_link';
const LTI_ROLES_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/roles';
const LTI_LIS_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/lis';

// ─── Primitive Helpers ───────────────────────────────────────────────────────

export function truthy(v: string | undefined): boolean {
  return (
    String(v ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

export function parseTokenMaxAgeSeconds(raw: string | undefined): number | false | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  if (s.toLowerCase() === 'false') return false;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function safeStr(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function firstNonEmptyString(v: unknown): string {
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = String(item ?? '').trim();
      if (s) return s;
    }
    return '';
  }
  return String(v ?? '').trim();
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseJwtExpireSeconds(raw: string | undefined): number {
  const v = String(raw ?? '').trim();
  if (!v) return 4 * 3600;
  if (v.endsWith('ms')) return Math.floor(parseInt(v, 10) / 1000);
  if (v.endsWith('s')) return parseInt(v, 10);
  if (v.endsWith('h')) return parseInt(v, 10) * 3600;
  if (v.endsWith('d')) return parseInt(v, 10) * 24 * 3600;
  const n = parseInt(v, 10);
  return n > 100000 ? Math.floor(n / 1000) : n;
}

// ─── Token Field Extraction ──────────────────────────────────────────────────

export function getIssuerFromLtiToken(token: any): string {
  return firstNonEmptyString(
    token?.iss ?? token?.issuer ?? token?.platformContext?.iss ?? token?.platformContext?.issuer
  );
}

export function getClientIdFromLtiToken(token: any): string {
  return firstNonEmptyString(
    token?.clientId ??
      token?.client_id ??
      token?.platformContext?.clientId ??
      token?.platformContext?.client_id ??
      token?.aud ??
      token?.platformContext?.aud
  );
}

export function getDeploymentIdFromLtiToken(token: any): string {
  return firstNonEmptyString(
    token?.deploymentId ??
      token?.deployment_id ??
      token?.platformContext?.deploymentId ??
      token?.platformContext?.deployment_id ??
      token?.[LTI_DEPLOYMENT_ID_CLAIM] ??
      token?.platformContext?.[LTI_DEPLOYMENT_ID_CLAIM]
  );
}

export function getEmailFromLtiToken(token: any): string {
  const email =
    token?.userInfo?.email ||
    token?.userInfo?.email_address ||
    token?.email ||
    token?.platformContext?.lis?.person_contact_email_primary;
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

export function getNameFromLtiToken(token: any): string {
  const ui = token?.userInfo || {};
  return (
    String(ui.name ?? '').trim() ||
    `${String(ui.given_name ?? '').trim()} ${String(ui.family_name ?? '').trim()}`.trim() ||
    String(token?.name ?? '').trim() ||
    ''
  );
}

export function getContextId(res: express.Response): string {
  const ctx: any = res.locals?.context;
  const token: any = res.locals?.token;
  const claim =
    token?.[LTI_CONTEXT_CLAIM] ||
    token?.platformContext?.[LTI_CONTEXT_CLAIM] ||
    token?.platformContext?.context;
  return safeStr(ctx?.context?.id || ctx?.contextId || claim?.id).trim();
}

export function getResourceLinkId(res: express.Response): string {
  const ctx: any = res.locals?.context;
  const token: any = res.locals?.token;
  const claim =
    token?.[LTI_RESOURCE_LINK_CLAIM] ||
    token?.platformContext?.[LTI_RESOURCE_LINK_CLAIM] ||
    token?.platformContext?.resource;
  return safeStr(ctx?.resource?.id || ctx?.resourceLinkId || claim?.id).trim();
}

export function getCustom(res: express.Response): Record<string, any> {
  const ctx: any = res.locals?.context;
  const token: any = res.locals?.token;
  const c =
    ctx?.custom ||
    token?.platformContext?.custom ||
    token?.custom ||
    token?.[LTI_CUSTOM_CLAIM] ||
    token?.platformContext?.[LTI_CUSTOM_CLAIM];
  return c && typeof c === 'object' ? c : {};
}

// ─── URL Resolution ──────────────────────────────────────────────────────────

export function getToolBaseUrl(req: express.Request, override?: string): string {
  const explicit = String(override ?? process.env.LTI_TOOL_BASE_URL ?? '').trim();
  if (explicit) return explicit.replace(/\/+$/g, '');
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.get('host') || 'localhost';
  return `${proto}://${host}`.replace(/\/+$/g, '');
}

export function getFrontendBaseUrl(req: express.Request, override?: string): string {
  const explicit = String(override ?? process.env.LTI_FRONTEND_BASE_URL ?? '').trim();
  if (explicit) return explicit.replace(/\/+$/g, '');
  return getToolBaseUrl(req);
}

// ─── Role Inference ──────────────────────────────────────────────────────────

export function inferRoleFromLti(res: express.Response): LtiRole {
  const ctx: any = res.locals?.context;
  const token: any = res.locals?.token;
  const rolesRaw =
    ctx?.roles ??
    token?.platformContext?.roles ??
    token?.[LTI_ROLES_CLAIM] ??
    token?.platformContext?.[LTI_ROLES_CLAIM];
  const roles: string[] = Array.isArray(rolesRaw)
    ? (rolesRaw as any[]).map((r) => String(r ?? ''))
    : [];
  const joined = roles.join(' ').toLowerCase();
  if (
    joined.includes('instructor') ||
    joined.includes('teachingassistant') ||
    joined.includes('administrator')
  ) {
    return 'teacher';
  }
  return 'student';
}

/**
 * Extract a numeric "external ID" (e.g. HKU UID, student number) from the LIS
 * person_sourcedid claim. Returns '' when the claim is absent or non-numeric.
 * Adapters can use this to link LTI users to existing accounts by their
 * institutional ID instead of email.
 */
export function getExternalIdFromLti(res: express.Response): string {
  const ctx: any = res.locals?.context;
  const token: any = res.locals?.token;
  const lis =
    ctx?.lis ||
    token?.platformContext?.lis ||
    token?.[LTI_LIS_CLAIM] ||
    token?.platformContext?.[LTI_LIS_CLAIM];
  const sourcedId = String(lis?.person_sourcedid ?? '').trim();
  return /^\d+$/.test(sourcedId) ? sourcedId : '';
}

// ─── LMS Course Identifier Guessing ──────────────────────────────────────────

function uniqStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (!s) continue;
    if (!seen.has(s)) seen.add(s);
  }
  return [...seen];
}

function looksLikeCourseIdentifier(s: string): boolean {
  const v = String(s ?? '').trim();
  if (!v) return false;
  if (/^[0-9a-fA-F]{24}$/.test(v)) return true;
  if (/^\d{2,}$/.test(v)) return true;
  if (/^[A-Za-z]{2,}\d{2,}[A-Za-z0-9]*$/.test(v)) return true;
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(v) && /\d/.test(v)) return true;
  return false;
}

function deriveIdentifierVariants(raw: string): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];

  const out = new Set<string>();
  out.add(s);

  try {
    const u = new URL(s);
    const idParam =
      u.searchParams.get('id') ||
      u.searchParams.get('courseid') ||
      u.searchParams.get('course_id') ||
      u.searchParams.get('contextid') ||
      u.searchParams.get('context_id');
    if (idParam) out.add(String(idParam).trim());
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) out.add(String(last).trim());
  } catch {
    // not a URL
  }

  const q = s.match(/[?&](?:id|courseid|course_id|contextid|context_id)=([^&#]+)/i);
  if (q?.[1]) out.add(String(q[1]).trim());

  const parts = s.split(/[\s:/,|]+/g).map((p) => p.trim());
  for (const p of parts) {
    if (looksLikeCourseIdentifier(p)) out.add(p);
  }

  const codeMatches = s.match(/[A-Za-z]{2,}\d{2,}[A-Za-z0-9]*/g) || [];
  for (const m of codeMatches) {
    if (looksLikeCourseIdentifier(m)) out.add(m);
  }

  const digitMatches = s.match(/\d{2,}/g) || [];
  for (const m of digitMatches) {
    if (looksLikeCourseIdentifier(m)) out.add(m);
  }

  return [...out].filter((x) => x && x.length <= 128);
}

function expandCourseIdentifierCandidates(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    out.push(...deriveIdentifierVariants(v));
  }
  return uniqStrings(out);
}

/**
 * Extract candidate course identifiers from an LTI launch context. This is a
 * best-effort fuzzy match — adapters use these to look up a project-side
 * course (`findCourseByCourseId`, `suggestCourses`) for auto-mapping during
 * Deep Linking.
 *
 * Pulls from: context_id, custom params (course_id, moodle_course_id, etc.),
 * LIS course_section_sourcedid, course_offering_sourcedid, context label/title.
 * Expands variants (URLs → IDs, embedded course codes, numeric runs).
 */
export function guessLmsCourseIdentifiers(res: express.Response): string[] {
  const ctx: any = res.locals?.context;
  const custom = getCustom(res);
  const token: any = res.locals?.token;
  const lis =
    ctx?.lis ||
    token?.platformContext?.lis ||
    token?.[LTI_LIS_CLAIM] ||
    token?.platformContext?.[LTI_LIS_CLAIM];

  const base = uniqStrings([
    getContextId(res),
    custom?.course_id,
    custom?.moodle_course_id,
    custom?.context_id,
    custom?.contextId,
    lis?.course_section_sourcedid,
    lis?.course_offering_sourcedid,
    ctx?.context?.label,
    ctx?.context?.title,
  ]).filter((s) => s.length <= 128);

  return expandCourseIdentifierCandidates(base);
}

// Backwards-compatible alias — the original TALIC code called this
// `guessMoodleCourseIdentifiers`, but the logic works for any LTI 1.3 LMS.
export const guessMoodleCourseIdentifiers = guessLmsCourseIdentifiers;
