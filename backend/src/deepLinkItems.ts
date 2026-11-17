/**
 * Helpers for the Deep Linking picker lists and the content items returned to
 * the LMS on `/deeplink/submit`.
 */

import type { LtiCategory, LtiDeepLinkItem, LtiResource } from './types';

export type DeepLinkItemKind = 'resource' | 'category' | 'assignment';

export interface DeepLinkItemTextContext {
  kind: DeepLinkItemKind;
  name: string;
  description?: string;
  /** Number of agents in the category (`kind: 'category'` only). */
  agentCount?: number;
}

/**
 * Builds the `text` of a returned content item (shown under the activity in
 * Moodle). Return `undefined` to omit it.
 */
export type DeepLinkItemText = (context: DeepLinkItemTextContext) => string | undefined;

/** Default item text: the trimmed description, if any. */
export const defaultDeepLinkItemText: DeepLinkItemText = ({ description }) =>
  description?.trim() || undefined;

export function resolveDeepLinkItemText(
  context: DeepLinkItemTextContext,
  custom?: DeepLinkItemText
): string | undefined {
  return (custom ?? defaultDeepLinkItemText)(context) || undefined;
}

/** Prefix a relative URL with the tool base; absolute URLs pass through. */
export function toAbsoluteUrl(base: string, url: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')) return url;
  return `${base.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Set `icon` / `thumbnail` on a content item from relative or absolute URLs. */
export function applyDeepLinkItemMedia(
  item: LtiDeepLinkItem,
  base: string,
  media: { iconUrl?: string; thumbnailUrl?: string }
): void {
  if (media.iconUrl) {
    item.icon = { url: toAbsoluteUrl(base, media.iconUrl), width: 64, height: 64 };
  }
  if (media.thumbnailUrl) {
    item.thumbnail = { url: toAbsoluteUrl(base, media.thumbnailUrl), width: 200, height: 200 };
  }
}

/** Agent entry for `GET /deeplink/course/:courseId/agents`. */
export function toPickerAgent(resource: LtiResource) {
  return {
    _id: resource.id,
    name: resource.name,
    description: resource.description,
    iconUrl: resource.iconUrl,
    source: resource.source || 'other',
  };
}

/** Category entry for `GET /deeplink/course/:courseId/categories`. */
export function toPickerCategory(category: LtiCategory) {
  return {
    _id: category.id,
    name: category.name,
    description: category.description,
    iconUrl: category.iconUrl,
    agentCount: category.agentCount,
    isCourseStudentAgents: category.isCourseStudentAgents,
    source: category.source,
  };
}
