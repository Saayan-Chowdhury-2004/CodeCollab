import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../../middleware/authenticate.ts';
import { validateRequest } from '../../middleware/validate.ts';
import {
  createSnippetComment,
  deleteSnippetComment,
  listSnippetComments,
  setSnippetCommentResolvedState,
  updateSnippetComment,
} from './comments.service.ts';

export const commentsRouter = Router({ mergeParams: true });

const snippetParamsSchema = z.object({
  snippetId: z.string().uuid(),
});

const commentItemParamsSchema = z.object({
  snippetId: z.string().uuid(),
  commentId: z.string().uuid(),
});

const createCommentBodySchema = z.object({
  lineNumber: z.coerce.number().int().min(1).optional(),
  versionId: z.string().uuid().optional(),
  parentId: z.string().uuid().nullable().optional(),
  body: z.string().trim().min(1).max(4000),
});

const updateCommentBodySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

// GET /api/snippets/:snippetId/comments
commentsRouter.get(
  '/',
  optionalAuth,
  validateRequest({ params: snippetParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listSnippetComments(req.user, req.params.snippetId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/snippets/:snippetId/comments
commentsRouter.post(
  '/',
  requireAuth,
  validateRequest({
    params: snippetParamsSchema,
    body: createCommentBodySchema,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comment = await createSnippetComment(req.user, req.params.snippetId, req.body);
      res.status(201).json({ comment });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/snippets/:snippetId/comments/:commentId
commentsRouter.patch(
  '/:commentId',
  requireAuth,
  validateRequest({
    params: commentItemParamsSchema,
    body: updateCommentBodySchema,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comment = await updateSnippetComment(
        req.user,
        req.params.snippetId,
        req.params.commentId,
        req.body.body
      );
      res.status(200).json({ comment });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/snippets/:snippetId/comments/:commentId/resolve
commentsRouter.post(
  '/:commentId/resolve',
  requireAuth,
  validateRequest({ params: commentItemParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comment = await setSnippetCommentResolvedState(
        req.user,
        req.params.snippetId,
        req.params.commentId,
        true
      );
      res.status(200).json({ comment });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/snippets/:snippetId/comments/:commentId/unresolve
commentsRouter.post(
  '/:commentId/unresolve',
  requireAuth,
  validateRequest({ params: commentItemParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comment = await setSnippetCommentResolvedState(
        req.user,
        req.params.snippetId,
        req.params.commentId,
        false
      );
      res.status(200).json({ comment });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/snippets/:snippetId/comments/:commentId
commentsRouter.delete(
  '/:commentId',
  requireAuth,
  validateRequest({ params: commentItemParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deleteSnippetComment(req.user, req.params.snippetId, req.params.commentId);
      res.status(200).json({ deleted: true, commentId: req.params.commentId });
    } catch (error) {
      next(error);
    }
  }
);
