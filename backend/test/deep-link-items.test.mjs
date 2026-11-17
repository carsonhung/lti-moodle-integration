import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDeepLinkItemMedia,
  resolveDeepLinkItemText,
  toAbsoluteUrl,
  toPickerAgent,
  toPickerCategory,
} from '../dist/deepLinkItems.js';

test('picker agents keep description and icon', () => {
  assert.deepEqual(
    toPickerAgent({ id: 'r1', name: 'Tutor', description: 'Helps', iconUrl: '/uploads/a.png' }),
    { _id: 'r1', name: 'Tutor', description: 'Helps', iconUrl: '/uploads/a.png', source: 'other' }
  );
  assert.equal(toPickerAgent({ id: 'r2', name: 'B', source: 'course' }).source, 'course');
});

test('picker categories keep the icon', () => {
  const category = toPickerCategory({
    id: 'k1',
    name: 'Cases',
    iconUrl: '/uploads/k.png',
    agentCount: 3,
    isCourseStudentAgents: false,
  });
  assert.equal(category._id, 'k1');
  assert.equal(category.iconUrl, '/uploads/k.png');
  assert.equal(category.agentCount, 3);
});

test('relative media URLs are made absolute against the tool base', () => {
  assert.equal(toAbsoluteUrl('https://tool.example/', '/uploads/a.png'), 'https://tool.example/uploads/a.png');
  assert.equal(toAbsoluteUrl('https://tool.example', 'uploads/a.png'), 'https://tool.example/uploads/a.png');
  assert.equal(toAbsoluteUrl('https://tool.example', 'https://cdn.example/a.png'), 'https://cdn.example/a.png');
  assert.equal(toAbsoluteUrl('https://tool.example', '//cdn.example/a.png'), '//cdn.example/a.png');
});

test('content item media sets icon and thumbnail only when given', () => {
  const item = { type: 'ltiResourceLink', title: 'Cases' };
  applyDeepLinkItemMedia(item, 'https://tool.example', {
    iconUrl: '/uploads/k.png',
    thumbnailUrl: '/uploads/k.png',
  });
  assert.deepEqual(item.icon, { url: 'https://tool.example/uploads/k.png', width: 64, height: 64 });
  assert.deepEqual(item.thumbnail, {
    url: 'https://tool.example/uploads/k.png',
    width: 200,
    height: 200,
  });

  const bare = { type: 'ltiResourceLink', title: 'Tutor' };
  applyDeepLinkItemMedia(bare, 'https://tool.example', {});
  assert.equal(bare.icon, undefined);
  assert.equal(bare.thumbnail, undefined);
});

test('item text defaults to the trimmed description', () => {
  assert.equal(resolveDeepLinkItemText({ kind: 'resource', name: 'A', description: ' Hi ' }), 'Hi');
  assert.equal(resolveDeepLinkItemText({ kind: 'resource', name: 'A', description: '  ' }), undefined);
  assert.equal(resolveDeepLinkItemText({ kind: 'resource', name: 'A' }), undefined);
});

test('a host can customise or omit item text', () => {
  const hint = ({ kind, description, agentCount }) =>
    kind === 'category' ? `${description ?? ''} (${agentCount} agents)`.trim() : undefined;
  assert.equal(
    resolveDeepLinkItemText({ kind: 'category', name: 'K', description: 'Cases', agentCount: 2 }, hint),
    'Cases (2 agents)'
  );
  assert.equal(
    resolveDeepLinkItemText({ kind: 'resource', name: 'A', description: 'Hi' }, hint),
    undefined
  );
});
