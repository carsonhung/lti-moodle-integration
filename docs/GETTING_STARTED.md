# Getting started (step by step)

The detailed walkthrough behind the README quick start: dependencies, backend wiring, adapter, frontend, environment, and a first Moodle launch.

This walkthrough copies the source into your project. To install it as a
package instead, see [INSTALLATION.md](INSTALLATION.md) (Option C) and import
from `lti-moodle-integration/backend` rather than `./lti`.

## Package layout


```
lti-moodle-integration/
├── README.md                       — overview and quick start
├── .env.example                    — all LTI_* env vars
├── package.json                    — backend deps (ltijs, jsonwebtoken, ...)
├── backend/
│   └── src/
│       ├── index.ts                — public API (initLti, createLtiAdminRouter, types)
│       ├── types.ts                — LtiAdapter + LtiLoginOnlyAdapter + LtiDatabasePlugin types
│       ├── core.ts                 — ltijs setup, routes, deep-link orchestration
│       ├── helpers.ts              — token parsing, URL helpers, identifier guessing
│       ├── deepLinkingUI.ts        — HTML templates for the legacy server-rendered UIs
│       ├── adminRouter.ts          — `createLtiAdminRouter()` factory for platform CRUD
│       ├── adapters/
│       │   ├── mongoose.example.ts — reference Mongoose adapter (full deep-link)
│       │   ├── drizzle.example.ts  — reference Drizzle/Postgres adapter (full deep-link)
│       │   └── login-only.example.ts — minimal LtiLoginOnlyAdapter (SSO-only use case)
│       └── models/
│           ├── LtiCourseMapModel.mongoose.ts
│           ├── LtiResourceLinkBindingModel.mongoose.ts
│           ├── drizzle-schema.example.ts
│           └── schema.sql          — raw SQL for non-Drizzle Postgres projects
├── frontend/
│   └── src/
│       ├── api.ts                  — axios handlers for tool + admin endpoints (framework-neutral, shared)
│       ├── router-integration.example.ts
│       ├── views/                  — Vue 3 components
│       │   ├── LtiLaunchView.vue   — session-bridge view (loads on `/lti/launch`)
│       │   ├── LtiDeepLinkView.vue — deep-link selection UI (loads on `/lti/deeplink`)
│       │   └── LtiPlatformsAdmin.vue — admin platform CRUD UI
│       └── react/                  — React 18 components (parallel to views/, same endpoints)
│           ├── LtiLaunch.tsx
│           ├── LtiDeepLink.tsx
│           ├── LtiPlatformsAdmin.tsx
│           └── routes-integration.example.tsx
└── docs/
    ├── ARCHITECTURE.md             — module design + LTI 1.3 flow diagrams
    ├── MOODLE_SETUP.md             — step-by-step Moodle external tool config
    ├── INTEGRATION_GUIDE.md        — drop-in checklist for a new project
    ├── INTEGRATION_TEMPLATE.md     — copy/fill-in template for both modes (login-only SSO + full activity)
    ├── LTI_INTEGRATION_MANUAL.md   — end-to-end integration manual (flows + setup)
    └── LTI_INTEGRATION_AGENT.md    — condensed agent-oriented integration brief
```

---


## 1. Install dependencies in your backend

```bash
npm install ltijs jsonwebtoken
# If using TypeScript:
npm install -D @types/jsonwebtoken
```

For the Drizzle adapter, you also need:

```bash
npm install drizzle-orm
```

## 2. Copy the backend folder into your project

Put `backend/src/*` into your backend at `src/lti/` (or any path you prefer). Then in your Express server:

```typescript
import express from 'express';
import { initLti, createLtiAdminRouter, setLtiLogger } from './lti';
import { myAdapter } from './lti/adapters/myAdapter';
import { protect, authorize } from './middleware/auth';
import logger from './utils/logger';

const app = express();

setLtiLogger(logger); // optional — defaults to console

// LTI Admin (platform CRUD). Mount BEFORE initLti if you share the prefix.
const ltiAdminRouter = createLtiAdminRouter({
  adminMiddleware: [protect, authorize('admin')],
  logger,
});
app.use('/api/v1/lti', ltiAdminRouter);

async function boot() {
  // LTI tool routes (login, launch, keys, deeplink, session, manage)
  await initLti(app, myAdapter, {
    mountPath: '/api/v1/lti',
    ltiaas: true, // recommended for iframe compatibility
  });
  app.listen(5000);
}
boot();
```

## 3. Implement your adapter

Pick one of the reference adapters in `backend/src/adapters/` and:

1. Replace the placeholder model imports at the top with your real ORM models.
2. Adjust column names if yours differ (`course_id` vs `courseId`, etc.).
3. Set the three UI fields: `deepLinkPageTitle`, `resourceLabel`, `customFieldPrefix`.

You also need two LTI-specific tables (or Mongoose collections). Use:

- **Mongoose**: copy the two files in `backend/src/models/*.mongoose.ts`.
- **Drizzle**: copy `models/drizzle-schema.example.ts` (and run a migration).
- **Other Postgres**: run `models/schema.sql`.

## 4. Copy the frontend pieces into your app

Put `frontend/src/*` into your frontend at `src/lti/` (or any path). `api.ts` is framework-neutral and shared by both flavours, so always copy it. Then configure the API base paths once at startup:

```typescript
// main.ts / main.tsx
import { configureLtiApi } from './lti/api';
configureLtiApi({
  ltiBase: '/api/v1/lti', // must match LTI_MOUNT_PATH on backend
  apiBase: '/api/v1',
});
```

**If your frontend is Vue 3** — use the components in `frontend/src/views/`. Add the three routes to your Vue router (see `frontend/src/router-integration.example.ts`). **Mark them as public** — don't gate them behind your auth middleware. Then edit `LtiLaunchView.vue` and fill in the `INTEGRATION HOOKS` section so it calls your auth store and uses your route names. The defaults assume `Welcome`, `StudentTopic`, `TeacherTopic`, `AdminTopic`, `LtiCategory` route names.

**If your frontend is React 18** — use the components in `frontend/src/react/` instead (you can ignore `views/` entirely). Add the routes from `frontend/src/react/routes-integration.example.tsx` to your `react-router-dom` config; keep `/lti/launch` public. Then edit `LtiLaunch.tsx`'s `INTEGRATION HOOKS` (`persistToken`, `loadProfile`, `targetRouteFor`) to call your auth store (Redux/Zustand/Context) and use your real route paths. See [REACT.md](REACT.md).

## 5. Set environment variables

Copy `.env.example` into your backend's `.env`, then fill in:

```env
LTI_ENABLED=true
LTI_ENCRYPTION_KEY=<32-character hex string>
LTI_DB_URL=mongodb://localhost/lti      # or reuse MONGO_URI
LTI_MOUNT_PATH=/api/v1/lti
LTI_CONNECT_MODE=context-mapping         # login-only | context-mapping | deep-linking
LTI_BIND_TOKEN_SECRET=<random string>    # signs the context-mapping per-link grouping bind token
LTI_LTIAAS_MODE=true                     # bypasses third-party cookie issues

LTI_PLATFORM_URL=https://moodle.example.com
LTI_PLATFORM_CLIENT_ID=<from Moodle>
LTI_PLATFORM_AUTH_ENDPOINT=https://moodle.example.com/mod/lti/auth.php
LTI_PLATFORM_TOKEN_ENDPOINT=https://moodle.example.com/mod/lti/token.php
LTI_PLATFORM_KEYSET_URL=https://moodle.example.com/mod/lti/certs.php
```

See [docs/MOODLE_SETUP.md](MOODLE_SETUP.md) for the matching configuration on the Moodle side.

## 6. Test the launch

1. Visit `https://yourserver.com/api/v1/lti/keys` — it should return a JWK set.
2. In Moodle, add an "External tool" activity that points to your tool.
3. Launch it as a teacher — you should land on the Deep Linking page.
4. Pick a course + resource, click "Save & Return to Moodle".
5. Re-launch as a student — you should land in your app at `/lti/launch?...` and get redirected to the selected resource.
