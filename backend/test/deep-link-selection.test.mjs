import assert from 'node:assert/strict';
import test from 'node:test';

import { deepLinkBindingMatches, readDeepLinkSelection } from '../dist/deepLinkSelection.js';

test('deep-link custom params resolve each binding type', () => {
  assert.deepEqual(readDeepLinkSelection({ app_course_id: 'c1', app_assignment_id: 'a1' }, 'app'), {
    courseId: 'c1',
    resourceId: '',
    categoryId: '',
    assignmentId: 'a1',
    bindingType: 'assignment',
    configured: true,
  });
  assert.equal(
    readDeepLinkSelection({ app_course_id: 'c1', app_category_id: 'k1' }, 'app').bindingType,
    'category'
  );
  assert.equal(
    readDeepLinkSelection({ app_course_id: 'c1', app_resource_id: 'r1' }, 'app').bindingType,
    'agent'
  );
});

test('a selection without a course is not treated as configured', () => {
  const selection = readDeepLinkSelection({ agentId: 'r1' }, 'app');
  assert.equal(selection.bindingType, 'agent');
  assert.equal(selection.configured, false);
  assert.equal(readDeepLinkSelection(undefined, 'app').configured, false);
});

test('binding comparison detects a stale resource-link binding', () => {
  const selection = readDeepLinkSelection({ app_course_id: 'c1', app_assignment_id: 'a1' }, 'app');
  assert.equal(
    deepLinkBindingMatches(
      { courseId: 'c1', resourceId: '', assignmentId: 'a1', bindingType: 'assignment' },
      selection
    ),
    true
  );
  assert.equal(
    deepLinkBindingMatches(
      { courseId: 'c1', resourceId: '', assignmentId: 'a2', bindingType: 'assignment' },
      selection
    ),
    false
  );
  assert.equal(deepLinkBindingMatches({ courseId: 'c1', resourceId: 'r1' }, selection), false);
  assert.equal(deepLinkBindingMatches(null, selection), false);
});
