import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from 'jose';
import type {
  LtiContextSnapshot,
  LtiInstitutionalIdentity,
  LtiPlatformContext,
  LtiRole,
} from './types';

export const BROKER_LTIK_TOKEN_TYPE = 'broker.ltik' as const;
export const BROKER_LTIK_CONTRACT_VERSION = '2' as const;
export const BROKER_DEFAULT_JWKS_PATH = '/.well-known/broker/jwks.json';
export const BROKER_LTIK_CONSUME_PATH = '/services/token';
export const BROKER_LTIK_ALGORITHMS = ['RS256'] as const;

export type BrokerLaunchMode = 'login-only' | 'course-based' | 'course-resource';
export type BrokerContractCompatibility = 'current-v2' | 'legacy-v1';

export interface BrokerLtikUser {
  sub?: string;
  name?: string;
  email?: string;
  /**
   * Backwards-compatible alias used by existing brokers for the platform
   * subject. It is never treated as an institutional identifier.
   */
  externalId?: string;
  roles: LtiRole[];
  institutionalIdentity?: LtiInstitutionalIdentity;
  /**
   * @deprecated Legacy broker claims had no trust provenance. Consumers may
   * use this only for account display/migration, never staff promotion.
   */
  hkuNo?: string;
  /** @deprecated See `hkuNo`. */
  institutionalId?: string;
}

export interface BrokerLtikPlatform {
  issuer: string;
  clientId: string;
  deploymentId: string;
}

export interface BrokerLtikContext
  extends Omit<LtiContextSnapshot, 'contextId' | 'identifierCandidates'> {
  contextId: string;
  identifierCandidates?: string[];
}

export interface BrokerLtikClaims extends JWTPayload {
  tt: typeof BROKER_LTIK_TOKEN_TYPE;
  ver: typeof BROKER_LTIK_CONTRACT_VERSION | '1';
  appId: string;
  launchId: string;
  mode?: BrokerLaunchMode;
  user: BrokerLtikUser;
  platform?: BrokerLtikPlatform;
  context?: BrokerLtikContext;
}

export interface VerifiedBrokerLtik {
  claims: BrokerLtikClaims;
  compatibility: BrokerContractCompatibility;
}

export interface VerifyBrokerLtikOptions {
  issuer: string;
  audience: string;
  key: JWTVerifyGetKey;
  algorithms?: readonly string[];
}

export interface CreateBrokerLtikVerifierOptions {
  issuer: string;
  audience: string;
  jwksUrl?: string | URL;
  algorithms?: readonly string[];
}

export interface ConsumeBrokerLtikOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export interface BrokerTeacherPromotionContext {
  institutionalIdentity: LtiInstitutionalIdentity;
  platform: LtiPlatformContext;
  context: BrokerLtikContext;
}

export class BrokerLtikContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrokerLtikContractError';
  }
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeRoles(value: unknown): LtiRole[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const roles = [...new Set(value.map(nonEmptyString))];
  if (
    roles.some((role) => role !== 'student' && role !== 'teacher')
    || roles.length === 0
  ) {
    return undefined;
  }
  return roles as LtiRole[];
}

function normalizeInstitutionalIdentity(value: unknown): LtiInstitutionalIdentity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const identityValue = nonEmptyString(candidate.value);
  const source = nonEmptyString(candidate.source);
  if (
    !identityValue
    || !source
    || candidate.trusted !== true
    || (source !== 'lis.person_sourcedid' && !source.startsWith('custom:'))
  ) {
    return undefined;
  }
  return {
    value: identityValue,
    source: source as LtiInstitutionalIdentity['source'],
    trusted: true,
  };
}

function normalizeContext(value: unknown): BrokerLtikContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const contextId = nonEmptyString(candidate.contextId);
  if (!contextId) return undefined;
  const identifiers = Array.isArray(candidate.identifierCandidates)
    ? candidate.identifierCandidates.map(nonEmptyString).filter((item): item is string => !!item)
    : undefined;
  const type = Array.isArray(candidate.type)
    ? candidate.type.map(nonEmptyString).filter((item): item is string => !!item)
    : undefined;
  return {
    contextId,
    ...(nonEmptyString(candidate.label) ? { label: nonEmptyString(candidate.label) } : {}),
    ...(nonEmptyString(candidate.title) ? { title: nonEmptyString(candidate.title) } : {}),
    ...(type?.length ? { type } : {}),
    ...(nonEmptyString(candidate.lisCourseOfferingSourcedId)
      ? { lisCourseOfferingSourcedId: nonEmptyString(candidate.lisCourseOfferingSourcedId) }
      : {}),
    ...(nonEmptyString(candidate.lisCourseSectionSourcedId)
      ? { lisCourseSectionSourcedId: nonEmptyString(candidate.lisCourseSectionSourcedId) }
      : {}),
    ...(nonEmptyString(candidate.customCourseId)
      ? { customCourseId: nonEmptyString(candidate.customCourseId) }
      : {}),
    ...(identifiers?.length ? { identifierCandidates: identifiers } : {}),
  };
}

/**
 * Validate and normalize the signed broker envelope after cryptographic JWT
 * verification. Version 1 remains login-compatible, but lacks the platform and
 * institutional-ID provenance required for trusted staff promotion.
 */
export function parseBrokerLtikClaims(
  payload: JWTPayload,
  expectedAppId: string,
): VerifiedBrokerLtik {
  if (payload.tt !== BROKER_LTIK_TOKEN_TYPE) {
    throw new BrokerLtikContractError('Unexpected broker token type.');
  }
  if (payload.appId !== expectedAppId) {
    throw new BrokerLtikContractError('Broker appId did not match the expected audience.');
  }
  const launchId = nonEmptyString(payload.launchId);
  if (!launchId) throw new BrokerLtikContractError('Broker launchId is required.');

  const rawUser = payload.user;
  if (!rawUser || typeof rawUser !== 'object' || Array.isArray(rawUser)) {
    throw new BrokerLtikContractError('Broker user claim is required.');
  }
  const userCandidate = rawUser as Record<string, unknown>;
  const roles = normalizeRoles(userCandidate.roles);
  if (!roles) throw new BrokerLtikContractError('Broker roles must be an explicit supported list.');
  const sub = nonEmptyString(userCandidate.sub);
  const externalId = nonEmptyString(userCandidate.externalId);
  const email = nonEmptyString(userCandidate.email)?.toLowerCase();
  if (!sub && !externalId && !email) {
    throw new BrokerLtikContractError('Broker user claim has no usable identity.');
  }

  const version = payload.ver === BROKER_LTIK_CONTRACT_VERSION
    ? BROKER_LTIK_CONTRACT_VERSION
    : payload.ver === undefined || payload.ver === '1' || payload.ver === 'v1'
      ? '1'
      : undefined;
  if (!version) {
    throw new BrokerLtikContractError('Unsupported broker contract version.');
  }
  const compatibility: BrokerContractCompatibility = version === BROKER_LTIK_CONTRACT_VERSION
    ? 'current-v2'
    : 'legacy-v1';
  const platformCandidate = payload.platform;
  let platform: BrokerLtikPlatform | undefined;
  if (platformCandidate && typeof platformCandidate === 'object' && !Array.isArray(platformCandidate)) {
    const raw = platformCandidate as Record<string, unknown>;
    const issuer = nonEmptyString(raw.issuer);
    const clientId = nonEmptyString(raw.clientId);
    const deploymentId = nonEmptyString(raw.deploymentId);
    if (issuer && clientId && deploymentId) platform = { issuer, clientId, deploymentId };
  }
  const context = normalizeContext(payload.context);
  const mode = payload.mode === 'course-based'
    || payload.mode === 'course-resource'
    || payload.mode === 'login-only'
    ? payload.mode
    : undefined;

  if (version === BROKER_LTIK_CONTRACT_VERSION) {
    if (!mode) {
      throw new BrokerLtikContractError('Broker v2 launch mode is required.');
    }
    if (!platform) {
      throw new BrokerLtikContractError('Broker v2 platform tuple is required.');
    }
    if (mode !== 'login-only' && !context) {
      throw new BrokerLtikContractError('Course-aware broker v2 context is required.');
    }
  }

  const user: BrokerLtikUser = {
    ...(sub ? { sub } : {}),
    ...(externalId ? { externalId } : {}),
    ...(email ? { email } : {}),
    ...(nonEmptyString(userCandidate.name) ? { name: nonEmptyString(userCandidate.name) } : {}),
    roles,
    ...(normalizeInstitutionalIdentity(userCandidate.institutionalIdentity)
      ? { institutionalIdentity: normalizeInstitutionalIdentity(userCandidate.institutionalIdentity) }
      : {}),
    ...(nonEmptyString(userCandidate.hkuNo) ? { hkuNo: nonEmptyString(userCandidate.hkuNo) } : {}),
    ...(nonEmptyString(userCandidate.institutionalId)
      ? { institutionalId: nonEmptyString(userCandidate.institutionalId) }
      : {}),
  };

  return {
    compatibility,
    claims: {
      ...payload,
      tt: BROKER_LTIK_TOKEN_TYPE,
      ver: version,
      appId: expectedAppId,
      launchId,
      ...(mode ? { mode } : {}),
      user,
      ...(platform ? { platform } : {}),
      ...(context ? { context } : {}),
    },
  };
}

export async function verifyBrokerLtik(
  token: string,
  options: VerifyBrokerLtikOptions,
): Promise<VerifiedBrokerLtik> {
  const result = await jwtVerify(token, options.key, {
    issuer: options.issuer,
    audience: options.audience,
    algorithms: [...(options.algorithms ?? BROKER_LTIK_ALGORITHMS)],
  });
  return parseBrokerLtikClaims(result.payload, options.audience);
}

export function createBrokerLtikVerifier(
  options: CreateBrokerLtikVerifierOptions,
): (token: string) => Promise<VerifiedBrokerLtik> {
  const issuer = options.issuer.replace(/\/+$/, '');
  const jwksUrl = options.jwksUrl
    ? new URL(options.jwksUrl)
    : new URL(`${issuer}${BROKER_DEFAULT_JWKS_PATH}`);
  const key = createRemoteJWKSet(jwksUrl);
  return (token) => verifyBrokerLtik(token, {
    issuer,
    audience: options.audience,
    key,
    algorithms: options.algorithms,
  });
}

/**
 * Atomically consume a launch token at the broker after local verification.
 * Production brokers persist the token JTI in their shared registry, so a
 * second callback or concurrent exchange is rejected across instances.
 */
export async function consumeBrokerLtik(
  token: string,
  options: ConsumeBrokerLtikOptions,
): Promise<void> {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetcher = options.fetch ?? globalThis.fetch;
  const response = await fetcher(`${baseUrl}${BROKER_LTIK_CONSUME_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ltik: token }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    const reason = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
    throw new BrokerLtikContractError(`Broker launch token was not consumed: ${reason}`);
  }
}

/** Values that a host may pass to its institution-specific shortname parser. */
export function brokerCourseIdentifierCandidates(
  context: BrokerLtikContext | undefined,
): string[] {
  if (!context) return [];
  return [
    context.label,
    ...(context.identifierCandidates ?? []),
    context.lisCourseSectionSourcedId,
    context.lisCourseOfferingSourcedId,
    context.customCourseId,
  ].filter((value): value is string => !!nonEmptyString(value));
}

export function brokerPlatformContext(
  claims: BrokerLtikClaims,
): LtiPlatformContext | undefined {
  if (!claims.platform || !claims.context) return undefined;
  return {
    ...claims.platform,
    contextId: claims.context.contextId,
  };
}

/**
 * Return the complete staff-promotion evidence only for an unambiguous current
 * contract. Legacy claims remain login-compatible but can never promote staff.
 */
export function brokerTeacherPromotionContext(
  verified: VerifiedBrokerLtik,
): BrokerTeacherPromotionContext | undefined {
  const { claims, compatibility } = verified;
  if (
    compatibility !== 'current-v2'
    || claims.mode === 'login-only'
    || claims.user.roles.length !== 1
    || claims.user.roles[0] !== 'teacher'
    || !claims.user.institutionalIdentity
    || !claims.platform
    || !claims.context
  ) {
    return undefined;
  }
  const trustedValue = claims.user.institutionalIdentity.value.trim();
  const legacyValues = [claims.user.hkuNo, claims.user.institutionalId]
    .map(nonEmptyString)
    .filter((value): value is string => !!value);
  if (legacyValues.some((value) => value !== trustedValue)) return undefined;
  return {
    institutionalIdentity: claims.user.institutionalIdentity,
    platform: {
      ...claims.platform,
      contextId: claims.context.contextId,
    },
    context: claims.context,
  };
}
