# LTI 1.3 Integration Manual

A self-contained reference for integrating an Express + SPA application with a
Learning Management System (Moodle and other LTI 1.3 platforms) using the
portable `lti-moodle-integration` package. This document is written for people:
it explains the choices, recommends a path, and gives step-by-step setup. A
companion document, `LTI_INTEGRATION_AGENT.md`, contains the same decisions in a
form an AI coding agent can execute.

> This manual is intentionally self-contained (no cross-file links) so it
> converts cleanly to PDF/Word. File paths are shown in `code font`.

---

## Contents

1. What this integration does
2. Choosing a connect mode (start here)
3. The three connect modes in detail
4. Real-world use cases (three live deployments)
5. Prerequisites
6. The adapter (how the package stays portable)
7. Moodle external-tool setup
8. Environment variables
9. Per-link grouping binding without Deep Linking
10. Troubleshooting
11. Verification checklist

---

## 1. What this integration does

LTI 1.3 (Learning Tools Interoperability) lets an LMS launch your application
from inside a course. The package handles the LTI 1.3 handshake (OIDC login,
signed launch validation, key management) and bridges the launching user into a
normal application session (your own JWT). Everything specific to your app —
users, courses, the "thing" a launch opens — is delegated to an **adapter** you
implement, so the LTI core never touches your database.

What LTI 1.3 gives you out of the box: single sign-on, the user's role
(instructor vs. student), and the course/activity context. What it does **not**
give you: a way to push groups or rosters back into the LMS. Group data flows
back via CSV export, not LTI.

---

## 2. Choosing a connect mode (start here)

A deployment runs in exactly one **connect mode**. The mode is the single most
important decision; it determines the Moodle-side setup, the adapter size, and
what a launch opens.

```
                ┌─────────────────────────────────────────┐
                │  Does the LMS need to know WHICH content  │
                │  a given activity opens?                  │
                └───────────────┬───────────────┬───────────┘
                                │ No            │ Yes
                                ▼               ▼
                   ┌────────────────────┐   ┌───────────────────────────────┐
                   │  LOGIN-ONLY        │   │  Does your LMS expose Deep      │
                   │  Moodle = SSO only │   │  Linking ("Select content")?    │
                   │  lands on dashboard│   └───────────┬───────────────┬─────┘
                   └────────────────────┘               │ No           │ Yes
                                                         ▼              ▼
                                          ┌──────────────────────┐  ┌──────────────────┐
                                          │  CONTEXT-MAPPING      │  │  DEEP-LINKING     │
                                          │  plain external tool  │  │  teacher picks    │
                                          │  course mapped on     │  │  content in a     │
                                          │  launch; activity can │  │  Moodle picker    │
                                          │  bind to a target via │  │                   │
                                          │  the app (no DL)      │  │                   │
                                          └──────────────────────┘  └──────────────────┘
```

**Recommendation:** prefer **login-only** or **context-mapping**. Both work with
a plain external-tool launch and require no special LMS capability. Treat
**deep-linking** as optional and LMS-dependent: many production Moodle instances
(including HKU's) disable "Select content", so an integration that depends on
Deep Linking can fail in production even if it worked in a test environment
(see §4).

| Mode | LMS requirement | A launch opens | Adapter size | Recommended? |
|------|-----------------|----------------|--------------|--------------|
| `login-only` | none | the dashboard (SSO) | ~3 methods | Yes |
| `context-mapping` | plain external tool | a course, then a target chosen in-app | full adapter | Yes |
| `deep-linking` | "Select content" enabled | a specific resource (teacher picked it in Moodle) | full adapter | Only if your LMS supports it |

---

## 3. The three connect modes in detail

### 3.1 Login-only

The launch is treated purely as identity. The package validates the launch,
provisions or matches the user, mints your application JWT, and drops the user on
your dashboard. No course or activity binding is involved. This is the smallest
integration: the adapter only needs to resolve/create a user and sign a JWT.

```
Moodle ──launch──▶ LTI core ──redirect──▶ SPA /lti/launch?ltik=…
                       │
                       └─ exchange ltik → app JWT → land on dashboard
```

### 3.2 Context-mapping (recommended default)

A plain external-tool launch. On a **teacher** launch the package matches or
auto-creates an application course from the Moodle course context and stores a
`context → course` map; the teacher lands in the app to manage the course. On a
**student** launch the course is resolved from that map and the student is
auto-enrolled.

On top of the course mapping, each individual activity can optionally bind to a
specific **target** (in this app, a *grouping*) using its `resource_link_id` —
**without** Deep Linking. See §9 for how that works. This is the key capability
that makes context-mapping a full replacement for Deep Linking on an LMS that
doesn't expose the content picker.

### 3.3 Deep-linking

Requires the LMS to expose Deep Linking ("Select content"). When a teacher adds
the activity, the tool shows a content picker inside Moodle; the teacher's choice
is written back into the activity and drives where every later launch lands. This
is the richest flow but only works where the LMS allows it.

```
Moodle "Select content" ──▶ tool picker ──▶ teacher picks course + resource
                                                   │
                              binding saved ◀───────┘ + signed response to Moodle
later launch ──▶ resolve binding ──▶ land on the bound resource
```

---

## 4. Real-world use cases (three live deployments)

One package serves three HKU TELI deployments. Each maps the package's generic
`course` / `resource` concepts to its own domain and picks a connect mode. This
grounds the abstract modes in concrete examples — and shows why the
no-Deep-Linking paths are the safe default.

| Deployment | Connect mode | A launch opens | How the binding is set | Adapter surface |
|---|---|---|---|---|
| **Learnity** | login-only | nothing — SSO/identity only, lands on dashboard | n/a | ~3 methods (login-only adapter) |
| **talicchatbot** | Deep Linking (test only) → `resource_id` binding workaround in production | an agent / chatbot | originally Moodle "Select content"; production binds on `resource_link_id` via the tool's own manage page (Deep Linking disabled in prod) | full adapter |
| **moodle grouping** (this app) | context-mapping | a grouping | in-app, bound on `resource_link_id` via a bind token (no Deep Linking) | full adapter |

> **Production lesson.** Deep Linking works in a permissive test Moodle, but
> institutional/production Moodle admins frequently disable "Select content".
> talicchatbot hit exactly this and switched to a `resource_id` binding
> workaround. That is why this manual recommends login-only or context-mapping
> and treats Deep Linking as optional. Both talicchatbot (a server-rendered
> manage page) and moodle grouping (an in-app SPA banner) bind on the same
> stable `resource_link_id` — only the binding UI differs.

### One package, three apps

```
                         ┌───────────────────────────────────────┐
                         │  lti-moodle-integration core            │
                         │  (ltijs + onConnect launch handling)    │
                         └───────────────────┬─────────────────────┘
                                             │ delegates to
                                   ┌─────────▼──────────┐
                                   │  LtiAdapter         │
                                   │  (implemented per   │
                                   │   application)      │
                                   └──┬───────┬───────┬──┘
              ┌───────────────────────┘       │       └────────────────────────┐
              ▼                                ▼                                ▼
   ┌────────────────────┐        ┌───────────────────────────┐    ┌──────────────────────────┐
   │ Learnity            │        │ talicchatbot              │    │ moodle grouping (this app)│
   │ login-only          │        │ resource_id binding (prod)│    │ context-mapping           │
   │ launch = SSO only   │        │ resource = agent; bound   │    │ resource = grouping;      │
   │ → dashboard         │        │ on resource_link_id       │    │ bound in-app on           │
   │                     │        │ (Deep Linking was         │    │ resource_link_id          │
   │                     │        │  test-only)               │    │                           │
   └────────────────────┘        └───────────────────────────┘    └──────────────────────────┘
```

### The `resource_id` binding pattern (no Deep Linking)

This is the context-mapping pattern, highlighted because it is what you use when
the LMS has no Deep Linking. The teacher binds the activity to a target from
inside the application; the launch identity is carried securely by a short-lived
signed **bind token**.

```
Moodle              LTI core                 App SPA                 App bind API
  │  teacher launch    │                         │                         │
  │  (resource_link_id,│                         │                         │
  │   no binding) ────▶│                         │                         │
  │                    │ resolve course (map);   │                         │
  │                    │ mint signed bindToken   │                         │
  │                    │ ── redirect courseId ──▶│                         │
  │                    │    + bindToken          │                         │
  │                    │                         │ show "link this         │
  │                    │                         │ activity to a target"   │
  │                    │                         │ banner                  │
  │                    │                         │ ── POST bind ──────────▶│
  │                    │                         │   {bindToken, targetId} │
  │                    │                         │       verify token;     │
  │                    │                         │       authz teacher;    │
  │                    │                         │       save binding      │
  │                    │                         │ ◀──── { targetId } ─────│
  │                    │                         │ navigate to the target  │
  │  Later launches (any role) resolve the binding and go straight to the target
```

### talicchatbot: testing vs production

talicchatbot binds a resource link to either an `agent` (one chatbot) or a
`category` (a set of agents), keyed on the `resource_link_id`. Only the way the
binding is *written* changed between environments; the launch-time resolution is
identical.

**Testing Moodle (Deep Linking ON — the original plan):**

```
Teacher ─ "Select content" ▶ Moodle ─ deep-linking request ▶ talicchatbot picker
                                                                   │
                          binding saved (agent/category) ◀──────────┘
                          signed ContentItem JWT ─▶ Moodle stores the resource link
Student click ─▶ onConnect resolves the binding by resource_link_id ─▶ agent
```

**Production Moodle (Deep Linking OFF — the `resource_id` binding workaround):**

```
Teacher ─ add External Tool (plain, no "Select content") ▶ Moodle
Teacher ─ click the activity ▶ Moodle ─ normal launch ▶ talicchatbot /launch/manage page
                                                              │
                       teacher picks course + agent/category │
                       POST update → save binding ◀───────────┘  (keyed on resource_link_id)
Student click ─▶ onConnect resolves the binding by resource_link_id ─▶ agent
```

(Alternative production path: the teacher types custom parameters
`talic_course_id` / `talic_resource_id` on the activity; `onConnect` uses them
as the fallback when no stored binding exists.)

**Contrast with moodle grouping:** the same `resource_link_id` binding idea, but
the teacher binds in the app SPA (a bind-token banner) and the bound entity is a
grouping, not an agent/category.

---

## 5. Prerequisites

- An Express backend (v4 or v5) reachable over public HTTPS.
- A SPA frontend (this app uses Vue 3) with a public `/lti/launch` bridge route.
- A data model with at least: **User** (`id`, `email`, `name`, `roles[]`),
  **Course** (`id`, `name`, ideally an institutional `course_id`), and — for
  context-mapping/deep-linking — the "target" entity a launch opens (here, a
  **Grouping** within a course).
- A datastore for the LTI package's own state (registered platforms, keys,
  nonces): MongoDB, or a SQL database via the `ltijs-sequelize` plugin.

---

## 6. The adapter (how the package stays portable)

The LTI core calls an **adapter** for every application-specific operation and
never imports a database library. You implement the adapter once for your stack.

- **Login-only** needs a tiny adapter: resolve/create a user, sign a JWT, and a
  no-op tenant method.
- **Context-mapping and deep-linking** need the full adapter: user resolution,
  course lookup/provisioning, the course map (`findCourseMap` /
  `upsertCourseMap`), and the resource binding (`findResourceBinding` /
  `upsertResourceBinding`). In this app the bound "resource" is a grouping, so
  the grouping id is stored in the binding's resource slot.

Three small UI strings on the adapter (`resourceLabel`, a deep-link page title,
and a stable `customFieldPrefix`) let the package speak your domain language.
Keep `customFieldPrefix` constant across deploys — changing it orphans existing
LMS-side configuration.

---

## 7. Moodle external-tool setup

### 7.1 URLs Moodle needs

With the tool mounted at `https://app.example.com` and an LTI mount path of
`/api/lti`:

| Field in Moodle | URL |
|---|---|
| Tool URL / Redirection URI | `https://app.example.com/api/lti/launch` |
| Initiate login URL | `https://app.example.com/api/lti/login` |
| Public keyset URL | `https://app.example.com/api/lti/keys` |

Verify the keyset URL in a browser — it must return a JSON object containing a
`keys` array.

### 7.2 Register the tool

In Moodle: **Site administration → Plugins → Activity modules → External tool →
Manage tools → configure a tool manually**. Set LTI version **1.3**, public key
type **Keyset URL**, and the three URLs above.

- For **context-mapping** and **login-only**: leave **"Supports Deep Linking
  (Content-Item Message)" OFF**. Do not set a Content Selection URL.
- For **deep-linking** only: set "Supports Deep Linking = YES" and a Content
  Selection URL of `https://app.example.com/api/lti/launch`.

Under **Privacy**, set **Share launcher's name = Always** and **Share launcher's
email = Always** (the session bridge fails without the email).

Save the tool, then copy the generated **Client ID**, **Deployment ID**, and the
platform's auth/token/keyset endpoints into your backend configuration (or
register the platform from the in-app admin screen).

### 7.3 Add the activity to a course

**Context-mapping (recommended):**

1. As a teacher, add an **External tool** activity and pick the preconfigured
   tool. Do **not** click "Select content".
2. Save and return to the course, then click the activity once. You land in the
   app with a banner to link the activity to a target (e.g. a grouping). Pick or
   create one.
3. From then on, every launch of that activity goes straight to that target. A
   second activity in the same course gets its own `resource_link_id` and can be
   bound to a different target.

**Deep-linking (only if supported):** add the activity, click "Select content",
pick the content in the tool's picker, and save back to Moodle.

---

## 8. Environment variables

Set these in the backend environment (gate the whole subsystem behind
`LTI_ENABLED`):

| Variable | Purpose |
|---|---|
| `LTI_ENABLED` | Master on/off switch for the LTI subsystem. |
| `LTI_ENCRYPTION_KEY` | Key the LTI package uses for its own state. Keep constant. |
| `LTI_DB_URL` | Datastore for the LTI package's internal state (or use a SQL plugin). |
| `LTI_MOUNT_PATH` | Base path for the LTI routes (e.g. `/api/lti`). |
| `LTI_CONNECT_MODE` | `login-only` \| `context-mapping` \| `deep-linking`. |
| `LTI_BIND_TOKEN_SECRET` | Signs the short-lived bind token used by context-mapping per-link binding. Override in production. |
| `LTI_PLATFORM_*` | Optional: auto-register one platform on boot (URL, client id, auth/token/keyset endpoints). |

---

## 9. Per-link grouping binding without Deep Linking

This is the mechanism that lets each Moodle activity open a *specific* target in
context-mapping mode, with no Deep Linking.

**Why a bind token?** The `resource_link_id` and the platform identifiers are
known only inside the LTI core at launch time, but the teacher chooses the target
later in the SPA (authenticated by the application JWT, not the LTI token). To
bridge that gap securely, the core mints a short-lived **signed bind token**
carrying the launch identity. The SPA returns it to an authenticated bind
endpoint, which verifies the signature before saving the binding — so a client
cannot forge the platform identifiers or the course.

**Teacher flow:** open an unbound activity → land on the course with a "link this
activity to a grouping" banner → pick an existing grouping or create one → the
binding is saved. A teacher launch always carries a fresh bind token, so a bound
activity can also be re-pointed later.

**Student flow:** open a bound activity → auto-enrolled and taken straight to the
grouping. Open an *unbound* activity → shown a "this activity has not been linked
yet — please contact your teacher" page (deliberately not a generic picker).

**Storage:** reuses the existing resource-binding collection keyed on
`(issuer, clientId, deploymentId, contextId, resourceLinkId)`, with the grouping
id stored in the resource slot. No schema change is required.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `stream is not readable` on the login POST | The app-level body parsers are draining the request before the LTI package can read it. Skip the global parsers for the LTI mount path. |
| SPA shows "Missing launch token" | `/lti/launch` was opened directly, or a proxy stripped the `?ltik=` parameter. |
| "LTI launch did not include an email" | In Moodle, set *Share launcher's email = Always*. |
| Iframe blocked (browser third-party cookies) | Enable the LTI package's iframe-friendly mode (URL parameters instead of cookies). |
| Student sees "this activity has not been linked yet" (context-mapping) | Expected for an unbound activity — the teacher must open it once and pick a target. |
| Teacher never sees the "link this activity" banner (context-mapping) | `LTI_BIND_TOKEN_SECRET` is unset (the core then skips minting the bind token), or the launching user didn't resolve to a teacher/admin on the matched course. |
| Deep-linking activity shows "not configured" though a binding exists | The adapter's `customFieldPrefix` doesn't match the prefix used in the launch custom-param fallback. |

---

## 11. Verification checklist

1. With `LTI_ENABLED=true` and the key/DB variables set, the backend boots and
   logs that LTI mounted at the configured path.
2. The keyset URL returns a valid JWK set.
3. The platform is registered (via env vars or the admin screen).
4. A test launch:
   - **login-only:** launch as a student → land on the dashboard, signed in.
   - **context-mapping:** launch as a teacher → land on the course with the bind
     banner → pick a grouping → relaunch as a student → land on that grouping,
     auto-enrolled.
   - **deep-linking:** launch as a teacher → content picker → save → relaunch as
     a student → land on the bound resource.
