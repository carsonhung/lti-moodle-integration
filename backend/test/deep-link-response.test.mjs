import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  createDeepLinkResponseFacade,
  respondToDeepLinking,
  shouldRegisterDeepLinkHandler,
} from '../dist/deepLinkResponse.js';
import {
  buildContentItemsJsonFromItems,
  buildSignedContentItemReturn,
} from '../dist/legacy/contentItem.js';
import { signOAuth1, verifyOAuth1Request } from '../dist/legacy/oauth1.js';
import { createLti11Router } from '../dist/legacy/lti11.js';

test('host hooks register 1.3 Deep Linking in every connect mode', () => {
  assert.equal(shouldRegisterDeepLinkHandler('login-only', true), true);
  assert.equal(shouldRegisterDeepLinkHandler('context-mapping', true), true);
  assert.equal(shouldRegisterDeepLinkHandler('deep-linking', false), true);
  assert.equal(shouldRegisterDeepLinkHandler('login-only', false), false);
  assert.equal(shouldRegisterDeepLinkHandler('context-mapping', false), false);
});

test('protocol-neutral response helper delegates to the authenticated facade', async () => {
  const calls = [];
  let sentBody;
  const response = {
    status(code) {
      assert.equal(code, 200);
      return this;
    },
    send(body) {
      sentBody = body;
      return 'sent-response';
    },
  };
  const deepLinking = createDeepLinkResponseFacade({
    version: '1.3',
    returnUrl: 'https://lms.example/deep-link/return',
    respond: async (items, options) => {
      calls.push({ items, options });
      return 'sent';
    },
  });
  const item = {
    type: 'ltiResourceLink',
    title: 'Group A',
    url: 'https://tool.example/launch',
  };

  const result = await respondToDeepLinking(
    {
      req: {},
      res: response,
      version: '1.3',
      isDeepLinkingRequest: true,
      deepLinking,
    },
    [item],
    { message: 'Configured' }
  );

  assert.equal(result, 'sent-response');
  assert.equal(sentBody, 'sent');
  assert.deepEqual(calls, [{ items: [item], options: { message: 'Configured' } }]);
});

test('protocol-neutral response helper rejects normal launches', async () => {
  await assert.rejects(
    respondToDeepLinking(
      {
        req: {},
        res: {},
        version: '1.3',
        isDeepLinkingRequest: false,
      },
      [{ type: 'ltiResourceLink', title: 'Group A', url: 'https://tool.example/launch' }]
    ),
    /not an LTI content-selection request/
  );
});

test('LTI 1.1 serializer safely maps resource links and rejects lossy item types', () => {
  const json = buildContentItemsJsonFromItems([
    {
      type: 'ltiResourceLink',
      title: 'Group A',
      text: 'Join this grouping',
      url: 'https://tool.example/launch',
      custom: { resource_id: 'group-a' },
    },
  ]);
  const parsed = JSON.parse(json);
  assert.equal(parsed['@graph'][0]['@type'], 'LtiLinkItem');
  assert.equal(parsed['@graph'][0].custom.resource_id, 'group-a');

  assert.throws(
    () =>
      buildContentItemsJsonFromItems([
        { type: 'html', title: 'Inline HTML', text: '<strong>Unsupported</strong>' },
      ]),
    /does not support item type/
  );
});

test('LTI 1.1 return signs the protocol-neutral content item', () => {
  const returnUrl = 'https://lms.example/content-item/return';
  const contentItemsJson = buildContentItemsJsonFromItems([
    {
      type: 'ltiResourceLink',
      title: 'Group A',
      url: 'https://tool.example/launch',
      custom: { resource_id: 'group-a' },
    },
  ]);
  const html = buildSignedContentItemReturn({
    returnUrl,
    data: 'opaque-lms-data',
    contentItemsJson,
    consumerKey: 'consumer-key',
    consumerSecret: 'consumer-secret',
    nowSeconds: 1_000_000,
    nonce: 'content-item-nonce',
  });
  const params = Object.fromEntries(
    [...html.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((match) => [
      match[1],
      match[2]
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&'),
    ])
  );

  const verified = verifyOAuth1Request({
    method: 'POST',
    url: returnUrl,
    params,
    consumerSecret: 'consumer-secret',
    timestampWindowSeconds: 300,
    nowSeconds: 1_000_001,
  });
  assert.equal(verified.ok, true, verified.error);
  assert.equal(params.data, 'opaque-lms-data');
});

test('LTI 1.1 Content-Item delegates before requiring a full adapter', async (t) => {
  const app = express();
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const launchUrl = `${baseUrl}/lti/legacy/launch`;
  const launches = [];

  app.use(
    '/lti/legacy',
    createLti11Router({
      adapter: { customFieldPrefix: 'test' },
      consumerStore: {
        async resolveConsumer(key) {
          return key === 'consumer-key'
            ? { key: 'consumer-key', secret: 'consumer-secret' }
            : null;
        },
      },
      nonceStore: { async seen() { return false; } },
      gradeLinkStore: {
        async saveGradeLink() {},
        async findGradeLink() { return null; },
      },
      connectMode: 'login-only',
      onNormalizedLaunch: async (launch, ctx) => {
        launches.push({ launch, ctx });
        return respondToDeepLinking(ctx, [
          {
            type: 'ltiResourceLink',
            title: 'Delegated group',
            url: `${baseUrl}/lti/legacy/launch`,
            custom: { resource_id: 'group-a' },
          },
        ]);
      },
      mountPath: '/lti',
      legacyMountPath: '/legacy',
      launchRedirectPath: '/launch',
      autoMapCourse: false,
      autoEnrollStudents: false,
      launchTicketSecret: 'launch-ticket-secret',
      timestampWindowSeconds: 300,
      legacyDeepLinking: true,
      toolBaseUrl: baseUrl,
      customFieldPrefix: 'test',
      deepLinkPageTitle: 'Configure',
      resourceLabel: 'Resource',
    })
  );

  const signed = signOAuth1({
    method: 'POST',
    url: launchUrl,
    consumerKey: 'consumer-key',
    consumerSecret: 'consumer-secret',
    params: {
      lti_message_type: 'ContentItemSelectionRequest',
      lti_version: 'LTI-1p1',
      roles: 'Instructor',
      user_id: 'teacher-1',
      lis_person_contact_email_primary: 'teacher@example.com',
      context_id: 'course-1',
      resource_link_id: 'resource-link-1',
      content_item_return_url: 'https://lms.example/content-item/return',
      data: 'opaque-lms-data',
    },
  });
  const response = await fetch(launchUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(signed.allParams),
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].ctx.isDeepLinkingRequest, true);
  assert.equal(launches[0].ctx.deepLinking.version, '1.1');
  assert.match(html, /ContentItemSelection/);
  assert.match(html, /Delegated group/);
});
