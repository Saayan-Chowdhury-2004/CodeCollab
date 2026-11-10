import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.ts';
import { validateRequest } from '../../middleware/validate.ts';
import { authorize } from '../../auth/authorize.ts';
import { paginationQuerySchema } from '../../utils/pagination.ts';
import {
  changeMyPassword,
  listUsersPaginated,
  updateMyProfile,
  updateUserGlobalRole,
} from './users.service.ts';

export const usersRouter = Router();

const updateProfileBodySchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    username: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, underscores, and hyphens')
      .optional(),
    avatarUrl: z.string().url('Avatar URL must be a valid URL').nullable().optional(),
    email: z.string().email('Valid email address is required').max(255).optional(),
  })
  .strict(); // Mass-assignment protection: rejects globalRole, id, etc.

const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .max(128)
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      ),
  })
  .strict();

const listUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
});

const userIdParamsSchema = z.object({
  id: z.string().uuid('Invalid user ID format'),
});

const updateRoleBodySchema = z
  .object({
    globalRole: z.enum(['admin', 'editor', 'viewer']),
  })
  .strict();

// PATCH /api/users/me
usersRouter.patch(
  '/me',
  requireAuth,
  validateRequest({ body: updateProfileBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      authorize(req.user, 'user:profile:edit', { targetUserId: req.user!.id });
      const updated = await updateMyProfile(req.user!.id, req.body);
      return res.status(200).json({ user: updated });
    } catch (error) {
      return next(error);
    }
  }
);

// POST /api/users/me/password
usersRouter.post(
  '/me/password',
  requireAuth,
  validateRequest({ body: changePasswordBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      authorize(req.user, 'user:profile:edit', { targetUserId: req.user!.id });
      await changeMyPassword(req.user!.id, req.body, req.user);
      return res.status(200).json({ status: 'password_updated' });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/users
usersRouter.get(
  '/',
  requireAuth,
  validateRequest({ query: listUsersQuerySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      authorize(req.user, 'user:list');
      const query = req.query as unknown as z.infer<typeof listUsersQuerySchema>;
      const result = await listUsersPaginated(
        {
          cursor: query.cursor,
          limit: query.limit,
          q: query.q,
        },
        req.user
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

// PATCH /api/users/:id/role (Admin only)
usersRouter.patch(
  '/:id/role',
  requireAuth,
  validateRequest({ params: userIdParamsSchema, body: updateRoleBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      authorize(req.user, 'user:manage_roles', { targetUserId: req.params.id });
      const updated = await updateUserGlobalRole(
        req.user!.id,
        req.params.id,
        req.body.globalRole
      );
      return res.status(200).json({ user: updated });
    } catch (error) {
      return next(error);
    }
  }
);
