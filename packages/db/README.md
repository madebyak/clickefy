# `@clickfy/db`

Drizzle ORM schema + client factory for Clickefy.

## Layout

```
src/
  schema/
    enums.ts            # pgEnum() declarations
    json-types.ts       # TS interfaces stamped onto jsonb columns
    users.ts            # users table
    categories.ts       # categories taxonomy
    templates.ts        # template recipes (admin-authored)
    template-versions.ts# publish snapshots
    jobs.ts             # user-initiated generation attempts
    credit-ledger.ts    # append-only credit audit trail
    provider-models.ts  # capability registry
    relations.ts        # drizzle relations() for query API
    index.ts            # barrel
  client.ts             # createDb({ connectionString, runtime? })
  index.ts              # main entry
drizzle/                # generated migration SQL (created on first `db:generate`)
drizzle.config.ts       # drizzle-kit config
```

## Local dev workflow

1. Add the Neon URL to `apps/api/.dev.vars` as `DATABASE_URL=...`.
2. From this package:
   ```bash
   export DATABASE_URL="postgresql://..."
   pnpm db:push          # apply schema directly (best for dev)
   pnpm db:studio        # GUI at http://localhost:4983
   ```
3. For production-ready migrations:
   ```bash
   pnpm db:generate      # diffs schema vs. last snapshot, writes SQL
   pnpm db:migrate       # applies pending migrations to DATABASE_URL
   ```

## Using the client

### From Cloudflare Workers (apps/api)

```ts
import { createDb, type Db } from '@clickfy/db';

const db: Db = createDb({ connectionString: env.DATABASE_URL });
const user = await db.query.users.findFirst({ where: eq(users.id, id) });
```

### From Node (admin Next.js, scripts)

Same call. The factory auto-detects the runtime.
