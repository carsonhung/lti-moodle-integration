/**
 * LTI Platform Connection Test — launch-free reachability / config checks.
 *
 * LTI 1.3 has no single "ping" endpoint, so the most useful pre-flight check
 * is to verify the three platform endpoints an integration depends on:
 *
 *  - Keyset / JWKS URL — must return a valid JWK Set (`{ keys: [...] }`). This
 *    is the platform's public key used to verify signed launch tokens; a wrong
 *    or unreachable keyset makes every launch fail. This check is decisive.
 *  - Authentication (OIDC auth) endpoint — must be reachable.
 *  - Access-token endpoint — must be reachable.
 *
 * "Reachable" means the host answered with any HTTP status (Moodle's auth.php /
 * token.php legitimately return 4xx to a bare probe); only a network/timeout
 * error counts as unreachable.
 */

const CONNECTION_TEST_TIMEOUT_MS = 8_000;
const JWK_SET_METHOD = 'JWK_SET';

export interface LtiConnectionTestInput {
  authenticationEndpoint?: string;
  accesstokenEndpoint?: string;
  /** JWKS / keyset URL (the `authConfig.key` when method is JWK_SET). */
  authConfigKey?: string;
  authConfigMethod?: string;
}

export interface LtiConnectionCheck {
  /** Stable identifier: 'keyset' | 'authentication' | 'accesstoken'. */
  id: 'keyset' | 'authentication' | 'accesstoken';
  /** Human-readable label. */
  label: string;
  /** URL that was probed (empty if not configured). */
  url: string;
  /** Whether this check passed. */
  ok: boolean;
  /** HTTP status code, when a response was received. */
  status?: number;
  /** Human-readable outcome / error detail. */
  message: string;
}

export interface LtiConnectionTestResult {
  /** Overall result: keyset valid AND both endpoints reachable. */
  success: boolean;
  checks: LtiConnectionCheck[];
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = CONNECTION_TEST_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function describeFetchError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return `Timed out after ${CONNECTION_TEST_TIMEOUT_MS} ms`;
    return err.message || 'Network error';
  }
  return 'Network error';
}

async function checkKeyset(url: string, method: string): Promise<LtiConnectionCheck> {
  const base: LtiConnectionCheck = {
    id: 'keyset',
    label: 'Keyset / JWKS URL',
    url,
    ok: false,
    message: '',
  };

  if (method && method.toUpperCase() !== JWK_SET_METHOD) {
    return {
      ...base,
      ok: true,
      message: `Auth method is ${method}; keyset URL not applicable, skipped.`,
    };
  }

  if (!url) {
    return { ...base, message: 'No keyset / JWKS URL provided.' };
  }

  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return { ...base, status: res.status, message: `Keyset returned HTTP ${res.status}.` };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        ...base,
        status: res.status,
        message: 'Keyset reachable but did not return valid JSON.',
      };
    }
    const keys = (body as { keys?: unknown })?.keys;
    if (!Array.isArray(keys) || keys.length === 0) {
      return {
        ...base,
        status: res.status,
        message: 'Keyset reachable but contains no JWK keys.',
      };
    }
    return {
      ...base,
      ok: true,
      status: res.status,
      message: `Valid JWK Set with ${keys.length} key(s).`,
    };
  } catch (err) {
    return { ...base, message: describeFetchError(err) };
  }
}

async function checkReachable(
  id: 'authentication' | 'accesstoken',
  label: string,
  url: string
): Promise<LtiConnectionCheck> {
  const base: LtiConnectionCheck = { id, label, url, ok: false, message: '' };
  if (!url) {
    return { ...base, message: 'No endpoint URL provided.' };
  }
  try {
    // Any HTTP response means the host is reachable; Moodle's auth.php /
    // token.php answer a bare GET with 4xx, which is still a healthy sign.
    const res = await fetchWithTimeout(url, { redirect: 'manual' });
    return { ...base, ok: true, status: res.status, message: `Reachable (HTTP ${res.status}).` };
  } catch (err) {
    return { ...base, message: describeFetchError(err) };
  }
}

/**
 * Runs the keyset + endpoint reachability checks for a platform configuration.
 * Pure with respect to the database — it only performs outbound HTTP probes.
 */
export async function testPlatformConnection(
  input: LtiConnectionTestInput
): Promise<LtiConnectionTestResult> {
  const method = String(input.authConfigMethod ?? JWK_SET_METHOD).trim();
  const keysetUrl = String(input.authConfigKey ?? '').trim();
  const authUrl = String(input.authenticationEndpoint ?? '').trim();
  const tokenUrl = String(input.accesstokenEndpoint ?? '').trim();

  const checks = await Promise.all([
    checkKeyset(keysetUrl, method),
    checkReachable('authentication', 'Authentication endpoint', authUrl),
    checkReachable('accesstoken', 'Access-token endpoint', tokenUrl),
  ]);

  return { success: checks.every((c) => c.ok), checks };
}
