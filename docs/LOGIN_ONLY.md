# Login-only mode (SSO replacement)

Use LTI purely as single sign-on from the LMS, plus the hooks for verified identity resolution and host-delegated content selection.


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

## Login-session identity resolution

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

## Host-delegated content selection

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
