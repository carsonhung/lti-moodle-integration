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

export { initLti, setLtiLogger, getLtiProvider } from './core';
export { createLtiAdminRouter } from './adminRouter';
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
  LtiRole,
  LtiBindingType,
  LtiTenantMode,
  LtiDeepLinkItem,
  LtiLineItem,
  LtiResourceAnalytics,
  LtiStudentUsage,
} from './types';
export * as ltiHelpers from './helpers';
