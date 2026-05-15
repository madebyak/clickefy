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

export * from './admin-audit-log';
export * from './categories';
export * from './credit-broadcasts';
export * from './credit-ledger';
export * from './credit-packs';
export * from './device-tokens';
export * from './grant-policies';
export * from './jobs';
export * from './provider-models';
export * from './reports';
export * from './revenuecat-events';
export * from './saved-templates';
export * from './subscription-plans';
export * from './template-versions';
export * from './templates';
export * from './users';

export * from './relations';
