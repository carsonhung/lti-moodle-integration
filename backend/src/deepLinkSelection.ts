import { safeStr } from './helpers';
import type { LtiBindingType, LtiResourceBinding } from './types';

/**
 * Course + target carried in the custom params of a content item placed by
 * Deep Linking. These are the activity's configuration: the platform assigns
 * the resource link id only after the deep-link response, so the binding saved
 * at selection time is keyed to a different (or empty) resource link.
 */
export interface DeepLinkSelection {
  courseId: string;
  resourceId: string;
  categoryId: string;
  assignmentId: string;
  bindingType?: LtiBindingType;
  configured: boolean;
}

export function readDeepLinkSelection(
  custom: Record<string, unknown> | undefined,
  fieldPrefix: string
): DeepLinkSelection {
  const c = custom ?? {};
  const courseId = safeStr(c[`${fieldPrefix}_course_id`] || c.courseId).trim();
  const resourceId = safeStr(
    c[`${fieldPrefix}_resource_id`] || c[`${fieldPrefix}_agent_id`] || c.agentId
  ).trim();
  const categoryId = safeStr(c[`${fieldPrefix}_category_id`] || c.categoryId).trim();
  const assignmentId = safeStr(c[`${fieldPrefix}_assignment_id`] || c.assignmentId).trim();
  const bindingType: LtiBindingType | undefined = assignmentId
    ? 'assignment'
    : categoryId
      ? 'category'
      : resourceId
        ? 'agent'
        : undefined;
  return {
    courseId,
    resourceId,
    categoryId,
    assignmentId,
    bindingType,
    configured: !!(courseId && bindingType),
  };
}

export function deepLinkBindingMatches(
  binding: LtiResourceBinding | null | undefined,
  selection: DeepLinkSelection
): boolean {
  if (!binding || !selection.bindingType) return false;
  if (binding.courseId !== selection.courseId) return false;
  if ((binding.bindingType || 'agent') !== selection.bindingType) return false;
  if (selection.bindingType === 'category') return binding.categoryId === selection.categoryId;
  if (selection.bindingType === 'assignment') {
    return binding.assignmentId === selection.assignmentId;
  }
  return binding.resourceId === selection.resourceId;
}
