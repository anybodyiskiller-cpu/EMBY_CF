# Media Gateway

Cloudflare Workers media gateway deployed as `media-gate`.

## Live URLs

- Home: `https://media.anybodyiskiller.shop/`
- Admin: `https://media.anybodyiskiller.shop/admin`
- Health: `https://media.anybodyiskiller.shop/health`
- UHD route: `https://media.anybodyiskiller.shop/uhd`
- Global route: `https://media.anybodyiskiller.shop/global`

## Cloudflare Resources

- Worker: `media-gate`
- D1 database: `media-store`
- D1 binding: `DB`
- Custom domain: `media.anybodyiskiller.shop`
- Admin secret binding: `ADMIN_TOKEN`

## Automatic Deploy

GitHub Actions deploys on every push to `main` or `master` using:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The workflow runs `wrangler deploy --keep-vars`, so existing Cloudflare secrets such as `ADMIN_TOKEN` are preserved.

## Current Routes

Routes are stored in D1 and managed from `/admin`.

| Prefix | Target |
| --- | --- |
| `uhd` | `https://global.uhdnow.com` |
| `global` | `https://global.uhdnow.com` |
