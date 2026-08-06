import type { LtiDeepLinkItem, NormalizedLaunchHookContext } from './types';
import type { LtiConnectMode } from './types';

export interface DeepLinkResponseOptions {
  /** Human-readable confirmation shown by supporting LTI 1.3 platforms. */
  message?: string;
  /** Machine-readable log value returned by supporting LTI 1.3 platforms. */
  log?: string;
}

/**
 * Protocol-neutral response capability attached to authenticated Deep Linking
 * and Content-Item requests. Hosts should normally call
 * {@link respondToDeepLinking} instead of invoking this object directly.
 */
export interface DeepLinkResponseFacade {
  readonly version: '1.3' | '1.1' | '1.0a';
  readonly returnUrl: string;
  /**
   * Build the signed auto-submit form. The host may return it immediately or
   * retain this request-scoped facade server-side while an external picker
   * completes, then send the returned HTML from its completion endpoint.
   */
  respond(items: LtiDeepLinkItem[], options?: DeepLinkResponseOptions): Promise<string>;
}

export function createDeepLinkResponseFacade(params: {
  version: DeepLinkResponseFacade['version'];
  returnUrl: string;
  respond: DeepLinkResponseFacade['respond'];
}): DeepLinkResponseFacade {
  return Object.freeze({
    version: params.version,
    returnUrl: params.returnUrl,
    respond: params.respond,
  });
}

/** @internal Exported for focused policy tests; not part of the package barrel. */
export function shouldRegisterDeepLinkHandler(
  connectMode: LtiConnectMode,
  hasHostHook: boolean
): boolean {
  return hasHostHook || connectMode === 'deep-linking';
}

/**
 * Complete an authenticated content-selection request without knowing whether
 * it arrived as LTI 1.3 Deep Linking or LTI 1.1 Content-Item.
 */
export async function respondToDeepLinking(
  ctx: NormalizedLaunchHookContext,
  items: LtiDeepLinkItem[],
  options?: DeepLinkResponseOptions
): Promise<unknown> {
  if (!ctx.isDeepLinkingRequest || !ctx.deepLinking) {
    throw new Error('This launch is not an LTI content-selection request.');
  }
  if (!items.length) {
    throw new Error('At least one LTI content item is required.');
  }
  const form = await ctx.deepLinking.respond(items, options);
  return ctx.res.status(200).send(form);
}
