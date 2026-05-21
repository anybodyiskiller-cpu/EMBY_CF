# Deploy

This repository deploys `media-gate` automatically with GitHub Actions.

## Required GitHub Secrets

The workflow expects these repository secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare token with Workers and D1 deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

`ADMIN_TOKEN` and `CF_API_TOKEN` are stored on Cloudflare as Worker secrets and are preserved by `wrangler deploy --keep-vars`.

The custom domain `media.anybodyiskiller.shop` is declared in `wrangler.toml` as a Cloudflare Workers custom domain. The GitHub Actions API token needs Workers script and Workers route permissions for the account zone.

## Cloudflare Configuration

The deployment target is defined in `wrangler.toml`:

```toml
name = "media-gate"
main = "worker.js"
compatibility_date = "2025-05-15"
compatibility_flags = ["nodejs_compat"]

[[routes]]
pattern = "media.anybodyiskiller.shop"
custom_domain = true

[vars]
BASE_DOMAIN = "anybodyiskiller.shop"
CF_ZONE_ID = "82068595bcd648d74ddcb168ed1557e2"
CF_ACCOUNT_ID = "a51f1948ebae31220a0466c69d97702f"

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
