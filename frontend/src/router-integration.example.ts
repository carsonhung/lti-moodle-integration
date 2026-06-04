/**
 * Example: how to plug the LTI views into a Vue Router instance.
 *
 * Copy the route definitions below into your project's router file. The
 * `LtiLaunch` route MUST be public (no auth guard) because students arriving
 * from Moodle won't have an app session yet — that's exactly what the
 * launch view is going to create.
 *
 * @example router/index.ts
 * ```typescript
 * import { createRouter, createWebHistory } from 'vue-router';
 * import { ltiRoutes } from './lti-routes';
 *
 * const router = createRouter({
 *   history: createWebHistory(),
 *   routes: [
 *     ...ltiRoutes,
 *     // ...your other routes
 *   ],
 * });
 *
 * router.beforeEach((to, from, next) => {
 *   // Skip auth guard for LTI routes — they manage their own session.
 *   if (to.name?.toString().startsWith('Lti')) return next();
 *   // ...your usual auth logic
 *   return next();
 * });
 * ```
 */

import type { RouteRecordRaw } from 'vue-router';
import LtiLaunchView from './views/LtiLaunchView.vue';
import LtiDeepLinkView from './views/LtiDeepLinkView.vue';
import LtiPlatformsAdmin from './views/LtiPlatformsAdmin.vue';

export const ltiRoutes: RouteRecordRaw[] = [
  {
    path: '/lti/launch',
    name: 'LtiLaunch',
    component: LtiLaunchView,
    meta: { public: true, lti: true },
  },
  {
    path: '/lti/deeplink',
    name: 'LtiDeepLink',
    component: LtiDeepLinkView,
    meta: { public: true, lti: true },
  },
  {
    path: '/admin/lti-platforms',
    name: 'AdminLtiPlatforms',
    component: LtiPlatformsAdmin,
    meta: { requiresAdmin: true },
  },
];
