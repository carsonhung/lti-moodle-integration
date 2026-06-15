/**
 * Bind tokens — short-lived signed claims for the context-mapping per-link
 * grouping binding (and reused as the 1.1 launch-ticket payload shape).
 *
 * Some LMSs (e.g. production HKU Moodle) do not expose Deep Linking, so a
 * teacher cannot bind an activity to a grouping via Moodle's content picker.
 * Instead, the context-mapping launch signs the launch identity into a short-
 * lived "bind token" and hands it to the app SPA. The authenticated app then
 * posts it back to its own bind endpoint, which verifies the signature (so the
 * platform tuple + resourceLinkId can be trusted) and persists the binding.
 *
 * Extracted from core.ts so both core.ts and launchHandler.ts can mint/verify
 * tokens without a circular import.
 */

import jwt from 'jsonwebtoken';

export const BIND_TOKEN_TTL_SECONDS = 30 * 60;

export interface LtiBindTokenClaims {
  issuer: string;
  clientId: string;
  deploymentId: string;
  contextId: string;
  resourceLinkId: string;
  courseId: string;
}

export function mintBindToken(secret: string, claims: LtiBindTokenClaims): string {
  return jwt.sign(claims, secret, { expiresIn: BIND_TOKEN_TTL_SECONDS });
}

/**
 * Verify a bind token minted by the context-mapping launch and return its
 * launch-identity claims. Throws (jsonwebtoken errors) if the token is invalid
 * or expired. The host app calls this from its bind endpoint with the same
 * `bindTokenSecret` passed to `initLti`.
 */
export function verifyBindToken(secret: string, token: string): LtiBindTokenClaims {
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload & Partial<LtiBindTokenClaims>;
  if (
    !decoded ||
    !decoded.issuer ||
    !decoded.clientId ||
    !decoded.deploymentId ||
    !decoded.contextId ||
    typeof decoded.resourceLinkId !== 'string' ||
    !decoded.courseId
  ) {
    throw new Error('Invalid bind token payload');
  }
  return {
    issuer: decoded.issuer,
    clientId: decoded.clientId,
    deploymentId: decoded.deploymentId,
    contextId: decoded.contextId,
    resourceLinkId: decoded.resourceLinkId,
    courseId: decoded.courseId,
  };
}
