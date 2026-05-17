const CURRENT_VERSION = '3.1-simplified';

const OPTIMIZED_DOMAINS = [
  { subdomain: 'proxy1', domain: 'cf.090227.xyz', name: 'CF优选-090227' },
  { subdomain: 'proxy2', domain: 'cf.877774.xyz', name: 'CF优选-877774' },
  { subdomain: 'proxy3', domain: 'cloudflare-dl.byoip.top', name: '鱼皮优选' },
  { subdomain: 'proxy4', domain: 'saas.sin.fan', name: 'MIYU优选' },
  { subdomain: 'proxy5', domain: 'bestcf.030101.xyz', name: 'Mingyu优选' },
  { subdomain: 'proxy6', domain: 'cf.cloudflare.182682.xyz', name: 'WeTest优选' },
  { subdomain: 'proxy7', domain: 'cf.tencentapp.cn', name: '腾讯泛域名' },
  { subdomain: 'proxy8', domain: 'www.visa.cn', name: 'Visa官方' },
  { subdomain: 'proxy9', domain: 'mfa.gov.ua', name: '乌克兰外交部' },
  { subdomain: 'proxy10', domain: 'www.shopify.com', name: 'Shopify官方' },
  { subdomain: 'proxy11', domain: 'store.ubi.com', name: '育碧商店' },
  { subdomain: 'proxy12', domain: 'staticdelivery.nexusmods.com', name: 'NexusMods' },
];

const RESERVED_ALIASES = new Set([
  'admin', 'stats', 'health', 'api', 'favicon.ico', 'cdn-cgi',
  '__client_rtt__', 'web', 'emby', 'sessions', 'playbackinfo',
]);

const MANUAL_REDIRECT_DOMAINS = [
  'emby.bangumi.ca', 'aliyundrive.com', 'aliyundrive.net', 'aliyuncs.com', 'alicdn.com', 'aliyun.com',
  'cdn.aliyundrive.com', 'xunlei.com', 'xlusercdn.com', 'xycdn.com', 'sandai.net', 'thundercdn.com',
  '115.com', '115cdn.com', '115cdn.net', 'anxia.com', '189.cn', 'mini189.cn', 'ctyunxs.cn',
  'cloud.189.cn', 'tianyiyun.com', 'telecomjs.com', 'quark.cn', 'quarkdrive.cn', 'uc.cn', 'ucdrive.cn',
  'xiaoya.pro', 'myqcloud.com', 'cloudfront.net', 'akamaized.net', 'fastly.net', 'hwcdn.net', 'bytecdn.cn', 'bdcdn.net',
];

const DOMAIN_PROXY_RULES = { 'biliblili.uk': 'example.com' };
const JP_COLOS = ['NRT', 'KIX', 'FUK', 'OKA'];

const blocker = {
  keys: ['.m3u8', '.ts', '.acc', '.m4s', 'photocall.tv', 'googlevideo.com'],
  check(url) {
    url = url.toLowerCase();
    return blocker.keys.some((x) => url.includes(x));
  },
};

const CONFIG = {
  pikpakProxyUrl: 'https://pp.255432.xyz',
  enableStats: true,
  cacheEnabled: true,
  domainCacheTtlMs: 3600000,
};

const PIKPAK_DOMAINS = [
  'pikpak.com', 'pikpak.net', 'pikpak-cn.com', 'pikpakcdn.com', 'pikpakapi.com', 'pikpakdrive.com',
];

const CORS_JSON = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };

let dbReady = false;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_JSON });
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function getCookie(req, name) {
  const s = req.headers.get('Cookie');
  if (!s) return null;
  const m = s.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : null;
}

function getAdminToken(env) {
  const raw = env.ADMIN_TOKEN ?? env.ADMIN_PASSWORD ?? env.admin_token ?? env.AdminToken;
  if (raw == null) return null;
  const t = String(raw).trim();
  return t.length ? t : null;
}

function isAdmin(request, env) {
  const expected = getAdminToken(env);
  if (!expected) return false;
  const provided = getCookie(request, 'admin_token');
  return provided === expected;
}

function adminLoginResponse(request, env, tokenFromUser) {
  const expected = getAdminToken(env);
  if (!expected) {
    return json({
      ok: false,
      error: 'Worker 未读到 ADMIN_TOKEN。请在 Cloudflare 控制台 → Worker → 设置 → 变量和机密 中添加 ADMIN_TOKEN。',
    }, 503);
  }
  if (tokenFromUser !== expected) {
    return json({ ok: false, error: '密钥错误' }, 401);
  }
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const cookie = `admin_token=${encodeURIComponent(expected)}; Path=/; Max-Age=2592000; SameSite=Lax${secure}`;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': cookie,
      'Cache-Control': 'no-store',
    },
  });
}

function getClientCacheKey(request) {
  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  const cf = request.cf || {};
  let ipKey = ip;
  if (ip.includes('.')) ipKey = ip.split('.').slice(0, 3).join('.');
  else if (ip.includes(':')) ipKey = ip.split(':').slice(0, 4).join(':');
  return `${cf.country || 'XX'}|${cf.city || ''}|${cf.asn || ''}|${ipKey}`;
}

function optimizedHost(item) {
  return `${item.subdomain}.${item.domain}`;
}

function latencyStatus(ms) {
  if (ms < 0) return 'timeout';
  if (ms < 100) return 'fast';
  if (ms < 300) return 'good';
  return 'slow';
}

async function initDatabase(env) {
  if (!env.DB || dbReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS routes (
      prefix TEXT PRIMARY KEY, target TEXT NOT NULL,
      remark TEXT DEFAULT '', last_play TEXT DEFAULT '',
      cache_img TEXT DEFAULT 'on', compat_mode TEXT DEFAULT 'off',
      sort_order INTEGER DEFAULT 0, target_latencies TEXT DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS visitor_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, prefix TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, ip TEXT, country TEXT, ua TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS request_stats (
      prefix TEXT, date TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(prefix, date))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS auto_emby_daily_stats (
      date TEXT PRIMARY KEY, playing_count INTEGER DEFAULT 0, playback_info_count INTEGER DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS domain_speed_cache (
      cache_key TEXT NOT NULL, subdomain TEXT NOT NULL, domain TEXT NOT NULL,
      display_name TEXT, latency_ms INTEGER DEFAULT -1, status TEXT DEFAULT 'unknown',
      tested_at INTEGER NOT NULL, PRIMARY KEY (cache_key, subdomain, domain))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS domain_best_cache (
      cache_key TEXT PRIMARY KEY, best_host TEXT, best_name TEXT, best_latency INTEGER,
      tested_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`),
  ]);
  try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN target_latencies TEXT DEFAULT ''`); } catch(e) {}
  try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN compat_mode TEXT DEFAULT 'off'`); } catch(e) {}
  dbReady = true;
}

async function getEdgeInfo(request) {
  const cf = request.cf || {};
  let traceIp = '';
  let traceColo = cf.colo || '未知';
  try {
    const tr = await fetch('https://1.1.1.1/cdn-cgi/trace', { headers: { 'User-Agent': 'CF-Worker-Trace' } });
    const text = await tr.text();
    const coloM = text.match(/colo=([A-Z0-9]+)/);
    const ipM = text.match(/ip=([^\n]+)/);
    if (coloM) traceColo = coloM[1];
    if (ipM) traceIp = ipM[1].trim();
  } catch (_) {}
  return {
    clientIp: request.headers.get('cf-connecting-ip') || '未知',
    entryColo: cf.colo || '未知',
    entryCountry: cf.country || '未知',
    entryCity: cf.city || '',
    edgeIp: traceIp || '—',
    egressColo: traceColo,
    cacheKey: getClientCacheKey(request),
  };
}

async function speedtestUrl(urlStr, timeoutMs = 5000) {
  const start = Date.now();
  try {
    const u = new URL(urlStr.startsWith('http') ? urlStr : 'https://' + urlStr);
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(u.origin + '/', { method: 'HEAD', signal: ctrl.signal, redirect: 'manual' });
    clearTimeout(tid);
    if (res.status === 502 || res.status === 503 || res.status === 504) return -1;
    return Date.now() - start;
  } catch {
    return -1;
  }
}

async function speedtestOptimizedFromEdge() {
  const results = [];
  for (const item of OPTIMIZED_DOMAINS) {
    const host = optimizedHost(item);
    const ms = await speedtestUrl(`https://${host}/cdn-cgi/trace`, 4000);
    results.push({
      subdomain: item.subdomain, domain: item.domain, name: item.name, host,
      latency: ms, status: latencyStatus(ms),
    });
  }
  results.sort((a, b) => {
    if (a.latency < 0 && b.latency < 0) return 0;
    if (a.latency < 0) return 1;
    if (b.latency < 0) return -1;
    return a.latency - b.latency;
  });
  const best = results.find((r) => r.latency >= 0);
  return { results, best: best ? best.host : null };
}

async function speedtestRouteTargets(env, prefix) {
  const route = await env.DB.prepare('SELECT * FROM routes WHERE prefix = ?').bind(prefix).first();
  if (!route) return [];
  const targets = route.target.split(',').map(s => s.trim()).filter(Boolean);
  const latencies = {};
  const out = [];
  for (const t of targets) {
    const ms = await speedtestUrl(t);
    latencies[t] = ms;
    out.push({ url: t, latency: ms, status: latencyStatus(ms) });
  }
  await env.DB.prepare('UPDATE routes SET target_latencies = ? WHERE prefix = ?')
    .bind(JSON.stringify(latencies), prefix).run();
  out.sort((a, b) => {
    if (a.latency < 0 && b.latency < 0) return 0;
    if (a.latency < 0) return 1;
    if (b.latency < 0) return -1;
    return a.latency - b.latency;
  });
  return out;
}

async function speedtestAllRoutes(env) {
  const { results: routes } = await env.DB.prepare('SELECT prefix, target FROM routes ORDER BY sort_order, prefix').all();
  const allResults = {};
  for (const route of routes || []) {
    const targets = route.target.split(',').map(s => s.trim()).filter(Boolean);
    const latencies = {};
    for (const t of targets) {
      const ms = await speedtestUrl(t);
      latencies[t] = ms;
    }
    await env.DB.prepare('UPDATE routes SET target_latencies = ? WHERE prefix = ?')
      .bind(JSON.stringify(latencies), route.prefix).run();
    allResults[route.prefix] = Object.entries(latencies).map(([url, latency]) => ({
      url, latency, status: latencyStatus(latency),
    }));
  }
  return allResults;
}

async function saveDomainSpeedCache(env, cacheKey, rows) {
  const now = Date.now();
  const expires = now + CONFIG.domainCacheTtlMs;
  const stmts = [];
  for (const r of rows) {
    stmts.push(env.DB.prepare(
      `INSERT INTO domain_speed_cache (cache_key, subdomain, domain, display_name, latency_ms, status, tested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key, subdomain, domain) DO UPDATE SET
       latency_ms=excluded.latency_ms, status=excluded.status, tested_at=excluded.tested_at`
    ).bind(cacheKey, r.subdomain, r.domain, r.name || r.display_name, r.latency, r.status, now));
  }
  const sorted = [...rows].filter((r) => r.latency >= 0).sort((a, b) => a.latency - b.latency);
  const best = sorted[0];
  if (best) {
    const host = `${best.subdomain}.${best.domain}`;
    stmts.push(env.DB.prepare(
      `INSERT INTO domain_best_cache (cache_key, best_host, best_name, best_latency, tested_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET
       best_host=excluded.best_host, best_name=excluded.best_name, best_latency=excluded.best_latency,
       tested_at=excluded.tested_at, expires_at=excluded.expires_at`
    ).bind(cacheKey, host, best.name || best.display_name, best.latency, now, expires));
  }
  await env.DB.batch(stmts);
}

async function loadDomainSpeedCache(env, cacheKey) {
  const now = Date.now();
  const best = await env.DB.prepare(
    'SELECT * FROM domain_best_cache WHERE cache_key = ? AND expires_at > ?'
  ).bind(cacheKey, now).first();
  if (!best) return null;
  const { results } = await env.DB.prepare(
    'SELECT subdomain, domain, display_name, latency_ms, status, tested_at FROM domain_speed_cache WHERE cache_key = ? ORDER BY latency_ms ASC'
  ).bind(cacheKey).all();
  if (!results?.length) return null;
  return {
    cached: true,
    cacheKey,
    best: best.best_host,
    bestName: best.best_name,
    results: results.map((r) => ({
      subdomain: r.subdomain, domain: r.domain, name: r.display_name, host: `${r.subdomain}.${r.domain}`,
      latency: r.latency_ms, status: r.status,
    })),
    expiresAt: best.expires_at,
  };
}

async function recordStats(env, type) {
  if (!env.DB || !CONFIG.enableStats) return;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const q = type === 'playing'
    ? `INSERT INTO auto_emby_daily_stats (date, playing_count, playback_info_count) VALUES (?, 1, 0)
       ON CONFLICT(date) DO UPDATE SET playing_count = playing_count + 1`
    : `INSERT INTO auto_emby_daily_stats (date, playing_count, playback_info_count) VALUES (?, 0, 1)
       ON CONFLICT(date) DO UPDATE SET playback_info_count = playback_info_count + 1`;
  await env.DB.prepare(q).bind(today).run();
}

async function handleStatsRequest(env) {
  if (!env.DB) return json({ error: "D1 数据库未绑定", data: null });
  const statsResult = await env.DB.prepare(
    `SELECT date, playing_count, playback_info_count FROM auto_emby_daily_stats
     WHERE date >= date('now', '-30 days') ORDER BY date DESC`
  ).all();
  const totalResult = await env.DB.prepare(
    `SELECT SUM(playing_count) as total_playing, SUM(playback_info_count) as total_playback_info
     FROM auto_emby_daily_stats WHERE date >= date('now', '-30 days')`
  ).first();
  return json({
    error: null,
    data: {
      total: { playing: totalResult?.total_playing || 0, playbackInfo: totalResult?.total_playback_info || 0 },
      dailyStats: statsResult?.results || [],
      lastUpdated: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    },
  });
}

function normalizePrefix(p) {
  return String(p || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
}

function validatePrefix(prefix) {
  const a = normalizePrefix(prefix);
  if (!a || !/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(a)) return '路径仅允许字母数字、下划线和连字符';
  if (RESERVED_ALIASES.has(a.toLowerCase())) return '该路径为系统保留，不可使用';
  return null;
}

async function handleAdminApi(request, env, url) {
  if (!isAdmin(request, env)) return new Response('Unauthorized', { status: 401 });

  if (url.pathname === '/admin/api/routes') {
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM routes ORDER BY sort_order, prefix').all();
      return json(results || []);
    }
    if (request.method === 'POST') {
      const data = await request.json();
      const err = validatePrefix(data.prefix);
      if (err) return json({ error: err }, 400);
      const prefix = normalizePrefix(data.prefix);
      let currentSortOrder = 0;
      if (data.oldPrefix && data.oldPrefix !== data.prefix) {
        const oldRow = await env.DB.prepare('SELECT sort_order FROM routes WHERE prefix = ?').bind(normalizePrefix(data.oldPrefix)).first();
        if (oldRow) currentSortOrder = oldRow.sort_order;
        await env.DB.prepare('DELETE FROM routes WHERE prefix = ?').bind(normalizePrefix(data.oldPrefix)).run();
      } else {
        const oldRow = await env.DB.prepare('SELECT sort_order FROM routes WHERE prefix = ?').bind(prefix).first();
        if (oldRow) currentSortOrder = oldRow.sort_order;
      }
      await env.DB.prepare(
        'INSERT OR REPLACE INTO routes (prefix, target, remark, cache_img, compat_mode, sort_order, target_latencies) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        prefix, data.target, data.remark || '', data.cache_img || 'on', data.compat_mode || 'off', currentSortOrder, ''
      ).run();
      return json({ success: true });
    }
    if (request.method === 'DELETE') {
      const prefix = url.searchParams.get('prefix');
      if (!prefix) return json({ error: '缺少 prefix 参数' }, 400);
      await env.DB.prepare('DELETE FROM routes WHERE prefix = ?').bind(normalizePrefix(prefix)).run();
      return json({ success: true });
    }
  }

  if (url.pathname === '/admin/api/speedtest/routes' && request.method === 'POST') {
    const prefix = url.searchParams.get('prefix');
    if (prefix) {
      const results = await speedtestRouteTargets(env, normalizePrefix(prefix));
      return json({ results });
    }
    const allResults = await speedtestAllRoutes(env);
    return json({ results: allResults });
  }

  if (url.pathname === '/admin/api/speedtest/domains' && request.method === 'POST') {
    const data = await speedtestOptimizedFromEdge();
    return json(data);
  }

  return json({ error: 'Not found' }, 404);
}

async function resolveProxyTarget(request, env, url) {
  const decodedPath = decodeURIComponent(url.pathname);
  let upstreamUrls = [];
  let enableCache = true;
  let compatMode = false;
  let matchedPrefix = null;
  let needsSpeedTest = false;

  const pathParts = decodedPath.split('/').filter(Boolean);
  const prefix = normalizeAlias(pathParts[0]);
  if (!prefix) return { error: new Response('Not Found', { status: 404 }) };

  const route = await env.DB.prepare('SELECT * FROM routes WHERE prefix = ?').bind(prefix).first();
  if (!route) return { error: new Response('404: 节点不存在', { status: 404 }) };

  matchedPrefix = route.prefix;
  enableCache = route.cache_img !== 'off';
  compatMode = route.compat_mode === 'on';
  const remainingPath = '/' + pathParts.slice(1).join('/');
  let targetUrls = route.target.split(',').map(s => s.trim()).filter(Boolean);

  if (remainingPath.startsWith('/http://') || remainingPath.startsWith('/https://')) {
    upstreamUrls = [remainingPath.substring(1) + url.search];
    enableCache = true;
  } else {
    if (targetUrls.length > 1 && route.target_latencies) {
      try {
        const latencies = JSON.parse(route.target_latencies);
        const hasAnyLatency = Object.values(latencies).some(v => typeof v === 'number' && v >= 0);
        if (hasAnyLatency) {
          targetUrls.sort((a, b) => {
            const la = latencies[a];
            const lb = latencies[b];
            if (typeof la !== 'number' || la < 0) return 1;
            if (typeof lb !== 'number' || lb < 0) return -1;
            return la - lb;
          });
        }
      } catch (_) {}
    }
    if (targetUrls.length > 1 && !route.target_latencies) {
      needsSpeedTest = true;
    }
    upstreamUrls = targetUrls.map(t => t.replace(/\/+$/, '') + remainingPath + url.search);
  }

  return { upstreamUrls, enableCache, compatMode, matchedPrefix, needsSpeedTest };
}

function normalizeAlias(a) {
  return String(a || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
}

async function proxyDirectUrl(request, env, ctx, upstreamUrls, opts = {}) {
  const { enableCache = true, compatMode = false, matchedPrefix = null, needsSpeedTest = false } = opts;
  const proxyOrigin = new URL(request.url).origin;

  if (!upstreamUrls.length) return new Response('404: Target empty', { status: 404 });

  if (needsSpeedTest && matchedPrefix && env.DB && ctx?.waitUntil) {
    ctx.waitUntil(speedtestRouteTargets(env, matchedPrefix));
  }

  let firstUpstreamUrl;
  try {
    firstUpstreamUrl = new URL(upstreamUrls[0]);
  } catch {
    return new Response('Invalid upstream URL', { status: 500 });
  }

  const isPlaybackInfo = /\/PlaybackInfo/i.test(firstUpstreamUrl.pathname);
  const isPlaying = firstUpstreamUrl.pathname.endsWith('/Sessions/Playing');

  if (isPlaying && CONFIG.enableStats) {
    ctx.waitUntil(recordStats(env, 'playing'));
  }
  if (isPlaybackInfo) {
    ctx.waitUntil(recordStats(env, 'playback_info'));
  }

  if (matchedPrefix && env.DB && ctx?.waitUntil && isPlaybackInfo) {
    const todayStr = new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0];
    const nowTime = new Date(Date.now() + 8 * 3600000).toISOString().replace('T', ' ').split('.')[0];
    const clientIp = request.headers.get('cf-connecting-ip') || 'Unknown';
    const clientCountry = request.headers.get('cf-ipcountry') || 'Unknown';
    const clientUa = request.headers.get('User-Agent') || 'Unknown';
    try {
      ctx.waitUntil(env.DB.batch([
        env.DB.prepare(`INSERT INTO request_stats (prefix, date, count) VALUES (?, ?, 1) ON CONFLICT(prefix, date) DO UPDATE SET count = count + 1`).bind(matchedPrefix, todayStr),
        env.DB.prepare(`UPDATE routes SET last_play = ? WHERE prefix = ?`).bind(nowTime, matchedPrefix),
        env.DB.prepare(`INSERT INTO visitor_logs (prefix, ip, country, ua) VALUES (?, ?, ?, ?)`).bind(matchedPrefix, clientIp, clientCountry, clientUa),
      ]));
    } catch(_) {}
  }

  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader?.toLowerCase() === 'websocket') {
    return fetch(upstreamUrls[0], request);
  }

  let requestBody = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    requestBody = await request.arrayBuffer();
  }

  let finalResponse = null;
  let lastError = null;
  let lastUpstreamUrl = null;

  for (let i = 0; i < upstreamUrls.length; i++) {
    let upstreamUrl;
    try {
      upstreamUrl = new URL(upstreamUrls[i]);
    } catch {
      lastError = new Error('Invalid target URL');
      continue;
    }

    if (PIKPAK_DOMAINS.some((d) => upstreamUrl.hostname.endsWith(d))) {
      return Response.redirect(new URL(upstreamUrl.pathname + upstreamUrl.search, CONFIG.pikpakProxyUrl).toString(), 301);
    }
    if (blocker.check(upstreamUrl.toString())) return Response.redirect('https://baidu.com', 301);

    const colo = request.cf?.colo;
    if (colo && JP_COLOS.includes(colo)) {
      for (const suffix in DOMAIN_PROXY_RULES) {
        if (upstreamUrl.host.endsWith(suffix)) {
          upstreamUrl.hostname = DOMAIN_PROXY_RULES[suffix];
          break;
        }
      }
    }

    const headers = new Headers(request.headers);
    headers.set('Host', upstreamUrl.host);
    headers.delete('Referer');
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp) {
      headers.set('x-forwarded-for', clientIp);
      headers.set('x-real-ip', clientIp);
    }
    if (compatMode) {
      headers.set('Origin', upstreamUrl.origin);
      headers.set('X-Forwarded-Proto', upstreamUrl.protocol.replace(':', ''));
      headers.set('X-Forwarded-Host', upstreamUrl.host);
    }

    const isStaticOrImage = /\.(jpg|jpeg|gif|png|svg|ico|webp|js|css|woff2?|ttf|otf|map|webmanifest|srt|ass|vtt|sub)$/i.test(upstreamUrl.pathname) ||
      /(\/Images\/|\/Icons\/|\/Branding\/|\/emby\/covers\/)/i.test(upstreamUrl.pathname);

    const fetchInit = { method: request.method, headers, redirect: compatMode ? 'follow' : 'manual' };
    if (isStaticOrImage && enableCache) fetchInit.cf = { cacheEverything: true, cacheTtl: 86400 };
    if (requestBody) fetchInit.body = requestBody;

    try {
      const response = await fetch(new Request(upstreamUrl.toString(), fetchInit));
      if (!compatMode && [502, 503, 504].includes(response.status)) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      finalResponse = response;
      lastUpstreamUrl = upstreamUrl;
      break;
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  if (!finalResponse) {
    return new Response('所有线路不可用: ' + (lastError?.message || 'Unknown'), { status: 502 });
  }

  const safePrefix = matchedPrefix ? `/${matchedPrefix}` : '';

  if (!compatMode) {
    const location = finalResponse.headers.get('Location');
    if (location && finalResponse.status >= 300 && finalResponse.status < 400) {
      try {
        const redirectUrl = new URL(location, lastUpstreamUrl);
        if (redirectUrl.hostname === lastUpstreamUrl.hostname) {
          return fetch(redirectUrl.toString(), new Request(redirectUrl, { method: request.method, headers: finalResponse.headers, redirect: 'follow' }));
        }
        if (MANUAL_REDIRECT_DOMAINS.some((d) => redirectUrl.hostname.endsWith(d))) {
          const rh = new Headers(finalResponse.headers);
          rh.set('Location', redirectUrl.toString());
          return new Response(finalResponse.body, { status: finalResponse.status, headers: rh });
        }
        if (matchedPrefix) {
          const rh = new Headers(finalResponse.headers);
          rh.set('Location', `${safePrefix}/${encodeURIComponent(redirectUrl.toString())}`);
          return new Response(finalResponse.body, { status: finalResponse.status, headers: rh });
        }
        const fh = new Headers(request.headers);
        fh.set('Host', redirectUrl.host);
        fh.delete('Referer');
        const cIp = request.headers.get('cf-connecting-ip');
        if (cIp) {
          fh.set('x-forwarded-for', cIp);
          fh.set('x-real-ip', cIp);
        }
        return fetch(redirectUrl.toString(), { method: request.method, headers: fh, body: requestBody || undefined, redirect: 'follow' });
      } catch (_) {}
    }
  }

  const responseHeaders = new Headers(finalResponse.headers);
  const contentType = finalResponse.headers.get('content-type') || '';

  if (!compatMode && finalResponse.status === 200 && contentType.includes('json') && matchedPrefix) {
    const urlPath = lastUpstreamUrl.pathname.toLowerCase();
    if (urlPath.includes('playbackinfo')) {
      try {
        const data = await finalResponse.clone().json();
        let modified = false;
        if (data?.MediaSources) {
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
    }
  }

  if (!compatMode && finalResponse.status === 200 && matchedPrefix) {
    const urlPath = lastUpstreamUrl.pathname.toLowerCase();
    if (urlPath.endsWith('.m3u8')) {
      try {
        const text = await finalResponse.clone().text();
        if (text.includes('http://') || text.includes('https://')) {
          const modifiedText = text.replace(/(https?:\/\/[^\s]+)/g, (match) => {
            try {
              const mUrl = new URL(match);
              const isDirectDomain = MANUAL_REDIRECT_DOMAINS.some(d => mUrl.hostname.endsWith(d));
              return isDirectDomain ? match : proxyOrigin + safePrefix + '/' + match;
            } catch (_) {
              return proxyOrigin + safePrefix + '/' + match;
            }
          });
          responseHeaders.delete('Content-Length');
          return new Response(modifiedText, { status: finalResponse.status, headers: responseHeaders });
        }
      } catch (_) {}
    }
  }

  if (CONFIG.cacheEnabled) {
    if (contentType.includes('image/') || contentType.includes('text/css') || contentType.includes('application/javascript')) {
      responseHeaders.set('Cache-Control', 'public, max-age=86400');
    } else if (contentType.includes('video/') || contentType.includes('audio/')) {
      responseHeaders.set('Cache-Control', 'public, max-age=3600');
    } else {
      responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }

  responseHeaders.set('Access-Control-Allow-Origin', '*');
  responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  responseHeaders.set('Access-Control-Allow-Headers', '*');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');

  return new Response(finalResponse.body, {
    status: finalResponse.status,
    statusText: finalResponse.statusText,
    headers: responseHeaders,
  });
}

const PAGE_STYLE = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #e5e7eb; margin: 0; padding: 0; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); min-height: 100vh; }
  .container { max-width: 1200px; margin: auto; padding: 24px; display: flex; flex-direction: column; gap: 24px; }
  .card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); padding: 28px; border-radius: 20px; border: 1px solid rgba(148, 163, 184, 0.15); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); }
  h1 { margin-top: 0; color: #60a5fa; font-size: 2em; font-weight: 700; letter-spacing: -0.02em; }
  h2 { color: #94a3b8; border-bottom: 2px solid rgba(148, 163, 184, 0.15); padding-bottom: 12px; font-size: 1.2em; font-weight: 600; letter-spacing: -0.01em; }
  code { background: rgba(96, 165, 250, 0.15); padding: 4px 10px; border-radius: 8px; color: #93c5fd; word-break: break-all; font-size: 0.9em; border: 1px solid rgba(96, 165, 250, 0.2); }
  .muted { color: #94a3b8; font-size: 14px; }
  .stat-row { display: flex; gap: 16px; flex-wrap: wrap; margin: 20px 0; }
  .stat-card { flex: 1; min-width: 160px; background: linear-gradient(135deg, rgba(96, 165, 250, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%); border: 1px solid rgba(96, 165, 250, 0.2); border-radius: 16px; padding: 20px; text-align: center; transition: transform 0.2s ease, box-shadow 0.2s ease; }
  .stat-card:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(96, 165, 250, 0.2); }
  .stat-val { font-size: 2em; font-weight: 700; color: #60a5fa; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid rgba(148, 163, 184, 0.15); }
  th { color: #60a5fa; background: rgba(96, 165, 250, 0.08); font-weight: 600; }
  tr.best td { background: rgba(34, 197, 94, 0.08); }
  .tag { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .tag-fast { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
  .tag-good { background: rgba(96, 165, 250, 0.2); color: #93c5fd; border: 1px solid rgba(96, 165, 250, 0.3); }
  .tag-slow { background: rgba(251, 191, 36, 0.2); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); }
  .tag-timeout { background: rgba(248, 113, 113, 0.2); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3); }
  .edge-box { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
  .edge-item { background: rgba(15, 23, 42, 0.5); padding: 16px; border-radius: 12px; font-size: 13px; border: 1px solid rgba(148, 163, 184, 0.1); }
  .edge-item strong { color: #60a5fa; display: block; margin-bottom: 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%); color: #fff; border-radius: 12px; text-decoration: none; font-weight: 600; border: none; cursor: pointer; font-size: 14px; transition: all 0.2s ease; box-shadow: 0 4px 15px rgba(96, 165, 250, 0.3); }
  .btn:hover { background: linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%); transform: translateY(-2px); box-shadow: 0 6px 20px rgba(96, 165, 250, 0.4); }
  .btn:active { transform: translateY(0); }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
  .warn { border: 2px solid rgba(248, 113, 113, 0.3); padding: 20px; border-radius: 16px; color: #fca5a5; background: rgba(248, 113, 113, 0.08); }
  input[type=password], input[type=text], input[type=url], select { width: 100%; padding: 14px 16px; border: 2px solid rgba(148, 163, 184, 0.2); border-radius: 12px; background: rgba(15, 23, 42, 0.6); color: #e5e7eb; margin-bottom: 16px; font-size: 14px; transition: all 0.2s ease; }
  input[type=password]:focus, input[type=text]:focus, input[type=url]:focus, select:focus { outline: none; border-color: #60a5fa; box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.1); }
  label { display: block; font-weight: 600; margin-bottom: 8px; font-size: 13px; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.05em; }
  .form-row { margin-bottom: 20px; }
  .toolbar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; align-items: center; }
  .route-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px; }
  .route-item { background: linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.9) 100%); border: 1px solid rgba(148, 163, 184, 0.15); border-radius: 20px; padding: 24px; transition: all 0.3s ease; position: relative; overflow: hidden; }
  .route-item::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #60a5fa 0%, #a78bfa 50%, #60a5fa 100%); opacity: 0; transition: opacity 0.3s ease; }
  .route-item:hover { transform: translateY(-4px); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4); border-color: rgba(96, 165, 250, 0.3); }
  .route-item:hover::before { opacity: 1; }
  .route-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .route-title { flex: 1; }
  .route-name { font-size: 1.3em; font-weight: 700; color: #f1f5f9; margin: 0 0 4px; letter-spacing: -0.01em; }
  .route-path { color: #60a5fa; font-weight: 600; font-size: 0.95em; }
  .route-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(148, 163, 184, 0.1); }
  .btn-sm { padding: 8px 14px; font-size: 13px; border-radius: 10px; font-weight: 500; }
  .btn-del { background: rgba(248, 113, 113, 0.15); border: 1px solid rgba(248, 113, 113, 0.3); color: #fca5a5; box-shadow: none; }
  .btn-del:hover { background: rgba(248, 113, 113, 0.25); }
  .btn-outline { background: rgba(148, 163, 184, 0.15); border: 1px solid rgba(148, 163, 184, 0.3); color: #cbd5e1; box-shadow: none; }
  .btn-outline:hover { background: rgba(148, 163, 184, 0.25); }
  .target-list { margin-top: 12px; }
  .target-row { background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.1); border-radius: 12px; padding: 12px 16px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 12px; transition: all 0.2s ease; }
  .target-row:hover { background: rgba(15, 23, 42, 0.8); border-color: rgba(148, 163, 184, 0.2); }
  .target-url { color: #94a3b8; font-size: 13px; word-break: break-all; flex: 1; }
  .target-latency { font-size: 13px; font-weight: 600; white-space: nowrap; }
  .route-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .meta-tag { font-size: 11px; padding: 3px 8px; background: rgba(148, 163, 184, 0.15); border-radius: 20px; color: #cbd5e1; }
  .modal { display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(8px); z-index: 1000; padding: 20px; overflow: auto; animation: fadeIn 0.2s ease; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .modal.show { display: flex; align-items: center; justify-content: center; }
  .modal-inner { background: linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%); padding: 32px; border-radius: 24px; max-width: 560px; width: 100%; border: 1px solid rgba(148, 163, 184, 0.2); box-shadow: 0 25px 60px rgba(0, 0, 0, 0.5); animation: slideUp 0.3s ease; }
  @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
  .modal-header { margin-bottom: 24px; }
  .modal-title { font-size: 1.5em; font-weight: 700; color: #f1f5f9; margin: 0; }
  .search-box { position: relative; flex: 1; min-width: 240px; }
  .search-box input { margin-bottom: 0; padding-left: 44px; }
  .search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #64748b; pointer-events: none; }
  .empty-state { text-align: center; padding: 48px 24px; color: #64748b; }
  .empty-state-icon { font-size: 4em; margin-bottom: 16px; display: block; }
  .empty-state-text { font-size: 1.1em; margin: 0; }
  .form-group { margin-bottom: 20px; }
  .form-group label { display: block; color: #cbd5e1; margin-bottom: 8px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .form-group input, .form-group select { width: 100%; padding: 14px 16px; border: 2px solid rgba(148, 163, 184, 0.2); border-radius: 12px; background: rgba(15, 23, 42, 0.6); color: #e5e7eb; font-size: 14px; transition: all 0.2s ease; margin-bottom: 0; }
  .form-group input:focus, .form-group select:focus { outline: none; border-color: #60a5fa; box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.1); }
  .form-hint { color: #64748b; font-size: 12px; margin: 8px 0 0; }
  .form-hint span { color: #60a5fa; font-weight: 600; }
  .modal-desc { color: #94a3b8; font-size: 14px; margin: 8px 0 0; }
  .modal-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 28px; padding-top: 20px; border-top: 1px solid rgba(148, 163, 184, 0.1); }
  .checkbox-label { display: flex !important; align-items: center; gap: 10px !important; text-transform: none !important; letter-spacing: normal !important; cursor: pointer; }
  .checkbox-label input[type="checkbox"] { width: 18px !important; height: 18px; accent-color: #60a5fa; cursor: pointer; flex-shrink: 0; }
  #toast { position: fixed; top: -60px; left: 50%; transform: translateX(-50%); background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(10px); color: #f1f5f9; padding: 12px 24px; border-radius: 30px; font-size: 14px; font-weight: 500; transition: top 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index: 9999; border: 1px solid rgba(96, 165, 250, 0.3); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); }
  #toast.show { top: 20px; }
  .target-inputs { display: flex; flex-direction: column; gap: 10px; }
  .target-input-row { display: flex; gap: 8px; align-items: center; }
  .target-input-row input { flex: 1; margin-bottom: 0; }
  .target-input-row .btn-remove { background: rgba(248, 113, 113, 0.15); border: 1px solid rgba(248, 113, 113, 0.3); color: #fca5a5; padding: 10px 14px; border-radius: 10px; cursor: pointer; font-size: 16px; flex-shrink: 0; }
`;

function buildFrontendHtml() {
  const domainListJson = JSON.stringify(OPTIMIZED_DOMAINS);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Media Gateway | 智能优选</title><style>${PAGE_STYLE}</style></head><body>
<div class="container">
  <div class="card">
    <h1>Media Gateway</h1>
    <p class="muted">版本 ${CURRENT_VERSION} · 支持别名快捷入口与 CF 优选域名智能测速</p>
    <p><a href="/admin" class="btn btn-outline">管理后台</a></p>
  </div>
  <div class="card">
    <h2>当前边缘节点</h2>
    <div id="edge-loading" class="muted">加载中...</div>
    <div id="edge-info" class="edge-box" style="display:none"></div>
  </div>
  <div class="card">
    <h2>优选域名测速（用户网络 → 优选入口）</h2>
    <p class="muted">按延迟排序；同网段 IP 一小时内复用缓存结果</p>
    <div class="toolbar"><button class="btn" id="btn-retest">重新测速</button><span id="speed-status" class="muted"></span></div>
    <div id="domain-table-wrap"><p class="muted" id="domain-loading">正在测速...</p></div>
  </div>
  <div class="card">
    <h2>使用格式</h2>
    <p><code>https://你的域名/别名</code> 或 <code>https://你的域名/https://origin.example.com:8096</code></p>
    <div class="warn">添加服务后请务必手动测试。恶意刷接口将封禁 IP。</div>
  </div>
  <div class="card">
    <h2>使用统计（近30天）</h2>
    <div id="stats-loading" class="muted">加载中...</div>
    <div id="stats-body" style="display:none">
      <div class="stat-row">
        <div class="stat-card"><div>播放次数</div><div class="stat-val" id="st-play">0</div></div>
        <div class="stat-card"><div>获取链接</div><div class="stat-val" id="st-pb">0</div></div>
      </div>
      <div id="daily-table"></div>
    </div>
  </div>
</div>
<script>
const OPT_DOMAINS = ${domainListJson};
const TAG = { fast:'极快', good:'良好', slow:'较慢', timeout:'超时' };
const CLS = { fast:'tag-fast', good:'tag-good', slow:'tag-slow', timeout:'tag-timeout' };

async function loadEdge() {
  try {
    const r = await fetch('/api/edge-info');
    const d = await r.json();
    document.getElementById('edge-loading').style.display = 'none';
    const box = document.getElementById('edge-info');
    box.style.display = 'grid';
    box.innerHTML = [
      ['客户端 IP', d.clientIp],
      ['接入 POP', d.entryColo],
      ['国家/地区', d.entryCountry + (d.entryCity ? ' / '+d.entryCity : '')],
      ['边缘出口 IP', d.edgeIp],
      ['落地 COLO', d.egressColo],
    ].map(([k,v]) => '<div class="edge-item"><strong>'+k+'</strong>'+ (v||'—') +'</div>').join('');
  } catch(e) { document.getElementById('edge-loading').textContent = '加载失败'; }
}

function renderDomainTable(results, best) {
  const wrap = document.getElementById('domain-table-wrap');
  if (!results.length) { wrap.innerHTML = '<p class="muted">无数据</p>'; return; }
  let html = '<table><thead><tr><th>#</th><th>名称</th><th>域名</th><th>延迟</th><th>状态</th></tr></thead><tbody>';
  results.forEach((r, i) => {
    const host = r.host || (r.subdomain+'.'+r.domain);
    const isBest = best && best === host;
    html += '<tr class="'+(isBest?'best':'')+'"><td>'+(i+1)+'</td><td>'+ (r.name||r.display_name||'') +'</td><td><code>'+host+'</code></td><td>'+(r.latency>=0?r.latency+' ms':'—')+'</td><td><span class="tag '+CLS[r.status||'timeout']+'">'+(TAG[r.status]||'—')+'</span></td></tr>';
  });
  wrap.innerHTML = html + '</tbody></table>';
}

function pingMs(url, timeout) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const timer = setTimeout(() => resolve(-1), timeout || 7000);
    const done = (ms) => { clearTimeout(timer); resolve(ms >= 0 && ms < (timeout || 7000) ? ms : -1); };
    fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' })
      .then(() => done(Math.round(performance.now() - t0)))
      .catch(() => {
        const img = new Image();
        const t1 = performance.now();
        const t2 = setTimeout(() => done(-1), 5000);
        const end = () => { clearTimeout(t2); done(Math.round(performance.now() - t1)); };
        img.onload = end;
        img.onerror = end;
        img.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      });
  });
}

async function probeDomain(item) {
  const host = item.subdomain + '.' + item.domain;
  const paths = ['/cdn-cgi/trace', '/favicon.ico', '/'];
  for (const p of paths) {
    const ms = await pingMs('https://' + host + p, 7000);
    if (ms >= 0) {
      const status = ms < 100 ? 'fast' : ms < 300 ? 'good' : 'slow';
      return { subdomain: item.subdomain, domain: item.domain, name: item.name, host, latency: ms, status, source: 'client' };
    }
  }
  try {
    const r = await fetch('/api/ping-host?host=' + encodeURIComponent(host));
    const d = await r.json();
    if (d.ms >= 0) {
      const status = d.ms < 100 ? 'fast' : d.ms < 300 ? 'good' : 'slow';
      return { subdomain: item.subdomain, domain: item.domain, name: item.name, host, latency: d.ms, status, source: 'edge' };
    }
  } catch (_) {}
  return { subdomain: item.subdomain, domain: item.domain, name: item.name, host, latency: -1, status: 'timeout', source: 'none' };
}

function finalizeResults(rows) {
  rows.forEach(r => { if (r.latency >= 0) r.status = r.latency < 100 ? 'fast' : r.latency < 300 ? 'good' : 'slow'; else r.status = 'timeout'; });
  rows.sort((a,b) => { if (a.latency<0) return 1; if (b.latency<0) return -1; return a.latency-b.latency; });
  return rows;
}

async function runDomainSpeed(force) {
  const st = document.getElementById('speed-status');
  const wrap = document.getElementById('domain-table-wrap');
  if (!force) {
    try {
      const cached = await fetch('/api/domains/speed');
      const data = await cached.json();
      if (data.cached && data.results?.length) {
        st.textContent = '已使用缓存（约1小时有效）';
        renderDomainTable(data.results, data.best);
        return;
      }
    } catch(e) {}
  }
  st.textContent = '加载边缘测速...';
  wrap.innerHTML = '<p class="muted">测速中...</p>';
  let results = [];
  try {
    const er = await fetch('/api/domains/speed?edge=1');
    const ed = await er.json();
    if (ed.results?.length) {
      results = ed.results;
      finalizeResults(results);
      renderDomainTable(results, ed.best);
      st.textContent = '边缘测速完成，正在用您的网络复测...';
    }
  } catch (_) {}
  const clientResults = await Promise.all(OPT_DOMAINS.map(probeDomain));
  finalizeResults(clientResults);
  const clientOk = clientResults.filter(r => r.latency >= 0).length;
  if (clientOk > 0) {
    results = clientResults;
    st.textContent = '浏览器测速完成（' + clientOk + '/12 可用）';
    try {
      await fetch('/api/domains/speed', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ results }) });
    } catch(e) {}
  } else if (!results.length) {
    st.textContent = '测速失败，请检查网络或稍后重试';
  }
  const best = results.find(r => r.latency >= 0);
  renderDomainTable(results, best ? best.host : null);
  if (best && clientOk > 0) st.textContent += ' · 推荐: ' + best.host;
}

async function loadStats() {
  try {
    const r = await fetch('/stats');
    const data = await r.json();
    if (data.error) { document.getElementById('stats-loading').textContent = data.error; return; }
    document.getElementById('stats-loading').style.display = 'none';
    document.getElementById('stats-body').style.display = 'block';
    document.getElementById('st-play').textContent = data.data.total.playing;
    document.getElementById('st-pb').textContent = data.data.total.playbackInfo;
    const daily = (data.data.dailyStats||[]).slice(0,10);
    let t = '<table><tr><th>日期</th><th>播放</th><th>链接</th></tr>';
    daily.forEach(s => { t += '<tr><td>'+s.date+'</td><td>'+s.playing_count+'</td><td>'+s.playback_info_count+'</td></tr>'; });
    document.getElementById('daily-table').innerHTML = t + '</table>';
  } catch(e) { document.getElementById('stats-loading').textContent = '统计加载失败'; }
}

document.getElementById('btn-retest').onclick = () => runDomainSpeed(true);
loadEdge(); runDomainSpeed(false); loadStats();
</script></body></html>`;
}

function buildLoginHtml() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>管理登录</title><style>${PAGE_STYLE}
body{display:flex;align-items:center;justify-content:center;min-height:100vh;}
.login-box{background:#252830;padding:40px;border-radius:16px;max-width:360px;width:100%;border-top:4px solid #0070f3;}
</style></head><body><div class="login-box">
<h1 style="text-align:center">管理后台</h1>
<p class="muted" style="text-align:center">请输入 Worker 环境变量 ADMIN_TOKEN</p>
<input type="password" id="tokenInput" placeholder="请输入管理密钥" onkeydown="if(event.key==='Enter')login()">
<p id="loginErr" style="color:#e06c75;font-size:14px;min-height:1.2em"></p>
<button class="btn" style="width:100%" id="loginBtn" onclick="login()">登录</button>
<script>
async function login(){
  const t=document.getElementById('tokenInput').value.trim();
  const err=document.getElementById('loginErr');
  const btn=document.getElementById('loginBtn');
  err.textContent='';
  if(!t){ err.textContent='请输入密钥'; return; }
  btn.disabled=true; btn.textContent='验证中...';
  try{
    const r=await fetch('/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})});
    const d=await r.json();
    if(d.ok){ location.href='/admin'; return; }
    err.textContent=d.error||'登录失败';
  }catch(e){ err.textContent='请求失败: '+e.message; }
  btn.disabled=false; btn.textContent='登录';
}
</script></div></body></html>`;
}

function buildAdminHtml() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>管理后台</title><style>${PAGE_STYLE}</style></head><body>
<div id="toast"></div>
<div class="container">
  <div class="card">
    <div class="toolbar" style="justify-content:space-between">
      <h1 style="margin:0">🎛️ 管理后台</h1>
      <div style="display:flex;gap:10px">
        <a href="/" class="btn btn-outline btn-sm">🏠 首页</a>
        <button class="btn btn-del btn-sm" onclick="logout()">🚪 退出</button>
      </div>
    </div>
  </div>

  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:16px">
      <h2 style="border:none;margin:0;padding:0">📦 路由管理</h2>
      <div class="toolbar" style="margin:0">
        <button class="btn" onclick="openRouteModal()">➕ 添加路由</button>
        <button class="btn btn-outline" onclick="speedtestAll()">⚡ 全局测速</button>
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input type="text" id="routeSearch" placeholder="搜索备注或路径..." oninput="filterRoutes()">
        </div>
      </div>
    </div>
    <div id="routeList" class="route-grid"><p class="muted">加载中...</p></div>
  </div>

  <div class="card">
    <h2>⚡ 优选域名测速</h2>
    <p class="muted" style="margin-bottom:16px">测试边缘节点到优选入口的延迟</p>
    <button class="btn" onclick="testDomains()">🚀 开始测速</button>
    <div id="adminDomainResult" style="margin-top:20px"></div>
  </div>
</div>

<div id="modalRoute" class="modal">
  <div class="modal-inner">
    <div class="modal-header">
      <h2 class="modal-title" id="routeModalTitle">➕ 添加路由</h2>
      <p class="modal-desc">创建路由后可通过 /路径 快捷访问目标服务</p>
    </div>
    <input type="hidden" id="oldPrefix">
    <div class="form-group">
      <label>备注名</label>
      <input id="routeRemark" placeholder="例如：主线路">
    </div>
    <div class="form-group">
      <label>路径 (prefix)</label>
      <input id="routePrefix" placeholder="main">
      <p class="form-hint">访问路径: https://你的域名/<span id="prefixPreview">main</span></p>
    </div>
    <div class="form-group">
      <label>目标线路 (target)</label>
      <div id="targetInputs" class="target-inputs">
        <div class="target-input-row">
          <input type="url" class="target-url-input" placeholder="主线路地址 (如: https://origin.example.com:8096)">
          <button class="btn-remove" onclick="removeTargetInput(this)" title="移除">✕</button>
        </div>
      </div>
      <button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="addTargetInput()">➕ 添加备用线路</button>
      <p class="form-hint">多个线路按顺序 failover，测速后按延迟排序优选</p>
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="routeCache" checked> 启用图片/静态资源缓存
      </label>
      <label class="checkbox-label" style="margin-top:12px">
        <input type="checkbox" id="routeCompat"> 兼容模式
      </label>
      <p class="form-hint">兼容模式适用于部分无法正常播放的源站，开启后不重写媒体流地址，由客户端直连源站播放</p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal('modalRoute')">取消</button>
      <button class="btn" onclick="saveRoute()">💾 保存</button>
    </div>
  </div>
</div>

<script>
let allRoutes=[];

function closeModal(id){document.getElementById(id).classList.remove('show');}
function openModal(id){document.getElementById(id).classList.add('show');}

function logout(){document.cookie='admin_token=;path=/;max-age=0';location.reload();}

function showToast(msg){
  var t=document.getElementById('toast');
  if(!t){t=document.createElement('div');t.id='toast';document.body.appendChild(t);}
  t.textContent=msg;t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2500);
}

function getLatencyInfo(ms){
  if(ms<0)return {text:'超时',cls:'tag-timeout',color:'#f87171'};
  if(ms<100)return {text:'极快',cls:'tag-fast',color:'#4ade80'};
  if(ms<300)return {text:'良好',cls:'tag-good',color:'#93c5fd'};
  return {text:'较慢',cls:'tag-slow',color:'#fbbf24'};
}

function addTargetInput(){
  var container=document.getElementById('targetInputs');
  var row=document.createElement('div');
  row.className='target-input-row';
  row.innerHTML='<input type="url" class="target-url-input" placeholder="备用线路地址"><button class="btn-remove" onclick="removeTargetInput(this)" title="移除">✕</button>';
  container.appendChild(row);
}

function removeTargetInput(btn){
  var container=document.getElementById('targetInputs');
  if(container.querySelectorAll('.target-input-row').length>1){
    btn.parentElement.remove();
  }
}

async function loadRoutes(){
  const r=await fetch('/admin/api/routes');
  if(r.status===401){location.reload();return;}
  allRoutes=await r.json();
  renderRoutes(allRoutes);
}

function parseLatencies(latStr){
  if(!latStr)return {};
  try{return JSON.parse(latStr);}catch(e){return {};}
}

function renderRoutes(list){
  const el=document.getElementById('routeList');
  if(!list.length){
    el.innerHTML='<div class="empty-state" style="grid-column:1/-1"><span class="empty-state-icon">📦</span><p class="empty-state-text">暂无路由，点击上方按钮添加</p></div>';
    return;
  }
  el.innerHTML=list.map(r=>{
    const targets=r.target.split(',').map(s=>s.trim()).filter(Boolean);
    const latencies=parseLatencies(r.target_latencies);
    const remarkName=r.remark||'未命名';
    const cacheStatus=r.cache_img!=='off';
    const compatStatus=r.compat_mode==='on';

    let targetsHtml='';
    targets.forEach((t,idx)=>{
      const lat=latencies[t];
      const latInfo=getLatencyInfo(lat);
      const tag=idx===0?'<span style="color:#4ade80;font-weight:bold;">[主]</span>':'<span style="color:#fbbf24;font-weight:bold;">[备'+idx+']</span>';
      const latDisplay=typeof lat==='number'&&lat>=0?'<span class="target-latency" style="color:'+latInfo.color+'">'+lat+'ms <span class="tag '+latInfo.cls+'">'+latInfo.text+'</span></span>':'<span class="target-latency" style="color:#64748b">未测速</span>';
      targetsHtml+='<div class="target-row">'+tag+' <span class="target-url"><code>'+t+'</code></span>'+latDisplay+'</div>';
    });

    return '<div class="route-item" data-search="'+(remarkName+' '+r.prefix).toLowerCase()+'">'+
      '<div class="route-header">'+
        '<div class="route-title">'+
          '<h3 class="route-name">'+remarkName+'</h3>'+
          '<span class="route-path">/'+r.prefix+'</span>'+
        '</div>'+
      '</div>'+
      '<div class="target-list">'+targetsHtml+'</div>'+
      '<div class="route-meta">'+
        (cacheStatus?'<span class="meta-tag">🖼️ 缓存开启</span>':'<span class="meta-tag">缓存关闭</span>')+
        (compatStatus?'<span class="meta-tag" style="background:rgba(251,191,36,0.2);color:#fbbf24">🔧 兼容模式</span>':'')+
        (r.last_play?'<span class="meta-tag">📺 '+r.last_play+'</span>':'')+
      '</div>'+
      '<div class="route-actions">'+
        '<button class="btn btn-sm btn-outline" onclick="speedtestRoute(\\''+r.prefix+'\\')">⚡ 测速</button>'+
        '<button class="btn btn-sm btn-outline" onclick="editRoute(\\''+r.prefix+'\\')">✏️ 编辑</button>'+
        '<button class="btn btn-sm btn-del" onclick="delRoute(\\''+r.prefix+'\\')">🗑️ 删除</button>'+
      '</div>'+
    '</div>';
  }).join('');
}

function filterRoutes(){
  const q=document.getElementById('routeSearch').value.toLowerCase();
  document.querySelectorAll('.route-item').forEach(c=>{
    c.style.display=(!q||c.dataset.search.includes(q))?'block':'none';
  });
}

function openRouteModal(){
  document.getElementById('oldPrefix').value='';
  document.getElementById('routeRemark').value='';
  document.getElementById('routePrefix').value='';
  document.getElementById('routeCache').checked=true;
  document.getElementById('routeCompat').checked=false;
  document.getElementById('prefixPreview').textContent='main';
  document.getElementById('routeModalTitle').textContent='➕ 添加路由';
  var container=document.getElementById('targetInputs');
  container.innerHTML='<div class="target-input-row"><input type="url" class="target-url-input" placeholder="主线路地址 (如: https://origin.example.com:8096)"><button class="btn-remove" onclick="removeTargetInput(this)" title="移除">✕</button></div>';
  openModal('modalRoute');
}

function editRoute(prefix){
  const r=allRoutes.find(x=>x.prefix===prefix);
  if(!r)return;
  document.getElementById('oldPrefix').value=r.prefix;
  document.getElementById('routeRemark').value=r.remark||'';
  document.getElementById('routePrefix').value=r.prefix;
  document.getElementById('routeCache').checked=r.cache_img!=='off';
  document.getElementById('routeCompat').checked=r.compat_mode==='on';
  document.getElementById('prefixPreview').textContent=r.prefix;
  document.getElementById('routeModalTitle').textContent='✏️ 编辑路由';

  var container=document.getElementById('targetInputs');
  container.innerHTML='';
  var targets=r.target.split(',').map(s=>s.trim()).filter(Boolean);
  targets.forEach(function(t){
    var row=document.createElement('div');
    row.className='target-input-row';
    row.innerHTML='<input type="url" class="target-url-input" value="'+t+'"><button class="btn-remove" onclick="removeTargetInput(this)" title="移除">✕</button>';
    container.appendChild(row);
  });
  if(!targets.length){
    var row=document.createElement('div');
    row.className='target-input-row';
    row.innerHTML='<input type="url" class="target-url-input" placeholder="主线路地址"><button class="btn-remove" onclick="removeTargetInput(this)" title="移除">✕</button>';
    container.appendChild(row);
  }
  openModal('modalRoute');
}

async function saveRoute(){
  const oldPrefix=document.getElementById('oldPrefix').value;
  const remark=document.getElementById('routeRemark').value.trim();
  const prefix=document.getElementById('routePrefix').value.trim().replace(/^\\/+|\\/+$/g,'');
  const cache_img=document.getElementById('routeCache').checked?'on':'off';
  const compat_mode=document.getElementById('routeCompat').checked?'on':'off';

  var targetInputs=document.querySelectorAll('.target-url-input');
  var targets=[];
  targetInputs.forEach(function(inp){
    var val=inp.value.trim().replace(/\\/$/g,'');
    if(val)targets.push(val);
  });
  const target=targets.join(',');

  if(!prefix){showToast('请输入路径');return;}
  if(!target){showToast('请至少填写一个主线路地址');return;}

  document.getElementById('prefixPreview').textContent=prefix||'main';

  const r=await fetch('/admin/api/routes',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({oldPrefix:oldPrefix,prefix:prefix,target:target,remark:remark,cache_img:cache_img,compat_mode:compat_mode})
  });
  const j=await r.json();
  if(!r.ok){showToast(j.error||'保存失败');return;}
  closeModal('modalRoute');
  showToast('保存成功');
  loadRoutes();
}

async function delRoute(prefix){
  if(!confirm('确定删除路由 /'+prefix+' ？'))return;
  await fetch('/admin/api/routes?prefix='+encodeURIComponent(prefix),{method:'DELETE'});
  showToast('已删除');
  loadRoutes();
}

async function speedtestRoute(prefix){
  showToast('测速中...');
  const r=await fetch('/admin/api/speedtest/routes?prefix='+encodeURIComponent(prefix),{method:'POST'});
  const d=await r.json();
  const ok=(d.results||[]).filter(x=>x.latency>=0).length;
  showToast('测速完成，'+ok+'条线路可用');
  loadRoutes();
}

async function speedtestAll(){
  showToast('全局测速中，请耐心等待...');
  const r=await fetch('/admin/api/speedtest/routes',{method:'POST'});
  const d=await r.json();
  showToast('全局测速完成');
  loadRoutes();
}

async function testDomains(){
  document.getElementById('adminDomainResult').innerHTML='<p class="muted">测速中...</p>';
  const r=await fetch('/admin/api/speedtest/domains',{method:'POST'});
  const d=await r.json();
  let h='<table><thead><tr><th>名称</th><th>域名</th><th>延迟</th><th>状态</th></tr></thead><tbody>';
  (d.results||[]).forEach(x=>{
    const status=getLatencyInfo(x.latency);
    h+='<tr'+(d.best===x.host?' class="best"':'')+'>'+
      '<td>'+(x.name||'—')+'</td>'+
      '<td><code>'+x.host+'</code></td>'+
      '<td>'+(x.latency>=0?x.latency+'ms':'超时')+'</td>'+
      '<td><span class="tag '+status.cls+'">'+status.text+'</span></td>'+
    '</tr>';
  });
  document.getElementById('adminDomainResult').innerHTML=h+'</tbody></table>';
}

document.getElementById('routePrefix').addEventListener('input',function(){
  document.getElementById('prefixPreview').textContent=this.value.trim()||'main';
});

loadRoutes();
</script>
</body></html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    if (env.DB) await initDatabase(env);

    if (url.pathname === '/__client_rtt__') {
      return new Response(null, {
        status: 204,
        headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (url.pathname === '/') return html(buildFrontendHtml());
    if (url.pathname === '/favicon.ico') return new Response('', { headers: { 'Content-Type': 'image/x-icon' } });
    if (url.pathname.startsWith('/cdn-cgi/')) return new Response('Not Found', { status: 404 });

    if (url.pathname === '/health') {
      return json({ status: 'ok', version: CURRENT_VERSION, colo: request.cf?.colo, timestamp: new Date().toISOString() });
    }

    if (url.pathname === '/stats') return handleStatsRequest(env);

    if (url.pathname === '/api/edge-info') return json(await getEdgeInfo(request));

    if (url.pathname === '/api/ping-host') {
      const host = (url.searchParams.get('host') || '').replace(/^https?:\/\//, '').split('/')[0];
      if (!host) return json({ ms: -1, error: 'missing host' });
      const ms = await speedtestUrl(`https://${host}/cdn-cgi/trace`, 5000);
      return json({ ms, host });
    }

    if (url.pathname === '/api/domains/speed') {
      const cacheKey = getClientCacheKey(request);
      if (request.method === 'GET') {
        if (url.searchParams.get('edge') === '1') {
          const data = await speedtestOptimizedFromEdge();
          const results = data.results.map((r) => ({
            subdomain: r.subdomain, domain: r.domain, name: r.name, host: r.host,
            latency: r.latency, status: r.status, source: 'edge',
          }));
          return json({ cached: false, edge: true, best: data.best, results });
        }
        if (!env.DB) return json({ cached: false, cacheKey, results: [] });
        const cached = await loadDomainSpeedCache(env, cacheKey);
        if (cached) return json(cached);
        return json({ cached: false, cacheKey, results: [], domains: OPTIMIZED_DOMAINS });
      }
      if (request.method === 'POST') {
        if (!env.DB) return json({ success: false, error: 'DB not bound' }, 500);
        const body = await request.json();
        const rows = (body.results || []).map((r) => ({
          subdomain: r.subdomain,
          domain: r.domain,
          name: r.name || r.display_name,
          latency: r.latency,
          status: r.status || latencyStatus(r.latency),
        }));
        await saveDomainSpeedCache(env, cacheKey, rows);
        const best = rows.filter((r) => r.latency >= 0).sort((a, b) => a.latency - b.latency)[0];
        return json({ success: true, best: best ? `${best.subdomain}.${best.domain}` : null });
      }
    }

    if (url.pathname === '/admin/api/login' && request.method === 'POST') {
      try {
        const body = await request.json();
        return adminLoginResponse(request, env, String(body.token || '').trim());
      } catch (e) {
        return json({ ok: false, error: e.message }, 400);
      }
    }

    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      if (!isAdmin(request, env)) return html(buildLoginHtml());
      return html(buildAdminHtml());
    }

    if (url.pathname.startsWith('/admin/api/')) {
      if (!isAdmin(request, env)) return new Response('Unauthorized', { status: 401 });
      if (!env.DB) return json({ error: 'DB 未绑定' }, 500);
      return handleAdminApi(request, env, url);
    }

    const pathFirst = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    const looksLikeDirectUrl = url.pathname.startsWith('/http://') || url.pathname.startsWith('/https://') ||
      (pathFirst && (pathFirst.includes('.') || pathFirst.includes(':')));

    if (looksLikeDirectUrl) {
      let path = url.pathname.substring(1);
      if (path.startsWith('/')) return new Response('Invalid proxy format', { status: 400 });
      path = path.replace(/^(https?)\/(?!\/)/, '$1://');
      if (!path.startsWith('http')) path = 'https://' + path;
      try {
        const upstreamUrl = new URL(path);
        upstreamUrl.search = url.search;
        return proxyDirectUrl(request, env, ctx, [upstreamUrl.toString()], { enableCache: true });
      } catch {
        return new Response('Invalid URL format', { status: 400 });
      }
    }

    if (!env.DB) {
      return new Response('D1 数据库未绑定，路由反代不可用。仍可使用 /https://... 格式。', { status: 500 });
    }

    const resolved = await resolveProxyTarget(request, env, url);
    if (resolved.error) return resolved.error;

    return proxyDirectUrl(request, env, ctx, resolved.upstreamUrls, {
      enableCache: resolved.enableCache,
      compatMode: resolved.compatMode,
      matchedPrefix: resolved.matchedPrefix,
      needsSpeedTest: resolved.needsSpeedTest,
    });
  },
};
