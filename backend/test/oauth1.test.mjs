/**
 * OAuth 1.0a (HMAC-SHA1) unit checks for the LTI 1.0a / 1.1 path.
 *
 * Runs against the COMPILED output (`backend/dist/legacy/oauth1.js`) so it
 * exercises exactly what ships. Run `npm run build` first, then `npm test`
 * (`node --test backend/test`). Imports the legacy module directly to avoid
 * pulling in ltijs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  percentEncode,
  buildBaseString,
  computeBodyHash,
  signOAuth1,
  verifyOAuth1Request,
} from '../dist/legacy/oauth1.js';

const URL_ = 'https://tool.example.com/api/v1/lti/legacy/launch';
const CONSUMER_KEY = 'consumer-key';
const CONSUMER_SECRET = 'consumer-secret';

test('percentEncode escapes the RFC 3986 reserved set incl. !*\'()', () => {
  // Unreserved A-Za-z0-9-._~ stay literal; everything else is escaped.
  assert.equal(percentEncode("a b!*'()~-._"), 'a%20b%21%2A%27%28%29~-._');
  assert.equal(percentEncode('a+b=c&d'), 'a%2Bb%3Dc%26d');
});

test('buildBaseString sorts params by encoded key then value', () => {
  const base = buildBaseString('post', URL_, {
    b: '2',
    a: '1',
    oauth_signature: 'IGNORED',
  });
  // Method upper-cased, URL percent-encoded, params normalized + encoded,
  // oauth_signature excluded.
  assert.equal(
    base,
    'POST&https%3A%2F%2Ftool.example.com%2Fapi%2Fv1%2Flti%2Flegacy%2Flaunch&a%3D1%26b%3D2'
  );
});

test('sign → verify round-trips for a form launch', () => {
  const params = {
    lti_message_type: 'basic-lti-launch-request',
    lti_version: 'LTI-1p0',
    resource_link_id: 'rl-1',
    user_id: 'u-1',
    context_id: 'ctx-1',
  };
  const signed = signOAuth1({
    method: 'POST',
    url: URL_,
    consumerKey: CONSUMER_KEY,
    consumerSecret: CONSUMER_SECRET,
    params,
    nowSeconds: 1_000_000,
    nonce: 'nonce-1',
  });

  assert.equal(signed.allParams.oauth_consumer_key, CONSUMER_KEY);
  assert.ok(signed.allParams.oauth_signature, 'produced a signature');

  const result = verifyOAuth1Request({
    method: 'POST',
    url: URL_,
    params: signed.allParams,
    consumerSecret: CONSUMER_SECRET,
    timestampWindowSeconds: 300,
    nowSeconds: 1_000_100,
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.nonce, 'nonce-1');
  assert.equal(result.timestamp, 1_000_000);
});

test('verify rejects a wrong shared secret (signature mismatch)', () => {
  const signed = signOAuth1({
    method: 'POST',
    url: URL_,
    consumerKey: CONSUMER_KEY,
    consumerSecret: CONSUMER_SECRET,
    params: { resource_link_id: 'rl-1' },
    nowSeconds: 1_000_000,
    nonce: 'nonce-2',
  });
  const result = verifyOAuth1Request({
    method: 'POST',
    url: URL_,
    params: signed.allParams,
    consumerSecret: 'WRONG-secret',
    timestampWindowSeconds: 300,
    nowSeconds: 1_000_010,
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /mismatch/i);
});

test('verify rejects an expired/skewed timestamp', () => {
  const signed = signOAuth1({
    method: 'POST',
    url: URL_,
    consumerKey: CONSUMER_KEY,
    consumerSecret: CONSUMER_SECRET,
    params: { resource_link_id: 'rl-1' },
    nowSeconds: 1_000_000,
    nonce: 'nonce-3',
  });
  const result = verifyOAuth1Request({
    method: 'POST',
    url: URL_,
    params: signed.allParams,
    consumerSecret: CONSUMER_SECRET,
    timestampWindowSeconds: 300,
    nowSeconds: 1_000_400, // 400s > 300s window
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /timestamp/i);
});

test('verify rejects an unsupported signature method (e.g. PLAINTEXT)', () => {
  const result = verifyOAuth1Request({
    method: 'POST',
    url: URL_,
    params: {
      oauth_consumer_key: CONSUMER_KEY,
      oauth_signature_method: 'PLAINTEXT',
      oauth_signature: 'x',
      oauth_nonce: 'n',
      oauth_timestamp: '1000000',
    },
    consumerSecret: CONSUMER_SECRET,
    timestampWindowSeconds: 300,
    nowSeconds: 1_000_000,
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /signature method/i);
});

test('oauth_body_hash round-trips for an XML POST (Basic Outcomes shape)', () => {
  const xml = '<?xml version="1.0"?><imsx_POXEnvelopeRequest/>';
  const bodyHash = computeBodyHash(xml);
  const signed = signOAuth1({
    method: 'POST',
    url: 'https://lms.example.com/grade/service',
    consumerKey: CONSUMER_KEY,
    consumerSecret: CONSUMER_SECRET,
    bodyHash,
    nowSeconds: 1_000_000,
    nonce: 'nonce-4',
  });
  assert.equal(signed.oauthParams.oauth_body_hash, bodyHash);
  assert.match(signed.authorizationHeader, /^OAuth realm="",/);
  assert.match(signed.authorizationHeader, /oauth_body_hash=/);

  // The body hash is part of the signed param set, so re-verifying the same
  // params (as a server would, minus body mixing) succeeds.
  const result = verifyOAuth1Request({
    method: 'POST',
    url: 'https://lms.example.com/grade/service',
    params: signed.allParams,
    consumerSecret: CONSUMER_SECRET,
    timestampWindowSeconds: 300,
    nowSeconds: 1_000_005,
  });
  assert.equal(result.ok, true, result.error);
});
