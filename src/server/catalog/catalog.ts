import { z } from 'zod';
import { CATEGORY_SLUGS, type CatalogItem, type Category, type CategorySlug } from '../../shared/contract.js';
import rawCatalog from './catalog.json' with { type: 'json' };

export const CATEGORY_LABELS: Record<CategorySlug, string> = {
  burgers: 'Burgers',
  pizza: 'Pizza',
  sushi: 'Sushi',
  healthy: 'Healthy',
  desserts: 'Desserts',
  groceries: 'Groceries',
};

export const CATEGORIES: readonly Category[] = CATEGORY_SLUGS.map((slug) => ({
  slug,
  label: CATEGORY_LABELS[slug],
}));

const catalogItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: z.enum(CATEGORY_SLUGS),
  restaurant: z.string().min(1),
  tags: z.array(z.string()),
  popularity: z.number().int().min(0).max(100),
});

const catalogSchema = z
  .array(catalogItemSchema)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
    message: 'Catalog item ids must be unique',
  });

/**
 * Validates catalog data at startup. JSON imports are typed loosely by TypeScript,
 * so a typo in catalog.json should fail fast here rather than surface as a
 * confusing runtime bug later.
 */
export function parseCatalog(data: unknown): readonly CatalogItem[] {
  return Object.freeze(catalogSchema.parse(data));
}

export const catalog: readonly CatalogItem[] = parseCatalog(rawCatalog);
