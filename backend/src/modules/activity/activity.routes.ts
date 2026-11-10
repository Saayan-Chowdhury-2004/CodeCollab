import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../../middleware/authenticate.ts';
import { validateRequest } from '../../middleware/validate.ts';
import { ActivityEventType } from './event-bus.ts';
import {
  listGlobalActivitiesPaginated,
  listSnippetActivitiesPaginated,
  listUserActivitiesPaginated,
} from './activity.service.ts';

export const activityRouter = Router();

const activityQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z
    .enum([
      'snippet.created',
      'snippet.edited',
      'snippet.deleted',
      'comment.added',
      'comment.resolved',
      'collaborator.added',
    ])
    .optional(),
});

const snippetIdParamsSchema = z.object({
  snippetId: z.string().uuid(),
});

const userIdParamsSchema = z.object({
  userId: z.string().uuid(),
});

async function handleGlobalActivities(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as unknown as z.infer<typeof activityQuerySchema>;
    const result = await listGlobalActivitiesPaginated({
      cursor: query.cursor,
      limit: Number(query.limit) || 20,
      type: query.type as ActivityEventType | undefined,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

// GET /api/activities/global (and alias GET /api/activities)
activityRouter.get(
  '/global',
  optionalAuth,
  validateRequest({ query: activityQuerySchema }),
  handleGlobalActivities
);

activityRouter.get(
  '/',
  optionalAuth,
  validateRequest({ query: activityQuerySchema }),
  handleGlobalActivities
);

// GET /api/activities/snippets/:snippetId
activityRouter.get(
  '/snippets/:snippetId',
  optionalAuth,
  validateRequest({
    params: snippetIdParamsSchema,
    query: activityQuerySchema,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as unknown as z.infer<typeof activityQuerySchema>;
      const result = await listSnippetActivitiesPaginated(req.user, req.params.snippetId, {
        cursor: query.cursor,
        limit: Number(query.limit) || 20,
        type: query.type as ActivityEventType | undefined,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/activities/users/:userId
activityRouter.get(
  '/users/:userId',
  optionalAuth,
  validateRequest({
    params: userIdParamsSchema,
    query: activityQuerySchema,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as unknown as z.infer<typeof activityQuerySchema>;
      const result = await listUserActivitiesPaginated(req.user, req.params.userId, {
        cursor: query.cursor,
        limit: Number(query.limit) || 20,
        type: query.type as ActivityEventType | undefined,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);
