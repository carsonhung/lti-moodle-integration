# LTI 1.0a / 1.1 support (legacy LMS)

Accept launches from older LMSs alongside LTI 1.3. Grade passback for both protocols is covered in [GRADE_PASSBACK.md](GRADE_PASSBACK.md).


Some institutions still run LMSs (or LMS configurations) that only speak **LTI
1.0a / 1.1** — an OAuth 1.0a HMAC-SHA1-signed HTML form POST with a shared
*consumer key/secret*, with **no** OIDC login round-trip and **no** signed JWT.
This module can accept those launches in parallel with the modern 1.3 path. It is
**off by default**; the 1.3 behaviour is unchanged unless you opt in.

## Enable it

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

## Consumer store (required)

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

## Session bridge (the 1.1 analogue of `ltik`)

A 1.1 launch has no ltijs `ltik`. After a valid OAuth 1.0a launch the router mints
a short-lived **signed launch ticket** and redirects the SPA to
`/lti/launch?ticket=…`. The shipped `LtiLaunchView.vue` / `LtiLaunch.tsx` already
detect `?ticket=` and exchange it at the legacy `/session` endpoint for your app
JWT — same UX as the 1.3 flow. If your frontend uses a non-default legacy mount,
set it once at startup: `configureLtiApi({ legacyBase: '/api/v1/lti/legacy' })`.

## Production notes

- The default `nonceStore` / `gradeLinkStore` / `agsSyncStore` are **in-memory**
  (single instance only). For multi-instance deployments supply durable, shared
  implementations (reference Mongoose `LtiGradeLinkModel`, `LtiAgsGradeSyncModel`
  and store examples are provided).
- Keep `legacyTimestampWindowSeconds` tight (default 300s) and ensure server
  clocks are synced — OAuth 1.0a replay protection depends on it.
- Shared secrets are long-lived bearer credentials; store them encrypted/at rest
  and rotate via the consumer admin. The admin API never returns a secret.
