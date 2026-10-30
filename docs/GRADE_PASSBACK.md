# Grade passback and graded assignments

Push scores back to the LMS gradebook (LTI 1.1 Basic Outcomes or LTI 1.3 AGS), and let teachers place graded assignments through Deep Linking.


The module records the LMS's grade target at launch time (the 1.1 Basic Outcomes
service URL + `sourcedId`, or the 1.3 AGS endpoint) in an `LtiGradeLinkStore`
(in-memory default via `createInMemoryGradeLinkStore`). Push a score with the
unified facade — it dispatches to the right protocol automatically:

```ts
import { sendScore, assignmentLineItemTag } from 'lti-moodle-integration/backend';

const result = await sendScore({
  platform: { issuer, clientId, deploymentId, contextId }, // captured at launch
  resourceLinkId,
  userExternalId: platformSubject, // 1.3: the LTI `sub`; 1.1: the launch user_id
  scoreGiven: 8,
  scoreMaximum: 10,
  // 1.3 only (all optional):
  scorePolicy: 'highest',            // 'latest' (default) | 'first' | 'highest'
  gradingProgress: 'FullyGraded',    // or 'PendingManual' with no scoreGiven
  lineItem: { tag: assignmentLineItemTag('app', assignmentId), resourceId: assignmentId },
});
// result: { success, protocol, status?: 'synced' | 'failed' | ..., syncId?, message? }
```

The launch identifiers are available to the host in the `resolveLoginSession`
hook (`identity.platform`, `identity.platformSubject`, `resourceLinkId`); store
them with the user's attempt so a later grade can be pushed.

- **LTI 1.1 Basic Outcomes** (`legacy/outcomes.ts`) — OAuth 1.0a-signed POX
  `replaceResult` / `readResult` / `deleteResult` with `oauth_body_hash`.
- **LTI 1.3 AGS** (`grades/ags.ts`, `grades/agsSync.ts`) — enable with
  `agsEnabled: true` / `LTI_AGS_ENABLED`. Built on ltijs's Grade service. Each
  user + activity has one durable sync record (`agsSyncStore`) with status,
  retries (`agsMaxAttempts`, default 5), score policies, and an atomic publish
  claim. If Moodle returns 404 for the launch line item (activity re-added or
  restored), the module lists the resource link's line items, matches by
  `tag`/`resourceId`, creates one when the `lineitem` scope allows, rescales the
  score to the column maximum, and retries. Re-run a failed record with
  `retryAgsScore(syncId)`.

## Graded assignments via Deep Linking

Implement the optional adapter methods `listSelectableAssignments`,
`getSelectableAssignment` (and `getAssignmentById` for the manage page) to add a
**Graded assignment** option to the deep-link picker. The content item carries
`<prefix>_course_id` / `<prefix>_assignment_id` custom params, an availability
window, and — when the assignment has `gradingEnabled` and AGS is on — a line
item (`label`, `scoreMaximum`, `resourceId`, `tag: '<prefix>:assignment:<id>'`)
so Moodle creates the grade column at placement time. Students land on
`/lti/launch?assignmentId=…`; route that in your SPA.

On every launch of a deep-linked activity, the custom params are the source of
truth: Moodle assigns the resource link id only after the deep-link response, so
the core copies the selection onto the real resource-link binding on first
launch.

## Production notes

- The default `nonceStore` / `gradeLinkStore` / `agsSyncStore` are **in-memory**
  (single instance only). For multi-instance deployments supply durable, shared
  implementations (reference Mongoose `LtiGradeLinkModel`, `LtiAgsGradeSyncModel`
  and store examples are provided).
- For the Moodle-side settings, see [MOODLE_SETUP.md](MOODLE_SETUP.md#grade-passback-lti-13-ags).
