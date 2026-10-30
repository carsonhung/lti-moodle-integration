/**
 * LTI Consumer Admin Router — CRUD for OAuth 1.0a consumer credentials.
 *
 * Parallel to `createLtiAdminRouter` (which manages 1.3 platforms), this router
 * manages the shared consumer key/secret pairs used by the LTI 1.0a / 1.1 path.
 * The secret is WRITE-ONLY: accepted on create/update, never returned in any
 * response. Supply your own admin-auth middleware and a `LtiConsumerAdminStore`
 * backed by your DB (see `stores/consumerAdminStore.mongoose.example.ts`).
 *
 * @example
 * ```typescript
 * import { createLtiConsumerAdminRouter } from 'lti-moodle-integration/backend';
 * const router = createLtiConsumerAdminRouter({
 *   adminMiddleware: [protect, authorize('admin')],
 *   store: myConsumerAdminStore,
 * });
 * app.use('/api/v1/lti/consumers', router);
 * ```
 */

import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import type { LtiConsumerAdminStore } from './types';

interface ConsumerAdminRouterOptions {
  adminMiddleware: RequestHandler[];
  store: LtiConsumerAdminStore;
  logger?: {
    info: (...a: any[]) => void;
    warn: (...a: any[]) => void;
    error: (...a: any[]) => void;
  };
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

export function createLtiConsumerAdminRouter(
  options: ConsumerAdminRouterOptions
): express.Router {
  const router = express.Router();
  const logger = options.logger || console;
  const ErrorClass = options.ErrorClass || DefaultLtiError;
  const adminOnly = options.adminMiddleware;
  const store = options.store;
  // Consumer admin payloads are small JSON; parse them here so the host need
  // not enable a global JSON parser on this mount.
  const json = express.json({ limit: '32kb' });

  router.get(
    '/',
    ...adminOnly,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = String(req.query.tenantId ?? '').trim() || undefined;
        const consumers = await store.list(tenantId);
        return res.status(200).json({ success: true, consumers });
      } catch (e: any) {
        logger.error('[LTI Consumer Admin] list failed', { message: e?.message });
        return next(new ErrorClass('Failed to list LTI consumers', 500));
      }
    }
  );

  router.post(
    '/',
    ...adminOnly,
    json,
    async (req: Request, res: Response, next: NextFunction) => {
      const body = req.body || {};
      const consumerKey = String(body.consumerKey ?? '').trim();
      const secret = String(body.secret ?? '').trim();
      if (!consumerKey || !secret) {
        return next(new ErrorClass('Missing required fields: consumerKey, secret', 400));
      }
      try {
        const consumer = await store.create({
          consumerKey,
          secret,
          label: String(body.label ?? '').trim() || undefined,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
          tenantId: String(body.tenantId ?? '').trim() || undefined,
        });
        return res.status(201).json({ success: true, consumer });
      } catch (e: any) {
        logger.error('[LTI Consumer Admin] create failed', { message: e?.message });
        const duplicate = /duplicate|E11000|unique/i.test(String(e?.message ?? ''));
        return next(
          new ErrorClass(
            duplicate ? 'A consumer with that key already exists' : 'Failed to create LTI consumer',
            duplicate ? 409 : 500
          )
        );
      }
    }
  );

  router.put(
    '/:id',
    ...adminOnly,
    json,
    async (req: Request, res: Response, next: NextFunction) => {
      const id = String(req.params.id ?? '').trim();
      const body = req.body || {};
      const update: { secret?: string; label?: string; enabled?: boolean } = {};
      const secret = String(body.secret ?? '').trim();
      const label = String(body.label ?? '').trim();
      if (secret) update.secret = secret;
      if (label) update.label = label;
      if (typeof body.enabled === 'boolean') update.enabled = body.enabled;

      try {
        const consumer = await store.update(id, update);
        if (!consumer) return next(new ErrorClass('Consumer not found', 404));
        return res.status(200).json({ success: true, consumer });
      } catch (e: any) {
        logger.error('[LTI Consumer Admin] update failed', { message: e?.message });
        return next(new ErrorClass('Failed to update LTI consumer', 500));
      }
    }
  );

  router.delete(
    '/:id',
    ...adminOnly,
    async (req: Request, res: Response, next: NextFunction) => {
      const id = String(req.params.id ?? '').trim();
      try {
        const ok = await store.remove(id);
        if (!ok) return next(new ErrorClass('Consumer not found', 404));
        return res.status(200).json({ success: true });
      } catch (e: any) {
        logger.error('[LTI Consumer Admin] delete failed', { message: e?.message });
        return next(new ErrorClass('Failed to delete LTI consumer', 500));
      }
    }
  );

  return router;
}
