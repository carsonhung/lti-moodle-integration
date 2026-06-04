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

## Step 3 — Add the Activity to a Course

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

### Launch shows "This activity is not configured yet"

The teacher hasn't used Deep Linking. Click the activity's settings → **Select content** to configure.

### Launch shows "LTI launch did not include an email"

In Moodle, edit the External tool and set **Share launcher's email with tool = Always**.

### Launch shows "Not authorized to configure this activity"

The user is launching as a Student in Moodle but doesn't have a teacher/admin role in your app. Either change their Moodle role to Instructor for this course, or create a teacher account for them in your app.

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

## Platform-Specific Notes

### Canvas

Canvas works mostly the same, but uses `/api/lti/security/jwks` for its keyset URL and a different auth endpoint. Set the corresponding `LTI_PLATFORM_*` env vars or register via the admin UI.

### Blackboard

Blackboard requires a separate developer key (REST API) for some advanced features, but the LTI 1.3 launch endpoints work the same. Use Blackboard's "REST API integration" page to get the keyset URL.

### Other LTI 1.3 LMSs

Any LMS that conforms to the [IMS LTI 1.3 spec](https://www.imsglobal.org/spec/lti/v1p3) will work — the module doesn't make Moodle-specific assumptions in the launch flow. The course-identifier auto-mapping helpers (in `helpers.ts`) do include some Moodle-friendly fuzzy matching, but they fall back gracefully on other LMSs.
