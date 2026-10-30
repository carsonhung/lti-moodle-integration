import test from 'node:test';
import assert from 'node:assert/strict';

import { trimTrailingSlashes } from '../dist/helpers.js';
import { testPlatformConnection } from '../dist/platformConnectionTest.js';

test('trimTrailingSlashes removes only trailing slashes', () => {
  assert.equal(trimTrailingSlashes('https://tool.example/lti///'), 'https://tool.example/lti');
  assert.equal(trimTrailingSlashes('https://tool.example/a/b'), 'https://tool.example/a/b');
  assert.equal(trimTrailingSlashes('///'), '');
  assert.equal(trimTrailingSlashes(''), '');
});

test('trimTrailingSlashes stays linear on pathological input', () => {
  const input = `${'/'.repeat(200_000)}x`;
  const started = Date.now();
  assert.equal(trimTrailingSlashes(input), input);
  assert.ok(Date.now() - started < 100);
});

test('connection test refuses non-http(s) URLs and embedded credentials', async () => {
  const result = await testPlatformConnection({
    authConfigMethod: 'JWK_SET',
    authConfigKey: 'file:///etc/passwd',
    authenticationEndpoint: 'https://user:pass@lms.example/auth',
    accesstokenEndpoint: 'not a url',
  });
  assert.equal(result.success, false);
  const byId = Object.fromEntries(result.checks.map((c) => [c.id, c.message]));
  assert.equal(byId.keyset, 'Only http(s) URLs can be tested.');
  assert.equal(byId.authentication, 'URLs with embedded credentials cannot be tested.');
  assert.equal(byId.accesstoken, 'Not a valid URL.');
});
