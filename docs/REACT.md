# Using the React components

How to use the React 18 components in `frontend/src/react/` instead of the Vue ones.


The backend and `frontend/src/api.ts` are framework-neutral, so a React frontend uses the **exact same** LTI engine, endpoints, and session bridge as the Vue one — only the UI layer differs. The React equivalents live in `frontend/src/react/`:

| Vue (`frontend/src/views/`) | React (`frontend/src/react/`) | Purpose |
|---|---|---|
| `LtiLaunchView.vue` | `LtiLaunch.tsx` | Exchange `ltik` → app JWT, persist token, redirect by role |
| `LtiDeepLinkView.vue` | `LtiDeepLink.tsx` | Teacher course + resource/category picker (optional — server-rendered HTML fallback exists) |
| `LtiPlatformsAdmin.vue` | `LtiPlatformsAdmin.tsx` | Admin platform CRUD |
| `router-integration.example.ts` | `routes-integration.example.tsx` | Router wiring (`react-router-dom` v6+) |

## Install the React peer deps

The React peers are declared **optional** in `package.json`, so installing only Vue (or only React) never triggers an unmet-peer error. In a React project install:

```bash
npm install react react-dom react-router-dom axios
```

## Wire it up

```tsx
// main.tsx
import { configureLtiApi } from './lti/api';
configureLtiApi({ ltiBase: '/api/v1/lti', apiBase: '/api/v1' });
```

```tsx
// router.tsx
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { LtiLaunch } from './lti/react/LtiLaunch';
import { LtiDeepLink } from './lti/react/LtiDeepLink';
import { LtiPlatformsAdmin } from './lti/react/LtiPlatformsAdmin';

const router = createBrowserRouter([
  { path: '/lti/launch', element: <LtiLaunch /> },     // MUST stay public
  { path: '/lti/deeplink', element: <LtiDeepLink /> },
  { path: '/admin/lti-platforms', element: <LtiPlatformsAdmin /> }, // gate with your own admin guard
  // ...your other routes
]);

export function App() {
  return <RouterProvider router={router} />;
}
```

## Fill in the integration hooks

`LtiLaunch.tsx` mirrors the Vue view's hooks. Edit these three functions to match your app:

- `persistToken(token, expiresInSec, tenant)` — store the JWT in your auth store (Redux/Zustand/Context) and set the axios `Authorization` header. The default writes to `localStorage`.
- `loadProfile()` — fetch the signed-in user so role-based redirects work (return `null` to skip).
- `targetRouteFor(...)` — map role + `agentId` / `categoryId` to your real route paths (defaults: `/welcome`, `/student/topic/:id`, `/teacher/topic/:id`, `/admin/topic/:id`, `/lti/category/:id`).

The components use plain inline styles (no CSS framework) and Font Awesome class names for icons (same as the Vue versions) — restyle to match your design system. `react-router-dom` is the only router assumed; swap `useSearchParams` / `useNavigate` for your router's equivalents if you use a different one. If you don't want a React deep-link picker at all, skip `LtiDeepLink.tsx` and let the backend's server-rendered `deepLinkingUI.ts` handle it.
