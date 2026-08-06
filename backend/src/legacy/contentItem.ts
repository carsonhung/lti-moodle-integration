/**
 * LTI 1.1 Content-Item deep linking.
 *
 * The 1.1 equivalent of the 1.3 Deep Linking picker. On a
 * `ContentItemSelectionRequest` launch the teacher picks a resource; the tool
 * then builds a `content_items` payload and OAuth1-signs an auto-POST form back
 * to `content_item_return_url`. Only the transport differs from 1.3 (signed
 * form POST vs signed JWT); the binding is carried in the content-item `custom`
 * params so later student launches resolve it via the existing custom-param
 * fallback.
 */

import { escapeHtml } from '../helpers';
import type { LtiDeepLinkItem } from '../types';
import { signOAuth1 } from './oauth1';
import { LTI_MESSAGE_TYPE_CONTENT_ITEM_SELECTION } from '../constants';

export interface ContentItemPickerResource {
  id: string;
  name: string;
  source?: string;
}

/**
 * Render the server-rendered picker shown inside the LMS content-selection
 * iframe. The form POSTs the chosen resource id + a signed `state` (carrying
 * the launch context) back to the tool's content-item return endpoint.
 */
export function renderContentItemPicker(params: {
  title: string;
  resourceLabel: string;
  courseName?: string;
  email?: string;
  resources: ContentItemPickerResource[];
  actionUrl: string;
  state: string;
  error?: string;
}): string {
  const { title, resourceLabel, courseName, email, resources, actionUrl, state, error } = params;
  const article = /^[aeiou]/i.test(resourceLabel) ? 'an' : 'a';
  const options = resources
    .map(
      (r) =>
        `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}${
          r.source ? ` (${escapeHtml(r.source)})` : ''
        }</option>`
    )
    .join('\n');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; color: #0f172a; }
      .card { max-width: 720px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
      h1 { margin: 0 0 10px; font-size: 18px; }
      label { font-weight: 600; font-size: 13px; display: block; margin-bottom: 6px; }
      select { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; }
      .btn { margin-top: 16px; border: 0; background: #0ea5e9; color: #fff; padding: 10px 16px; border-radius: 10px; font-weight: 700; cursor: pointer; }
      .btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .muted { color: #64748b; font-size: 12px; }
      .error { background: #fff1f2; border: 1px solid #fecdd3; color: #9f1239; padding: 10px 12px; border-radius: 10px; margin-bottom: 12px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      ${email ? `<p class="muted">Signed in via the LMS as <strong>${escapeHtml(email)}</strong></p>` : ''}
      ${courseName ? `<p class="muted">Course: <strong>${escapeHtml(courseName)}</strong></p>` : ''}
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <form method="POST" action="${escapeHtml(actionUrl)}">
        <input type="hidden" name="state" value="${escapeHtml(state)}" />
        <label for="resourceId">${escapeHtml(resourceLabel)}</label>
        <select id="resourceId" name="resourceId" required>
          <option value="">Select ${article} ${escapeHtml(resourceLabel.toLowerCase())}…</option>
          ${options}
        </select>
        <button class="btn" type="submit">Save &amp; Return to the LMS</button>
      </form>
    </div>
  </body>
</html>`;
}

/**
 * Build the LTI 1.1 `content_items` JSON for a single LtiLinkItem. The chosen
 * resource id + course id are carried in `custom` so subsequent launches
 * resolve the binding without predicting the LMS-assigned resource_link_id.
 */
export function buildContentItemsJson(params: {
  launchUrl: string;
  title: string;
  prefix: string;
  courseId: string;
  resourceId: string;
  text?: string;
}): string {
  return buildContentItemsJsonFromItems([
    {
      type: 'ltiResourceLink',
      url: params.launchUrl,
      title: params.title,
      text: params.text,
      custom: {
        [`${params.prefix}_course_id`]: params.courseId,
        [`${params.prefix}_resource_id`]: params.resourceId,
      },
    },
  ]);
}

/**
 * Convert protocol-neutral deep-link items to the LTI 1.1 Content-Item shape.
 * Content-Item only has a safe equivalent for launchable LTI resource links;
 * unsupported 1.3 item types are rejected instead of being lossy-converted.
 */
export function buildContentItemsJsonFromItems(items: LtiDeepLinkItem[]): string {
  if (!items.length) {
    throw new Error('At least one LTI content item is required.');
  }

  const graph = items.map((source) => {
    if (source.type !== 'ltiResourceLink') {
      throw new Error(`LTI 1.1 Content-Item does not support item type "${source.type}".`);
    }
    if (!source.url) {
      throw new Error('LTI 1.1 Content-Item resource links require an absolute URL.');
    }
    const launchUrl = new URL(source.url);
    if (launchUrl.protocol !== 'https:' && launchUrl.protocol !== 'http:') {
      throw new Error('LTI 1.1 Content-Item resource links require an HTTP(S) URL.');
    }

    const item: Record<string, unknown> = {
      '@type': 'LtiLinkItem',
      mediaType: 'application/vnd.ims.lti.v1.ltilink',
      url: launchUrl.toString(),
      title: source.title,
    };
    if (source.text) item.text = source.text;
    if (source.custom && Object.keys(source.custom).length) item.custom = source.custom;
    if (source.icon) item.icon = source.icon;
    if (source.thumbnail) item.thumbnail = source.thumbnail;
    return item;
  });

  return JSON.stringify({
    '@context': 'http://purl.imsglobal.org/ctx/lti/v1/ContentItem',
    '@graph': graph,
  });
}

/**
 * Build a server-rendered, OAuth1-signed auto-POST form that returns the chosen
 * content item to the LMS's `content_item_return_url`.
 */
export function buildSignedContentItemReturn(params: {
  returnUrl: string;
  data?: string;
  contentItemsJson: string;
  consumerKey: string;
  consumerSecret: string;
  /** Test overrides. */
  nowSeconds?: number;
  nonce?: string;
}): string {
  const formParams: Record<string, string> = {
    lti_message_type: LTI_MESSAGE_TYPE_CONTENT_ITEM_SELECTION,
    lti_version: 'LTI-1p1',
    content_items: params.contentItemsJson,
  };
  if (params.data) formParams.data = params.data;

  const { allParams } = signOAuth1({
    method: 'POST',
    url: params.returnUrl,
    consumerKey: params.consumerKey,
    consumerSecret: params.consumerSecret,
    params: formParams,
    nowSeconds: params.nowSeconds,
    nonce: params.nonce,
  });

  const hiddenInputs = Object.entries(allParams)
    .map(
      ([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`
    )
    .join('\n      ');

  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Returning to the LMS…</title></head>
  <body onload="document.forms[0].submit()">
    <form method="POST" action="${escapeHtml(params.returnUrl)}">
      ${hiddenInputs}
      <noscript><button type="submit">Return to the LMS</button></noscript>
    </form>
  </body>
</html>`;
}
