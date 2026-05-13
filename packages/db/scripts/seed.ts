/**
 * Seed script — populates a baseline set of categories so the mobile app
 * has real content to render before the admin dashboard is wired up.
 *
 * Idempotent: re-running won't duplicate rows (uses `slug` as the unique
 * key and ON CONFLICT DO NOTHING).
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/seed.ts
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from '../src/schema';
import { categories } from '../src/schema';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(url);
const db = drizzle(sql, { schema });

// Starter categories. Hero images are Unsplash for now — replace with
// branded assets from R2 once we wire uploads.
const STARTER_CATEGORIES: Array<{
  name: string;
  slug: string;
  iconUrl: string;
  sortOrder: number;
}> = [
  {
    name: 'Skincare',
    slug: 'skincare',
    iconUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&q=80',
    sortOrder: 10,
  },
  {
    name: 'Fashion',
    slug: 'fashion',
    iconUrl: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=400&q=80',
    sortOrder: 20,
  },
  {
    name: 'Food & Drink',
    slug: 'food-drink',
    iconUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&q=80',
    sortOrder: 30,
  },
  {
    name: 'Tech',
    slug: 'tech',
    iconUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&q=80',
    sortOrder: 40,
  },
  {
    name: 'Home & Living',
    slug: 'home-living',
    iconUrl: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=80',
    sortOrder: 50,
  },
  {
    name: 'Fitness',
    slug: 'fitness',
    iconUrl: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=400&q=80',
    sortOrder: 60,
  },
  {
    name: 'Jewelry',
    slug: 'jewelry',
    iconUrl: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80',
    sortOrder: 70,
  },
  {
    name: 'Pets',
    slug: 'pets',
    iconUrl: 'https://images.unsplash.com/photo-1450778869180-41d0601e046e?w=400&q=80',
    sortOrder: 80,
  },
];

async function main() {
  const before = await db.query.categories.findMany();
  console.log(`Before: ${before.length} categories`);

  for (const cat of STARTER_CATEGORIES) {
    await db
      .insert(categories)
      .values(cat)
      .onConflictDoNothing({ target: categories.slug });
  }

  const after = await db.query.categories.findMany({
    orderBy: (c, { asc }) => [asc(c.sortOrder)],
  });
  console.log(`\nAfter: ${after.length} categories`);
  for (const c of after) console.log(`  • [${c.sortOrder}] ${c.name} (${c.slug})`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
