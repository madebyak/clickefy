/**
 * Schema barrel — one import to rule them all.
 *
 * Consumers use:
 *
 *   import * as schema from '@clickfy/db/schema';
 *   const db = drizzle(client, { schema });
 *
 * …which both unlocks Drizzle's query API (`db.query.users.findFirst`)
 * and re-exports every table + enum + inferred type for ad-hoc queries.
 */

export * from './enums';
export * from './json-types';

export * from './categories';
export * from './credit-ledger';
export * from './jobs';
export * from './provider-models';
export * from './saved-templates';
export * from './template-versions';
export * from './templates';
export * from './users';

export * from './relations';
