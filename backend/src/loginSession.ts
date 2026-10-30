import type {
  LtiJsonObject,
  LtiInstitutionalIdentity,
  LtiInitOptions,
  LtiLoginSessionContext,
  LtiLoginSessionResolution,
  LtiPlatformContext,
  ResolveLtiLoginSession,
} from './types';

export function serializePlatformId(platform: LtiPlatformContext): string {
  return JSON.stringify([platform.issuer, platform.clientId, platform.deploymentId]);
}

export function resolveInstitutionalIdentity(
  claim: LtiInitOptions['institutionalIdClaim'],
  custom: Record<string, unknown>,
  lisPersonSourcedId?: unknown
): LtiInstitutionalIdentity | undefined {
  if (!claim) return undefined;
  if (claim.source === 'custom') {
    const key = String(claim.key ?? '').trim();
    const value = key ? String(custom[key] ?? '').trim() : '';
    return value ? { value, source: `custom:${key}`, trusted: true } : undefined;
  }
  const value = String(lisPersonSourcedId ?? '').trim();
  return value ? { value, source: 'lis.person_sourcedid', trusted: true } : undefined;
}

export function isSafeLoginTarget(target: string): boolean {
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return false;
  if (/[\u0000-\u001f\u007f]/.test(target)) return false;
  try {
    const parsed = new URL(target, 'https://lti.invalid');
    return parsed.origin === 'https://lti.invalid';
  } catch {
    return false;
  }
}

function cloneSerializableMetadata(value: LtiJsonObject): LtiJsonObject {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error('LTI login-session launchMetadata must be JSON-serializable.');
  }
  if (encoded === undefined) {
    throw new Error('LTI login-session launchMetadata must be JSON-serializable.');
  }
  const cloned = JSON.parse(encoded) as LtiJsonObject;
  if (!cloned || Array.isArray(cloned) || typeof cloned !== 'object') {
    throw new Error('LTI login-session launchMetadata must be a JSON object.');
  }
  return cloned;
}

export async function resolveLtiLoginSession(
  hook: ResolveLtiLoginSession | undefined,
  context: LtiLoginSessionContext
): Promise<Required<Pick<LtiLoginSessionResolution, 'user'>> & LtiLoginSessionResolution> {
  if (!hook) return { user: context.user };

  const result = await hook(context);
  const user = result?.user ?? context.user;
  if (!user || typeof user.id !== 'string' || !user.id.trim()) {
    throw new Error('LTI login-session hook returned an invalid user.');
  }

  const target = result?.target?.trim();
  if (target && !isSafeLoginTarget(target)) {
    throw new Error('LTI login-session target must be an app-relative path.');
  }

  return {
    user,
    ...(target ? { target } : {}),
    ...(result?.launchMetadata
      ? { launchMetadata: cloneSerializableMetadata(result.launchMetadata) }
      : {}),
  };
}
