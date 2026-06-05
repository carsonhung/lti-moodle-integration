# Integration Guide

A drop-in checklist for adding this LTI module to an existing Express + Vue **or** Express + React project.

## Prerequisites

- An Express.js backend (v4 or v5).
- A frontend in one of:
  - **Vue 3** + Vue Router (works with both Vuex and Pinia for state) — use `frontend/src/views/`.
  - **React 18** + `react-router-dom` v6+ (works with Redux/Zustand/Context for state) — use `frontend/src/react/`.
- A user/course/resource data model already in place — this module *bridges* an LMS to your existing entities, it doesn't create them.

The minimum domain entities you need are:

| Entity | What it must have |
|---|---|
| **User** | `id`, `email`, `name`, `roles[]` (must include at least `'student'`, `'teacher'`, `'admin'`) |
| **Course** | `id`, `name`. Ideally also `code`, `course_id` (the institutional course code, e.g. "ENGL1011"), `semester`, `year` |
| **Resource** (the "thing" launched from Moodle — agent, bot, quiz, etc.) | `id`, `name` |
| **CourseTeachers** + **CourseStudents** join tables (or array fields on Course) | for enrollment |
| **CourseResources** join table (or array field on Course) | for attaching resources to courses |

If you don't have all of these, set up minimal versions before continuing. The module is most useful when your app already has the "Course → Resource" model the deep-link flow expects.

## Step-by-Step

### Step 1 — Copy the backend module

```bash
# From the lti-moodle-integration/ folder:
cp -r backend/src <your-backend>/src/lti
```

The folder must end up at `<your-backend>/src/lti/` (or any path) with:

- `index.ts`, `types.ts`, `core.ts`, `helpers.ts`, `deepLinkingUI.ts`, `adminRouter.ts`
- `adapters/` — keep only the ONE adapter you'll use
- `models/` — keep only the schema files for your DB

### Step 2 — Install backend dependencies

```bash
cd <your-backend>
npm install ltijs jsonwebtoken
npm install -D @types/jsonwebtoken
```

**For SQL-backed deployments** (Postgres / MySQL / MariaDB / MSSQL / SQLite), also install [`ltijs-sequelize`](https://www.npmjs.com/package/ltijs-sequelize) and the matching driver — this lets `ltijs` back its internal state (registered platforms, OIDC nonces, JWK keypair) in your SQL store instead of MongoDB:

```bash
npm install ltijs-sequelize sequelize pg            # Postgres
# or: npm install ltijs-sequelize sequelize mysql2  # MySQL / MariaDB
# or: npm install ltijs-sequelize sequelize sqlite3 # SQLite (great for dev)
```

You then pass the plugin instance to `initLti` via `dbPlugin` (see Step 5). When `dbPlugin` is set, `LTI_DB_URL` is ignored.

### Step 3 — Create the LTI tables

**Mongoose**: rename `LtiCourseMapModel.mongoose.ts` → `LtiCourseMapModel.ts` and same for the binding model. They self-register with Mongoose on first import.

**Drizzle**: add the schema to your central schema barrel:

```typescript
// src/db/schema/index.ts
export * from './users';
export * from './courses';
export * from './lti';     // ← add this
```

Then run a migration: `pnpm drizzle-kit generate && pnpm drizzle-kit migrate`.

**Other Postgres**: run `models/schema.sql` against your database. Adjust the foreign-key tables (`users`, `courses`, `resources`, `categories`) to match your schema.

### Step 4 — Implement your adapter

Open the example adapter (`adapters/mongoose.example.ts` or `adapters/drizzle.example.ts`) and:

1. Replace the placeholder model imports at the top with your real imports.
2. Adjust any column name differences.
3. Set the three UI strings (`deepLinkPageTitle`, `resourceLabel`, `customFieldPrefix`).
4. For single-tenant apps, leave the tenant methods as-is — they're no-ops.
5. Save as e.g. `adapters/myAdapter.ts`.

Each adapter method's contract is fully documented in `types.ts`. The "easy" ones to start with:

- `resolveTeacherByEmail` — single email lookup, return the user or null.
- `upsertUser` — find or create a user by email.
- `generateJwt` — sign an app JWT for the user. The example uses `jsonwebtoken` with your `JWT_SECRET`.
- `listCoursesForTeacher` — list the teacher's courses.
- `getCourseById` — get a course by id.

If you skip category methods (`listSelectableCategories?`, `getCategoryById?`, `listCategoryAgents?`), the frontend Deep Linking UI hides the category toggle automatically — pass `:category-supported="false"` to `<LtiDeepLinkView>` (Vue) or `<LtiDeepLink categorySupported={false} />` (React).

### Step 5 — Wire into your Express server

Add to your server entry (after `app = express()` and middleware setup):

```typescript
import { initLti, createLtiAdminRouter, setLtiLogger } from './lti';
import { myAdapter } from './lti/adapters/myAdapter';
import { protect, authorize } from './middleware/auth';
import logger from './utils/logger';

setLtiLogger(logger);

const ltiAdminRouter = createLtiAdminRouter({
  adminMiddleware: [protect, authorize('admin')],
  logger,
});
app.use('/api/v1/lti', ltiAdminRouter);

// inside boot() / before app.listen():
await initLti(app, myAdapter, { mountPath: '/api/v1/lti' });
```

**SQL-backed variant** — drop in a `ltijs-sequelize` instance and skip `LTI_DB_URL` entirely:

```typescript
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

await initLti(app, myAdapter, { mountPath: '/api/v1/lti', dbPlugin: ltiDb });
```

**Login-only variant** (LTI as an SSO replacement, no teacher resource picker):

```typescript
import { loginOnlyAdapter } from './lti/adapters/login-only';

await initLti(app, loginOnlyAdapter, {
  mountPath: '/api/v1/lti',
  skipDeepLinking: true,
  loginOnlyLaunchPath: '/lti/launch',  // your SPA's bridge route
  dbPlugin: ltiDb,                     // or set LTI_DB_URL for Mongo
});
```

In login-only mode the core skips registering every `/deeplink/*`, `/launch/manage`, and `/category/*` route, and never invokes adapter methods related to courses/resources/bindings — so the adapter is just 3 methods (`upsertUser`, `generateJwt`, `resolveEffectiveTenant`). See `adapters/login-only.example.ts` for a complete reference.

**Important order of operations:**

1. Mount `ltiAdminRouter` BEFORE `initLti(...)`. They share the same path prefix.
2. `initLti` is async — await it before calling `app.listen`.
3. The LTI mount path must match `LTI_MOUNT_PATH` env var.

### Step 6 — CORS + Helmet adjustments

LTI launches use form POSTs from Moodle (not AJAX), and the UI runs inside Moodle's iframe. Adjust your security middleware:

```typescript
import helmet from 'helmet';
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    xFrameOptions: false,
  })
);

// Skip strict CORS allowlist for LTI routes (they POST with Origin: null)
app.use((req, res, next) => {
  const isLti = req.path.startsWith('/api/v1/lti');
  if (isLti) {
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  }
  return corsMiddleware(req, res, next);
});
```

#### Body parsers — skip them for the LTI mount path

> ⚠️ **Common gotcha — `stream is not readable` on `/login`.** `ltijs` registers its
> **own** body parsers on its routes (the OIDC `/login` POST and the `/launch` POST are
> `application/x-www-form-urlencoded`). If your app-level `express.json()` /
> `express.urlencoded()` run first, they read and **drain** the request stream, so when
> `ltijs` tries to parse the body again `raw-body` throws `stream is not readable` and the
> launch fails. The parsers must be **after** the CORS block but **skip the LTI mount path**:

```typescript
// Let ltijs own body parsing on its own routes.
const skipLti = (parser: express.RequestHandler): express.RequestHandler => (req, res, next) => {
  if (req.path.startsWith('/api/v1/lti')) return next();   // ← your LTI_MOUNT_PATH
  return parser(req, res, next);
};
app.use(skipLti(express.json({ limit: '1mb' })));
app.use(skipLti(express.urlencoded({ extended: true })));
```

Use the same `LTI_MOUNT_PATH` value you pass to `initLti`. This is the single most common
reason a launch that *should* work returns a 500 from the very first Moodle redirect.

### Step 7 — Copy the frontend module

```bash
cp -r frontend/src <your-frontend>/src/lti
```

This copies `api.ts` (framework-neutral, used by both flavours), the Vue components in `views/`, and the React components in `react/`. You can delete whichever framework folder you don't use. In your `main.ts` / `main.tsx`:

```typescript
import { configureLtiApi } from './lti/api';
configureLtiApi({
  ltiBase: '/api/v1/lti',
  apiBase: '/api/v1',
});
```

> The rest of this section has a **Vue** and a **React** track. Follow the one matching your frontend.

### Step 8 — Add the routes

**Vue** — open `frontend/src/lti/router-integration.example.ts` and copy the `ltiRoutes` array into your router. Make them **public** (no auth guard):

```typescript
router.beforeEach((to, from, next) => {
  if (to.name?.toString().startsWith('Lti')) return next();
  if (to.meta?.public) return next();
  if (!isAuthenticated()) return next({ name: 'Login' });
  return next();
});
```

**React** — install the peers, then copy the routes from `frontend/src/lti/react/routes-integration.example.tsx` into your `react-router-dom` config. Keep `/lti/launch` (and `/lti/deeplink`) **public**; gate `/admin/lti-platforms` with your own admin wrapper:

```bash
npm install react react-dom react-router-dom axios
```

```tsx
import { LtiLaunch } from './lti/react/LtiLaunch';
import { LtiDeepLink } from './lti/react/LtiDeepLink';
import { LtiPlatformsAdmin } from './lti/react/LtiPlatformsAdmin';

const router = createBrowserRouter([
  { path: '/lti/launch', element: <LtiLaunch /> },          // public
  { path: '/lti/deeplink', element: <LtiDeepLink /> },      // public
  { path: '/admin/lti-platforms', element: <RequireRole role="admin"><LtiPlatformsAdmin /></RequireRole> },
  // ...your other routes
]);
```

### Step 9 — Fill in the launch view integration hooks

**Vue** — open `src/lti/views/LtiLaunchView.vue` and edit the section marked `INTEGRATION HOOKS`:

1. `persistToken(token, expiresInSec, tenant)` — call your auth store's `setToken`/`setTenant`.
2. `loadProfile()` — call your `/auth/me` (or equivalent) and return the user.
3. `targetRouteFor()` — return the route name + params for your app. The default assumes routes named `Welcome`, `StudentTopic`, `TeacherTopic`, `AdminTopic`, `LtiCategory`.

If your app uses Pinia, a minimal hook looks like:

```typescript
async function persistToken(token, expiresInSec, tenant) {
  const auth = useAuthStore();
  await auth.setToken(token, expiresInSec);
  if (tenant) useTenantStore().setTenant(tenant);
}

async function loadProfile() {
  const auth = useAuthStore();
  await auth.fetchProfile();
  return auth.user;
}
```

**React** — open `src/lti/react/LtiLaunch.tsx` and edit the same three hooks at the top of the file:

1. `persistToken(token, expiresInSec, tenant)` — write the JWT into your store and set the axios header.
2. `loadProfile()` — fetch the signed-in user (return `null` to skip role-based routing).
3. `targetRouteFor()` — return a `{ path, query? }` for your app. The default assumes paths `/welcome`, `/student/topic/:id`, `/teacher/topic/:id`, `/admin/topic/:id`, `/lti/category/:id`.

With Zustand, a minimal hook looks like:

```tsx
async function persistToken(token, expiresInSec, tenant) {
  useAuthStore.getState().setToken(token, expiresInSec * 1000);
  if (tenant) useTenantStore.getState().setTenant(tenant);
  axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
}

async function loadProfile() {
  await useAuthStore.getState().fetchProfile();
  return useAuthStore.getState().user;
}
```

### Step 10 — Set environment variables

Copy `.env.example` → your backend `.env` and set at minimum:

```env
LTI_ENABLED=true
LTI_ENCRYPTION_KEY=<32-char hex string>
LTI_DB_URL=<your db url; can be the same as your main DB url>
LTI_MOUNT_PATH=/api/v1/lti
LTI_LTIAAS_MODE=true
```

Generate the encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### Step 11 — Restart, verify, and test

```bash
# Verify the JWK set is reachable
curl https://yourserver.com/api/v1/lti/keys

# Verify the platform was registered (after setting LTI_PLATFORM_* vars)
# Should log: [LTI] Platform registered/updated from env
```

Then follow [MOODLE_SETUP.md](MOODLE_SETUP.md) to configure the matching external tool in Moodle and run a test launch.

## Verifying the Adapter

Run a test launch and watch your backend logs. You should see, in order:

```
[LTI] onConnect — launch received {...email, role, contextId, resourceLinkId}
[LTI] onConnect — resolution {bindingFound: false, resolvedFrom: 'none'}
[LTI] onConnect — teacher redirect to management page    # for teachers
# or
[LTI] onConnect — no resource resolved, showing "not configured"  # for students before deep linking
```

After deep linking:

```
[LTI] /deeplink/data — gathered {courseCount: N, suggestedCount: M}
[LTI] /deeplink/course/:id/agents — loaded {agentCount: K}
[LTI] /deeplink/submit — received {courseId, agentId}
[LTI] /deeplink/submit — binding saved
[LTI] /deeplink/submit — deep link response sent to Moodle
```

After a student launch:

```
[LTI] onConnect — launch received {role: 'student'}
[LTI] onConnect — student redirect {target: 'https://app.example.com/lti/launch?agentId=...'}
[LTI] /session — bridge request {email, role}
[LTI] Auto-enrolled learner into course   # if LTI_AUTO_ENROLL_STUDENTS=true
[LTI] Session tenant resolved {tenantId}
```

If you don't see these, look for the corresponding `[LTI] ... failed` line to find the error.

## Common Customisations

### Different resource label ("Bot" instead of "Agent")

In your adapter:

```typescript
export const myAdapter: LtiAdapter = {
  deepLinkPageTitle: 'Configure Bot Activity',
  resourceLabel: 'Bot',
  customFieldPrefix: 'mybot', // → custom param keys: mybot_course_id, mybot_resource_id
  ...
};
```

Both the Vue and React Deep Linking UIs read `pageData.resourceLabel` and render all related strings dynamically.

### Skip the Teacher Manage page

Set the `teacherLaunchUrl` option:

```typescript
await initLti(app, myAdapter, {
  teacherLaunchUrl: 'https://app.example.com/teacher/agents/{resourceId}?courseId={courseId}',
});
```

Teachers will go straight to that URL on a normal launch (after Deep Linking).

### Custom JWT signing (asymmetric, refresh tokens, etc.)

Override `generateJwt` in your adapter — return whatever string you want as `token` and the lifetime as `expiresIn`. The launch view stores both in localStorage and on `axios.defaults.headers.common['Authorization']`.

### Embed mode (no SPA shell, just the resource)

Set `LTI_LAUNCH_DESTINATION=embed`. Students will be redirected to `/embed/:resourceId` instead of `/lti/launch?agentId=...`. Useful for resource-focused widgets without the full app chrome.

## Reverse-Proxy Configuration

If you're behind nginx or another reverse proxy, make sure:

```nginx
location /api/v1/lti {
    # Pass through X-Forwarded headers (so req.protocol works correctly)
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://backend:5000;

    # LTI launches use form POSTs; allow longer bodies + idle timeout
    client_max_body_size 1m;
    proxy_read_timeout 120s;
}
```

Set `app.set('trust proxy', 1)` in your Express server so it honours `X-Forwarded-Proto`.
