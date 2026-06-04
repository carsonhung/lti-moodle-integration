# LTI 1.3 Moodle Integration

A portable, adapter-based **LTI 1.3 Provider** module for Express.js applications, with ready-made **Vue 3** _and_ **React 18** frontend components. Lets your app be launched from Moodle (or any LTI 1.3-compatible LMS) as an external tool, with full support for OIDC login, Deep Linking (teacher activity configuration), session bridging (LTI token → app JWT), and platform registration.

Extracted from the [TALIC Chatbot project](../) and made framework-agnostic so it can be dropped into any Express application — Mongoose/MongoDB, Drizzle/Postgres, Prisma, Supabase, you choose. The frontend ships in two flavours (`frontend/src/views/` for Vue, `frontend/src/react/` for React) that share the same framework-neutral `api.ts`.

---

## Features

- **OIDC Login & Launch** — Receives Moodle's LTI launch, validates the JWT, and redirects users into your app.
- **Login-only mode** *(new)* — Set `skipDeepLinking: true` to use LTI purely as an SSO replacement. The core skips registering every deep-link / teacher-management / category route, and you ship an `LtiLoginOnlyAdapter` (3 methods) instead of the full `LtiAdapter` (~25 methods). See `adapters/login-only.example.ts`.
- **Deep Linking** — Teachers pick a course + resource (or category) in a clean UI (Vue or React component provided); the selection is persisted as a binding for that LMS activity.
- **Session Bridge** — Exchanges the LTI launch token (`ltik`) for your app's JWT so the SPA can authenticate.
- **Platform Registration** — Admin API + UI (Vue or React) for registering LMS platforms (Moodle, Canvas, etc.).
- **Vue or React frontend** — Ship the same LTI flows with Vue 3 (`frontend/src/views/`) or React 18 (`frontend/src/react/`); both share one framework-neutral `api.ts`.
- **Auto-mapping** — Tries to match Moodle courses to your app's courses using context identifiers, course IDs, course codes, etc.
- **Auto-enrollment** — Optionally adds students to a course when they launch.
- **Category bindings** — A single Moodle activity can be bound to a *category* of resources (e.g. "let students pick from these 12 chatbots") instead of a single resource.
- **Multi-tenant aware** — Tenant resolution flows are first-class but optional; single-tenant apps just return `undefined`.
- **Mongo or SQL** — `ltijs` defaults to MongoDB for its internal state, but you can pass a SQL `dbPlugin` instead (e.g. [`ltijs-sequelize`](https://www.npmjs.com/package/ltijs-sequelize) for Postgres / MySQL / MariaDB / MSSQL / SQLite). See [SQL-backed deployments](#sql-backed-deployments-ltijs-sequelize) below.

## What's in this folder

```
lti-moodle-integration/
├── README.md                       — this file
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
    └── INTEGRATION_TEMPLATE.md     — copy/fill-in template for both modes (login-only SSO + full activity)
```

---

## Quick Start

### 1. Install dependencies in your backend

```bash
npm install ltijs jsonwebtoken
# If using TypeScript:
npm install -D @types/jsonwebtoken
```

For the Drizzle adapter, you also need:

```bash
npm install drizzle-orm
```

### 2. Copy the backend folder into your project

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

### 3. Implement your adapter

Pick one of the reference adapters in `backend/src/adapters/` and:

1. Replace the placeholder model imports at the top with your real ORM models.
2. Adjust column names if yours differ (`course_id` vs `courseId`, etc.).
3. Set the three UI fields: `deepLinkPageTitle`, `resourceLabel`, `customFieldPrefix`.

You also need two LTI-specific tables (or Mongoose collections). Use:

- **Mongoose**: copy the two files in `backend/src/models/*.mongoose.ts`.
- **Drizzle**: copy `models/drizzle-schema.example.ts` (and run a migration).
- **Other Postgres**: run `models/schema.sql`.

### 4. Copy the frontend pieces into your app

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

**If your frontend is React 18** — use the components in `frontend/src/react/` instead (you can ignore `views/` entirely). Add the routes from `frontend/src/react/routes-integration.example.tsx` to your `react-router-dom` config; keep `/lti/launch` public. Then edit `LtiLaunch.tsx`'s `INTEGRATION HOOKS` (`persistToken`, `loadProfile`, `targetRouteFor`) to call your auth store (Redux/Zustand/Context) and use your real route paths. See [Using the React components](#using-the-react-components) below.

### 5. Set environment variables

Copy `.env.example` into your backend's `.env`, then fill in:

```env
LTI_ENABLED=true
LTI_ENCRYPTION_KEY=<32-character hex string>
LTI_DB_URL=mongodb://localhost/lti      # or reuse MONGO_URI
LTI_MOUNT_PATH=/api/v1/lti
LTI_LTIAAS_MODE=true                     # bypasses third-party cookie issues

LTI_PLATFORM_URL=https://moodle.example.com
LTI_PLATFORM_CLIENT_ID=<from Moodle>
LTI_PLATFORM_AUTH_ENDPOINT=https://moodle.example.com/mod/lti/auth.php
LTI_PLATFORM_TOKEN_ENDPOINT=https://moodle.example.com/mod/lti/token.php
LTI_PLATFORM_KEYSET_URL=https://moodle.example.com/mod/lti/certs.php
```

See [docs/MOODLE_SETUP.md](docs/MOODLE_SETUP.md) for the matching configuration on the Moodle side.

### 6. Test the launch

1. Visit `https://yourserver.com/api/v1/lti/keys` — it should return a JWK set.
2. In Moodle, add an "External tool" activity that points to your tool.
3. Launch it as a teacher — you should land on the Deep Linking page.
4. Pick a course + resource, click "Save & Return to Moodle".
5. Re-launch as a student — you should land in your app at `/lti/launch?...` and get redirected to the selected resource.

---

## Two ways to consume this folder

**Option A — Copy in (steps above).** Copy `backend/src/*` into your app's `src/lti/` and `frontend/src/*` into your app's `src/lti/`. The files then resolve your app's own `node_modules`. Best when you want to fork/diverge from the module.

**Option B — Reference in place (no copy).** Keep this folder intact as a sibling of your `backend/`/`frontend/` and import its source directly. Nothing portable is duplicated in your app — you only write the app-specific adapter + bootstrap + thin views. This is how the **`selfgroupassignment`** project consumes it, and it's the recommended setup when you want to keep vibe-coding new LTI features inside this folder. Wiring:

```
your-project/
├── package.json            ← root: hosts the LTI runtime deps (see below)
├── lti-moodle-integration/ ← this folder, dropped in unchanged
├── backend/                ← your app (keeps its own node_modules)
└── frontend/               ← your app (keeps its own node_modules)
```

1. **Provide the folder's runtime deps so the sibling can resolve them.** Node/TS resolve a module's `import`s by walking *up* the directory tree, so this folder needs `express`, `ltijs`, `jsonwebtoken`, `mongoose` (backend) and `axios` (frontend) to be reachable from an ancestor directory. The simplest way is a **root `package.json`** with those deps + `npm install` at the root:

```jsonc
// ./package.json (workspace root)
{
  "private": true,
  "dependencies": {
    "axios": "^1.7.7",
    "express": "^5.0.1",
    "jsonwebtoken": "^9.0.2",
    "ltijs": "^5.9.5",
    "mongoose": "^8.7.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/node": "^22.7.5"
  }
}
```

(npm workspaces work too; this minimal root install keeps your `backend/`/`frontend/` `node_modules` untouched.)

2. **Backend — compile the folder + import it relatively.** In `backend/tsconfig.json`, add the folder to `include` and exclude the `*.example.ts` reference adapters:

```jsonc
{
  "include": ["src/**/*.ts", "../lti-moodle-integration/backend/src/**/*.ts"],
  "exclude": [
    "node_modules", "dist",
    "../lti-moodle-integration/backend/src/adapters/*.example.ts",
    "../lti-moodle-integration/backend/src/models/drizzle-schema.example.ts"
  ]
}
```

Then your `bootstrap.ts` / adapter import the public API by relative path:

```typescript
import { initLti, createLtiAdminRouter, setLtiLogger } from '../../../lti-moodle-integration/backend/src/index';
import type { LtiAdapter } from '../../../../lti-moodle-integration/backend/src/types';
import { LtiCourseMapModel } from '../../../../lti-moodle-integration/backend/src/models/LtiCourseMapModel.mongoose';
```

> Note: `tsc` doesn't rewrite path aliases in emitted JS, so the backend uses **relative** imports (works for `tsx` dev, `tsc --noEmit`, and `node dist`). Because the folder is now part of the program, the emitted `dist/` nests under `dist/backend/src/` — point `main`/`start` there.

3. **Frontend — alias the folder.** In `vite.config.ts` and `tsconfig.json`:

```typescript
// vite.config.ts
alias: { '@lti': path.resolve(__dirname, '../lti-moodle-integration/frontend/src') }
```

```jsonc
// tsconfig.json
"paths": { "@lti/*": ["../lti-moodle-integration/frontend/src/*"] }
```

Then import the portable client directly: `import { configureLtiApi, getLtiSession } from '@lti/api';`. (Vite resolves `axios` from your frontend's `node_modules`; `vue-tsc` resolves it from the root install in step 1.)

4. **Your app keeps only the glue.** Everything that touches your models/auth lives in your app, importing the portable types/core above:
   - `backend/src/lti/adapters/<yourAdapter>.ts` — implements `LtiAdapter` (or `LtiLoginOnlyAdapter`).
   - `backend/src/lti/bootstrap.ts` — calls `initLti` + mounts `createLtiAdminRouter`.
   - `frontend/src/lti/views/*.vue` (Vue) or `frontend/src/lti/react/*.tsx` (React) — your app-styled `LtiLaunch` / `LtiDeepLink` / `LtiPlatformsAdmin` (start from this folder's templates and wire your auth store + route names).

To move to the next project: copy this folder in unchanged, repeat steps 1–4. Nothing in this folder needs editing for portability — all the app-specific code lives in your `backend/`/`frontend/`.

---

## Using the React components

The backend and `frontend/src/api.ts` are framework-neutral, so a React frontend uses the **exact same** LTI engine, endpoints, and session bridge as the Vue one — only the UI layer differs. The React equivalents live in `frontend/src/react/`:

| Vue (`frontend/src/views/`) | React (`frontend/src/react/`) | Purpose |
|---|---|---|
| `LtiLaunchView.vue` | `LtiLaunch.tsx` | Exchange `ltik` → app JWT, persist token, redirect by role |
| `LtiDeepLinkView.vue` | `LtiDeepLink.tsx` | Teacher course + resource/category picker (optional — server-rendered HTML fallback exists) |
| `LtiPlatformsAdmin.vue` | `LtiPlatformsAdmin.tsx` | Admin platform CRUD |
| `router-integration.example.ts` | `routes-integration.example.tsx` | Router wiring (`react-router-dom` v6+) |

### Install the React peer deps

The React peers are declared **optional** in `package.json`, so installing only Vue (or only React) never triggers an unmet-peer error. In a React project install:

```bash
npm install react react-dom react-router-dom axios
```

### Wire it up

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

### Fill in the integration hooks

`LtiLaunch.tsx` mirrors the Vue view's hooks. Edit these three functions to match your app:

- `persistToken(token, expiresInSec, tenant)` — store the JWT in your auth store (Redux/Zustand/Context) and set the axios `Authorization` header. The default writes to `localStorage`.
- `loadProfile()` — fetch the signed-in user so role-based redirects work (return `null` to skip).
- `targetRouteFor(...)` — map role + `agentId` / `categoryId` to your real route paths (defaults: `/welcome`, `/student/topic/:id`, `/teacher/topic/:id`, `/admin/topic/:id`, `/lti/category/:id`).

The components use plain inline styles (no CSS framework) and Font Awesome class names for icons (same as the Vue versions) — restyle to match your design system. `react-router-dom` is the only router assumed; swap `useSearchParams` / `useNavigate` for your router's equivalents if you use a different one. If you don't want a React deep-link picker at all, skip `LtiDeepLink.tsx` and let the backend's server-rendered `deepLinkingUI.ts` handle it.

---

## SQL-backed deployments (`ltijs-sequelize`)

`ltijs` defaults to MongoDB for its own internal bookkeeping — registered platforms, OIDC nonces, the tool's own JWK keypair, idtoken cache, etc. Projects that don't want to run a MongoDB instance can swap that out for a SQL database by passing a `dbPlugin` instance instead of a `dbUrl`. The integration point on the module side is already there:

```ts
await initLti(app, adapter, {
  mountPath: '/api/v1/lti',
  dbPlugin: mySqlPlugin,   // takes precedence over dbUrl / LTI_DB_URL
});
```

The plugin must implement the `LtiDatabasePlugin` shape exported from `./types` (`setup`, `Get`, `Insert`, `Modify`, `Delete` — MongoDB-document-oriented). The simplest path is the **official community plugin** [`ltijs-sequelize`](https://www.npmjs.com/package/ltijs-sequelize), which implements that contract over Postgres / MySQL / MariaDB / MSSQL / SQLite via Sequelize.

**Install the plugin + the SQL driver for your DB:**

```bash
npm install ltijs-sequelize sequelize pg            # Postgres
# or: npm install ltijs-sequelize sequelize mysql2  # MySQL / MariaDB
# or: npm install ltijs-sequelize sequelize sqlite3 # SQLite (great for dev)
```

**Wire it up:**

```ts
import { initLti } from 'lti-moodle-integration/backend';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('ltijs-sequelize');

const ltiDb = new Database(
  process.env.LTI_DB_NAME ?? 'lti',
  process.env.LTI_DB_USER,
  process.env.LTI_DB_PASS,
  {
    host: process.env.LTI_DB_HOST,
    dialect: 'postgres',
    logging: false,
  },
);

await initLti(app, adapter, {
  mountPath: '/api/v1/lti',
  dbPlugin: ltiDb,        // skip LTI_DB_URL — ltijs uses the plugin instead
  skipDeepLinking: true,  // optional, see "Login-only mode" below
});
```

`ltijs-sequelize` creates and manages its own tables (`idtoken`, `nonce`, `platform`, `accesstoken`, etc.) using Sequelize migrations — it does **not** know about your project's Drizzle / Prisma / TypeORM schema, and it doesn't need to. They coexist peacefully in the same Postgres instance. If you'd prefer the LTI tables to live in their own logical database (recommended for isolation), point `LTI_DB_NAME` at a separate DB and ensure your DB user can `CREATE TABLE` in it.

Your business-data tables (the ones backing `LtiCourseMap` and `LtiResourceLinkBinding` — what your *adapter* persists to record course mappings and resource bindings) are independent of ltijs's plugin: you keep using whatever ORM you already use for those, via the adapters in `backend/src/adapters/`.

---

## Login-only mode (SSO replacement)

If you only want LTI as an SSO replacement — Moodle launches → land the user in your app, no teacher-side resource picker — pass `skipDeepLinking: true` and use the minimal `LtiLoginOnlyAdapter` (3 methods) instead of the full `LtiAdapter` (~25 methods):

```ts
import { initLti } from 'lti-moodle-integration/backend';
import { loginOnlyAdapter } from './lti-adapter';

await initLti(app, loginOnlyAdapter, {
  mountPath: '/api/v1/lti',
  skipDeepLinking: true,
  loginOnlyLaunchPath: '/lti/launch',  // SPA route that exchanges ltik for app JWT
  dbPlugin: mySqlPlugin,               // or dbUrl: mongoUrl
});
```

In this mode the LTI core:

- **Does not register** `/deeplink/*`, `/launch/manage`, `/launch/manage/update`, or `/category/:categoryId/agents`.
- **Skips invoking** every adapter method related to courses, resources, categories, bindings, or tenant grants.
- On launch, **redirects directly** to `${frontendBaseUrl}${loginOnlyLaunchPath}` — your SPA's `LtiLaunchView` then calls `${mountPath}/session` to swap the `ltik` for an app JWT and lands the user in the app.

A complete reference adapter ships at `backend/src/adapters/login-only.example.ts` — copy it, replace the `UserModel.findOrCreate` + `signToken` placeholders with your project's real ones, and customise `mapLtiRoleToProjectRoles()` to fit your role taxonomy.

You should also configure Moodle's "External tool" registration with **Tool configuration usage = Launch only** (not "Show as a way to pick course content") so teachers never see the broken deep-link link.

---

## The Adapter Pattern

The `LtiAdapter` interface (`backend/src/types.ts`) is the single integration point. The LTI core never imports a database driver — it calls your adapter for every project-specific operation.

| Concern | Methods |
|---|---|
| User resolution | `resolveTeacherByEmail`, `resolveOrProvisionTeacher`, `upsertUser`, `generateJwt` |
| Courses | `listCoursesForTeacher`, `getCourseForTeacher`, `getCourseById`, `suggestCourses`, `findCourseByCourseId(ForTeacher)` |
| Resources | `listSelectableResources`, `getSelectableResourceForDeepLinking`, `getResourceById?` |
| Categories *(optional)* | `listSelectableCategories?`, `getCategoryById?`, `listCategoryAgents?` |
| Enrollment | `ensureResourceInCourse`, `ensureTeacherInCourse`, `ensureStudentInCourse` |
| Mapping | `findCourseMap`, `upsertCourseMap`, `findResourceBinding`, `upsertResourceBinding` |
| Tenants | `resolveEffectiveTenant`, `resolveTenantFromBinding`, `grantTeacherTenantAccess`, `getTenantMode?` |
| UI customisation | `deepLinkPageTitle`, `resourceLabel`, `customFieldPrefix` |

Method documentation is in `backend/src/types.ts`. See `backend/src/adapters/mongoose.example.ts` and `backend/src/adapters/drizzle.example.ts` for complete implementations.

## Reading the docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module design, request flows, deep-link modes.
- [docs/MOODLE_SETUP.md](docs/MOODLE_SETUP.md) — step-by-step Moodle external tool configuration.
- [docs/INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md) — drop-in checklist for adding LTI to an existing project.
- [docs/INTEGRATION_TEMPLATE.md](docs/INTEGRATION_TEMPLATE.md) — **copy/fill-in template** for every deployment shape: login-only SSO bridge, full activity with Deep Linking, and full activity without the Deep Linking picker. Decision-gated: it opens with a "confirm choices before writing code" checklist the implementing AI must ask the user first. Start here when scaffolding a new integration.

## License

Extracted from the TALIC Chatbot project. Reuse freely within HKU TELI projects.
