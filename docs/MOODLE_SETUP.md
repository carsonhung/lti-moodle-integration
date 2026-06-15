# Moodle Setup Guide

Step-by-step configuration of an LTI 1.3 External Tool in Moodle that points at your application.

## Prerequisites

- Moodle 3.7+ with LTI 1.3 support (built in to all current versions).
- Site administrator access to Moodle (to register the external tool).
- Your application backend running with `LTI_ENABLED=true` and a public HTTPS URL.

## URLs you'll need from your backend

If `LTI_MOUNT_PATH=/api/v1/lti` and your tool is hosted at `https://app.example.com`, the four URLs Moodle needs are:

| Field in Moodle | Backend URL |
|---|---|
| Tool URL | `https://app.example.com/api/v1/lti/launch` |
| Initiate Login URL | `https://app.example.com/api/v1/lti/login` |
| Public Keyset URL | `https://app.example.com/api/v1/lti/keys` |
| Redirection URI | `https://app.example.com/api/v1/lti/launch` |
| Content Selection URL *(for Deep Linking)* | `https://app.example.com/api/v1/lti/launch` |

Verify the keyset URL works in a browser — it should return a JSON object like `{"keys":[{"kty":"RSA",...}]}`.

## Choose a connect mode first

How you register the tool depends on `LTI_CONNECT_MODE`:

- **`context-mapping` (recommended, no Deep Linking)** — register a **plain** external tool. Do
  NOT enable "Select content"; teachers add the activity directly. The launch maps the Moodle
  course to a platform course, and (optionally) each activity binds to a grouping **in the app**
  using its `resource_link_id`. Use this when your Moodle does not expose Deep Linking — which is
  the case on many production instances, including HKU's.
- **`login-only`** — same plain registration; the launch is treated purely as SSO.
- **`deep-linking`** — requires "Supports Deep Linking (Content-Item Message) = YES" and a Content
  Selection URL; teachers bind the activity via Moodle's content picker.

The deep-linking-specific fields below (marked *for Deep Linking*) are only needed for the
`deep-linking` mode. For `context-mapping` / `login-only`, leave "Supports Deep Linking" **off**
and skip the Content Selection URL.

## Step 1 — Register the External Tool in Moodle

**Site administration → Plugins → Activity modules → External tool → Manage tools → configure a tool manually**

Fill in the form:

| Field | Value |
|---|---|
| Tool name | e.g. *My App Chatbot* |
| Tool URL | `https://app.example.com/api/v1/lti/launch` |
| LTI version | **LTI 1.3** |
| Client ID | *(leave blank — Moodle generates it after saving)* |
| Public key type | **Keyset URL** |
| Public keyset URL | `https://app.example.com/api/v1/lti/keys` |
| Initiate login URL | `https://app.example.com/api/v1/lti/login` |
| Redirection URI(s) | `https://app.example.com/api/v1/lti/launch` |
| Default launch container | *Embed, without blocks* (recommended) |
| Supports Deep Linking (Content-Item Message) | **YES** ✔ |
| Content Selection URL | `https://app.example.com/api/v1/lti/launch` |

**Services**: enable IMS LTI Assignment and Grade Services if you'll need grade passback. (Optional for the core flow.)

**Privacy**:

| Field | Value |
|---|---|
| Share launcher's name with tool | Always |
| Share launcher's email with tool | **Always** (REQUIRED — the session bridge fails without it) |
| Accept grades from the tool | Yes (if using grade passback) |

Save the tool.

## Step 2 — Copy Moodle's IDs Back to Your Backend

After saving, click **View configuration details** on the registered tool. You'll see:

- **Platform ID** — `https://moodle.example.com` (the issuer)
- **Client ID** — a numeric or random string Moodle generated
- **Deployment ID** — a short string
- **Public keyset URL** — Moodle's public keys (`/mod/lti/certs.php`)
- **Access token URL** — `/mod/lti/token.php`
- **Authentication request URL** — `/mod/lti/auth.php`

Put these into your backend `.env`:

```env
LTI_PLATFORM_URL=https://moodle.example.com
LTI_PLATFORM_NAME=Moodle
LTI_PLATFORM_CLIENT_ID=<the Client ID from Moodle>
LTI_PLATFORM_AUTH_ENDPOINT=https://moodle.example.com/mod/lti/auth.php
LTI_PLATFORM_TOKEN_ENDPOINT=https://moodle.example.com/mod/lti/token.php
LTI_PLATFORM_KEYSET_URL=https://moodle.example.com/mod/lti/certs.php
```

Restart your backend. On boot you should see a log line like:

```
[LTI] Platform registered/updated from env {"url":"https://moodle.example.com",...}
```

Alternatively, you can register the platform at runtime via the admin UI (`LtiPlatformsAdmin.vue`) or by POSTing to `/api/v1/lti/platforms`.

For `context-mapping` / `login-only`, also set `LTI_BIND_TOKEN_SECRET` to a random string in your
backend `.env` (it signs the per-link grouping bind token used by the in-app binding step). Any
value works as long as it stays constant.

## Step 3 — Add the Activity to a Course

### Context-mapping (recommended, no Deep Linking)

1. As a teacher, open a Moodle course.
2. **Turn editing on** → Add an activity → **External tool**.
3. Pick your tool from the **Preconfigured tool** dropdown. Do **not** click "Select content".
4. Give the activity a name and **Save and return to course**.
5. Click the activity once as the teacher. You land in the app on the matched/auto-created course
   with a "Link this Moodle activity to a grouping" banner — pick an existing grouping or create
   one. From now on, every launch of this activity goes straight to that grouping.
6. Add a second External tool activity to bind a different grouping (it gets its own
   `resource_link_id`).

### Deep-linking (only if your Moodle exposes "Select content")

1. As a teacher, open a Moodle course.
2. **Turn editing on** → Add an activity → **External tool**.
3. Pick your tool from the **Preconfigured tool** dropdown.
4. Click **Select content** — this triggers a Deep Linking launch.
5. Your Deep Linking UI (the Vue form) opens inside Moodle's iframe.
6. Select a course + resource (or category), click **Save & Return to Moodle**.
7. Moodle saves the binding. Click **Save and return to course**.

The activity is now live for students.

## Step 4 — Test as a Student

1. Switch to a student account (or use **Switch role to → Student**).
2. Click the activity.
3. You should be redirected to `/lti/launch?...` in your app, then immediately to the bound resource.
4. The student should be auto-enrolled in the mapped course (if `LTI_AUTO_ENROLL_STUDENTS=true`).

## Troubleshooting

### Launch shows "This activity is not configured yet" (deep-linking)

The teacher hasn't used Deep Linking. Click the activity's settings → **Select content** to configure.

### Student sees "this activity has not been linked to a group sign-up yet" (context-mapping)

Expected when a teacher hasn't bound the activity yet. The teacher must click the activity once
(they get the "Link this Moodle activity to a grouping" banner) and choose a grouping. Students are
intentionally not shown a grouping picker for an unbound activity.

### Teacher doesn't see the "Link this activity to a grouping" banner (context-mapping)

Make sure `LTI_BIND_TOKEN_SECRET` is set in the backend `.env` — without it the core skips minting
the bind token, so the SPA can't show the banner. Also confirm the launching user resolves to a
teacher/admin on the matched course.

### Launch shows "LTI launch did not include an email"

In Moodle, edit the External tool and set **Share launcher's email with tool = Always**.

### Launch shows "Not authorized to configure this activity"

The user is launching as a Student in Moodle but doesn't have a teacher/admin role in your app. Either change their Moodle role to Instructor for this course, or create a teacher account for them in your app.

### Backend logs `stream is not readable` on `POST /login`

Your app-level body parsers (`express.json()` / `express.urlencoded()`) are running on the
LTI routes and draining the request stream before `ltijs` can read it. `ltijs` registers its
own parsers on its routes, so the global parsers must **skip the LTI mount path**. See the
"Body parsers" note in [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) (Step 6) — wrap the parsers
so they `next()` past anything under `LTI_MOUNT_PATH`.

### Browser blocks the LTI iframe (Chrome third-party cookies)

Set `LTI_LTIAAS_MODE=true` in your backend `.env` and restart. This makes ltijs use URL parameters instead of cookies.

### `lti_resource_bindings` row exists but launch shows "not configured"

Your `customFieldPrefix` in the adapter likely doesn't match the prefix used in `core.ts`'s custom-param fallback. Both should match (e.g. `talic` → `talic_resource_id`).

### Backend logs "Platform env vars partially set"

You set some of the `LTI_PLATFORM_*` vars but not all five. Set all five, or set none (then register the platform via the admin UI).

### After saving Deep Linking, Moodle shows "Tool returned invalid response"

Common causes:

1. The `deep_link_return_url` was lost — make sure your frontend isn't stripping query params from the LTI launch.
2. The JWT signing key (`LTI_ENCRYPTION_KEY`) is different between the Deep Linking call and the launch — keep it constant.
3. The signed JWT exceeded URL length limits — Moodle handles this fine with both GET and POST, but some proxies don't. Switch your reverse proxy to allow longer URLs.

Enable debug mode by visiting your deep link URL with `?debug=1` — the page will dump diagnostic events and POST them to `/deeplink/diag` so they appear in your backend logs.

## Legacy LTI 1.0a / 1.1 (older LMS, OAuth 1.0a)

If your LMS only supports the older **LTI 1.0a / 1.1** standard (a shared
consumer-key/secret instead of OIDC + JWK), enable the legacy path in the backend
(`legacyLti: true`, plus a `consumerStore` and `LTI_LAUNCH_TICKET_SECRET` — see the
README's "LTI 1.0a / 1.1 support" section). Then register a **legacy External
Tool** in Moodle (Site administration → Plugins → External tool → Manage tools →
*configure a tool manually*):

| Field in Moodle | Value |
|---|---|
| Tool URL | `https://app.example.com/api/v1/lti/legacy/launch` |
| LTI version | **LTI 1.0/1.1** |
| Consumer key | the key you created in the consumer admin |
| Shared secret | the matching secret |
| Default launch container | New window / Embed, as you prefer |
| Share launcher's name/email with tool | **Always** (the tool needs the user identity) |

For **grade passback** (LTI 1.1 Basic Outcomes), set **"Accept grades from the
tool = Always"** and add the activity to the gradebook. The launch then includes
the `lis_outcome_service_url` + `lis_result_sourcedid` the module records for
`sendScore()`.

For **Content-Item deep linking** (teacher picks content), enable
`legacyDeepLinking` in the backend and set **"Supports Deep Linking (Content-Item
Message) = Yes"** with the same launch URL as the Content Selection URL.

> The legacy mount subpath defaults to `/legacy` (configurable via
> `LTI_LEGACY_MOUNT`). The 1.3 registration above is unaffected — both can run side
> by side against the same app.

## Platform-Specific Notes

### Canvas

Canvas works mostly the same, but uses `/api/lti/security/jwks` for its keyset URL and a different auth endpoint. Set the corresponding `LTI_PLATFORM_*` env vars or register via the admin UI.

### Blackboard

Blackboard requires a separate developer key (REST API) for some advanced features, but the LTI 1.3 launch endpoints work the same. Use Blackboard's "REST API integration" page to get the keyset URL.

### Other LTI 1.3 LMSs

Any LMS that conforms to the [IMS LTI 1.3 spec](https://www.imsglobal.org/spec/lti/v1p3) will work — the module doesn't make Moodle-specific assumptions in the launch flow. The course-identifier auto-mapping helpers (in `helpers.ts`) do include some Moodle-friendly fuzzy matching, but they fall back gracefully on other LMSs.
