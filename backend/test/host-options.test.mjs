import assert from 'node:assert/strict';
import test from 'node:test';

import { hasLearnerRoleFromLti, inferRoleFromLti } from '../dist/helpers.js';
import { buildAgsLineItemPayload } from '../dist/grades/ags.js';
import { resolveOrProvisionCourseForContext } from '../dist/launchHandler.js';

const MEMBERSHIP = 'http://purl.imsglobal.org/vocab/lis/v2/membership';
const withRoles = (roles) => ({ locals: { context: { roles } } });

test('Learner role is detected alongside a teacher role', () => {
  const both = withRoles([`${MEMBERSHIP}#Instructor`, `${MEMBERSHIP}#Learner`]);
  assert.equal(inferRoleFromLti(both), 'teacher');
  assert.equal(hasLearnerRoleFromLti(both), true);
  assert.equal(hasLearnerRoleFromLti(withRoles([`${MEMBERSHIP}#Instructor`])), false);
  assert.equal(hasLearnerRoleFromLti(withRoles(['Learner'])), true);
  assert.equal(hasLearnerRoleFromLti(withRoles([`${MEMBERSHIP}#NonLearner`])), false);
});

test('assignment line item keeps a host tag when given', () => {
  const base = { assignmentId: 'a1', title: 'Quiz', scoreMaximum: 10, tagPrefix: 'app' };
  assert.equal(buildAgsLineItemPayload(base).tag, 'app:assignment:a1');
  assert.equal(buildAgsLineItemPayload({ ...base, tag: 'legacy:a1' }).tag, 'legacy:a1');
  assert.equal(buildAgsLineItemPayload({ ...base, tag: '  ' }).tag, 'app:assignment:a1');
});

function fakeAdapter({ teacherCourses = [], allCourses = [] } = {}) {
  const maps = new Map();
  const calls = { attached: [] };
  const byCode = (list, code) => list.find((c) => c.courseId === code) ?? null;
  const byId = (list, id) => list.find((c) => c.id === id) ?? null;
  return {
    calls,
    findCourseMap: async (p) => maps.get(p.contextId) ?? null,
    upsertCourseMap: async (p) => {
      const map = { courseId: p.courseId, tenantId: p.tenantId };
      maps.set(p.contextId, map);
      return map;
    },
    findCourseByCourseIdForTeacher: async (_t, code) => byCode(teacherCourses, code),
    findCourseByCourseId: async (code) => byCode(allCourses, code),
    getCourseForTeacher: async (_t, id) => byId(teacherCourses, id),
    getCourseById: async (id) => byId(allCourses, id),
    ensureTeacherInCourse: async (course) => calls.attached.push(course.id),
    resolveEffectiveTenant: () => undefined,
  };
}

const params = {
  issuer: 'https://lms.example',
  clientId: 'client-1',
  deploymentId: 'deployment-1',
  contextId: 'ctx-1',
  autoMapCourse: true,
};
const snapshot = { contextId: 'ctx-1', identifierCandidates: ['DEMO1001'] };
const teacher = { id: 't1', email: 't@example.com', name: 'T', roles: ['teacher'] };
const otherCourse = { id: 'c-other', courseId: 'DEMO1001', name: 'Demo', tenantId: 'tenant-b' };

test('auto-map scope "any" attaches the teacher to a course they do not teach', async () => {
  const adapter = fakeAdapter({ allCourses: [otherCourse] });
  const resolved = await resolveOrProvisionCourseForContext(adapter, snapshot, teacher, params);
  assert.deepEqual(resolved, { courseId: 'c-other', tenantId: 'tenant-b', created: false });
  assert.ok(adapter.calls.attached.includes('c-other'));
});

test('auto-map scope "teacher" only matches courses the teacher teaches', async () => {
  const adapter = fakeAdapter({ allCourses: [otherCourse] });
  const resolved = await resolveOrProvisionCourseForContext(adapter, snapshot, teacher, {
    ...params,
    autoMapScope: 'teacher',
  });
  assert.equal(resolved, null);
  assert.deepEqual(adapter.calls.attached, []);

  const own = { ...otherCourse, id: 'c-own' };
  const owner = fakeAdapter({ teacherCourses: [own], allCourses: [own] });
  const mapped = await resolveOrProvisionCourseForContext(owner, snapshot, teacher, {
    ...params,
    autoMapScope: 'teacher',
  });
  assert.equal(mapped?.courseId, 'c-own');
});

test('auto-map scope "teacher" still lets admins match any course', async () => {
  const adapter = fakeAdapter({ allCourses: [otherCourse] });
  const admin = { ...teacher, roles: ['teacher', 'admin'] };
  const resolved = await resolveOrProvisionCourseForContext(adapter, snapshot, admin, {
    ...params,
    autoMapScope: 'teacher',
  });
  assert.equal(resolved?.courseId, 'c-other');
  assert.deepEqual(adapter.calls.attached, []);
});
