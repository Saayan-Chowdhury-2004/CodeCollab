import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.ts';
import { validateRequest } from '../../middleware/validate.ts';
import {
  listUserNotificationsPaginated,
  markAllUserNotificationsAsRead,
  markNotificationAsRead,
} from './notifications.service.ts';

export const notificationsRouter = Router();

const listNotificationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

const notificationParamsSchema = z.object({
  id: z.string().uuid(),
});

// GET /api/notifications
notificationsRouter.get(
  '/',
  requireAuth,
  validateRequest({ query: listNotificationsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as unknown as z.infer<typeof listNotificationsQuerySchema>;
      const result = await listUserNotificationsPaginated(req.user!.id, {
        cursor: query.cursor,
        limit: Number(query.limit) || 20,
        unreadOnly: Boolean(query.unreadOnly),
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/notifications/read-all
notificationsRouter.post(
  '/read-all',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await markAllUserNotificationsAsRead(req.user!.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/notifications/:id/read
notificationsRouter.post(
  '/:id/read',
  requireAuth,
  validateRequest({ params: notificationParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const notification = await markNotificationAsRead(req.user!.id, req.params.id);
      res.status(200).json({ notification });
    } catch (error) {
      next(error);
    }
  }
);
