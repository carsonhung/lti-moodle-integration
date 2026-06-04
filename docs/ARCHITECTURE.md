# Architecture

## Module Layout

```
┌──────────────────────────────────────────────────────────┐
│  LTI Core (generic, no DB knowledge)                     │
│  ┌────────────┐ ┌───────────┐ ┌──────────────────┐       │
│  │  core.ts   │ │ helpers.ts│ │ deepLinkingUI.ts │       │
│  │  ltijs +   │ │  pure     │ │ server-rendered  │       │
│  │  routes +  │ │  utils    │ │ HTML fallbacks   │       │
│  │  handlers  │ │           │ │ (Vue UI in       │       │
│  │            │ │           │ │  frontend/)      │       │
│  └─────┬──────┘ └───────────┘ └──────────────────┘       │
│        │ calls adapter.*()                               │
├────────┼─────────────────────────────────────────────────┤
│        ▼                                                 │
│  ┌──────────────────────────────┐                        │
│  │  LtiAdapter interface        │   (types.ts)           │
│  │  - resolveTeacherByEmail()   │                        │
│  │  - listCoursesForTeacher()   │                        │
│  │  - listSelectableResources() │                        │
│  │  - upsertCourseMap()         │                        │
│  │  - generateJwt()             │                        │
│  │  - ...30+ methods            │                        │
│  └──────────────┬───────────────┘                        │
│                 │                                        │
├─────────────────┼────────────────────────────────────────┤
│  Adapters       │  (project-specific)                    │
│  ┌──────────────┴───────────────┐                        │
│  │  mongoose.example.ts         │  ← ready-to-copy       │
│  │  (or) drizzle.example.ts     │  ← ready-to-copy       │
│  │  (or) write your own         │                        │
│  └──────────────────────────────┘                        │
└──────────────────────────────────────────────────────────┘
```

## Core Design Principles

### 1. Adapter Pattern — Core Never Touches the Database

`core.ts` calls `adapter.methodName()` for every project-specific operation. It never imports Mongoose, Drizzle, Supabase, or any DB library. New projects implement `LtiAdapter` (in `types.ts`) for their own data layer.

This is what makes the module portable. You can switch from MongoDB to Postgres without touching `core.ts`.

### 2. Shared Types Are Protocol-Agnostic

Types in `types.ts` (`LtiUser`, `LtiCourse`, `LtiResource`, `LtiPlatformContext`, etc.) describe **domain concepts**, not protocol details. If a future LTI 1.0/1.1 engine is added, both protocols would map their payloads to the same shared types.

### 3. Helpers Are Pure Functions

`helpers.ts` has no side effects, no DB access, no Express middleware — just token parsing and URL helpers. Use them anywhere.

## LTI 1.3 Flow

```
LMS (Moodle)                    Tool (this module)              Your App (Vue)
     │                               │                              │
     │  1. OIDC Login Request        │                              │
     │  POST /lti/login ────────────▶│                              │
     │                               │                              │
     │  2. Auth redirect             │                              │
     │◀──────────────────────────────│                              │
     │                               │                              │
     │  3. LTI Launch (id_token)     │                              │
     │  POST /lti/launch ───────────▶│                              │
     │                               │  4. Validate JWT             │
     │                               │  5. Find resource binding    │
     │                               │  6. Redirect to /lti/launch?ltik=… │
     │                               │───────────────────────────▶  │
     │                               │                              │
     │                               │  7. Session bridge call      │
     │                               │◀──── GET /lti/session ───────│
     │                               │  8. Exchange ltik → app JWT  │
     │                               │───── { token, role } ──────▶ │
     │                               │                              │
     │                               │  9. Vue Router navigates to  │
     │                               │     /agents/:id, /lti/category/:id, etc.
```

## Deep Linking Flows

Two flows exist, both submitting to the same `/deeplink/submit` backend endpoint:

| Mode | Entry Point | When Used |
|------|-------------|-----------|
| **Inline iframe (Vue)** | Moodle "Select content" → `/lti/deeplink` (popupMode=false) | Initial activity setup |
| **Popup window** | Teacher Manage page → `/lti/deeplink?popup=1` | Reconfiguring an existing activity |

In **inline mode**, the Vue form posts to `/deeplink/submit?format=json`, receives `{ jwt, returnUrl }`, and navigates the iframe back to Moodle's `deep_link_return_url` with the signed JWT.

In **popup mode**, the Vue form is opened in a separate browser window. The popup posts the selection back to the launcher iframe via `window.postMessage`, which then submits the deep link response form to Moodle. (For reconfigure, no deep-link return URL is present, so the popup just closes after persisting the binding.)

## Storage Model

Two LTI-specific tables (or Mongoose collections):

### `lti_course_maps`

One row per **LMS course context**. Maps `(issuer, clientId, deploymentId, contextId)` → your app's `courseId`. Created on Deep Linking + auto-mapping; reused on subsequent launches from the same Moodle course.

### `lti_resource_bindings`

One row per **LMS activity** (resource link). Adds `resourceLinkId` to the same context tuple, plus either `resourceId` (single-resource binding) or `categoryId` (category binding). This is what the launch flow reads to decide where to redirect.

In addition, ltijs maintains its own internal tables (`lti_*`) for storing platform metadata, public keys, nonces, etc. These are managed automatically; you don't write to them directly.

## Multi-Tenant Support

For multi-tenant apps:

1. Have your `Course` (and `Resource`) tables include a `tenantId` column.
2. In your adapter, filter all queries by `tenantId`.
3. Implement `resolveEffectiveTenant()` and `getTenantMode()` to return the active tenant.
4. The core stamps `tenantId` on every `upsertCourseMap` / `upsertResourceBinding` automatically.
5. On launch, the `/session` route resolves tenant from the binding and returns it in the response so the frontend can scope further requests.

Single-tenant apps just return `undefined` from `resolveEffectiveTenant()` and `getTenantMode()` — all the multi-tenant code paths become no-ops.

## Logging Convention

Every log call inside the core uses `logInfo` / `logWarn` / `logError`, which:

1. Wrap structured metadata into a single JSON-serialised string.
2. Forward to the injected logger (or `console` by default).

To use your own logger:

```typescript
import { setLtiLogger } from './lti';
setLtiLogger({
  info: (msg) => myLogger.info(msg),
  warn: (msg) => myLogger.warn(msg),
  error: (msg) => myLogger.error(msg),
});
```

## When Modifying the Module

| Change | File(s) to Touch |
|--------|-------------------|
| New adapter method needed | `types.ts` (interface) + your adapter implementation |
| New route | `core.ts` (register on `lti.app`, not `app`) |
| Change deep link UI text/layout | `frontend/src/views/LtiDeepLinkView.vue` |
| New helper function | `helpers.ts` (keep pure) |
| Platform CRUD changes | `adminRouter.ts` |
| Server-rendered fallback page | `deepLinkingUI.ts` |
