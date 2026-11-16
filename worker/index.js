/**
 * Feynman Classroom · Cloudflare Worker proxy
 *
 * Holds the real model API key on the server so students can open the
 * published page and start learning without typing a key.
 *
 * Endpoints:
 *   GET  /health                → { ok: true }
 *   POST /v1/chat/completions   → streamed proxy to the upstream provider
 *
 * Environment (see wrangler.toml):
 *   UPSTREAM_KEY        secret, required  (e.g. OpenRouter key)
 *   UPSTREAM_BASE       var,    default https://openrouter.ai/api/v1
 *   ACCESS_CODE         secret, optional  (shared soft gate, sent as x-access-code)
 *   ALLOWED_ORIGINS     var,    comma separated, empty = allow any
 *   ALLOWED_MODELS      var,    comma separated, empty = allow any
 *   RATE_LIMIT_PER_MINUTE var,  default 30  (per IP, best effort per isolate)
 *   DAILY_LIMIT_PER_IP  var,    default 0   (0 = off, needs RATE_KV binding)
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/** Per-isolate fixed-window counters. Best effort, resets on cold start. */
const minuteBuckets = new Map();

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  let allowOrigin = '';
  if (!allowed.length) allowOrigin = '*';
  else if (origin && allowed.includes(origin)) allowOrigin = origin;
  else if (!origin) allowOrigin = allowed[0];
  else allowOrigin = '';

  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (!allowOrigin) delete headers['Access-Control-Allow-Origin'];
  return headers;
}

function originAllowed(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!allowed.length) return true;
  const origin = request.headers.get('Origin');
  // No Origin header: curl / server-to-server. Keep it working when a code is set.
  if (!origin) return true;
  return allowed.includes(origin);
}

function jsonResponse(payload, status, request, env) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env) }
  });
}

function fail(message, status, request, env) {
  return jsonResponse({ error: { message, type: 'proxy_error' } }, status, request, env);
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
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

async function overDailyLimit(ip, limit, env) {
  if (!limit || limit <= 0 || !env.RATE_KV) return false;
  const day = new Date().toISOString().slice(0, 10);
  const key = `quota:${day}:${ip}`;
  const current = Number((await env.RATE_KV.get(key)) || 0);
  if (current >= limit) return true;
  await env.RATE_KV.put(key, String(current + 1), { expirationTtl: 172800 });
  return false;
}

function readBody(request) {
  return request
    .clone()
    .json()
    .catch(() => null);
}

function sanitizePayload(payload, env) {
  const allowedModels = String(env.ALLOWED_MODELS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowedModels.length && !allowedModels.includes(payload.model)) {
    return {
      error: `这个课堂只允许使用以下模型：${allowedModels.join(', ')}。请在设置里切换模型。`
    };
  }

  const maxTokens = Number(env.MAX_TOKENS || 2000);
  if (maxTokens > 0) {
    payload.max_tokens = Math.min(Number(payload.max_tokens) || maxTokens, maxTokens);
  }
  payload.stream = Boolean(payload.stream);
  return { payload };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (!originAllowed(request, env)) {
      return fail('这个来源不允许使用课堂代理。', 403, request, env);
    }

    if (url.pathname === '/health' || url.pathname === '/') {
      return jsonResponse(
        {
          ok: true,
          service: 'feynman-classroom-proxy',
          upstream: String(env.UPSTREAM_BASE || 'https://openrouter.ai/api/v1'),
          model: String(env.ALLOWED_MODELS || '') || undefined
        },
        200,
        request,
        env
      );
    }

    if (!/\/chat\/completions\/?$/.test(url.pathname)) {
      return fail('只支持 POST /v1/chat/completions。', 404, request, env);
    }
    if (request.method !== 'POST') {
      return fail('请使用 POST 请求。', 405, request, env);
    }

    if (!env.UPSTREAM_KEY) {
      return fail('代理还没有配置 UPSTREAM_KEY，请运行 wrangler secret put UPSTREAM_KEY。', 500, request, env);
    }

    const expectedCode = String(env.ACCESS_CODE || '');
    if (expectedCode) {
      const provided = request.headers.get('x-access-code') || '';
      if (provided !== expectedCode) {
        return fail('访问码不正确，请向老师索取课堂访问码。', 401, request, env);
      }
    }

    const ip = clientIp(request);
    if (overMinuteLimit(ip, Number(env.RATE_LIMIT_PER_MINUTE || 30))) {
      return fail('请求太频繁了，请等一分钟再试。', 429, request, env);
    }
    if (await overDailyLimit(ip, Number(env.DAILY_LIMIT_PER_IP || 0), env)) {
      return fail('今天的课堂额度已经用完，请明天再来或联系老师。', 429, request, env);
    }

    const raw = await readBody(request);
    if (!raw || typeof raw !== 'object') {
      return fail('请求内容不是合法的 JSON。', 400, request, env);
    }

    const checked = sanitizePayload(raw, env);
    if (checked.error) return fail(checked.error, 400, request, env);

    const upstreamBase = String(env.UPSTREAM_BASE || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    let upstream;
    try {
      upstream = await fetch(`${upstreamBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.UPSTREAM_KEY}`,
          'HTTP-Referer': String(env.SITE_URL || 'https://yanqing11.github.io/feynman-classroom/'),
          'X-Title': 'Feynman Classroom'
        },
        body: JSON.stringify(checked.payload)
      });
    } catch (error) {
      return fail(`代理无法连接模型服务：${error?.message || 'network error'}`, 502, request, env);
    }

    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);

    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
