/**
 * LTI package constants.
 *
 * Per the project constants-pattern rule, every configurable literal (mount
 * subpaths, deployment-id sentinels, timestamp windows, TTLs) lives here so the
 * rest of the code imports a typed constant instead of inlining magic values.
 * Environment overrides are resolved in `core.ts` with these as the hardcoded
 * fallback layer.
 */

// ─── LTI 1.1 / 1.0a (legacy) ─────────────────────────────────────────────────

/**
 * Synthetic `deploymentId` used for LTI 1.0a/1.1 launches. LTI 1.1 has no
 * deployment concept, so we map every legacy launch onto this constant to reuse
 * the same `{ issuer, clientId, deploymentId, contextId }` platform tuple the
 * 1.3 course-map / binding stores key on.
 */
export const LTI_1P1_DEPLOYMENT_ID = 'lti-1p1';

/** Default subpath (under the main LTI mount) where the legacy router mounts. */
export const DEFAULT_LEGACY_MOUNT_SUBPATH = '/legacy';

/**
 * Default OAuth 1.0a timestamp acceptance window, in seconds. A launch whose
 * `oauth_timestamp` is more than this many seconds from now (either direction)
 * is rejected. 5 minutes matches the OAuth 1.0a spec's common guidance.
 */
export const DEFAULT_LEGACY_TIMESTAMP_WINDOW_S = 300;

/**
 * Default in-memory nonce retention, in milliseconds. A nonce that has been
 * seen within this window is rejected as a replay. Should comfortably exceed
 * the timestamp window so the two protections don't leave a replay gap.
 */
export const DEFAULT_LEGACY_NONCE_TTL_MS = 600_000;

/** How often the in-memory nonce store sweeps expired entries. */
export const NONCE_STORE_SWEEP_INTERVAL_MS = 60_000;

/** Required OAuth 1.0a signature method. PLAINTEXT is rejected. */
export const OAUTH1_SIGNATURE_METHOD = 'HMAC-SHA1';

// ─── Legacy launch-ticket (1.1 session bridge) ───────────────────────────────

/**
 * Lifetime of the short-lived signed launch ticket minted after a valid 1.1
 * launch and exchanged by the SPA at the legacy `/session` endpoint. Only needs
 * to outlive the browser redirect, so it is intentionally short.
 */
export const LAUNCH_TICKET_TTL_SECONDS = 120;

// ─── LTI message types (legacy) ──────────────────────────────────────────────

export const LTI_MESSAGE_TYPE_BASIC_LAUNCH = 'basic-lti-launch-request';
export const LTI_MESSAGE_TYPE_CONTENT_ITEM_SELECTION_REQUEST = 'ContentItemSelectionRequest';
export const LTI_MESSAGE_TYPE_CONTENT_ITEM_SELECTION = 'ContentItemSelection';

/** `lti_version` values a legacy launch may advertise. */
export const LTI_LEGACY_VERSIONS = ['LTI-1p0', 'LTI-1p1'] as const;
