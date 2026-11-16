/**
 * Feynman Classroom · Netlify Edge Function proxy
 *
 * Same job as worker/index.js, but runs on *.netlify.app, which is directly
 * reachable from mainland China without a VPN.
 *
 * Endpoint:
 *   POST /v1/chat/completions
 *   GET  /v1/chat/completions  → health check
 *
 * Environment (set in Netlify → Site configuration → Environment variables):
 *   UPSTREAM_KEY          secret, required
 *   UPSTREAM_BASE         default https://openrouter.ai/api/v1
 *   ACCESS_CODE           optional shared code, sent as x-access-code
 *   ALLOWED_ORIGINS       comma separated; empty = allow any
 *   ALLOWED_MODELS        comma separated; empty = allow any
 *   RATE_LIMIT_PER_MINUTE default 30 (per IP, best effort per instance)
 *   MAX_TOKENS            default 2000
 *   SITE_URL              sent to OpenRouter as HTTP-Referer
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/** Per-instance fixed-window counters. Best effort, resets on cold start. */
const minuteBuckets = new Map();

function readEnv(name, fallback = '') {
  try {
    if (typeof Netlify !== 'undefined' && Netlify?.env?.get) {
      const value = Netlify.env.get(name);
      if (value !== undefined && value !== null) return String(value);
    }
  } catch {
    /* Fall through to process.env for local tests. */
  }
  if (typeof process !== 'undefined' && process.env && process.env[name] !== undefined) {
    return String(process.env[name]);
  }
  return fallback;
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = splitList(readEnv('ALLOWED_ORIGINS'));

  let allowOrigin = '';
  if (!allowed.length) allowOrigin = '*';
  else if (origin && allowed.includes(origin)) allowOrigin = origin;
  else if (!origin) allowOrigin = allowed[0];

  const headers = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
  return headers;
}

function originAllowed(request) {
  const allowed = splitList(readEnv('ALLOWED_ORIGINS'));
  if (!allowed.length) return true;
  const origin = request.headers.get('Origin');
  if (!origin) return true; // curl / server-to-server
  return allowed.includes(origin);
}

function jsonResponse(payload, status, request) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request) }
  });
}

function fail(message, status, request) {
  return jsonResponse({ error: { message, type: 'proxy_error' } }, status, request);
}

function clientIp(request, context) {
  return (
    context?.ip ||
    request.headers.get('x-nf-client-connection-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

function overMinuteLimit(ip, limit) {
  if (!limit || limit <= 0) return false;
  const now = Date.now();
  const bucket = minuteBuckets.get(ip);

  if (!bucket || now - bucket.start >= 60_000) {
    minuteBuckets.set(ip, { start: now, count: 1 });
  } else {
    bucket.count += 1;
    if (bucket.count > limit) return true;
  }

  if (minuteBuckets.size > 5000) {
    for (const [key, value] of minuteBuckets) {
      if (now - value.start >= 120_000) minuteBuckets.delete(key);
    }
  }
  return false;
}

function sanitizePayload(payload) {
  const allowedModels = splitList(readEnv('ALLOWED_MODELS'));
  if (allowedModels.length && !allowedModels.includes(payload.model)) {
    return {
      error: `这个课堂只允许使用以下模型：${allowedModels.join(', ')}。请在设置里切换模型。`
    };
  }

  const maxTokens = Number(readEnv('MAX_TOKENS', '2000'));
  if (maxTokens > 0) {
    payload.max_tokens = Math.min(Number(payload.max_tokens) || maxTokens, maxTokens);
  }
  payload.stream = Boolean(payload.stream);
  return { payload };
}

export default async (request, context) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (!originAllowed(request)) {
    return fail('这个来源不允许使用课堂代理。', 403, request);
  }

  if (request.method === 'GET') {
    return jsonResponse(
      {
        ok: true,
        service: 'feynman-classroom-proxy',
        runtime: 'netlify-edge',
        model: readEnv('ALLOWED_MODELS') || undefined
      },
      200,
      request
    );
  }

  if (request.method !== 'POST') {
    return fail('请使用 POST 请求。', 405, request);
  }

  const upstreamKey = readEnv('UPSTREAM_KEY');
  if (!upstreamKey) {
    return fail('代理还没有配置 UPSTREAM_KEY，请在 Netlify 环境变量里设置。', 500, request);
  }

  const expectedCode = readEnv('ACCESS_CODE');
  if (expectedCode) {
    const provided = request.headers.get('x-access-code') || '';
    if (provided !== expectedCode) {
      return fail('访问码不正确，请向老师索取课堂访问码。', 401, request);
    }
  }

  const ip = clientIp(request, context);
  if (overMinuteLimit(ip, Number(readEnv('RATE_LIMIT_PER_MINUTE', '30')))) {
    return fail('请求太频繁了，请等一分钟再试。', 429, request);
  }

  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    return fail('请求内容不是合法的 JSON。', 400, request);
  }

  const checked = sanitizePayload(raw);
  if (checked.error) return fail(checked.error, 400, request);

  const upstreamBase = readEnv('UPSTREAM_BASE', 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  let upstream;
  try {
    upstream = await fetch(`${upstreamBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstreamKey}`,
        'HTTP-Referer': readEnv('SITE_URL', 'https://yanqing11.github.io/feynman-classroom/'),
        'X-Title': 'Feynman Classroom'
      },
      body: JSON.stringify(checked.payload)
    });
  } catch (error) {
    return fail(`代理无法连接模型服务：${error?.message || 'network error'}`, 502, request);
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);

  return new Response(upstream.body, { status: upstream.status, headers });
};

export const config = { path: '/v1/chat/completions' };
