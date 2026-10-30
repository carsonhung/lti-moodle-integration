/**
 * LTI 1.3 Assignment & Grade Services (AGS) — score publication.
 *
 * Built on `ltijs`'s Grade service, which handles the OAuth2 client-credentials
 * token flow against the platform using the tool's existing registration. This
 * module rebuilds a minimal idtoken from the claims captured at launch, posts
 * the score, and recovers when the launch line item is gone (Moodle returns 404
 * after an activity is deleted/re-added or restored from backup).
 *
 * Durable retries and score policies live in `agsSync.ts`.
 */

import { logInfo, logWarn } from '../logger';
import type {
  LtiAgsGradeLink,
  LtiAgsLineItemHint,
  LtiLineItem,
  LtiPlatformContext,
} from '../types';

export const AGS_SCORE_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
export const AGS_LINEITEM_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem';
export const AGS_LINEITEM_READONLY_SCOPE =
  'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly';
export const AGS_ENDPOINT_CLAIM = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint';
export const AGS_COMMENT_MAX_LENGTH = 4000;
export const AGS_PENDING_MANUAL = 'PendingManual';

const isFullyGraded = (gradingProgress?: string) =>
  (gradingProgress || 'FullyGraded') === 'FullyGraded';

export function normalizeAgsScopes(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String) : String(value ?? '').split(/\s+/);
  return raw.map((v) => v.trim()).filter(Boolean);
}

/**
 * Moodle line-item URLs look like `.../lineitems/675606/lineitem?type_id=204`;
 * the container is `.../lineitems?type_id=204`. Moodle often omits `lineitems`
 * from the launch, so derive it.
 */
export function deriveLineItemsEndpoint(lineItemUrl: string | undefined): string | undefined {
  const raw = String(lineItemUrl ?? '').trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const nextPath = url.pathname.replace(/\/lineitems\/[^/]+\/lineitem\/?$/i, '/lineitems');
    if (nextPath === url.pathname || !/\/lineitems$/i.test(nextPath)) return undefined;
    url.pathname = nextPath;
    return url.toString();
  } catch {
    return undefined;
  }
}

export interface AgsEndpointClaims {
  lineItem?: string;
  lineItems?: string;
  scopes: string[];
}

/** Read the AGS endpoint claim from an ltijs-normalised (or raw) id_token. */
export function extractAgsEndpoint(token: any): AgsEndpointClaims | null {
  const endpoint = token?.platformContext?.endpoint ?? token?.[AGS_ENDPOINT_CLAIM];
  if (!endpoint || typeof endpoint !== 'object') return null;
  const lineItem = String(endpoint.lineitem ?? '').trim() || undefined;
  const lineItems =
    String(endpoint.lineitems ?? '').trim() || deriveLineItemsEndpoint(lineItem) || undefined;
  const scopes = normalizeAgsScopes(endpoint.scope);
  if (!lineItem && !lineItems && !scopes.length) return null;
  return { lineItem, lineItems, scopes };
}

/** A launch with a line item and the score scope expects a grade for this user. */
export function isAgsGradebookLaunch(claims: AgsEndpointClaims | null | undefined): boolean {
  return Boolean(claims?.lineItem && claims.scopes.includes(AGS_SCORE_SCOPE));
}

/** Returns why AGS cannot publish for this link, or `undefined` when it can. */
export function evaluateAgsAvailability(input: {
  enabled: boolean;
  scopes: string[];
  lineItemUrl?: string;
  lineItemsEndpoint?: string;
}): string | undefined {
  if (!input.enabled) return 'LTI AGS is disabled (set agsEnabled / LTI_AGS_ENABLED)';
  if (!input.scopes.includes(AGS_SCORE_SCOPE)) {
    return 'The LTI launch did not grant the AGS score scope';
  }
  if (!input.lineItemUrl && !input.lineItemsEndpoint) {
    return 'The LTI launch did not provide a line-item or line-items URL';
  }
  return undefined;
}

export interface AgsScoreValues {
  userId: string;
  scoreGiven?: number;
  scoreMaximum: number;
  comment?: string;
  activityProgress?: string;
  gradingProgress?: string;
}

export function isScorelessSubmission(input: { scoreGiven?: number; gradingProgress?: string }) {
  return input.scoreGiven === undefined && !isFullyGraded(input.gradingProgress);
}

/** Throws when the values would be rejected by the platform. */
export function assertValidAgsScore(input: Omit<AgsScoreValues, 'userId'>): void {
  if (isScorelessSubmission(input)) return;
  const { scoreGiven, scoreMaximum } = input;
  if (
    scoreGiven === undefined ||
    !Number.isFinite(scoreGiven) ||
    !Number.isFinite(scoreMaximum) ||
    scoreMaximum <= 0 ||
    scoreGiven < 0 ||
    scoreGiven > scoreMaximum
  ) {
    throw new Error('Invalid AGS score: need 0 <= scoreGiven <= scoreMaximum and scoreMaximum > 0');
  }
}

export function buildAgsScorePayload(input: AgsScoreValues) {
  if (!input.userId) throw new Error('Invalid AGS score: missing LTI user id');
  assertValidAgsScore(input);
  const scoreless = isScorelessSubmission(input);
  const comment = input.comment?.trim().slice(0, AGS_COMMENT_MAX_LENGTH);
  return {
    userId: input.userId,
    // AGS only accepts scoreMaximum alongside scoreGiven.
    ...(scoreless ? {} : { scoreGiven: input.scoreGiven, scoreMaximum: input.scoreMaximum }),
    ...(comment ? { comment } : {}),
    activityProgress: input.activityProgress || 'Completed',
    gradingProgress: input.gradingProgress || 'FullyGraded',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Line item attached to an assignment deep-link content item. The `tag` and
 * `resourceId` let the sync layer find the column again if the launch URL goes
 * stale.
 */
export function buildAgsLineItemPayload(input: {
  assignmentId: string;
  title: string;
  scoreMaximum: number;
  tagPrefix: string;
  /** Replaces the default `<tagPrefix>:assignment:<id>` tag. */
  tag?: string;
}): LtiLineItem {
  if (
    !input.assignmentId ||
    !input.title.trim() ||
    !Number.isFinite(input.scoreMaximum) ||
    input.scoreMaximum <= 0
  ) {
    throw new Error('Invalid AGS line-item payload');
  }
  return {
    scoreMaximum: input.scoreMaximum,
    label: input.title,
    resourceId: input.assignmentId,
    tag: input.tag?.trim() || assignmentLineItemTag(input.tagPrefix, input.assignmentId),
  };
}

export function assignmentLineItemTag(prefix: string, assignmentId: string): string {
  return `${prefix}:assignment:${assignmentId}`;
}

/** Moodle rejects a score whose `scoreMaximum` differs from the line item's. */
export function scaleScoreToLineItem(
  scoreGiven: number,
  scoreMaximum: number,
  lineItemMaximum: number
): { scoreGiven: number; scoreMaximum: number } {
  if (!Number.isFinite(lineItemMaximum) || lineItemMaximum <= 0 || lineItemMaximum === scoreMaximum) {
    return { scoreGiven, scoreMaximum };
  }
  return {
    scoreGiven:
      Math.round(((scoreGiven / scoreMaximum) * lineItemMaximum + Number.EPSILON) * 100) / 100,
    scoreMaximum: lineItemMaximum,
  };
}

/** Include the HTTP method, URL, status, and body from ltijs/got errors. */
export function formatAgsError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error ?? 'Unknown AGS publication failure').slice(0, 2000);
  }
  const err = error as {
    message?: string;
    options?: { url?: unknown; method?: string };
    response?: { statusCode?: number; body?: unknown; url?: string; requestUrl?: unknown };
  };
  const statusCode = err.response?.statusCode;
  let body = err.response?.body;
  if (body != null && typeof body !== 'string') {
    try {
      body = JSON.stringify(body);
    } catch {
      body = String(body);
    }
  }
  const rawUrl = err.response?.requestUrl ?? err.response?.url ?? err.options?.url;
  const requestUrl = rawUrl ? String(rawUrl) : '';
  const method = err.options?.method ? `${err.options.method} ` : '';
  const base = err.message || 'Unknown AGS publication failure';
  if (statusCode || body || requestUrl) {
    return `${base} [${method}${requestUrl || '?'} -> HTTP ${statusCode ?? '?'}: ${String(body ?? '').slice(0, 1200)}]`.slice(
      0,
      2000
    );
  }
  return base.slice(0, 2000);
}

export function isHttpNotFound(error: unknown): boolean {
  const statusCode = (error as { response?: { statusCode?: number } })?.response?.statusCode;
  if (statusCode === 404) return true;
  return /404|resource not found/i.test(formatAgsError(error));
}

/** Everything needed to publish a score without the launch in flight. */
export interface AgsTarget {
  issuer: string;
  clientId: string;
  deploymentId: string;
  contextId: string;
  resourceLinkId: string;
  lmsUserId: string;
  lineItemUrl?: string;
  lineItemsEndpoint?: string;
  scopes: string[];
  lineItemHint?: LtiAgsLineItemHint;
}

export function buildAgsIdToken(target: AgsTarget) {
  return {
    iss: target.issuer,
    clientId: target.clientId,
    platformId: target.issuer,
    deploymentId: target.deploymentId,
    user: target.lmsUserId,
    platformContext: {
      context: { id: target.contextId },
      // getLineItems({ resourceLinkId: true }) filters on this.
      resource: { id: target.resourceLinkId },
      endpoint: {
        lineitem: target.lineItemUrl,
        lineitems: target.lineItemsEndpoint || deriveLineItemsEndpoint(target.lineItemUrl),
        scope: target.scopes,
      },
    },
  };
}

export interface ResolvedLineItem {
  lineItemUrl: string;
  scoreMaximum?: number;
  source: 'launch' | 'resource-link' | 'created';
}

/**
 * Find a live line item for the resource link: the launch URL if readable,
 * else one listed for the resource link (matched by tag, then resourceId, then
 * the only/first item), else create one when the `lineitem` scope allows it.
 */
export async function resolveLiveLineItem(
  provider: any,
  target: AgsTarget,
  scoreMaximum: number
): Promise<ResolvedLineItem> {
  const grade = provider?.Grade;
  const idtoken = buildAgsIdToken(target);

  if (target.lineItemUrl) {
    try {
      const item = await grade.getLineItemById(idtoken, target.lineItemUrl);
      return {
        lineItemUrl: target.lineItemUrl,
        scoreMaximum: Number(item?.scoreMaximum) || undefined,
        source: 'launch',
      };
    } catch (error) {
      logWarn('[LTI AGS] Launch line item is not readable', { error: formatAgsError(error) });
    }
  }

  const lineItemsEndpoint =
    target.lineItemsEndpoint || deriveLineItemsEndpoint(target.lineItemUrl);
  if (!lineItemsEndpoint) {
    throw new Error('No line-items endpoint is available to recover the grade column');
  }
  idtoken.platformContext.endpoint.lineitems = lineItemsEndpoint;
  const hint = target.lineItemHint ?? {};

  try {
    const listed = await grade.getLineItems(idtoken, { resourceLinkId: true });
    const items: Array<{ id?: string; tag?: string; resourceId?: string; scoreMaximum?: number }> =
      Array.isArray(listed) ? listed : listed?.lineItems || [];
    const match =
      (hint.tag && items.find((item) => item.tag === hint.tag)) ||
      (hint.resourceId && items.find((item) => String(item.resourceId ?? '') === hint.resourceId)) ||
      items[0];
    if (match?.id) {
      logInfo('[LTI AGS] Recovered line item from resource link', {
        lineItemUrl: match.id,
        count: items.length,
      });
      return {
        lineItemUrl: match.id,
        scoreMaximum: Number(match.scoreMaximum) || undefined,
        source: 'resource-link',
      };
    }
  } catch (error) {
    logWarn('[LTI AGS] Could not list line items', { error: formatAgsError(error) });
  }

  if (!target.scopes.includes(AGS_LINEITEM_SCOPE)) {
    throw new Error(
      `The platform returned 404 for grade column ${target.lineItemUrl || '(none)'} and the launch ` +
        'lacks the AGS lineitem scope, so no replacement can be created. In Moodle, set the ' +
        'tool\'s AGS service to "Use this service for grade sync and column management", make ' +
        'sure the activity accepts grades from the tool, and re-place the activity.'
    );
  }
  try {
    const created = await grade.createLineItem(
      idtoken,
      {
        scoreMaximum,
        label: hint.label || 'Score',
        ...(hint.tag ? { tag: hint.tag } : {}),
        ...(hint.resourceId ? { resourceId: hint.resourceId } : {}),
      },
      { resourceLinkId: true }
    );
    if (!created?.id) throw new Error('The platform did not return a line-item URL after create');
    logInfo('[LTI AGS] Created line item for resource link', { lineItemUrl: created.id });
    return {
      lineItemUrl: created.id,
      scoreMaximum: Number(created.scoreMaximum) || undefined,
      source: 'created',
    };
  } catch (error) {
    throw new Error(
      `The platform rejected grade-column create/list/read for ${target.lineItemUrl || lineItemsEndpoint} ` +
        `(${formatAgsError(error)}). Usually the activity's grade item is missing or not linked ` +
        'to this tool.'
    );
  }
}

export interface AgsPublishResult {
  lineItemUrl: string;
  lineItemsEndpoint?: string;
  scoreGiven?: number;
  scoreMaximum: number;
  source: ResolvedLineItem['source'];
}

/**
 * Post one score. Tries the launch line item first (score scope only; GET/list
 * need `lineitem.readonly` and often fail where POST would succeed). On 404 or
 * no launch URL, resolves a live line item, rescales, and posts again. Throws on
 * failure with a descriptive message.
 */
export async function publishAgsScore(
  provider: any,
  target: AgsTarget,
  score: Omit<AgsScoreValues, 'userId'>
): Promise<AgsPublishResult> {
  const grade = provider?.Grade;
  if (!grade || typeof grade.submitScore !== 'function') {
    throw new Error('ltijs Grade service unavailable');
  }
  assertValidAgsScore(score);

  let scoreGiven = score.scoreGiven;
  let scoreMaximum = score.scoreMaximum;
  const post = async (url: string) => {
    const payload = buildAgsScorePayload({
      ...score,
      userId: target.lmsUserId,
      scoreGiven,
      scoreMaximum,
    });
    await grade.submitScore(buildAgsIdToken({ ...target, lineItemUrl: url }), url, payload);
  };
  const recover = async (): Promise<AgsPublishResult> => {
    const resolved = await resolveLiveLineItem(
      provider,
      { ...target, lineItemUrl: undefined },
      score.scoreMaximum
    );
    if (scoreGiven !== undefined && resolved.scoreMaximum) {
      ({ scoreGiven, scoreMaximum } = scaleScoreToLineItem(
        score.scoreGiven!,
        score.scoreMaximum,
        resolved.scoreMaximum
      ));
    }
    await post(resolved.lineItemUrl);
    return {
      lineItemUrl: resolved.lineItemUrl,
      lineItemsEndpoint:
        target.lineItemsEndpoint || deriveLineItemsEndpoint(resolved.lineItemUrl),
      scoreGiven,
      scoreMaximum,
      source: resolved.source,
    };
  };

  if (!target.lineItemUrl) return recover();
  try {
    await post(target.lineItemUrl);
    return {
      lineItemUrl: target.lineItemUrl,
      lineItemsEndpoint: target.lineItemsEndpoint,
      scoreGiven,
      scoreMaximum,
      source: 'launch',
    };
  } catch (error) {
    if (!isHttpNotFound(error)) throw error;
    logWarn('[LTI AGS] Score POST returned 404; recovering line item', {
      error: formatAgsError(error),
    });
    return recover();
  }
}

// ─── One-shot submission (no durable record) ─────────────────────────────────

export interface AgsScoreInput {
  /** The ltijs Provider (passed in to avoid a core <-> grades import cycle). */
  provider: any;
  platform: LtiPlatformContext;
  resourceLinkId?: string;
  /** Fallback user id; `link.userId` (the LTI `sub`) wins when present. */
  userExternalId: string;
  link: LtiAgsGradeLink;
  scoreGiven?: number;
  scoreMaximum: number;
  comment?: string;
  activityProgress?: string;
  gradingProgress?: string;
  lineItemHint?: LtiAgsLineItemHint;
}

export interface AgsScoreResult {
  success: boolean;
  message?: string;
  lineItemUrl?: string;
}

/** Publish once and report the outcome instead of throwing. */
export async function submitAgsScore(input: AgsScoreInput): Promise<AgsScoreResult> {
  if (!input.link.lineItem && !input.link.lineItems) {
    return { success: false, message: 'No AGS line item captured for this launch' };
  }
  const target: AgsTarget = {
    ...input.platform,
    resourceLinkId: input.resourceLinkId ?? '',
    lmsUserId: input.link.userId || input.userExternalId,
    lineItemUrl: input.link.lineItem,
    lineItemsEndpoint: input.link.lineItems || deriveLineItemsEndpoint(input.link.lineItem),
    scopes: input.link.scopes ?? [],
    lineItemHint: input.lineItemHint,
  };
  try {
    const result = await publishAgsScore(input.provider, target, input);
    logInfo('[LTI AGS] submitScore ok', { lineItemUrl: result.lineItemUrl, source: result.source });
    return { success: true, lineItemUrl: result.lineItemUrl };
  } catch (e) {
    const message = formatAgsError(e);
    logWarn('[LTI AGS] submitScore failed', { message });
    return { success: false, message };
  }
}
