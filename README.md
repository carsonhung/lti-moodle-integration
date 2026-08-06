# LTI 1.3 Moodle Integration

A portable, adapter-based **LTI 1.3 Provider** module for Express.js applications, with ready-made **Vue 3** _and_ **React 18** frontend components. Lets your app be launched from Moodle (or any LTI 1.3-compatible LMS) as an external tool, with full support for OIDC login, Deep Linking (teacher activity configuration), session bridging (LTI token → app JWT), and platform registration.

Extracted from the [TALIC Chatbot project](../) and made framework-agnostic so it can be dropped into any Express application — Mongoose/MongoDB, Drizzle/Postgres, Prisma, Supabase, you choose. The frontend ships in two flavours (`frontend/src/views/` for Vue, `frontend/src/react/` for React) that share the same framework-neutral `api.ts`.

---

## Features

- **OIDC Login & Launch** — Receives Moodle's LTI launch, validates the JWT, and redirects users into your app.
- **LTI 1.0a / 1.1 support** *(new, optional)* — Be launched from older LMSs that speak LTI 1.0a / 1.1 (OAuth 1.0a-signed form POST, no OIDC/JWT) alongside the 1.3 path, with **Content-Item deep linking** and **Basic Outcomes** grade passback. Off by default — see [LTI 1.0a / 1.1 support](#lti-10a--11-support-legacy-lms).
- **Grade passback** *(new, optional)* — A unified `sendScore()` facade pushes scores back to the LMS via LTI 1.1 Basic Outcomes or an experimental LTI 1.3 AGS prototype.
- **Login-only mode** *(new)* — Set `skipDeepLinking: true` to use LTI purely as an SSO replacement. The core skips registering every deep-link / teacher-management / category route, and you ship an `LtiLoginOnlyAdapter` (3 methods) instead of the full `LtiAdapter` (~25 methods). See `adapters/login-only.example.ts`.
- **Deep Linking** — Teachers pick a course + resource (or category) in a clean UI (Vue or React component provided); the selection is persisted as a binding for that LMS activity.
- **Session Bridge** — Exchanges the LTI launch token (`ltik`) for your app's JWT so the SPA can authenticate.
- **Platform Registration** — Admin API + UI (Vue or React) for registering LMS platforms (Moodle, Canvas, etc.).
- **Broker consumer contract** — Verify and atomically consume central-broker
  `broker.ltik` launches with shared v2 platform, course, role, and identity-provenance types.
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
    ├── INTEGRATION_TEMPLATE.md     — copy/fill-in template for both modes (login-only SSO + full activity)
    ├── LTI_INTEGRATION_MANUAL.md   — end-to-end integration manual (flows + setup)
    └── LTI_INTEGRATION_AGENT.md    — condensed agent-oriented integration brief
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
LTI_CONNECT_MODE=context-mapping         # login-only | context-mapping | deep-linking
LTI_BIND_TOKEN_SECRET=<random string>    # signs the context-mapping per-link grouping bind token
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

**Option C — Install as a package (`npm install`).** The folder is now packaged so you can depend on it like any other module instead of copying source. The backend ships compiled (`backend/dist` with `.d.ts`); the frontend components ship as source under the `./frontend/*` subpath export and are resolved by your own bundler.

Version 1.1.0 is released through its GitHub tag. The package is prepared for
public npm publication but is not currently available from npm:

```bash
npm install git+https://github.com/carsonhung/lti-moodle-integration.git#v1.1.0
```

> Installing from git runs the `prepare` script, which npm executes **after** installing the package's dev dependencies — so `tsc` is available and `backend/dist` is compiled automatically on the consumer's machine. Always pin a tag or commit; without one npm installs the default branch HEAD.

Then consume the published entry points instead of relative paths:

```typescript
// backend
import { initLti, createLtiAdminRouter, setLtiLogger } from 'lti-moodle-integration/backend';
import type { LtiAdapter } from 'lti-moodle-integration/backend';
```

```typescript
// frontend (your bundler resolves the raw component source)
import { configureLtiApi, getLtiSession } from 'lti-moodle-integration/frontend/src/api';
// Vue:
import LtiLaunchView from 'lti-moodle-integration/frontend/src/views/LtiLaunchView.vue';
// React:
import { LtiLaunch } from 'lti-moodle-integration/frontend/src/react/LtiLaunch';
```

You still implement your own adapter and thin views — the package gives you the portable core, types, admin router, and reference components; everything that touches your models/auth/routes stays in your app (steps 3–4 of Option B). The reference adapters and models (`backend/src/adapters/*.example.ts`, `backend/src/models/*`) ship as source for you to copy and adapt.

Choose the consumption model by how much you expect to diverge from the module:

| | A: Copy in | B: Reference in place | C: Install as a package |
|---|---|---|---|
| You edit the core | Yes (forked) | Yes (vibe-code in the folder) | No (consume releases) |
| Upgrades | Manual re-copy | `git pull` the folder | `npm update` / bump version |
| Best for | One-off forks | Active co-development | Many independent consumers |

---

## Consuming a central LTI broker

Apps behind the TALIC broker register an allow-listed backend callback and use
the shared contract instead of defining local claim interfaces:

```ts
import {
  consumeBrokerLtik,
  createBrokerLtikVerifier,
} from 'lti-moodle-integration/backend';

const verify = createBrokerLtikVerifier({
  issuer: process.env.BROKER_BASE_URL!,
  audience: process.env.BROKER_APP_ID!,
});

const verified = await verify(req.query.ltik as string);
await consumeBrokerLtik(req.query.ltik as string, {
  baseUrl: process.env.BROKER_BASE_URL!,
});
```

The v2 token type is `tt = broker.ltik`. It always includes `mode`, normalized
roles, and the verified platform `(issuer, clientId, deploymentId)` tuple.
`course-based` and `course-resource` modes also require signed context; trusted
institutional identity includes its configured LIS/custom provenance. Legacy v1
tokens remain login-compatible but are insufficient for staff promotion.

Set `BROKER_BASE_URL` to the public broker issuer and `BROKER_APP_ID` to the App
record id/audience. In the broker registry, allow-list the full backend callback,
set course-aware apps to `course-based`, and add a routing rule for the intended
Moodle `(issuer, clientId, deploymentId)` (plus context/resource dimensions only
when intentionally narrower). Production broker deployments must use their
durable registry: `/services/token` atomically consumes the JTI and rejects
repeat/concurrent callbacks.

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
import { loginOnlyAdapter, resolveLoginSession } from './lti-adapter';

await initLti(app, loginOnlyAdapter, {
  mountPath: '/api/v1/lti',
  skipDeepLinking: true,
  loginOnlyLaunchPath: '/lti/launch',  // SPA route that exchanges ltik for app JWT
  resolveLoginSession,                 // verified target/linkage policy
  dbPlugin: mySqlPlugin,               // or dbUrl: mongoUrl
});
```

In this mode the LTI core:

- **Does not register** `/deeplink/*`, `/launch/manage`, `/launch/manage/update`, or `/category/:categoryId/agents`.
- **Skips invoking** every adapter method related to courses, resources, categories, bindings, or tenant grants.
- On launch, **redirects directly** to `${frontendBaseUrl}${loginOnlyLaunchPath}` — your SPA's `LtiLaunchView` then calls `${mountPath}/session` to swap the `ltik` for an app JWT and lands the user in the app.

A complete reference adapter ships at `backend/src/adapters/login-only.example.ts` — copy it, replace the `UserModel.findOrCreate`, `signToken`, and teacher-linkage placeholders with your project's real ones, and customise `mapLtiRoleToProjectRoles()` to fit your role taxonomy. Its `resolveLoginSession` example routes students from verified context/LIS/custom candidates, passes verified teacher metadata to a host hook, and falls back to `/dashboard` when no course context can be validated.

You should also configure Moodle's "External tool" registration with **Tool configuration usage = Launch only** (not "Show as a way to pick course content") so teachers never see the broken deep-link link.

### Login-session identity resolution

The built-in `/session` bridges expose verified launch identity to adapters:
`upsertUser()` now receives optional `platformSubject`, the explicit
`platform` tuple (`issuer`, `clientId`, `deploymentId`, `contextId`), a stable
serialized `platformId`, and trusted institutional-ID provenance when
configured. Existing adapters remain valid because every new field is optional.

For host-side account linking immediately before JWT creation, supply the
optional `resolveLoginSession` hook:

```ts
await initLti(app, loginOnlyAdapter, {
  connectMode: 'login-only',
  institutionalIdClaim: { source: 'custom', key: 'institution_user_id' },
  resolveLoginSession: async (session) => {
    const linkedUser = await linkVerifiedIdentity({
      user: session.user,
      role: session.role,
      identity: session.identity,
      context: session.contextSnapshot,
      lis: session.lis,
      custom: session.custom,
      courseHints: session.courseHints,
    });
    return {
      user: linkedUser,
      target: `/courses/${encodeURIComponent(session.contextSnapshot.contextId)}`,
      launchMetadata: { source: 'lti', linked: true },
    };
  },
});
```

The returned `user` is passed to `generateJwt()`. `target` must be an
app-relative path (absolute and protocol-relative URLs are rejected), and
`launchMetadata` must be a JSON object. The response includes either field only
when the hook returns it. The hook runs for built-in LTI 1.3 and legacy session
bridges; it is not invoked when `onNormalizedLaunch` owns the response.

No institutional identifier is trusted by default. Select exactly one source
with `institutionalIdClaim`, or use
`LTI_INSTITUTIONAL_ID_CUSTOM_CLAIM=<claim-key>` /
`LTI_INSTITUTIONAL_ID_SOURCE=lis_person_sourcedid`. Ordinary diagnostics log
claim presence and masked fingerprints. Raw PII diagnostics require the
separate `LTI_DEBUG_RAW_CLAIMS=true` switch and still redact credentials.

### Host-delegated content selection

Gateways and other hosts that supply `onNormalizedLaunch` can delegate their
own resource picker while retaining a minimal `LtiLoginOnlyAdapter`. Authenticated
LTI 1.3 Deep Linking requests reach the hook in every `connectMode`; login-only
still means the engine does not install its built-in picker/manage routes.

```ts
import {
  initLti,
  respondToDeepLinking,
} from 'lti-moodle-integration/backend';

await initLti(app, loginOnlyAdapter, {
  connectMode: 'login-only',
  onNormalizedLaunch: async (launch, ctx) => {
    if (!ctx.isDeepLinkingRequest) {
      return handleNormalLaunch(launch, ctx);
    }

    const resource = await chooseResource(launch);
    return respondToDeepLinking(ctx, [{
      type: 'ltiResourceLink',
      title: resource.name,
      url: 'https://tool.example/lti/launch',
      custom: { resource_id: resource.id },
    }], {
      message: 'Activity configured successfully.',
    });
  },
});
```

`ctx.deepLinking` is an authenticated response capability. Its `respond()`
method returns a signed auto-submit form; `respondToDeepLinking()` sends that
form on the current response as a convenience. A host can instead retain the
facade server-side while an external picker completes and send the returned
form from its completion endpoint. The engine-held platform key or consumer
secret remains captured inside the facade and is never exposed to the host.
LTI 1.1 Content-Item delegation requires
`legacyLti: true` and `legacyDeepLinking: true`, supports
`ltiResourceLink` items, and rejects 1.3-only item types rather than converting
them lossily. Retained facades are in-memory capabilities: multi-instance or
restart-safe hosts must provide sticky routing or treat a lost capability as an
expired selection and ask the instructor to restart.

---

## LTI 1.0a / 1.1 support (legacy LMS)

Some institutions still run LMSs (or LMS configurations) that only speak **LTI
1.0a / 1.1** — an OAuth 1.0a HMAC-SHA1-signed HTML form POST with a shared
*consumer key/secret*, with **no** OIDC login round-trip and **no** signed JWT.
This module can accept those launches in parallel with the modern 1.3 path. It is
**off by default**; the 1.3 behaviour is unchanged unless you opt in.

### Enable it

```ts
import {
  initLti,
  createInMemoryNonceStore,        // single-instance default; swap for a shared store in prod
} from 'lti-moodle-integration/backend';
import { myConsumerStore } from './lti/consumerStore'; // resolves the shared secret by consumer key

await initLti(app, adapter, {
  mountPath: '/api/v1/lti',
  legacyLti: true,                 // or LTI_LEGACY_ENABLED=true
  consumerStore: myConsumerStore,  // REQUIRED — see below
  launchTicketSecret: process.env.LTI_LAUNCH_TICKET_SECRET, // falls back to bindTokenSecret
  legacyDeepLinking: true,         // optional — Content-Item picker (LTI_LEGACY_DEEP_LINKING)
  // nonceStore, gradeLinkStore, legacyMountPath, legacyTimestampWindowSeconds all optional
});
```

The legacy router mounts at `${mountPath}${legacyMountPath}` (default
`/api/v1/lti/legacy`). Register this as the tool launch URL in the old LMS:

| Field | Value |
|---|---|
| Launch URL | `https://yourserver.com/api/v1/lti/legacy/launch` |
| Consumer key | the key you stored via the consumer admin |
| Shared secret | the matching secret |

### Consumer store (required)

LTI 1.0a/1.1 has no key discovery — you must hold the shared secret. Implement the
`LtiConsumerStore` interface (one method) so the verifier can look up the secret
for an incoming `oauth_consumer_key`:

```ts
import type { LtiConsumerStore } from 'lti-moodle-integration/backend';

export const myConsumerStore: LtiConsumerStore = {
  async resolveConsumer(consumerKey, tenantId) {
    const doc = await LtiConsumerModel.findOne({ consumerKey, enabled: true });
    return doc ? { consumerKey: doc.consumerKey, secret: doc.secret, tenantId: doc.tenantId } : null;
  },
};
```

A reference `LtiConsumerModel` (Mongoose) and store example ship at
`backend/src/models/LtiConsumerModel.mongoose.ts` and
`backend/src/stores/consumerStore.mongoose.example.ts`. For an admin UI, mount the
write-only-secret CRUD router:

```ts
import { createLtiConsumerAdminRouter } from 'lti-moodle-integration/backend';
app.use('/api/v1/lti/consumers', createLtiConsumerAdminRouter({
  adminMiddleware: [protect, authorize('admin')],
  store: myConsumerAdminStore, // see stores/consumerAdminStore.mongoose.example.ts
}));
```

### Session bridge (the 1.1 analogue of `ltik`)

A 1.1 launch has no ltijs `ltik`. After a valid OAuth 1.0a launch the router mints
a short-lived **signed launch ticket** and redirects the SPA to
`/lti/launch?ticket=…`. The shipped `LtiLaunchView.vue` / `LtiLaunch.tsx` already
detect `?ticket=` and exchange it at the legacy `/session` endpoint for your app
JWT — same UX as the 1.3 flow. If your frontend uses a non-default legacy mount,
set it once at startup: `configureLtiApi({ legacyBase: '/api/v1/lti/legacy' })`.

### Grade passback

The module records the LMS's grade target at launch time (the 1.1 Basic Outcomes
service URL + `sourcedId`, or the 1.3 AGS endpoint) in an `LtiGradeLinkStore`
(in-memory default via `createInMemoryGradeLinkStore`). Push a score with the
unified facade — it dispatches to the right protocol automatically:

```ts
import { sendScore } from 'lti-moodle-integration/backend';

await sendScore({
  userExternalId: '...',   // the LMS user id captured at launch
  contextId: '...',
  resourceLinkId: '...',
  score: 8,
  maxScore: 10,
});
```

- **LTI 1.1 Basic Outcomes** (`legacy/outcomes.ts`) — OAuth 1.0a-signed POX
  `replaceResult` / `readResult` / `deleteResult` with `oauth_body_hash`.
- **LTI 1.3 AGS** (`grades/ags.ts`, **experimental prototype**) — gated behind
  `agsPrototype: true` / `LTI_AGS_PROTOTYPE`. Built on ltijs's Grade service; not
  production-hardened.

### Production notes

- The default `nonceStore` / `gradeLinkStore` are **in-memory** (single instance
  only). For multi-instance deployments supply durable, shared implementations
  (reference Mongoose `LtiGradeLinkModel` + store example are provided).
- Keep `legacyTimestampWindowSeconds` tight (default 300s) and ensure server
  clocks are synced — OAuth 1.0a replay protection depends on it.
- Shared secrets are long-lived bearer credentials; store them encrypted/at rest
  and rotate via the consumer admin. The admin API never returns a secret.

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
- [docs/LTI_INTEGRATION_MANUAL.md](docs/LTI_INTEGRATION_MANUAL.md) — end-to-end integration manual covering the launch/bind flows and platform setup.
- [docs/LTI_INTEGRATION_AGENT.md](docs/LTI_INTEGRATION_AGENT.md) — condensed, agent-oriented brief of the same integration steps.

## License

Licensed under the [Apache License 2.0](LICENSE), Copyright 2026 HKU TALIC — see
[`NOTICE`](NOTICE) for attribution. Originally extracted from the TALIC Chatbot
project (HKU TALIC) and made framework-agnostic for reuse.
