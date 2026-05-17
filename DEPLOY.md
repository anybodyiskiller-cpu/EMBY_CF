# Deploy

This repository deploys `media-gate` automatically with GitHub Actions.

## Required GitHub Secrets

The workflow expects these repository secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare token with Workers and D1 deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

`ADMIN_TOKEN` is stored on Cloudflare as a Worker secret and is preserved by `wrangler deploy --keep-vars`.

The custom domain `media.anybodyiskiller.shop` is already bound in Cloudflare. It is intentionally not declared in `wrangler.toml` for GitHub Actions, because the existing API token can deploy Worker scripts but cannot update zone routes.

## Cloudflare Configuration

The deployment target is defined in `wrangler.toml`:

```toml
name = "media-gate"
main = "worker.js"
compatibility_date = "2025-05-15"
compatibility_flags = ["nodejs_compat"]

[vars]
BASE_DOMAIN = "anybodyiskiller.shop"

[[d1_databases]]
binding = "DB"
database_name = "media-store"
database_id = "dfff5cd4-1df8-4b31-b9f8-d48bd9729566"
```

## Manual Deploy

```bash
npx wrangler deploy --keep-vars
```

## Verification

```bash
curl https://media.anybodyiskiller.shop/health
```

Expected result:

```json
{"status":"ok"}
```
