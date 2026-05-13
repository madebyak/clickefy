# @clickfy/api

Public mobile-facing HTTP API. Hono on Cloudflare Workers.

## Run locally

```bash
cp .dev.vars.example .dev.vars     # fill in secrets when needed
pnpm install
pnpm --filter @clickfy/api dev      # serves on http://localhost:8787
```

Smoke test:

```bash
curl http://localhost:8787/                        # API banner
curl http://localhost:8787/v1/health               # status
curl http://localhost:8787/v1/catalog/templates    # mock template list
```

## Deploy

```bash
wrangler login                                      # one-time
wrangler r2 bucket create clickfy-uploads
wrangler r2 bucket create clickfy-outputs
wrangler kv namespace create RATE_LIMIT
# (paste the IDs back into wrangler.toml)
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CLERK_JWT_KEY
wrangler secret put MONGODB_URI
wrangler secret put REVENUECAT_WEBHOOK_SECRET
pnpm --filter @clickfy/api deploy
```

See `docs/ARCHITECTURE.md` §6 for the full endpoint contract.
