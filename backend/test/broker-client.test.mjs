import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';

import {
  BROKER_LTIK_CONTRACT_VERSION,
  BROKER_LTIK_TOKEN_TYPE,
  brokerCourseIdentifierCandidates,
  brokerTeacherPromotionContext,
  consumeBrokerLtik,
  parseBrokerLtikClaims,
  verifyBrokerLtik,
} from '../dist/brokerClient.js';

const issuer = 'https://broker.example';
const audience = 'learnity';

async function signingFixture(overrides = {}) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'broker-key-1';
  const payload = {
    tt: BROKER_LTIK_TOKEN_TYPE,
    ver: BROKER_LTIK_CONTRACT_VERSION,
    appId: audience,
    launchId: 'launch-1',
    mode: 'course-based',
    user: {
      sub: 'moodle-subject-1',
      email: 'teacher@hku.hk',
      name: 'Teacher',
      roles: ['teacher'],
      institutionalIdentity: {
        value: '001234',
        source: 'lis.person_sourcedid',
        trusted: true,
      },
    },
    platform: {
      issuer: 'https://moodle.example',
      clientId: 'moodle-client-1',
      deploymentId: 'moodle-deployment-1',
    },
    context: {
      contextId: 'moodle-context-1',
      label: 'TALIC001_2A_2026',
      title: 'Teaching and Learning Course',
      identifierCandidates: ['not-a-shortname', 'TALIC001_2A_2026'],
    },
    ...overrides,
  };
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(privateKey);
  return {
    token,
    key: createLocalJWKSet({ keys: [publicJwk] }),
    payload,
  };
}

test('verifies the v2 course-based contract and preserves Moodle launch provenance', async () => {
  const fixture = await signingFixture();
  const result = await verifyBrokerLtik(fixture.token, {
    issuer,
    audience,
    key: fixture.key,
  });
  assert.equal(result.compatibility, 'current-v2');
  assert.deepEqual(result.claims.platform, fixture.payload.platform);
  assert.equal(result.claims.context.label, 'TALIC001_2A_2026');
  assert.deepEqual(result.claims.user.institutionalIdentity, {
    value: '001234',
    source: 'lis.person_sourcedid',
    trusted: true,
  });
  assert.deepEqual(brokerCourseIdentifierCandidates(result.claims.context), [
    'TALIC001_2A_2026',
    'not-a-shortname',
    'TALIC001_2A_2026',
  ]);
});

test('rejects wrong signatures, audiences, and token types', async () => {
  const valid = await signingFixture();
  const otherKey = (await signingFixture()).key;
  await assert.rejects(
    verifyBrokerLtik(valid.token, { issuer, audience, key: otherKey }),
  );
  await assert.rejects(
    verifyBrokerLtik(valid.token, { issuer, audience: 'other-app', key: valid.key }),
  );

  const wrongType = await signingFixture({ tt: 'ltik' });
  await assert.rejects(
    verifyBrokerLtik(wrongType.token, { issuer, audience, key: wrongType.key }),
    /token type/i,
  );
});

test('rejects missing roles and incomplete v2 platform or course context', () => {
  const base = {
    tt: BROKER_LTIK_TOKEN_TYPE,
    ver: BROKER_LTIK_CONTRACT_VERSION,
    appId: audience,
    launchId: 'launch-1',
    mode: 'course-based',
    user: { sub: 'subject-1', roles: ['student'] },
    platform: {
      issuer: 'https://moodle.example',
      clientId: 'client-1',
      deploymentId: 'deployment-1',
    },
    context: { contextId: 'context-1', label: 'TALIC001_2A_2026' },
  };
  assert.throws(
    () => parseBrokerLtikClaims({ ...base, user: { sub: 'subject-1' } }, audience),
    /roles/i,
  );
  assert.throws(
    () => parseBrokerLtikClaims({ ...base, platform: undefined }, audience),
    /platform tuple/i,
  );
  assert.throws(
    () => parseBrokerLtikClaims({ ...base, context: undefined }, audience),
    /context/i,
  );
  assert.throws(
    () => parseBrokerLtikClaims({ ...base, mode: undefined }, audience),
    /mode/i,
  );
  assert.throws(
    () => parseBrokerLtikClaims({ ...base, ver: '99' }, audience),
    /version/i,
  );
});

test('v2 login-only keeps platform provenance without manufacturing course context', () => {
  const result = parseBrokerLtikClaims({
    tt: BROKER_LTIK_TOKEN_TYPE,
    ver: BROKER_LTIK_CONTRACT_VERSION,
    appId: audience,
    launchId: 'login-launch',
    mode: 'login-only',
    user: { sub: 'subject-1', roles: ['student'] },
    platform: {
      issuer: 'https://moodle.example',
      clientId: 'client-1',
      deploymentId: 'deployment-1',
    },
  }, audience);
  assert.equal(result.compatibility, 'current-v2');
  assert.equal(result.claims.context, undefined);
});

test('legacy v1 remains login-compatible without manufacturing trusted provenance', () => {
  const result = parseBrokerLtikClaims({
    tt: BROKER_LTIK_TOKEN_TYPE,
    appId: audience,
    launchId: 'legacy-launch',
    user: {
      sub: 'legacy-subject',
      roles: ['teacher'],
      hkuNo: '001234',
    },
    context: {
      contextId: 'legacy-context',
      label: 'INCOMPATIBLE_3_2026',
    },
  }, audience);
  assert.equal(result.compatibility, 'legacy-v1');
  assert.equal(result.claims.user.institutionalIdentity, undefined);
  assert.equal(result.claims.user.hkuNo, '001234');
  assert.equal(brokerTeacherPromotionContext(result), undefined);
});

test('teacher promotion requires one teacher role, trusted provenance, platform, and context', () => {
  const base = {
    tt: BROKER_LTIK_TOKEN_TYPE,
    ver: BROKER_LTIK_CONTRACT_VERSION,
    appId: audience,
    launchId: 'teacher-launch',
    mode: 'course-based',
    user: {
      sub: 'teacher-1',
      roles: ['teacher'],
      institutionalIdentity: {
        value: '001234',
        source: 'lis.person_sourcedid',
        trusted: true,
      },
    },
    platform: {
      issuer: 'https://moodle.example',
      clientId: 'client-1',
      deploymentId: 'deployment-1',
    },
    context: { contextId: 'context-1', label: 'TALIC001_2A_2026' },
  };
  const verified = parseBrokerLtikClaims(base, audience);
  assert.equal(brokerTeacherPromotionContext(verified)?.institutionalIdentity.value, '001234');
  assert.equal(
    brokerTeacherPromotionContext(parseBrokerLtikClaims({
      ...base,
      user: { ...base.user, roles: ['student', 'teacher'] },
    }, audience)),
    undefined,
  );
  assert.equal(
    brokerTeacherPromotionContext(parseBrokerLtikClaims({
      ...base,
      user: { ...base.user, institutionalIdentity: { ...base.user.institutionalIdentity, trusted: false } },
    }, audience)),
    undefined,
  );
  assert.equal(
    brokerTeacherPromotionContext(parseBrokerLtikClaims({
      ...base,
      user: { ...base.user, hkuNo: '009999' },
    }, audience)),
    undefined,
  );
});

test('local verification is repeatable but broker consumption rejects replay', async () => {
  const fixture = await signingFixture();
  const first = await verifyBrokerLtik(fixture.token, { issuer, audience, key: fixture.key });
  const repeated = await verifyBrokerLtik(fixture.token, { issuer, audience, key: fixture.key });
  assert.equal(first.claims.launchId, repeated.claims.launchId);

  let consumed = false;
  const fetch = async () => {
    if (consumed) {
      return new Response(JSON.stringify({ error: 'ltik already used' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    consumed = true;
    return Response.json({ serviceToken: 'ignored' });
  };
  await consumeBrokerLtik(fixture.token, { baseUrl: issuer, fetch });
  await assert.rejects(
    consumeBrokerLtik(fixture.token, { baseUrl: issuer, fetch }),
    /already used/i,
  );

  consumed = false;
  const concurrent = await Promise.allSettled([
    consumeBrokerLtik(fixture.token, { baseUrl: issuer, fetch }),
    consumeBrokerLtik(fixture.token, { baseUrl: issuer, fetch }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
});
