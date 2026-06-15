/**
 * LTI 1.0a / 1.1 router — the OAuth 1.0a-signed launch path.
 *
 * Mounted by `initLti` under `${mountPath}${legacyMountPath}` when
 * `legacyLti` is enabled. Handles:
 *  - `POST /launch`: verify the OAuth 1.0a signature/timestamp/nonce, map the
 *    form params onto a {@link NormalizedLaunch}, capture any Basic Outcomes
 *    service link, and run the shared login-only / context-mapping handler.
 *  - `POST /content-item/return`: build + OAuth1-sign the Content-Item return
 *    (when `legacyDeepLinking` is on).
 *  - `GET /session`: exchange the short-lived launch ticket for an app JWT
 *    (the 1.1 analogue of the 1.3 `ltik` -> `/session` bridge).
 *
 * 1.0a and 1.1 share the same launch mechanism; `lti_version` selects which.
 */

import express from 'express';
import jwt from 'jsonwebtoken';

import type {
  LtiAdapter,
  LtiLoginOnlyAdapter,
  LtiConsumerStore,
  LtiNonceStore,
  LtiGradeLinkStore,
  LtiContextSnapshot,
  LtiConnectMode,
  NormalizedLaunch,
  LtiLaunchVersion,
} from '../types';
import {
  getToolBaseUrl,
  getFrontendBaseUrl,
  safeStr,
  inferRoleFromLegacyRoles,
  expandLmsCourseIdentifiers,
} from '../helpers';
import { logInfo, logWarn, logError } from '../logger';
import {
  handleNormalizedLaunch,
  resolveOrProvisionCourseForContext,
  type NormalizedLaunchContext,
} from '../launchHandler';
import {
  verifyOAuth1Request,
  flattenParams,
} from './oauth1';
import {
  renderContentItemPicker,
  buildContentItemsJson,
  buildSignedContentItemReturn,
} from './contentItem';
import {
  LTI_1P1_DEPLOYMENT_ID,
  LAUNCH_TICKET_TTL_SECONDS,
  LTI_MESSAGE_TYPE_CONTENT_ITEM_SELECTION_REQUEST,
} from '../constants';

export interface Lti11RouterConfig {
  adapter: LtiAdapter | LtiLoginOnlyAdapter;
  consumerStore: LtiConsumerStore;
  nonceStore: LtiNonceStore;
  gradeLinkStore: LtiGradeLinkStore;
  connectMode: LtiConnectMode;
  mountPath: string;
  legacyMountPath: string;
  launchRedirectPath: string;
  autoMapCourse: boolean;
  autoEnrollStudents: boolean;
  bindTokenSecret?: string;
  launchTicketSecret: string;
  timestampWindowSeconds: number;
  legacyDeepLinking: boolean;
  toolBaseUrl?: string;
  frontendBaseUrl?: string;
  customFieldPrefix: string;
  deepLinkPageTitle: string;
  resourceLabel: string;
}

interface LaunchTicketClaims {
  email: string;
  name: string;
  role: 'student' | 'teacher';
  externalId?: string;
  version: LtiLaunchVersion;
  issuer: string;
  clientId: string;
  deploymentId: string;
  contextId: string;
  resourceLinkId: string;
}

interface ContentItemStateClaims {
  returnUrl: string;
  data?: string;
  consumerKey: string;
  issuer: string;
  clientId: string;
  deploymentId: string;
  contextId: string;
  resourceLinkId: string;
  courseId: string;
}

const MSG_HTML = (msg: string) =>
  `<div style="font-family:system-ui;padding:24px;">${msg}</div>`;

function legacyVersion(params: Record<string, string>): LtiLaunchVersion {
  return String(params.lti_version ?? '').trim() === 'LTI-1p0' ? '1.0a' : '1.1';
}

function buildLegacyContextSnapshot(params: Record<string, string>): LtiContextSnapshot {
  const contextId = safeStr(params.context_id);
  const customCourseId = safeStr(
    params.custom_course_id || params.custom_moodle_course_id || params.custom_context_id
  );
  return {
    contextId,
    label: safeStr(params.context_label) || undefined,
    title: safeStr(params.context_title) || undefined,
    type: params.context_type ? [safeStr(params.context_type)] : undefined,
    lisCourseOfferingSourcedId: safeStr(params.lis_course_offering_sourcedid) || undefined,
    lisCourseSectionSourcedId: safeStr(params.lis_course_section_sourcedid) || undefined,
    customCourseId: customCourseId || undefined,
    identifierCandidates: expandLmsCourseIdentifiers([
      contextId,
      customCourseId,
      params.lis_course_section_sourcedid,
      params.lis_course_offering_sourcedid,
      params.context_label,
      params.context_title,
    ]),
  };
}

/** Collect `custom_*` launch params into bare-name keys (1.3 custom convention). */
function extractCustom(params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith('custom_')) out[k.slice('custom_'.length)] = v;
  }
  return out;
}

function mapToNormalizedLaunch(params: Record<string, string>): NormalizedLaunch {
  const issuer = safeStr(params.tool_consumer_instance_guid) || safeStr(params.oauth_consumer_key);
  const clientId = safeStr(params.oauth_consumer_key);
  const contextId = safeStr(params.context_id);
  const email = safeStr(params.lis_person_contact_email_primary).toLowerCase();
  const name =
    safeStr(params.lis_person_name_full) ||
    `${safeStr(params.lis_person_name_given)} ${safeStr(params.lis_person_name_family)}`.trim() ||
    email;
  return {
    version: legacyVersion(params),
    email,
    name,
    role: inferRoleFromLegacyRoles(params.roles),
    externalId: safeStr(params.user_id) || undefined,
    platform: { issuer, clientId, deploymentId: LTI_1P1_DEPLOYMENT_ID, contextId },
    resourceLinkId: safeStr(params.resource_link_id),
    custom: extractCustom(params),
    contextSnapshot: buildLegacyContextSnapshot(params),
  };
}

export function createLti11Router(config: Lti11RouterConfig): express.Router {
  const router = express.Router();
  // The host app skips global body parsers on the LTI mount, so the legacy
  // router parses its own urlencoded bodies.
  const urlencoded = express.urlencoded({ extended: true, limit: '256kb' });

  const fullAdapter = config.adapter as LtiAdapter;
  const launchEndpointUrl = (req: express.Request) =>
    `${getToolBaseUrl(req, config.toolBaseUrl)}${config.mountPath}${config.legacyMountPath}/launch`;
  const contentItemReturnUrl = (req: express.Request) =>
    `${getToolBaseUrl(req, config.toolBaseUrl)}${config.mountPath}${config.legacyMountPath}/content-item/return`;

  const mintLaunchTicket = (launch: NormalizedLaunch): string => {
    const claims: LaunchTicketClaims = {
      email: launch.email,
      name: launch.name,
      role: launch.role,
      externalId: launch.externalId,
      version: launch.version,
      issuer: launch.platform.issuer,
      clientId: launch.platform.clientId,
      deploymentId: launch.platform.deploymentId,
      contextId: launch.platform.contextId,
      resourceLinkId: launch.resourceLinkId,
    };
    return jwt.sign(claims, config.launchTicketSecret, { expiresIn: LAUNCH_TICKET_TTL_SECONDS });
  };

  // ── POST /launch ──────────────────────────────────────────────────────
  router.post('/launch', urlencoded, async (req: express.Request, res: express.Response) => {
    try {
      const params = flattenParams(req.body as Record<string, unknown>);
      const consumerKey = safeStr(params.oauth_consumer_key);
      if (!consumerKey) {
        return res.status(400).send(MSG_HTML('Missing oauth_consumer_key.'));
      }

      const consumer = await config.consumerStore.resolveConsumer(consumerKey);
      if (!consumer) {
        logWarn('[LTI 1.1] launch — unknown/disabled consumer key', { consumerKey });
        return res.status(401).send(MSG_HTML('Unknown or disabled consumer key.'));
      }

      const verify = verifyOAuth1Request({
        method: 'POST',
        url: launchEndpointUrl(req),
        params,
        consumerSecret: consumer.secret,
        timestampWindowSeconds: config.timestampWindowSeconds,
      });
      if (!verify.ok) {
        logWarn('[LTI 1.1] launch — signature/timestamp rejected', { error: verify.error });
        return res.status(401).send(MSG_HTML('LTI launch verification failed.'));
      }

      if (await config.nonceStore.seen(verify.nonce!, verify.timestamp!)) {
        logWarn('[LTI 1.1] launch — replayed nonce rejected', { nonce: verify.nonce });
        return res.status(401).send(MSG_HTML('LTI launch verification failed (replay).'));
      }

      const messageType = safeStr(params.lti_message_type);
      if (messageType === LTI_MESSAGE_TYPE_CONTENT_ITEM_SELECTION_REQUEST) {
        if (!config.legacyDeepLinking) {
          return res.status(200).send(MSG_HTML('Content-Item selection is not enabled.'));
        }
        return handleContentItemRequest(req, res, params, consumer);
      }

      return handleBasicLaunch(req, res, params, consumerKey);
    } catch (e: any) {
      logError('[LTI 1.1] launch failed', { message: e?.message, stack: e?.stack });
      return res.status(200).send(MSG_HTML('LTI launch error. Please try again later.'));
    }
  });

  async function handleBasicLaunch(
    req: express.Request,
    res: express.Response,
    params: Record<string, string>,
    consumerKey: string
  ): Promise<unknown> {
    const launch = mapToNormalizedLaunch(params);
    const frontend = getFrontendBaseUrl(req, config.frontendBaseUrl);

    // Capture the Basic Outcomes service link if the LMS enabled grading.
    const serviceUrl = safeStr(params.lis_outcome_service_url);
    const sourcedId = safeStr(params.lis_result_sourcedid);
    if (serviceUrl && sourcedId && launch.externalId) {
      try {
        await config.gradeLinkStore.saveGradeLink({
          ...launch.platform,
          resourceLinkId: launch.resourceLinkId,
          userExternalId: launch.externalId,
          link: { protocol: '1.1', serviceUrl, sourcedId, consumerKey },
        });
      } catch (e: any) {
        logWarn('[LTI 1.1] failed to persist outcome grade link (continuing)', {
          message: e?.message,
        });
      }
    }

    const isLoginOnly = config.connectMode === 'login-only';
    const ticket = mintLaunchTicket(launch);

    const launchCtx: NormalizedLaunchContext = {
      mode: isLoginOnly ? 'login-only' : 'context-mapping',
      autoMapCourse: config.autoMapCourse,
      bindTokenSecret: config.bindTokenSecret,
      redirectToLaunch: (qsParams) => {
        const qs = new URLSearchParams(qsParams);
        qs.set('lti', '1');
        qs.set('ticket', ticket);
        return res.redirect(`${frontend}${config.launchRedirectPath}?${qs.toString()}`);
      },
      respondHtml: (html) => res.status(200).send(html),
    };

    logInfo('[LTI 1.1] basic launch', {
      version: launch.version,
      email: launch.email,
      role: launch.role,
      contextId: launch.platform.contextId,
      hasOutcomeService: !!(serviceUrl && sourcedId),
    });

    // login-only mode may run on the minimal adapter; handleNormalizedLaunch
    // only touches full-adapter methods in context-mapping mode.
    return handleNormalizedLaunch(fullAdapter, launch, launchCtx);
  }

  // ── Content-Item selection (deep linking) ───────────────────────────────
  async function handleContentItemRequest(
    req: express.Request,
    res: express.Response,
    params: Record<string, string>,
    consumer: { key: string; secret: string }
  ): Promise<unknown> {
    const returnUrl = safeStr(params.content_item_return_url);
    if (!returnUrl) {
      return res.status(400).send(MSG_HTML('Missing content_item_return_url.'));
    }

    const launch = mapToNormalizedLaunch(params);
    if (launch.role !== 'teacher') {
      return res.status(200).send(MSG_HTML('Only instructors can configure this activity.'));
    }

    const teacher = await fullAdapter.resolveOrProvisionTeacher(
      launch.email,
      launch.name,
      launch.role,
      launch.externalId
    );
    if (!teacher) {
      return res.status(200).send(MSG_HTML('Not authorized to configure this activity.'));
    }

    const resolved = await resolveOrProvisionCourseForContext(
      fullAdapter,
      launch.contextSnapshot,
      teacher,
      { ...launch.platform, autoMapCourse: config.autoMapCourse }
    );
    if (!resolved) {
      return res.status(200).send(MSG_HTML('Could not match or create a course for this LMS course.'));
    }

    const course = await fullAdapter.getCourseById(resolved.courseId);
    const resources = course
      ? await fullAdapter.listSelectableResources(teacher, course, { limit: 30 })
      : [];

    const state: ContentItemStateClaims = {
      returnUrl,
      data: safeStr(params.data) || undefined,
      consumerKey: consumer.key,
      ...launch.platform,
      resourceLinkId: launch.resourceLinkId,
      courseId: resolved.courseId,
    };
    const stateToken = jwt.sign(state, config.launchTicketSecret, {
      expiresIn: LAUNCH_TICKET_TTL_SECONDS,
    });

    return res.status(200).send(
      renderContentItemPicker({
        title: config.deepLinkPageTitle,
        resourceLabel: config.resourceLabel,
        courseName: course?.name,
        email: launch.email,
        resources: resources.map((r) => ({ id: r.id, name: r.name, source: r.source })),
        actionUrl: contentItemReturnUrl(req),
        state: stateToken,
      })
    );
  }

  router.post(
    '/content-item/return',
    urlencoded,
    async (req: express.Request, res: express.Response) => {
      try {
        const stateToken = safeStr((req.body as any)?.state);
        const resourceId = safeStr((req.body as any)?.resourceId);
        if (!stateToken || !resourceId) {
          return res.status(400).send(MSG_HTML('Missing selection.'));
        }

        let claims: ContentItemStateClaims;
        try {
          claims = jwt.verify(stateToken, config.launchTicketSecret) as ContentItemStateClaims;
        } catch {
          return res.status(400).send(MSG_HTML('Selection session expired. Please retry from the LMS.'));
        }

        const consumer = await config.consumerStore.resolveConsumer(claims.consumerKey);
        if (!consumer) {
          return res.status(401).send(MSG_HTML('Unknown or disabled consumer key.'));
        }

        let title = config.resourceLabel;
        if (fullAdapter.getResourceById) {
          const resource = await fullAdapter.getResourceById(resourceId);
          if (resource?.name) title = resource.name;
        }

        const launchUrl = launchEndpointUrl(req);
        const contentItemsJson = buildContentItemsJson({
          launchUrl,
          title,
          prefix: config.customFieldPrefix,
          courseId: claims.courseId,
          resourceId,
        });

        logInfo('[LTI 1.1] content-item return', {
          courseId: claims.courseId,
          resourceId,
          returnHost: (() => {
            try {
              return new URL(claims.returnUrl).host;
            } catch {
              return '(invalid)';
            }
          })(),
        });

        return res.status(200).send(
          buildSignedContentItemReturn({
            returnUrl: claims.returnUrl,
            data: claims.data,
            contentItemsJson,
            consumerKey: consumer.key,
            consumerSecret: consumer.secret,
          })
        );
      } catch (e: any) {
        logError('[LTI 1.1] content-item return failed', { message: e?.message, stack: e?.stack });
        return res.status(200).send(MSG_HTML('Failed to return selection to the LMS.'));
      }
    }
  );

  // ── GET /session — exchange the launch ticket for an app JWT ────────────
  router.get('/session', async (req: express.Request, res: express.Response) => {
    try {
      const ticket = safeStr(req.query?.ticket);
      if (!ticket) {
        return res.status(401).json({ success: false, message: 'Missing launch ticket' });
      }

      let claims: LaunchTicketClaims;
      try {
        claims = jwt.verify(ticket, config.launchTicketSecret) as LaunchTicketClaims;
      } catch {
        return res.status(401).json({ success: false, message: 'Invalid or expired launch ticket' });
      }

      if (!claims.email) {
        return res.status(400).json({
          success: false,
          message: 'LTI launch did not include an email.',
        });
      }

      const user = await config.adapter.upsertUser({
        email: claims.email,
        name: claims.name || claims.email,
        role: claims.role,
        externalId: claims.externalId,
      });

      // Auto-enroll students in context-mapping mode (mirrors the 1.3 bridge).
      if (
        config.connectMode === 'context-mapping' &&
        config.autoEnrollStudents &&
        claims.role === 'student'
      ) {
        try {
          const platform = {
            issuer: claims.issuer,
            clientId: claims.clientId,
            deploymentId: claims.deploymentId,
            contextId: claims.contextId,
          };
          let courseId = '';
          const mapped = await fullAdapter.findCourseMap(platform);
          if (mapped) courseId = mapped.courseId;
          if (!courseId && claims.resourceLinkId) {
            const binding = await fullAdapter.findResourceBinding({
              ...platform,
              resourceLinkId: claims.resourceLinkId,
            });
            if (binding) courseId = binding.courseId;
          }
          if (courseId) {
            const course = await fullAdapter.getCourseById(courseId);
            if (course) await fullAdapter.ensureStudentInCourse(course, user);
          }
        } catch (e: any) {
          logWarn('[LTI 1.1] auto-enroll failed (continuing)', { message: e?.message });
        }
      }

      const tenant = config.adapter.resolveEffectiveTenant();
      const appJwt = config.adapter.generateJwt(user);

      return res.status(200).json({
        success: true,
        token: appJwt.token,
        expiresIn: appJwt.expiresIn,
        role: claims.role,
        tenant,
      });
    } catch (e: any) {
      logError('[LTI 1.1] /session failed', { message: e?.message, stack: e?.stack });
      return res.status(500).json({ success: false, message: 'LTI 1.1 session bridge failed' });
    }
  });

  return router;
}
