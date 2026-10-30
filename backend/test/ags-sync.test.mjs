import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGS_LINEITEM_SCOPE,
  AGS_SCORE_SCOPE,
  buildAgsLineItemPayload,
  buildAgsScorePayload,
  deriveLineItemsEndpoint,
  extractAgsEndpoint,
  isAgsGradebookLaunch,
  publishAgsScore,
  scaleScoreToLineItem,
  submitAgsScore,
} from '../dist/grades/ags.js';
import { createAgsScoreSync, createInMemoryAgsSyncStore } from '../dist/grades/agsSync.js';

const LINE_ITEM = 'https://moodle.example/mod/lti/services.php/2/lineitems/675606/lineitem?type_id=204';
const LINE_ITEMS = 'https://moodle.example/mod/lti/services.php/2/lineitems?type_id=204';

const notFound = () =>
  Object.assign(new Error('Response code 404 (Not Found)'), { response: { statusCode: 404 } });

function fakeProvider({ failPostsTo = new Set(), listed = [], created, readable = true } = {}) {
  const calls = { posts: [], lists: 0, creates: [] };
  return {
    calls,
    Grade: {
      async submitScore(idtoken, url, score) {
        calls.posts.push({ idtoken, url, score });
        if (failPostsTo.has(url)) throw notFound();
      },
      async getLineItemById(_idtoken, url) {
        if (!readable) throw notFound();
        return { id: url, scoreMaximum: 10 };
      },
      async getLineItems(idtoken) {
        calls.lists += 1;
        calls.listIdtoken = idtoken;
        return { lineItems: listed };
      },
      async createLineItem(_idtoken, lineItem, options) {
        calls.creates.push({ lineItem, options });
        if (!created) throw notFound();
        return { ...lineItem, id: created };
      },
    },
  };
}

const target = (overrides = {}) => ({
  issuer: 'https://moodle.example',
  clientId: 'client-1',
  deploymentId: 'dep-1',
  contextId: 'course-1',
  resourceLinkId: 'rl-1',
  lmsUserId: 'sub-42',
  lineItemUrl: LINE_ITEM,
  lineItemsEndpoint: LINE_ITEMS,
  scopes: [AGS_SCORE_SCOPE],
  ...overrides,
});

test('Moodle line-items endpoint is derived from the line-item URL', () => {
  assert.equal(deriveLineItemsEndpoint(LINE_ITEM), LINE_ITEMS);
  assert.equal(deriveLineItemsEndpoint('https://moodle.example/other'), undefined);
  assert.equal(deriveLineItemsEndpoint(''), undefined);
});

test('AGS endpoint claim is normalised from a space-separated scope string', () => {
  const claims = extractAgsEndpoint({
    platformContext: { endpoint: { lineitem: LINE_ITEM, scope: `${AGS_SCORE_SCOPE} ${AGS_LINEITEM_SCOPE}` } },
  });
  assert.deepEqual(claims, {
    lineItem: LINE_ITEM,
    lineItems: LINE_ITEMS,
    scopes: [AGS_SCORE_SCOPE, AGS_LINEITEM_SCOPE],
  });
  assert.equal(isAgsGradebookLaunch(claims), true);
  assert.equal(isAgsGradebookLaunch({ ...claims, scopes: [AGS_LINEITEM_SCOPE] }), false);
  assert.equal(extractAgsEndpoint({}), null);
});

test('score payload validates ranges, truncates comments, and supports PendingManual', () => {
  assert.throws(() => buildAgsScorePayload({ userId: 'u', scoreGiven: 11, scoreMaximum: 10 }));
  assert.throws(() => buildAgsScorePayload({ userId: '', scoreGiven: 1, scoreMaximum: 10 }));

  const full = buildAgsScorePayload({
    userId: 'u',
    scoreGiven: 7,
    scoreMaximum: 10,
    comment: 'x'.repeat(5000),
  });
  assert.equal(full.comment.length, 4000);
  assert.equal(full.gradingProgress, 'FullyGraded');

  const pending = buildAgsScorePayload({
    userId: 'u',
    scoreMaximum: 10,
    activityProgress: 'Submitted',
    gradingProgress: 'PendingManual',
  });
  assert.equal('scoreGiven' in pending, false);
  assert.equal('scoreMaximum' in pending, false);
  assert.equal(pending.gradingProgress, 'PendingManual');
});

test('scores are rescaled to the line item maximum', () => {
  assert.deepEqual(scaleScoreToLineItem(7, 10, 100), { scoreGiven: 70, scoreMaximum: 100 });
  assert.deepEqual(scaleScoreToLineItem(1, 3, 10), { scoreGiven: 3.33, scoreMaximum: 10 });
  assert.deepEqual(scaleScoreToLineItem(7, 10, 0), { scoreGiven: 7, scoreMaximum: 10 });
});

test('assignment line item carries a recoverable tag and resource id', () => {
  assert.deepEqual(
    buildAgsLineItemPayload({ assignmentId: 'a1', title: 'Quiz', scoreMaximum: 20, tagPrefix: 'app' }),
    { scoreMaximum: 20, label: 'Quiz', resourceId: 'a1', tag: 'app:assignment:a1' }
  );
  assert.throws(() =>
    buildAgsLineItemPayload({ assignmentId: 'a1', title: 'Quiz', scoreMaximum: 0, tagPrefix: 'app' })
  );
});

test('a 404 on the launch line item recovers by tag and rescales', async () => {
  const recovered = 'https://moodle.example/lineitems/999/lineitem';
  const provider = fakeProvider({
    failPostsTo: new Set([LINE_ITEM]),
    listed: [
      { id: 'https://moodle.example/lineitems/1/lineitem', tag: 'other', scoreMaximum: 5 },
      { id: recovered, tag: 'app:assignment:a1', scoreMaximum: 100 },
    ],
  });
  const result = await publishAgsScore(
    provider,
    target({ lineItemHint: { tag: 'app:assignment:a1' } }),
    { scoreGiven: 7, scoreMaximum: 10 }
  );
  assert.equal(result.lineItemUrl, recovered);
  assert.equal(result.source, 'resource-link');
  assert.deepEqual([result.scoreGiven, result.scoreMaximum], [70, 100]);
  assert.equal(provider.calls.posts.at(-1).url, recovered);
  assert.equal(provider.calls.posts.at(-1).score.userId, 'sub-42');
  assert.equal(provider.calls.listIdtoken.platformContext.resource.id, 'rl-1');
});

test('a missing line item is created when the lineitem scope was granted', async () => {
  const created = 'https://moodle.example/lineitems/new/lineitem';
  const provider = fakeProvider({ failPostsTo: new Set([LINE_ITEM]), created, readable: false });
  const result = await publishAgsScore(
    provider,
    target({ scopes: [AGS_SCORE_SCOPE, AGS_LINEITEM_SCOPE], lineItemHint: { tag: 't', label: 'Quiz' } }),
    { scoreGiven: 3, scoreMaximum: 10 }
  );
  assert.equal(result.source, 'created');
  assert.equal(result.lineItemUrl, created);
  assert.deepEqual(provider.calls.creates[0].options, { resourceLinkId: true });
  assert.equal(provider.calls.creates[0].lineItem.label, 'Quiz');
});

test('without the lineitem scope a 404 fails with Moodle guidance', async () => {
  const provider = fakeProvider({ failPostsTo: new Set([LINE_ITEM]), readable: false });
  await assert.rejects(
    publishAgsScore(provider, target(), { scoreGiven: 3, scoreMaximum: 10 }),
    /lineitem scope/
  );
});

test('one-shot submit posts for the LTI sub captured on the link', async () => {
  const provider = fakeProvider();
  const result = await submitAgsScore({
    provider,
    platform: { issuer: 'i', clientId: 'c', deploymentId: 'd', contextId: 'x' },
    resourceLinkId: 'rl',
    userExternalId: '3035123456',
    link: { protocol: '1.3', userId: 'sub-42', lineItem: LINE_ITEM, scopes: [AGS_SCORE_SCOPE] },
    scoreGiven: 1,
    scoreMaximum: 2,
  });
  assert.equal(result.success, true);
  assert.equal(provider.calls.posts[0].score.userId, 'sub-42');
});

// ─── Durable sync ────────────────────────────────────────────────────────────

function makeSync(provider, opts = {}) {
  const store = createInMemoryAgsSyncStore();
  const sync = createAgsScoreSync({
    store,
    getProvider: () => provider,
    enabled: true,
    ...opts,
  });
  return { store, sync };
}

test('sync is unavailable without the score scope and never posts', async () => {
  const provider = fakeProvider();
  const { sync } = makeSync(provider);
  const record = await sync.enqueue({ target: target({ scopes: [] }), scoreGiven: 1, scoreMaximum: 2 });
  assert.equal(record.status, 'unavailable');
  assert.match(record.lastError, /score scope/);
  assert.equal(provider.calls.posts.length, 0);
});

test('latest policy re-posts each submission on the same record', async () => {
  const provider = fakeProvider();
  const { sync } = makeSync(provider);
  const first = await sync.enqueue({ target: target(), scoreGiven: 4, scoreMaximum: 10 });
  const second = await sync.enqueue({ target: target(), scoreGiven: 6, scoreMaximum: 10 });
  assert.equal(first.status, 'synced');
  assert.equal(second.id, first.id);
  assert.equal(second.scoreGiven, 6);
  assert.equal(provider.calls.posts.length, 2);
});

test('first policy keeps the first synced score', async () => {
  const provider = fakeProvider();
  const { sync } = makeSync(provider);
  await sync.enqueue({ target: target(), scorePolicy: 'first', scoreGiven: 4, scoreMaximum: 10 });
  const kept = await sync.enqueue({ target: target(), scorePolicy: 'first', scoreGiven: 9, scoreMaximum: 10 });
  assert.equal(kept.scoreGiven, 4);
  assert.equal(provider.calls.posts.length, 1);
});

test('highest policy only sends an improvement', async () => {
  const provider = fakeProvider();
  const { sync } = makeSync(provider);
  await sync.enqueue({ target: target(), scorePolicy: 'highest', scoreGiven: 6, scoreMaximum: 10 });
  await sync.enqueue({ target: target(), scorePolicy: 'highest', scoreGiven: 5, scoreMaximum: 10 });
  const better = await sync.enqueue({
    target: target(),
    scorePolicy: 'highest',
    scoreGiven: 8,
    scoreMaximum: 10,
  });
  assert.equal(better.scoreGiven, 8);
  assert.equal(provider.calls.posts.length, 2);
});

test('a scoreless resubmission never clears a graded score', async () => {
  const provider = fakeProvider();
  const { sync } = makeSync(provider);
  await sync.enqueue({ target: target(), scoreGiven: 7, scoreMaximum: 10 });
  const kept = await sync.enqueue({
    target: target(),
    scoreMaximum: 10,
    gradingProgress: 'PendingManual',
  });
  assert.equal(kept.scoreGiven, 7);
  assert.equal(kept.gradingProgress, 'FullyGraded');
  assert.equal(provider.calls.posts.length, 1);
});

test('failures stay retryable until the attempt budget is spent', async () => {
  let fail = true;
  const provider = fakeProvider();
  const submit = provider.Grade.submitScore;
  provider.Grade.submitScore = async (...args) => {
    if (fail) throw Object.assign(new Error('Response code 500'), { response: { statusCode: 500 } });
    return submit(...args);
  };
  const { sync } = makeSync(provider, { maxAttempts: 2 });

  const failed = await sync.enqueue({ target: target(), scoreGiven: 1, scoreMaximum: 2 });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.attempts, 1);
  assert.match(failed.lastError, /HTTP 500/);

  const stillFailed = await sync.attempt(failed.id);
  assert.equal(stillFailed.attempts, 2);
  const exhausted = await sync.attempt(failed.id);
  assert.match(exhausted.lastError, /stopped after 2 attempts/);

  fail = false;
  const resubmitted = await sync.enqueue({ target: target(), scoreGiven: 2, scoreMaximum: 2 });
  assert.equal(resubmitted.status, 'synced');
  assert.equal(resubmitted.attempts, 1);
});

test('a submission that lands mid-publish is sent after the in-flight one', async () => {
  const provider = fakeProvider();
  let release;
  let sync;
  let resubmission;
  const submit = provider.Grade.submitScore;
  provider.Grade.submitScore = async (...args) => {
    if (!release) {
      await new Promise((resolve) => {
        release = resolve;
        resubmission = sync.enqueue({ target: target(), scoreGiven: 9, scoreMaximum: 10 });
        setImmediate(resolve);
      });
    }
    return submit(...args);
  };
  ({ sync } = makeSync(provider));

  const record = await sync.enqueue({ target: target(), scoreGiven: 3, scoreMaximum: 10 });
  await resubmission;
  assert.equal(record.status, 'synced');
  assert.equal(record.scoreGiven, 9);
  assert.deepEqual(
    provider.calls.posts.map((p) => p.score.scoreGiven),
    [3, 9]
  );
});

test('recovered line items are reported so the grade link can be refreshed', async () => {
  const recovered = 'https://moodle.example/lineitems/2/lineitem';
  const provider = fakeProvider({
    failPostsTo: new Set([LINE_ITEM]),
    listed: [{ id: recovered, scoreMaximum: 10 }],
  });
  const seen = [];
  const { sync } = makeSync(provider, {
    onLineItemResolved: (_record, url) => seen.push(url),
  });
  const record = await sync.enqueue({ target: target(), scoreGiven: 5, scoreMaximum: 10 });
  assert.equal(record.status, 'synced');
  assert.equal(record.lineItemUrl, recovered);
  assert.deepEqual(seen, [recovered]);
});
