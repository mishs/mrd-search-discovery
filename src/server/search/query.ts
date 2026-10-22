import { z } from 'zod';
import { CATEGORY_SLUGS, SORT_OPTIONS, type SearchQuery } from '../../shared/contract.js';

export const MAX_QUERY_LENGTH = 100;

/**
 * Runtime validation for GET /api/search query strings.
 *
 * Decisions:
 * - Missing or blank `q` means "browse everything" (after filters).
 * - Blank `category` means "all categories". An unknown category is a 400, not
 *   silently ignored: the client only sends values it got from /api/categories,
 *   so an unknown one signals a bug or a stale link and should be visible.
 * - Repeated parameters (?q=a&q=b) arrive as arrays and are rejected.
 * - Unknown extra parameters are ignored.
 */
const searchQuerySchema = z.object({
  q: z
    .string({ error: 'q must be a single string' })
    .optional()
    .transform((value) => value?.trim() ?? '')
    .refine((value) => value.length <= MAX_QUERY_LENGTH, {
      message: `q must be at most ${MAX_QUERY_LENGTH} characters`,
    }),
  category: z
    .string({ error: 'category must be a single string' })
    .optional()
    .transform((value) => value?.trim() || null)
    .pipe(
      z.enum(CATEGORY_SLUGS, { error: `category must be one of: ${CATEGORY_SLUGS.join(', ')}` }).nullable(),
    ),
  sort: z
    .string({ error: 'sort must be a single string' })
    .optional()
    .transform((value) => value?.trim() || 'popularity')
    .pipe(z.enum(SORT_OPTIONS, { error: `sort must be one of: ${SORT_OPTIONS.join(', ')}` })),
});

export type ParseResult =
  | { ok: true; query: SearchQuery }
  | { ok: false; details: { field: string; message: string }[] };

export function parseSearchQuery(raw: unknown): ParseResult {
  const result = searchQuerySchema.safeParse(raw);
  if (result.success) {
    const query: SearchQuery = result.data;
    return { ok: true, query };
  }
  return {
    ok: false,
    details: result.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'query',
      message: issue.message,
    })),
  };
}
