/**
 * LTI Admin Router — Platform CRUD for the registered LMS platforms.
 *
 * This router is created by a factory function so the host application can
 * supply its own admin-auth middleware and error class. The router is
 * mounted under a path of your choice (typically `/api/v1/lti`) and is
 * separate from the LTI tool routes mounted by `initLti`.
 *
 * @example
 * ```typescript
 * import { createLtiAdminRouter } from 'lti-moodle-integration/backend';
 * import { protect, authorize } from './middleware/auth';
 *
 * const ltiAdminRouter = createLtiAdminRouter({
 *   adminMiddleware: [protect, authorize('admin')],
 *   logger: myLogger, // optional
 * });
 * app.use('/api/v1/lti', ltiAdminRouter);
 * ```
 */

import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import { truthy } from './helpers';
import { getLtiProvider } from './core';

interface LtiAdminRouterOptions {
  /**
   * Middleware stack that protects the admin platform routes. Typical usage
   * is `[protect, authorize('admin')]` — the order is preserved.
   */
  adminMiddleware: RequestHandler[];
  /**
   * Optional logger. Falls back to console.
   */
  logger?: {
    info: (...a: any[]) => void;
    warn: (...a: any[]) => void;
    error: (...a: any[]) => void;
  };
  /**
   * Optional error class constructor. The router uses `new ErrorClass(msg, statusCode)`
   * to forward errors to your existing error middleware. Defaults to a tiny
   * internal class that sets `.statusCode` on a regular Error.
   */
  ErrorClass?: new (message: string, statusCode: number) => Error & { statusCode?: number };
}

class DefaultLtiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'LtiError';
  }
}

function isLtiEnabled(): boolean {
  return truthy(process.env.LTI_ENABLED);
}

function getLtiReadinessError(
  lti: any
): { statusCode: number; message: string } | null {
  if (!isLtiEnabled()) {
    return { statusCode: 400, message: 'LTI is disabled on this server (LTI_ENABLED=false)' };
  }

  // If ltijs has been initialised (and exposed its internal Database
  // helper), we're ready — regardless of whether the backend used a Mongo
  // URL or a custom dbPlugin (e.g. ltijs-sequelize for Postgres). This
  // check used to reject dbPlugin-based setups by demanding LTI_DB_URL,
  // which is intentionally unset in that mode.
  if (lti && lti.Database) {
    return null;
  }

  const encryptionKey = String(process.env.LTI_ENCRYPTION_KEY ?? '').trim();
  if (!encryptionKey || encryptionKey === 'your_32_char_hex_key_here') {
    return {
      statusCode: 503,
      message:
        'LTI is enabled but LTI_ENCRYPTION_KEY is missing (or still the placeholder). Set a real encryption key and restart the backend.',
    };
  }

  const dbUrl =
    String(process.env.LTI_DB_URL ?? '').trim() || String(process.env.MONGO_URI ?? '').trim();
  if (!dbUrl) {
    return {
      statusCode: 503,
      message:
        'LTI is enabled but no database is configured. Set LTI_DB_URL (Mongo) or pass a dbPlugin (e.g. ltijs-sequelize) to initLti, then restart the backend.',
    };
  }

  return {
    statusCode: 503,
    message:
      'LTI provider is not initialized yet. Check backend startup logs for [LTI] Enabled (or missing key/DB warnings) and restart the backend.',
  };
}

async function safeCallAsync<T>(obj: any, method: string, fallback: T): Promise<T> {
  try {
    if (!obj || typeof obj[method] !== 'function') return fallback;
    const v: any = obj[method]();
    if (v && typeof v.then === 'function') return (await v) as T;
    return v as T;
  } catch {
    return fallback;
  }
}

async function mapPlatform(p: any) {
  // ltijs Platform fields are mostly exposed as async methods, so we must
  // await them. Returning Promises directly to JSON renders as `{}`.
  const platformId =
    (await safeCallAsync<string | undefined>(p, 'platformId', undefined)) || p?.platformId;
  const url = (await safeCallAsync<string | undefined>(p, 'platformUrl', undefined)) || p?.url;
  const clientId =
    (await safeCallAsync<string | undefined>(p, 'platformClientId', undefined)) || p?.clientId;
  const name = (await safeCallAsync<string | undefined>(p, 'platformName', undefined)) || p?.name;

  const authenticationEndpoint =
    (await safeCallAsync<string | undefined>(p, 'platformAuthenticationEndpoint', undefined)) ||
    p?.authenticationEndpoint;
  const accesstokenEndpoint =
    (await safeCallAsync<string | undefined>(p, 'platformAccessTokenEndpoint', undefined)) ||
    p?.accesstokenEndpoint;

  const authConfig =
    (await safeCallAsync<any>(p, 'platformAuthConfig', undefined)) || p?.authConfig || {};

  const active =
    p?.active ?? (await safeCallAsync<boolean | undefined>(p, 'platformActive', undefined));

  return {
    platformId,
    url,
    clientId,
    name,
    authenticationEndpoint,
    accesstokenEndpoint,
    authConfigMethod: authConfig?.method,
    authConfigKey: authConfig?.key,
    active,
  };
}

export function createLtiAdminRouter(options: LtiAdminRouterOptions): express.Router {
  const router = express.Router();
  const logger = options.logger || console;
  const ErrorClass = options.ErrorClass || DefaultLtiError;
  const adminOnly = options.adminMiddleware;

  function requireLtiReady(req: Request, res: Response, next: NextFunction) {
    const lti = getLtiProvider();
    const err = getLtiReadinessError(lti);
    if (err) return next(new ErrorClass(err.message, err.statusCode));
    return next();
  }

  // NOTE: Do NOT put auth middleware at router-level if the LTI tool is
  // mounted under the same prefix (e.g. LTI_MOUNT_PATH=/api/v1/lti). Tool
  // endpoints like /login and /launch must remain public to Moodle.

  router.get(
    '/platforms',
    ...adminOnly,
    requireLtiReady,
    async (req: Request, res: Response, next: NextFunction) => {
      const lti = getLtiProvider();
      try {
        const platforms = await lti.getAllPlatforms();
        const list = Array.isArray(platforms) ? await Promise.all(platforms.map(mapPlatform)) : [];
        return res.status(200).json({ success: true, platforms: list });
      } catch (e: any) {
        logger.error('[LTI Admin] list platforms failed', { message: e?.message, stack: e?.stack });
        return next(new ErrorClass('Failed to list LTI platforms', 500));
      }
    }
  );

  router.post(
    '/platforms',
    ...adminOnly,
    requireLtiReady,
    async (req: Request, res: Response, next: NextFunction) => {
      const lti = getLtiProvider();
      const body = req.body || {};
      const url = String(body.url ?? '').trim();
      const name = String(body.name ?? '').trim() || 'Platform';
      const clientId = String(body.clientId ?? '').trim();
      const authenticationEndpoint = String(body.authenticationEndpoint ?? '').trim();
      const accesstokenEndpoint = String(body.accesstokenEndpoint ?? '').trim();
      const authConfigMethod = String(body.authConfigMethod ?? 'JWK_SET').trim();
      const authConfigKey = String(body.authConfigKey ?? '').trim();

      if (!url || !clientId || !authenticationEndpoint || !accesstokenEndpoint || !authConfigKey) {
        return next(
          new ErrorClass(
            'Missing required fields: url, clientId, authenticationEndpoint, accesstokenEndpoint, authConfigKey',
            400
          )
        );
      }

      try {
        // ltijs v5.x registerPlatform internally calls getPlatform without
        // binding `this`, so we pass a bound getPlatform + explicit Database
        // to avoid "Cannot read properties of undefined (reading 'Database')".
        const platform = await lti.registerPlatform(
          {
            url,
            name,
            clientId,
            authenticationEndpoint,
            accesstokenEndpoint,
            authConfig: { method: authConfigMethod, key: authConfigKey },
          },
          lti.getPlatform?.bind(lti),
          undefined,
          lti.Database
        );
        return res.status(200).json({ success: true, platform: await mapPlatform(platform) });
      } catch (e: any) {
        logger.error('[LTI Admin] register platform failed', {
          message: e?.message,
          stack: e?.stack,
        });
        return next(new ErrorClass('Failed to register LTI platform', 500));
      }
    }
  );

  router.put(
    '/platforms',
    ...adminOnly,
    requireLtiReady,
    async (req: Request, res: Response, next: NextFunction) => {
      const lti = getLtiProvider();
      const body = req.body || {};
      const platformId = String(body.platformId ?? '').trim();
      if (!platformId) {
        return next(new ErrorClass('Missing required field: platformId', 400));
      }

      // Build a partial update. Only forward fields that were actually sent —
      // ltijs's updatePlatformById falls back to the stored value for any field
      // left undefined, so omitting a field leaves it unchanged. Empty strings
      // are treated as "not provided" to avoid clobbering identity/endpoints.
      const platformInfo: {
        url?: string;
        clientId?: string;
        name?: string;
        authenticationEndpoint?: string;
        accesstokenEndpoint?: string;
        authConfig?: { method?: string; key?: string };
      } = {};

      const url = String(body.url ?? '').trim();
      const clientId = String(body.clientId ?? '').trim();
      const name = String(body.name ?? '').trim();
      const authenticationEndpoint = String(body.authenticationEndpoint ?? '').trim();
      const accesstokenEndpoint = String(body.accesstokenEndpoint ?? '').trim();
      const authConfigMethod = String(body.authConfigMethod ?? '').trim();
      const authConfigKey = String(body.authConfigKey ?? '').trim();

      if (url) platformInfo.url = url;
      if (clientId) platformInfo.clientId = clientId;
      if (name) platformInfo.name = name;
      if (authenticationEndpoint) platformInfo.authenticationEndpoint = authenticationEndpoint;
      if (accesstokenEndpoint) platformInfo.accesstokenEndpoint = accesstokenEndpoint;
      if (authConfigMethod || authConfigKey) {
        platformInfo.authConfig = {};
        if (authConfigMethod) platformInfo.authConfig.method = authConfigMethod;
        if (authConfigKey) platformInfo.authConfig.key = authConfigKey;
      }

      try {
        const platform = await lti.updatePlatformById(platformId, platformInfo);
        if (!platform) {
          return next(new ErrorClass('No LTI platform found for that platformId', 404));
        }

        // `active` lives in a separate platformStatus record keyed by the
        // unchanged platformId, so it is toggled via the Platform instance
        // rather than updatePlatformById.
        if (typeof body.active === 'boolean') {
          await platform.platformActive(body.active);
        }

        return res.status(200).json({ success: true, platform: await mapPlatform(platform) });
      } catch (e: any) {
        logger.error('[LTI Admin] update platform failed', {
          message: e?.message,
          stack: e?.stack,
        });
        const msg =
          e?.message === 'URL_CLIENT_ID_COMBINATION_ALREADY_EXISTS'
            ? 'Another platform is already registered with that issuer URL + client ID'
            : 'Failed to update LTI platform';
        const status = e?.message === 'URL_CLIENT_ID_COMBINATION_ALREADY_EXISTS' ? 409 : 500;
        return next(new ErrorClass(msg, status));
      }
    }
  );

  router.delete(
    '/platforms',
    ...adminOnly,
    requireLtiReady,
    async (req: Request, res: Response, next: NextFunction) => {
      const lti = getLtiProvider();
      const platformId = String(req.query.platformId ?? req.body?.platformId ?? '').trim();
      const url = String(req.query.url ?? req.body?.url ?? '').trim();
      const clientId = String(req.query.clientId ?? req.body?.clientId ?? '').trim();

      try {
        if (platformId) {
          await lti.deletePlatformById(platformId);
          return res.status(200).json({ success: true });
        }
        if (url && clientId) {
          await lti.deletePlatform(url, clientId);
          return res.status(200).json({ success: true });
        }
        return next(new ErrorClass('Provide platformId or (url + clientId)', 400));
      } catch (e: any) {
        logger.error('[LTI Admin] delete platform failed', {
          message: e?.message,
          stack: e?.stack,
        });
        return next(new ErrorClass('Failed to delete LTI platform', 500));
      }
    }
  );

  return router;
}
