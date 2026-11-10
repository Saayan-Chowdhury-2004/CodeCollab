import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../../middleware/authenticate.ts';
import { validateRequest } from '../../middleware/validate.ts';
import { AppError } from '../../utils/errors.ts';
import {
  getSearchFacets,
  searchSnippetsPaginated,
  SearchSortMode,
} from './search.service.ts';
import { SnippetVisibility } from '../../auth/authorize.ts';

export const searchRouter = Router();

const searchQuerySchema = z.object({
  q: z.string().trim().max(250).optional(),
  language: z.string().trim().max(64).optional(),
  tag: z.string().trim().max(64).optional(),
  authorId: z.string().uuid().optional(),
  authorUsername: z.string().trim().max(64).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
  scope: z.enum(['public', 'mine', 'collaborated', 'all']).optional(),
  createdFrom: z
    .string()
    .optional()
    .refine((val) => !val || !Number.isNaN(new Date(val).getTime()), {
      message: 'createdFrom must be a valid ISO date string',
    }),
  createdTo: z
    .string()
    .optional()
    .refine((val) => !val || !Number.isNaN(new Date(val).getTime()), {
      message: 'createdTo must be a valid ISO date string',
    }),
  sort: z.enum(['relevance', 'newest', 'oldest', 'updated']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

async function handleSearchSnippets(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as unknown as z.infer<typeof searchQuerySchema>;

    const createdFromDate = query.createdFrom ? new Date(query.createdFrom) : undefined;
    const createdToDate = query.createdTo ? new Date(query.createdTo) : undefined;

    if (createdFromDate && createdToDate && createdFromDate > createdToDate) {
      throw new AppError(
        400,
        'INVALID_DATE_RANGE',
        'createdFrom cannot be later than createdTo'
      );
    }

    const result = await searchSnippetsPaginated(req.user, {
      q: query.q,
      language: query.language,
      tag: query.tag,
      authorId: query.authorId,
      authorUsername: query.authorUsername,
      visibility: query.visibility as SnippetVisibility | undefined,
      scope: query.scope,
      createdFrom: createdFromDate,
      createdTo: createdToDate,
      sort: query.sort as SearchSortMode | undefined,
      cursor: query.cursor,
      limit: Number(query.limit) || 20,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

// Primary endpoint: GET /api/search/snippets and alias GET /api/search
searchRouter.get(
  '/snippets',
  optionalAuth,
  validateRequest({ query: searchQuerySchema }),
  handleSearchSnippets
);

searchRouter.get(
  '/',
  optionalAuth,
  validateRequest({ query: searchQuerySchema }),
  handleSearchSnippets
);

// Search filter facets: GET /api/search/facets
searchRouter.get(
  '/facets',
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const facets = await getSearchFacets(req.user);
      res.status(200).json(facets);
    } catch (error) {
      next(error);
    }
  }
);
