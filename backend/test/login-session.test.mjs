import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSafeLoginTarget,
  resolveInstitutionalIdentity,
  resolveLtiLoginSession,
  serializePlatformId,
} from '../dist/loginSession.js';
import {
  getSubjectFromLtiToken,
  inferRoleFromLegacyRoles,
} from '../dist/helpers.js';

const platform = {
  issuer: 'https://lms.example',
  clientId: 'client-1',
  deploymentId: 'deployment-1',
  contextId: 'course-1',
};

const context = {
  version: '1.3',
  role: 'teacher',
  user: { id: 'user-1', email: 'teacher@example.com', name: 'Teacher', roles: ['teacher'] },
  identity: {
    email: 'teacher@example.com',
    name: 'Teacher',
    role: 'teacher',
    platformSubject: 'subject-1',
    platform,
    platformId: serializePlatformId(platform),
  },
  contextSnapshot: { contextId: 'course-1', identifierCandidates: ['COURSE101'] },
  lis: { courseSectionSourcedId: 'COURSE101' },
  custom: { course_id: 'COURSE101' },
  courseHints: ['COURSE101'],
  resourceLinkId: 'resource-1',
};

test('stable subject and platform namespace are extracted deterministically', () => {
  assert.equal(getSubjectFromLtiToken({ userInfo: { sub: 'subject-1' } }), 'subject-1');
  assert.equal(
    serializePlatformId(platform),
    '["https://lms.example","client-1","deployment-1"]'
  );
});

test('teacher-equivalent LTI roles are inferred consistently', () => {
  for (const role of [
    'Instructor',
    'TeachingAssistant',
    'Administrator',
    'ContentDeveloper',
  ]) {
    assert.equal(inferRoleFromLegacyRoles(role), 'teacher', role);
  }
  assert.equal(inferRoleFromLegacyRoles('Learner'), 'student');
});

test('institutional identity is trusted only from configured provenance', () => {
  assert.equal(resolveInstitutionalIdentity(undefined, { staff_id: '123' }, '456'), undefined);
  assert.deepEqual(
    resolveInstitutionalIdentity({ source: 'custom', key: 'staff_id' }, { staff_id: '00123' }),
    { value: '00123', source: 'custom:staff_id', trusted: true }
  );
  assert.deepEqual(
    resolveInstitutionalIdentity({ source: 'lis.person_sourcedid' }, {}, 'S-456'),
    { value: 'S-456', source: 'lis.person_sourcedid', trusted: true }
  );
});

test('login-session hook can replace user and return safe serializable launch data', async () => {
  const result = await resolveLtiLoginSession(async (received) => {
    assert.equal(received.identity.platformSubject, 'subject-1');
    assert.deepEqual(received.courseHints, ['COURSE101']);
    return {
      user: { ...received.user, id: 'linked-user' },
      target: '/courses/COURSE101?source=lti',
      launchMetadata: { courseCode: 'COURSE101', linked: true },
    };
  }, context);

  assert.equal(result.user.id, 'linked-user');
  assert.equal(result.target, '/courses/COURSE101?source=lti');
  assert.deepEqual(result.launchMetadata, { courseCode: 'COURSE101', linked: true });
});

test('login-session hook rejects external targets and non-serializable metadata', async () => {
  for (const target of ['https://evil.example', '//evil.example/path', '/safe\\evil']) {
    assert.equal(isSafeLoginTarget(target), false);
    await assert.rejects(
      resolveLtiLoginSession(async () => ({ target }), context),
      /app-relative path/
    );
  }

  const circular = {};
  circular.self = circular;
  await assert.rejects(
    resolveLtiLoginSession(async () => ({ launchMetadata: circular }), context),
    /JSON-serializable/
  );
});

test('omitting the login-session hook preserves the original user', async () => {
  const result = await resolveLtiLoginSession(undefined, context);
  assert.equal(result.user, context.user);
  assert.equal(result.target, undefined);
});
