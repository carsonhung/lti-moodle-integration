/**
 * LTI 1.3 Module — Public API
 *
 * Import `initLti` and pass your adapter to integrate LTI 1.3 into any
 * Express app. Set `LTI_ENABLED=true` and configure the required env vars
 * (see .env.example) before calling `initLti`.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { initLti, setLtiLogger } from './lti';
 * import { myAdapter } from './lti/adapters/myAdapter';
 *
 * const app = express();
 *
 * setLtiLogger(myAppLogger); // optional — defaults to console
 *
 * async function boot() {
 *   await initLti(app, myAdapter, { mountPath: '/lti' });
 *   app.listen(3000);
 * }
 *
 * boot();
 * ```
 */

export { initLti, setLtiLogger, getLtiProvider, verifyBindToken } from './core';
export type { LtiBindTokenClaims } from './core';
export { createLtiAdminRouter } from './adminRouter';
export { createLtiConsumerAdminRouter } from './consumerAdminRouter';
export { testPlatformConnection } from './platformConnectionTest';
export type {
  LtiConnectionTestInput,
  LtiConnectionCheck,
  LtiConnectionTestResult,
} from './platformConnectionTest';

// ── Normalized launch handler (shared by 1.3 + 1.1) ──────────────────────────
export { handleNormalizedLaunch, resolveOrProvisionCourseForContext } from './launchHandler';
export type { NormalizedLaunchContext } from './launchHandler';

// ── LTI 1.0a / 1.1 (legacy) + grade passback ─────────────────────────────────
export { createInMemoryNonceStore } from './legacy/nonceStore';
export type { InMemoryNonceStore } from './legacy/nonceStore';
export { createInMemoryGradeLinkStore } from './stores/gradeLinkStore';
export { sendScore } from './grades/sendScore';
export type { SendScoreParams, SendScoreResult } from './grades/sendScore';
// OAuth 1.0a primitives (exposed for custom legacy flows + testing).
export {
  verifyOAuth1Request,
  signOAuth1,
  computeBodyHash,
  buildBaseString,
  percentEncode,
} from './legacy/oauth1';
export type { OAuth1VerifyInput, OAuth1VerifyResult, OAuth1SignInput, OAuth1SignResult } from './legacy/oauth1';

export type {
  LtiAdapter,
  LtiLoginOnlyAdapter,
  LtiInitOptions,
  LtiDatabasePlugin,
  LtiUser,
  LtiCourse,
  LtiCategory,
  LtiResource,
  LtiCourseMapping,
  LtiResourceBinding,
  LtiPlatformContext,
  LtiContextSnapshot,
  LtiRole,
  LtiConnectMode,
  LtiBindingType,
  LtiTenantMode,
  LtiDeepLinkItem,
  LtiLineItem,
  LtiResourceAnalytics,
  LtiStudentUsage,
  // Normalized launch + legacy/grade types
  NormalizedLaunch,
  LtiLaunchVersion,
  LtiConsumer,
  LtiConsumerStore,
  LtiConsumerSummary,
  LtiConsumerAdminStore,
  LtiNonceStore,
  LtiGradeLink,
  LtiOutcomeGradeLink,
  LtiAgsGradeLink,
  LtiGradeLinkStore,
} from './types';
export * as ltiHelpers from './helpers';
