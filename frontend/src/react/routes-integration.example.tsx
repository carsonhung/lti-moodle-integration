/**
 * Example: how to plug the React LTI views into react-router-dom (v6+).
 *
 * Copy the route objects below into your project's router. The `LtiLaunch`
 * route MUST be public (no auth guard) because students arriving from Moodle
 * won't have an app session yet — that's exactly what the launch view creates.
 *
 * @example router.tsx
 * ```tsx
 * import { createBrowserRouter, RouterProvider } from 'react-router-dom';
 * import { ltiRoutes } from './lti/react/routes-integration.example';
 *
 * const router = createBrowserRouter([
 *   ...ltiRoutes,
 *   // ...your other routes (wrap protected ones in your own <RequireAuth>)
 * ]);
 *
 * export function App() {
 *   return <RouterProvider router={router} />;
 * }
 * ```
 *
 * Remember to configure the API base paths once at startup (e.g. in main.tsx),
 * before any LTI view mounts:
 *
 * ```ts
 * import { configureLtiApi } from './lti/api';
 * configureLtiApi({ ltiBase: '/api/v1/lti', apiBase: '/api/v1' });
 * ```
 */

import type { RouteObject } from 'react-router-dom';

import { LtiLaunch } from './LtiLaunch';
import { LtiDeepLink } from './LtiDeepLink';
import { LtiPlatformsAdmin } from './LtiPlatformsAdmin';

// Swap this for your own admin guard component, e.g.
//   <RequireRole role="admin"><LtiPlatformsAdmin /></RequireRole>
export const ltiRoutes: RouteObject[] = [
  {
    // Public — students/teachers land here straight from Moodle.
    path: '/lti/launch',
    element: <LtiLaunch />,
  },
  {
    // Public — teacher Deep Linking picker (optional; server-rendered fallback exists).
    path: '/lti/deeplink',
    element: <LtiDeepLink />,
  },
  {
    // Admin-only — gate this with your own auth wrapper.
    path: '/admin/lti-platforms',
    element: <LtiPlatformsAdmin />,
  },
];
