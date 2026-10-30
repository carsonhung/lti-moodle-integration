/**
 * Hand-rolled OAuth 1.0a (HMAC-SHA1) for the LTI 1.0a / 1.1 path.
 *
 * LTI 1.0a/1.1 launches, the Content-Item deep-link return, and Basic Outcomes
 * calls are all OAuth 1.0a-signed with a shared `consumer_key`/`secret` (no
 * token). Rather than pull in a heavy OAuth dependency we implement the small
 * slice the spec (RFC 5849) requires, using only Node's `crypto`:
 *
 *  - {@link verifyOAuth1Request}: validate an inbound launch signature.
 *  - {@link signOAuth1}: sign an outbound request (deep-link return form params
 *    and the Outcomes XML POST, the latter via `oauth_body_hash`).
 *
 * Only HMAC-SHA1 is supported; PLAINTEXT is rejected.
 */

import crypto from 'crypto';
import { OAUTH1_SIGNATURE_METHOD } from '../constants';

/**
 * Percent-encode per RFC 3986 / RFC 5849 §3.6: everything except the unreserved
 * set `A-Za-z0-9-._~` is escaped. `encodeURIComponent` leaves `!*'()` unescaped,
 * so we fix those up.
 */
export function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function decodePercent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Normalize the request URL for the signature base string: lowercased scheme +
 * host, default ports dropped, query/fragment removed.
 */
export function normalizeBaseUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const scheme = u.protocol.toLowerCase();
  const host = u.hostname.toLowerCase();
  const port = u.port;
  const isDefault =
    (scheme === 'https:' && (port === '' || port === '443')) ||
    (scheme === 'http:' && (port === '' || port === '80'));
  const hostPort = isDefault ? host : `${host}:${port}`;
  return `${scheme}//${hostPort}${u.pathname}`;
}

/**
 * Build the OAuth 1.0a signature base string. `params` are the request
 * parameters (oauth_* + body/query params) EXCLUDING `oauth_signature`. Keys
 * and values are percent-encoded, sorted by encoded key then encoded value, and
 * joined `key=value&...`.
 */
export function buildBaseString(
  method: string,
  url: string,
  params: Record<string, string>
): string {
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (k === 'oauth_signature') continue;
    pairs.push([percentEncode(k), percentEncode(v ?? '')]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const normalized = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  return [
    method.toUpperCase(),
    percentEncode(normalizeBaseUrl(url)),
    percentEncode(normalized),
  ].join('&');
}

/** HMAC-SHA1 signing key: `percentEncode(consumerSecret)&percentEncode(tokenSecret)`. */
function signingKey(consumerSecret: string, tokenSecret = ''): string {
  return `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
}

/** Compute the base64 HMAC-SHA1 signature of a base string. */
export function signBaseString(
  baseString: string,
  consumerSecret: string,
  tokenSecret = ''
): string {
  return crypto
    .createHmac('sha1', signingKey(consumerSecret, tokenSecret))
    .update(baseString)
    .digest('base64');
}

/** base64 SHA-1 of the raw request body, for `oauth_body_hash` (XML POSTs). */
export function computeBodyHash(body: string | Buffer): string {
  return crypto.createHash('sha1').update(body).digest('base64');
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export interface OAuth1VerifyInput {
  method: string;
  /** The exact signed URL (reconstruct from toolBaseUrl + mount path, not req.url). */
  url: string;
  /** All request params (form body + query), including the `oauth_*` set. */
  params: Record<string, string>;
  consumerSecret: string;
  /** Accept window in seconds for `oauth_timestamp`. */
  timestampWindowSeconds: number;
  /** Optional clock override for tests (seconds since epoch). */
  nowSeconds?: number;
}

export interface OAuth1VerifyResult {
  ok: boolean;
  error?: string;
  nonce?: string;
  timestamp?: number;
}

/**
 * Verify an inbound OAuth 1.0a HMAC-SHA1 signature plus the timestamp window
 * and signature method. Nonce replay is checked separately by the caller (it
 * needs an async store). Returns the nonce + timestamp so the caller can record
 * them on success.
 */
export function verifyOAuth1Request(input: OAuth1VerifyInput): OAuth1VerifyResult {
  const { params } = input;
  const signatureMethod = String(params.oauth_signature_method ?? '');
  if (signatureMethod.toUpperCase() !== OAUTH1_SIGNATURE_METHOD) {
    return { ok: false, error: `Unsupported signature method: ${signatureMethod || '(none)'}` };
  }

  const version = String(params.oauth_version ?? '').trim();
  if (version && version !== '1.0') {
    return { ok: false, error: `Unsupported OAuth version: ${version}` };
  }

  const providedSignature = String(params.oauth_signature ?? '');
  if (!providedSignature) {
    return { ok: false, error: 'Missing oauth_signature' };
  }

  const consumerKey = String(params.oauth_consumer_key ?? '');
  if (!consumerKey) {
    return { ok: false, error: 'Missing oauth_consumer_key' };
  }

  const timestamp = Number(params.oauth_timestamp);
  const nonce = String(params.oauth_nonce ?? '');
  if (!Number.isFinite(timestamp) || !nonce) {
    return { ok: false, error: 'Missing or invalid oauth_timestamp / oauth_nonce' };
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > input.timestampWindowSeconds) {
    return { ok: false, error: 'Expired or skewed oauth_timestamp', nonce, timestamp };
  }

  const baseString = buildBaseString(input.method, input.url, params);
  const expected = signBaseString(baseString, input.consumerSecret);
  if (!constantTimeEqual(expected, providedSignature)) {
    return { ok: false, error: 'Signature mismatch', nonce, timestamp };
  }

  return { ok: true, nonce, timestamp };
}

export interface OAuth1SignInput {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  /** Extra non-oauth params that participate in the signature (form fields). */
  params?: Record<string, string>;
  /** base64 `oauth_body_hash` when signing a raw-body (XML) POST. */
  bodyHash?: string;
  /** Clock / nonce overrides for tests. */
  nowSeconds?: number;
  nonce?: string;
}

export interface OAuth1SignResult {
  /** The complete oauth_* param set (for a form POST, merge with `params`). */
  oauthParams: Record<string, string>;
  /** All signed params (oauth_* + the extra `params`), including the signature. */
  allParams: Record<string, string>;
  /** `Authorization: OAuth ...` header value (for XML/body POSTs). */
  authorizationHeader: string;
}

/**
 * Sign an outbound OAuth 1.0a request. Returns both a flat param map (for a
 * form-encoded POST such as the Content-Item return) and an `Authorization`
 * header (for the Outcomes XML POST, where the body is hashed via
 * `oauth_body_hash` instead of being mixed into the signature params).
 */
export function signOAuth1(input: OAuth1SignInput): OAuth1SignResult {
  const ts = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? crypto.randomBytes(16).toString('hex');

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: input.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: OAUTH1_SIGNATURE_METHOD,
    oauth_timestamp: String(ts),
    oauth_version: '1.0',
  };
  if (input.bodyHash) oauthParams.oauth_body_hash = input.bodyHash;

  const allForBase: Record<string, string> = { ...(input.params ?? {}), ...oauthParams };
  const baseString = buildBaseString(input.method, input.url, allForBase);
  const signature = signBaseString(baseString, input.consumerSecret);

  oauthParams.oauth_signature = signature;
  const allParams: Record<string, string> = { ...(input.params ?? {}), ...oauthParams };

  const headerParams = Object.entries(oauthParams)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ');
  const authorizationHeader = `OAuth realm="",${headerParams}`;

  return { oauthParams, allParams, authorizationHeader };
}

/**
 * Parse a urlencoded body into a flat string map, taking the first value for
 * any repeated key (LTI launches never legitimately repeat keys).
 */
export function flattenParams(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (Array.isArray(v)) out[k] = String(v[0] ?? '');
    else out[k] = v == null ? '' : String(v);
  }
  return out;
}

// Re-export for callers that build base strings from already-decoded params.
export { decodePercent };
