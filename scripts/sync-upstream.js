const fs = require('node:fs/promises');

const upstreamBase = 'https://raw.githubusercontent.com/Dirige/EMBY_CF/main';

const localReadme = `# Media Gateway

Cloudflare Workers media gateway deployed as \`media-gate\`.

## Live URLs

- Home: \`https://media.anybodyiskiller.shop/\`
- Admin: \`https://media.anybodyiskiller.shop/admin\`
- Health: \`https://media.anybodyiskiller.shop/health\`
- UHD route: \`https://media.anybodyiskiller.shop/uhd\`
- Global route: \`https://media.anybodyiskiller.shop/global\`

## Cloudflare Resources

- Worker: \`media-gate\`
- D1 database: \`media-store\`
- D1 binding: \`DB\`
- Custom domain: \`media.anybodyiskiller.shop\` (already bound in Cloudflare)
- Admin secret binding: \`ADMIN_TOKEN\`

## Automatic Deploy

GitHub Actions deploys on every push to \`main\` or \`master\` using:

- \`CLOUDFLARE_API_TOKEN\`
- \`CLOUDFLARE_ACCOUNT_ID\`

The workflow runs \`wrangler deploy --keep-vars\`, so existing Cloudflare secrets such as \`ADMIN_TOKEN\` are preserved. The custom domain is not managed by Actions because the existing API token can deploy Workers but cannot update zone routes.

## Upstream Sync

\`.github/workflows/sync-upstream.yml\` checks \`Dirige/EMBY_CF\` every 6 hours. When upstream changes, it refreshes \`worker.js\`, reapplies the local media-gate patches, commits the result, and lets the deploy workflow publish it.

## Current Routes

Routes are stored in D1 and managed from \`/admin\`.

| Prefix | Target |
| --- | --- |
| \`uhd\` | \`https://global.uhdnow.com\` |
| \`global\` | \`https://global.uhdnow.com\` |
`;

const localDeploy = `# Deploy

This repository deploys \`media-gate\` automatically with GitHub Actions.

## Required GitHub Secrets

The workflow expects these repository secrets:

| Secret | Purpose |
| --- | --- |
| \`CLOUDFLARE_API_TOKEN\` | Cloudflare token with Workers and D1 deploy permissions |
| \`CLOUDFLARE_ACCOUNT_ID\` | Cloudflare account ID |

\`ADMIN_TOKEN\` is stored on Cloudflare as a Worker secret and is preserved by \`wrangler deploy --keep-vars\`.

The custom domain \`media.anybodyiskiller.shop\` is already bound in Cloudflare. It is intentionally not declared in \`wrangler.toml\` for GitHub Actions, because the existing API token can deploy Worker scripts but cannot update zone routes.

## Cloudflare Configuration

The deployment target is defined in \`wrangler.toml\`:

\`\`\`toml
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
\`\`\`

## Manual Deploy

\`\`\`bash
npx wrangler deploy --keep-vars
\`\`\`

## Verification

\`\`\`bash
curl https://media.anybodyiskiller.shop/health
\`\`\`
`;

const localWrangler = `name = "media-gate"
main = "worker.js"
compatibility_date = "2025-05-15"
compatibility_flags = ["nodejs_compat"]

[vars]
BASE_DOMAIN = "anybodyiskiller.shop"

[[d1_databases]]
binding = "DB"
database_name = "media-store"
database_id = "dfff5cd4-1df8-4b31-b9f8-d48bd9729566"
`;

const jsonRewriteHelper = `function rewriteJsonUrls(value, upstreamOrigin, proxyBase) {
  let modified = false;

  function walk(item) {
    if (typeof item === 'string') {
      if (item.startsWith(upstreamOrigin)) {
        modified = true;
        return proxyBase + item.slice(upstreamOrigin.length);
      }
      return item;
    }
    if (Array.isArray(item)) {
      return item.map(walk);
    }
    if (item && typeof item === 'object') {
      Object.keys(item).forEach((key) => {
        item[key] = walk(item[key]);
      });
      return item;
    }
    return item;
  }

  return { data: walk(value), modified };
}`;

const jsonRewriteBlock = `if (!compatMode && finalResponse.status === 200 && contentType.includes('json') && matchedPrefix) {
    const urlPath = lastUpstreamUrl.pathname.toLowerCase();
    try {
      const data = await finalResponse.clone().json();
      let modified = false;
      const proxyBase = proxyOrigin + safePrefix;

      const httpRewrite = rewriteJsonUrls(data, lastUpstreamUrl.origin.replace(/^https:/, 'http:'), proxyBase);
      const httpsRewrite = rewriteJsonUrls(httpRewrite.data, lastUpstreamUrl.origin.replace(/^http:/, 'https:'), proxyBase);
      modified = httpRewrite.modified || httpsRewrite.modified;

      if (urlPath.includes('playbackinfo') && data?.MediaSources) {
        data.MediaSources.forEach((source) => {
          ['DirectStreamUrl', 'TranscodingUrl'].forEach((key) => {
            if (source[key]?.startsWith('http')) {
              try {
                const mediaUrl = new URL(source[key]);
                const isDirectDomain = MANUAL_REDIRECT_DOMAINS.some(d => mediaUrl.hostname.endsWith(d));
                if (!isDirectDomain) {
                  source[key] = proxyOrigin + safePrefix + '/' + source[key];
                  modified = true;
                }
              } catch (_) {
                source[key] = proxyOrigin + safePrefix + '/' + source[key];
                modified = true;
              }
            }
          });
        });
      }

      if (modified) {
        responseHeaders.delete('Content-Length');
        return new Response(JSON.stringify(data), { status: finalResponse.status, headers: responseHeaders });
      }
    } catch (_) {}
  }`;

async function fetchText(path) {
  const response = await fetch(`${upstreamBase}/${path}`, {
    headers: { 'User-Agent': 'media-gate-upstream-sync' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function replaceBalancedBlock(source, marker, replacement) {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Marker not found: ${marker}`);

  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) throw new Error(`Opening brace not found for: ${marker}`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let templateExprDepth = 0;

  for (let i = braceStart; i < source.length; i++) {
    const char = source[i];
    const prev = source[i - 1];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\\\') {
        escaped = true;
      } else if (quote === '`' && char === '$' && source[i + 1] === '{') {
        templateExprDepth++;
        i++;
      } else if (quote === '`' && templateExprDepth > 0 && char === '}') {
        templateExprDepth--;
      } else if (char === quote && templateExprDepth === 0) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '/' && source[i + 1] === '/') {
      const next = source.indexOf('\\n', i + 2);
      i = next === -1 ? source.length : next;
      continue;
    }

    if (char === '/' && source[i + 1] === '*') {
      const next = source.indexOf('*/', i + 2);
      i = next === -1 ? source.length : next + 1;
      continue;
    }

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(0, start) + replacement + source.slice(i + 1);
      }
    }

    if (prev === '\\r') continue;
  }

  throw new Error(`Could not find block end for: ${marker}`);
}

function patchWorker(source) {
  let worker = source;

  const textReplacements = [
    ['<title>Emby 反代 | 智能优选</title>', '<title>Media Gateway | 智能优选</title>'],
    ['<h1>Emby 反向代理</h1>', '<h1>Media Gateway</h1>'],
    ['https://你的域名/https://emby.example.com:8096', 'https://你的域名/https://origin.example.com:8096'],
    ['placeholder="例如：我的 Emby 服务器"', 'placeholder="例如：主线路"'],
    ['placeholder="myemby"', 'placeholder="main"'],
    ['<span id="prefixPreview">myemby</span>', '<span id="prefixPreview">main</span>'],
    ['主线路地址 (如: https://emby.example.com:8096)', '主线路地址 (如: https://origin.example.com:8096)'],
    ['兼容模式适用于部分无法正常播放的 Emby 服务器，开启后不重写媒体流地址，由客户端直连源站播放', '兼容模式适用于部分无法正常播放的源站，开启后不重写媒体流地址，由客户端直连源站播放'],
    ["textContent='myemby'", "textContent='main'"],
    ["prefix||'myemby'", "prefix||'main'"],
    ["trim()||'myemby'", "trim()||'main'"],
  ];

  for (const [from, to] of textReplacements) {
    worker = worker.split(from).join(to);
  }

  if (!worker.includes('function rewriteJsonUrls(')) {
    const normalizeFn = `function normalizeAlias(a) {
  return String(a || '').trim().toLowerCase().replace(/^\\/+|\\/+$/g, '');
}`;
    if (!worker.includes(normalizeFn)) {
      throw new Error('normalizeAlias function changed upstream; update sync patcher.');
    }
    worker = worker.replace(normalizeFn, `${normalizeFn}\n\n${jsonRewriteHelper}`);
  }

  worker = replaceBalancedBlock(
    worker,
    "if (!compatMode && finalResponse.status === 200 && contentType.includes('json') && matchedPrefix) {",
    jsonRewriteBlock,
  );

  return worker;
}

async function main() {
  const upstreamWorker = await fetchText('worker.js');
  await fs.writeFile('worker.js', patchWorker(upstreamWorker));
  await fs.writeFile('README.md', localReadme);
  await fs.writeFile('DEPLOY.md', localDeploy);
  await fs.writeFile('wrangler.toml', localWrangler);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
