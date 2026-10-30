# Consuming a central LTI broker

For apps that sit behind a central LTI broker instead of talking to the LMS directly.


Apps behind a central broker register an allow-listed backend callback and use
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
