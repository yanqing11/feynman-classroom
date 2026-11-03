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

function friendlyStatus(status) {
  if (status === 401) return 'API Key 无效或已过期，请到服务商后台检查。';
  if (status === 402) return '账户余额不足，请到服务商后台充值或换一个模型。';
  if (status === 403) return '这个 Key 没有访问该模型的权限，或所在地区被限制。';
  if (status === 404) return '找不到这个模型，请检查模型名称。';
  if (status === 429) return '请求太频繁或额度用完了，等一会儿再试。';
  if (status >= 500) return '模型服务暂时不可用，请稍后再试。';
  return '请求失败。';
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
  const message = providerMessage
    ? `${friendlyStatus(response.status)} ${providerMessage}`
    : friendlyStatus(response.status);
  return new ApiError(message, { status: response.status, code, details: body.slice(0, 800) });
}

function networkError(error) {
  if (isAbortError(error)) throw error;
  return new ApiError(
    '无法连接到模型服务。请检查网络、Base URL，以及服务商是否允许浏览器直连（CORS）。OpenRouter 通常可以直接连接。',
    { details: error?.message || '' }
  );
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
  if (!settings?.apiKey) throw new ApiError('还没有填写 API Key，请先在设置里连接 AI。');

  const abort = createAbort(signal);
  let response;
  try {
    response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(settings),
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
    throw networkError(error);
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
    throw networkError(error);
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
  if (!settings?.apiKey) throw new ApiError('还没有填写 API Key，请先在设置里连接 AI。');

  const request = async (useJsonMode) => {
    const abort = createAbort(signal);
    let response;
    try {
      response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(settings),
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
      throw networkError(error);
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
  if (!settings?.apiKey) throw new ApiError('请先填写 API Key。');
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
