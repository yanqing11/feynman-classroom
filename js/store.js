import { APP, kickoffMessage } from './config.js';

export const STATUS = Object.freeze({
  HOME: 'home',
  TEACHING: 'teaching',
  EVALUATING: 'evaluating',
  REPORT: 'report'
});

const ALLOWED = {
  home: [STATUS.TEACHING],
  teaching: [STATUS.EVALUATING, STATUS.HOME],
  evaluating: [STATUS.REPORT, STATUS.TEACHING],
  report: [STATUS.TEACHING, STATUS.HOME]
};

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function loadSettings() {
  const stored = safeParse(localStorage.getItem(APP.storage.settings)) || {};
  return {
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
    baseUrl:
      typeof stored.baseUrl === 'string' && stored.baseUrl.trim()
        ? stored.baseUrl.trim()
        : APP.defaults.baseUrl,
    model:
      typeof stored.model === 'string' && stored.model.trim()
        ? stored.model.trim()
        : APP.defaults.model,
    temperature:
      Number.isFinite(Number(stored.temperature)) && Number(stored.temperature) >= 0
        ? Math.min(1.2, Number(stored.temperature))
        : APP.defaults.temperature
  };
}

export function saveSettings(settings) {
  const normalized = {
    apiKey: (settings.apiKey || '').trim(),
    baseUrl: (settings.baseUrl || APP.defaults.baseUrl).trim().replace(/\/+$/, ''),
    model: (settings.model || APP.defaults.model).trim(),
    temperature: Math.max(0, Math.min(1.2, Number(settings.temperature) || 0))
  };
  localStorage.setItem(APP.storage.settings, JSON.stringify(normalized));
  return normalized;
}

export function clearSettings() {
  localStorage.removeItem(APP.storage.settings);
}

export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 10) return '••••';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function createSession(topic, topicImage) {
  const now = new Date().toISOString();
  const kickoff = {
    id: newId(),
    role: 'user',
    content: kickoffMessage(topic),
    images: topicImage ? [topicImage] : [],
    hidden: true,
    createdAt: now
  };
  return {
    id: newId(),
    topic,
    createdAt: now,
    updatedAt: now,
    messages: [kickoff],
    report: null
  };
}

function restoreSession() {
  const stored = safeParse(localStorage.getItem(APP.storage.session));
  if (!stored || typeof stored !== 'object' || !stored.topic || !Array.isArray(stored.messages)) {
    return null;
  }
  return {
    id: typeof stored.id === 'string' ? stored.id : newId(),
    topic: String(stored.topic).slice(0, APP.limits.maxTopicChars),
    createdAt: stored.createdAt || new Date().toISOString(),
    updatedAt: stored.updatedAt || new Date().toISOString(),
    messages: stored.messages
      .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
      .filter((message) => (typeof message.content === 'string' && message.content.trim()) || message.images?.length)
      .map((message) => ({
        id: message.id || newId(),
        role: message.role,
        content: typeof message.content === 'string' ? message.content : '',
        images: Array.isArray(message.images) ? message.images.slice(0, APP.limits.maxImages) : [],
        hidden: Boolean(message.hidden),
        createdAt: message.createdAt || new Date().toISOString()
      })),
    report: stored.report && typeof stored.report === 'object' ? stored.report : null
  };
}

export class ClassroomStore {
  constructor() {
    const session = restoreSession();
    this.settings = loadSettings();
    this.busy = false;
    this.listeners = new Set();
    this.persistenceWarning = '';
    this.state = {
      status: session ? STATUS.TEACHING : STATUS.HOME,
      session
    };
    this.restored = Boolean(session);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  canTransition(next) {
    const allowed = ALLOWED[this.state.status] || [];
    return this.state.status === next || allowed.includes(next);
  }

  setStatus(next) {
    if (!this.canTransition(next)) {
      console.warn(`[Feynman] Illegal state transition: ${this.state.status} → ${next}`);
      return;
    }
    this.state.status = next;
    this.emit();
  }

  setBusy(busy) {
    this.busy = Boolean(busy);
    this.emit();
  }

  get session() {
    return this.state.session;
  }

  start(topic, topicImage) {
    if (!this.canTransition(STATUS.TEACHING)) return;
    this.state.session = createSession(topic, topicImage);
    this.state.status = STATUS.TEACHING;
    this.persist();
    this.emit();
  }

  updateSettings(settings) {
    this.settings = saveSettings(settings);
    this.emit();
  }

  addMessage(role, content, images = []) {
    if (!this.session) return null;
    const message = {
      id: newId(),
      role,
      content,
      images: images.slice(0, APP.limits.maxImages),
      hidden: false,
      createdAt: new Date().toISOString()
    };
    this.session.messages.push(message);
    this.touch();
    return message;
  }

  appendToMessage(id, delta, { persist = false } = {}) {
    const message = this.session?.messages.find((item) => item.id === id);
    if (!message) return;
    message.content += delta;
    if (persist) this.touch();
  }

  removeMessage(id) {
    if (!this.session) return;
    this.session.messages = this.session.messages.filter((message) => message.id !== id);
    this.touch();
  }

  setReport(report) {
    if (!this.session) return;
    this.session.report = report;
    this.touch();
  }

  touch() {
    if (this.session) this.session.updatedAt = new Date().toISOString();
    this.persist();
    this.emit();
  }

  persist() {
    if (!this.session) {
      localStorage.removeItem(APP.storage.session);
      return;
    }
    try {
      localStorage.setItem(APP.storage.session, JSON.stringify(this.session));
      this.persistenceWarning = '';
    } catch {
      // Images can exceed the localStorage quota. Keep the words, drop the pictures.
      try {
        const lean = {
          ...this.session,
          messages: this.session.messages.map((message) => ({ ...message, images: [] }))
        };
        localStorage.setItem(APP.storage.session, JSON.stringify(lean));
        this.persistenceWarning = '浏览器存储空间不足，图片没有随对话保存（文字已保存）。';
      } catch {
        this.persistenceWarning = '浏览器存储空间不足，本次对话无法自动保存。';
        try {
          localStorage.removeItem(APP.storage.session);
        } catch {
          /* Ignore. */
        }
      }
    }
  }

  end() {
    this.state.session = null;
    this.state.status = STATUS.HOME;
    this.busy = false;
    try {
      localStorage.removeItem(APP.storage.session);
    } catch {
      /* Ignore. */
    }
    this.emit();
  }
}
