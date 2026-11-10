import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../../middleware/authenticate.ts';
import { validateRequest } from '../../middleware/validate.ts';
import { authorize } from '../../auth/authorize.ts';
import { paginationQuerySchema } from '../../utils/pagination.ts';
import {
  addOrUpdateCollaborator,
  computeSnippetVersionDiff,
  createSnippet,
  createSnippetVersionSnapshot,
  deleteSnippetById,
  hydrateSnippetDetail,
  listSnippetsPaginated,
  listSnippetVersionsPaginated,
  getSnippetVersionDetail,
  loadSnippetAuthContext,
  removeCollaborator,
  restoreSnippetVersion,
  updateSnippet,
} from './snippets.service.ts';

export const snippetsRouter = Router();

const snippetIdParamsSchema = z.object({
  id: z.string().uuid('Invalid snippet ID format'),
});

const restoreVersionParamsSchema = z.object({
  id: z.string().uuid('Invalid snippet ID format'),
  versionId: z.string().uuid('Invalid version ID format'),
});

const removeCollaboratorParamsSchema = z.object({
  id: z.string().uuid('Invalid snippet ID format'),
  userId: z.string().uuid('Invalid user ID format'),
});

const createSnippetBodySchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().max(2000).optional().default(''),
    language: z.string().min(1).max(40).default('typescript'),
    visibility: z.enum(['public', 'unlisted', 'private']).default('public'),
    content: z.string().max(500000).default(''),
    tags: z.array(z.string().min(1).max(48)).max(15).optional().default([]),
  })
  .strict();

const listSnippetsQuerySchema = paginationQuerySchema.extend({
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
  language: z.string().optional(),
  authorId: z.string().uuid().optional(),
  tag: z.string().optional(),
  scope: z.enum(['public', 'mine', 'collaborated', 'all']).optional(),
  sort: z.enum(['newest', 'oldest', 'updated']).optional(),
});

const updateSnippetBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    language: z.string().min(1).max(40).optional(),
    visibility: z.enum(['public', 'unlisted', 'private']).optional(),
    content: z.string().max(500000).optional(),
    tags: z.array(z.string().min(1).max(48)).max(15).optional(),
    versionSummary: z.string().max(255).optional(),
    summary: z.string().max(255).optional(),
  })
  .strict();

const createVersionBodySchema = z
  .object({
    content: z.string().max(500000).optional(),
    summary: z.string().min(1).max(255).optional(),
  })
  .strict();

const diffQuerySchema = z.object({
  from: z.string().uuid('from versionId must be a valid UUID'),
  to: z.string().uuid('to versionId must be a valid UUID'),
});

const addCollaboratorBodySchema = z
  .object({
    userId: z.string().uuid().optional(),
    username: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role: z.enum(['editor', 'viewer']),
  })
  .strict()
  .refine((d) => Boolean(d.userId || d.username || d.email), {
    message: 'One of userId, username, or email is required',
    path: ['userId'],
  });

// POST /api/snippets
snippetsRouter.post(
  '/',
  requireAuth,
  validateRequest({ body: createSnippetBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      authorize(req.user, 'snippet:create');
      const snippet = await createSnippet(req.user!, req.body);
      return res.status(201).json({ snippet });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/snippets
snippetsRouter.get(
  '/',
  optionalAuth,
  validateRequest({ query: listSnippetsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as unknown as z.infer<typeof listSnippetsQuerySchema>;
      const result = await listSnippetsPaginated(req.user, {
        cursor: query.cursor,
        limit: query.limit,
        visibility: query.visibility,
        language: query.language,
        authorId: query.authorId,
        tag: query.tag,
        scope: query.scope,
        sort: query.sort,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/snippets/:id
snippetsRouter.get(
  '/:id',
  optionalAuth,
  validateRequest({ params: snippetIdParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { snippetRow, authResource } = await loadSnippetAuthContext(
        req.params.id,
        req.user
      );
      authorize(req.user, 'snippet:read', { snippet: authResource });
      const detail = await hydrateSnippetDetail(snippetRow, req.user, authResource);
      return res.status(200).json({ snippet: detail });
    } catch (error) {
      return next(error);
    }
  }
);

// PATCH /api/snippets/:id
snippetsRouter.patch(
  '/:id',
  requireAuth,
  validateRequest({ params: snippetIdParamsSchema, body: updateSnippetBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { snippetRow, authResource } = await loadSnippetAuthContext(
        req.params.id,
        req.user
      );

      // Changing visibility requires owner or admin ('snippet:manage_collaborators')
      if (
        req.body.visibility !== undefined &&
        req.body.visibility !== snippetRow.visibility
      ) {
        authorize(req.user, 'snippet:manage_collaborators', { snippet: authResource });
      } else {
        authorize(req.user, 'snippet:edit', { snippet: authResource });
      }

      const updated = await updateSnippet(
        req.user!,
        snippetRow,
        authResource,
        {
          ...req.body,
          versionSummary: req.body.versionSummary || req.body.summary,
        }
      );
      return res.status(200).json({ snippet: updated });
    } catch (error) {
      return next(error);
    }
  }
);

// DELETE /api/snippets/:id
snippetsRouter.delete(
  '/:id',
  requireAuth,
  validateRequest({ params: snippetIdParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { snippetRow, authResource } = await loadSnippetAuthContext(
        req.params.id,
        req.user
      );
      authorize(req.user, 'snippet:delete', { snippet: authResource });
      await deleteSnippetById(req.user!, snippetRow);
      return res.status(200).json({ status: 'deleted', id: snippetRow.id });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/snippets/:id/versions
snippetsRouter.get(
  '/:id/versions',
  optionalAuth,
  validateRequest({ params: snippetIdParamsSchema, query: paginationQuerySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { authResource } = await loadSnippetAuthContext(req.params.id, req.user);
      authorize(req.user, 'snippet:read', { snippet: authResource });
      const query = req.query as unknown as z.infer<typeof paginationQuerySchema>;
      const result = await listSnippetVersionsPaginated(req.params.id, {
        cursor: query.cursor,
        limit: query.limit,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/snippets/:id/versions/:versionId
snippetsRouter.get(
  '/:id/versions/:versionId',
  optionalAuth,
  validateRequest({ params: restoreVersionParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { authResource } = await loadSnippetAuthContext(req.params.id, req.user);
      authorize(req.user, 'snippet:read', { snippet: authResource });
      const version = await getSnippetVersionDetail(req.params.id, req.params.versionId);
      return res.status(200).json({ version });
    } catch (error) {
      return next(error);
    }
  }
);

// POST /api/snippets/:id/versions
snippetsRouter.post(
  '/:id/versions',
  requireAuth,
  validateRequest({ params: snippetIdParamsSchema, body: createVersionBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { snippetRow, authResource } = await loadSnippetAuthContext(
        req.params.id,
        req.user
      );
      authorize(req.user, 'snippet:version:create', { snippet: authResource });
      const version = await createSnippetVersionSnapshot(
        req.user!,
        snippetRow,
        req.body
      );
      return res.status(201).json({ version });
    } catch (error) {
      return next(error);
    }
  }
);

// POST /api/snippets/:id/versions/:versionId/restore
snippetsRouter.post(
  '/:id/versions/:versionId/restore',
  requireAuth,
  validateRequest({ params: restoreVersionParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { snippetRow, authResource } = await loadSnippetAuthContext(
        req.params.id,
        req.user
      );
      authorize(req.user, 'snippet:version:restore', { snippet: authResource });
      const result = await restoreSnippetVersion(
        req.user!,
        snippetRow,
        authResource,
        req.params.versionId
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/snippets/:id/diff
snippetsRouter.get(
  '/:id/diff',
  optionalAuth,
  validateRequest({ params: snippetIdParamsSchema, query: diffQuerySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { authResource } = await loadSnippetAuthContext(req.params.id, req.user);
      authorize(req.user, 'snippet:read', { snippet: authResource });
      const query = req.query as unknown as z.infer<typeof diffQuerySchema>;
      const diff = await computeSnippetVersionDiff(
        req.params.id,
        query.from,
        query.to
      );
      return res.status(200).json({ diff });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/snippets/:id/collaborators
snippetsRouter.get(
  '/:id/collaborators',
  optionalAuth,
  validateRequest({ params: snippetIdParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { snippetRow, authResource } = await loadSnippetAuthContext(
        req.params.id,
        req.user
      );
      authorize(req.user, 'snippet:read', { snippet: authResource });
      const detail = await hydrateSnippetDetail(snippetRow, req.user, authResource);
      return res.status(200).json({ collaborators: detail.collaborators });
    } catch (error) {
      return next(error);
    }
  }
);

// POST /api/snippets/:id/collaborators
snippetsRouter.post(
  '/:id/collaborators',
  requireAuth,
  validateRequest({ params: snippetIdParamsSchema, body: addCollaboratorBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { snippetRow, authResource } = await loadSnippetAuthContext(
        req.params.id,
        req.user
      );
      authorize(req.user, 'snippet:manage_collaborators', { snippet: authResource });
      const collaborator = await addOrUpdateCollaborator(
        req.user!,
        snippetRow,
        req.body
      );
      return res.status(201).json({ collaborator });
    } catch (error) {
      return next(error);
    }
  }
);

// DELETE /api/snippets/:id/collaborators/:userId
snippetsRouter.delete(
  '/:id/collaborators/:userId',
  requireAuth,
  validateRequest({ params: removeCollaboratorParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { authResource } = await loadSnippetAuthContext(
        req.params.id,
        req.user
      );
      authorize(req.user, 'snippet:manage_collaborators', { snippet: authResource });
      await removeCollaborator(req.params.id, req.params.userId);
      return res.status(200).json({ status: 'collaborator_removed', userId: req.params.userId });
    } catch (error) {
      return next(error);
    }
  }
);
