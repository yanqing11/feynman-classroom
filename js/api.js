/**
 * Minimal OpenAI-compatible chat client.
 * Calls go straight from the browser to the provider configured by the user.
 * The API key is read from localStorage-backed settings and never persisted anywhere else.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', details = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeBaseUrl(value) {
  const raw = (value || '').trim() || 'https://openrouter.ai/api/v1';
  return raw.replace(/\/+$/, '');
}

export function isAbortError(error) {
  return error && (error.name === 'AbortError' || error.code === 20 || /aborted/i.test(error.message || ''));
}

export function isConfigured(settings) {
  return Boolean((settings?.apiKey || '').trim() || (settings?.proxyUrl || '').trim());
}

function buildHeaders(settings) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${(settings.apiKey || '').trim()}`
  };
  if (/openrouter\.ai/i.test(settings.baseUrl || '')) {
    headers['HTTP-Referer'] = location.origin && location.origin !== 'null' ? location.origin : 'https://localhost';
    headers['X-Title'] = 'Feynman Classroom';
  }
  return headers;
}

/**
 * A configured classroom proxy (Cloudflare Worker) holds the real provider key.
 * In that mode the browser sends an optional access code and no Authorization header.
 */
function requestTarget(settings) {
  const proxyUrl = (settings?.proxyUrl || '').trim();
  if (proxyUrl) {
    const headers = { 'Content-Type': 'application/json' };
    const code = (settings.accessCode || '').trim();
    if (code) headers['x-access-code'] = code;
    return { url: `${normalizeBaseUrl(proxyUrl)}/chat/completions`, headers };
  }
  return {
    url: `${normalizeBaseUrl(settings?.baseUrl)}/chat/completions`,
    headers: buildHeaders(settings)
  };
}

function friendlyStatus(status) {
  if (status === 400) return '请求被模型拒绝了，可能是模型不支持图片或参数不合法。';
  if (status === 401) return 'API Key 无效或已过期，请到服务商后台检查。';
  if (status === 402) return '账户余额不足，请到服务商后台充值或换一个模型。';
  if (status === 403) return '这个 Key 没有访问该模型的权限，或所在地区被限制。';
  if (status === 404) return '找不到这个模型，请检查模型名称。';
  if (status === 413) return '图片或内容太大了，换一张小一点的图片再试。';
  if (status === 429) return '请求太频繁或额度用完了，等一会儿再试。';
  if (status >= 500) return '模型服务暂时不可用，请稍后再试。';
  return '请求失败。';
}

function providerHint(text) {
  const value = (text || '').toLowerCase();
  if (!value) return '';
  if (/not available in your region|not supported in your (country|region)|region.*restricted/.test(value)) {
    return '当前地区不支持这个模型。请换用 DeepSeek / Gemini 等模型，或改用课堂共享代理。';
  }
  if (/does not support image|image.*not supported|invalid.*image_url|vision.*not supported|no endpoints found.*(image|vision)/.test(value)) {
    return '这个模型不支持图片输入。请换用支持视觉的模型（如 Qwen3-VL、Mistral Small 3.2），或直接输入题目文字。';
  }
  if (/insufficient (quota|credit)|exceeded your current quota|credit balance/.test(value)) {
    return '账户额度不足，请到服务商后台充值或换一个模型。';
  }
  if (/no endpoints found|model not found|unknown model/.test(value)) {
    return '服务商找不到这个模型，请检查模型名称或改用预设模型。';
  }
  return '';
}

async function readError(response) {
  let body = '';
  let payload = null;
  try {
    body = await response.text();
    payload = body ? JSON.parse(body) : null;
  } catch {
    /* Non-JSON error body. */
  }
  const providerMessage =
    payload?.error?.message ||
    payload?.error?.metadata?.raw ||
    payload?.message ||
    (typeof payload?.error === 'string' ? payload.error : '') ||
    body.slice(0, 400);
  const code = payload?.error?.code || payload?.code || '';
  const hint = providerHint(providerMessage);
  const message = hint || (providerMessage ? `${friendlyStatus(response.status)} ${providerMessage}` : friendlyStatus(response.status));
  return new ApiError(message, { status: response.status, code, details: body.slice(0, 800) });
}

function networkError(error, settings) {
  if (isAbortError(error)) throw error;
  const usingProxy = Boolean((settings?.proxyUrl || '').trim());
  const message = usingProxy
    ? '连不上课堂共享代理。请检查网络，或确认当前网络能打开代理地址；也可以先在设置里填自己的 API Key 直连。'
    : '无法连接到模型服务。请检查网络、Base URL，以及服务商是否允许浏览器直连（CORS）。OpenRouter 通常可以直接连接。';
  return new ApiError(message, { details: error?.message || '' });
}

function createAbort(externalSignal, timeoutMs = 120000) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  };
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('');
  }
  return '';
}

export async function streamChat({
  settings,
  messages,
  maxTokens = 500,
  temperature = 0.7,
  signal,
  onDelta
}) {
  if (!isConfigured(settings)) throw new ApiError('还没有连接 AI：请先在设置里填写 API Key，或使用课堂共享代理。');

  const target = requestTarget(settings);
  const abort = createAbort(signal);
  let response;
  try {
    response = await fetch(target.url, {
      method: 'POST',
      headers: target.headers,
      signal: abort.signal,
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true
      })
    });
  } catch (error) {
    abort.cleanup();
    if (abort.didTimeOut()) throw new ApiError('模型响应超时，请稍后再试。');
    throw networkError(error, settings);
  }

  if (!response.ok) {
    abort.cleanup();
    throw await readError(response);
  }
  if (!response.body) {
    abort.cleanup();
    throw new ApiError('模型没有返回可读取的内容。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let finishReason = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        if (payload?.error) {
          throw new ApiError(payload.error.message || '模型返回了一个错误。', {
            code: payload.error.code || ''
          });
        }
        const choice = payload?.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = textFromContent(choice.delta?.content);
        if (delta) {
          fullText += delta;
          onDelta?.(delta, fullText);
        }
      }
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof ApiError) throw error;
    throw networkError(error, settings);
  } finally {
    abort.cleanup();
    try {
      reader.releaseLock();
    } catch {
      /* Ignore. */
    }
  }

  if (!fullText.trim()) {
    if (finishReason === 'content_filter') {
      throw new ApiError('模型拒绝了这个请求，请调整内容后再试。');
    }
    throw new ApiError('模型这次没有说出内容，请再发送一次。');
  }

  return fullText.trim();
}

export async function completeChat({
  settings,
  messages,
  maxTokens = 1200,
  temperature = 0.4,
  jsonMode = false,
  signal
}) {
  if (!isConfigured(settings)) throw new ApiError('还没有连接 AI：请先在设置里填写 API Key，或使用课堂共享代理。');

  const target = requestTarget(settings);
  const request = async (useJsonMode) => {
    const abort = createAbort(signal);
    let response;
    try {
      response = await fetch(target.url, {
        method: 'POST',
        headers: target.headers,
        signal: abort.signal,
        body: JSON.stringify({
          model: settings.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false,
          ...(useJsonMode ? { response_format: { type: 'json_object' } } : {})
        })
      });
    } catch (error) {
      abort.cleanup();
      if (abort.didTimeOut()) throw new ApiError('模型响应超时，请稍后再试。');
      throw networkError(error, settings);
    }

    if (!response.ok) {
      abort.cleanup();
      throw await readError(response);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      abort.cleanup();
      throw new ApiError('模型返回的内容无法解析，请再试一次。', { details: error?.message || '' });
    }
    abort.cleanup();

    if (payload?.error) {
      throw new ApiError(payload.error.message || '模型返回了一个错误。');
    }
    const text = textFromContent(payload?.choices?.[0]?.message?.content);
    if (!text.trim()) throw new ApiError('模型这次没有返回内容，请再试一次。');
    return text.trim();
  };

  if (jsonMode) {
    try {
      return await request(true);
    } catch (error) {
      // Some OpenAI-compatible providers do not implement response_format.
      if (error instanceof ApiError && (error.status === 400 || error.status === 422)) {
        return request(false);
      }
      throw error;
    }
  }
  return request(false);
}

export async function testConnection(settings) {
  if (!isConfigured(settings)) throw new ApiError('请先填写 API Key，或配置课堂共享代理。');
  if (!settings?.model) throw new ApiError('请先填写模型名称。');

  const started = performance.now();
  const reply = await completeChat({
    settings,
    messages: [
      { role: 'system', content: 'You are a connection test. Reply with exactly: OK' },
      { role: 'user', content: 'Reply with OK.' }
    ],
    maxTokens: 8,
    temperature: 0,
    jsonMode: false
  });
  return {
    latency: Math.round(performance.now() - started),
    model: settings.model,
    reply: reply.slice(0, 40)
  };
}

const PROBLEM_MAX_CHARS = 1200;

/**
 * Turns a photo of a math problem into editable text so a session can start
 * with an image only. Requires a vision-capable model.
 */
export async function recognizeProblem({ settings, image, signal }) {
  if (!image) throw new ApiError('没有可识别的题目图片。');

  const text = await completeChat({
    settings,
    signal,
    messages: [
      {
        role: 'system',
        content: [
          '你是一个数学题目转写器。',
          '把图片里的题目完整转写成可以编辑的文字：保留题号、已知条件、问题、选项、单位与图形描述。',
          '公式用普通数学符号或 LaTeX 表示，例如 x^2 - 4x + 3 = 0。',
          '只输出题目本身：不要解答，不要点评，不要解释，不要使用代码块。',
          '如果图片里没有数学题目，只输出 NO_PROBLEM。'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请把这张图片里的题目完整转写成文字。' },
          { type: 'image_url', image_url: { url: image } }
        ]
      }
    ],
    maxTokens: 800,
    temperature: 0
  });

  const cleaned = text
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '')
    .replace(/^(题目|原题)\s*[:：]\s*/, '')
    .trim();

  if (!cleaned || /^NO_PROBLEM$/i.test(cleaned)) {
    throw new ApiError('没能从图片里认出数学题目，请换一张更清晰的照片，或直接把题目打出来。');
  }
  return cleaned.slice(0, PROBLEM_MAX_CHARS);
}
