import {
  APP,
  DIFFICULTIES,
  INTENSITIES,
  PERSONAS,
  SOURCES,
  STUDENT_MODES,
  SUBJECT_KEYS,
  kickoffMessage,
  normalizeTags
} from './config.js';

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

const SUBJECT_KEYS_SET = new Set(SUBJECT_KEYS);
const DIFFICULTY_KEYS = new Set(DIFFICULTIES.map((item) => item.key));
const SOURCE_KEYS = new Set(Object.keys(SOURCES));
const PERSONA_KEYS = new Set(PERSONAS.map((item) => item.key));
const MODE_KEYS = new Set(STUDENT_MODES.map((item) => item.key));
const INTENSITY_KEYS = new Set(INTENSITIES.map((item) => item.key));

const PRACTICE_DEFAULT = {
  subject: 'junior',
  difficulty: 'medium',
  persona: 'curious',
  mode: 'real',
  intensity: 'normal',
  lockSubject: true
};

function pick(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

export function loadPractice() {
  const stored = safeParse(localStorage.getItem(APP.storage.practice)) || {};
  return {
    subject: pick(stored.subject, SUBJECT_KEYS_SET, PRACTICE_DEFAULT.subject),
    difficulty: pick(stored.difficulty, DIFFICULTY_KEYS, PRACTICE_DEFAULT.difficulty),
    persona: pick(stored.persona, PERSONA_KEYS, PRACTICE_DEFAULT.persona),
    mode: pick(stored.mode, MODE_KEYS, PRACTICE_DEFAULT.mode),
    intensity: pick(stored.intensity, INTENSITY_KEYS, PRACTICE_DEFAULT.intensity),
    lockSubject:
      typeof stored.lockSubject === 'boolean' ? stored.lockSubject : PRACTICE_DEFAULT.lockSubject
  };
}

export function savePractice(practice) {
  const merged = { ...loadPractice(), ...practice };
  const normalized = {
    subject: pick(merged.subject, SUBJECT_KEYS_SET, PRACTICE_DEFAULT.subject),
    difficulty: pick(merged.difficulty, DIFFICULTY_KEYS, PRACTICE_DEFAULT.difficulty),
    persona: pick(merged.persona, PERSONA_KEYS, PRACTICE_DEFAULT.persona),
    mode: pick(merged.mode, MODE_KEYS, PRACTICE_DEFAULT.mode),
    intensity: pick(merged.intensity, INTENSITY_KEYS, PRACTICE_DEFAULT.intensity),
    lockSubject: Boolean(merged.lockSubject)
  };
  try {
    localStorage.setItem(APP.storage.practice, JSON.stringify(normalized));
  } catch {
    /* Storage may be blocked; the in-memory value is still correct. */
  }
  return normalized;
}

function randomPersona() {
  return PERSONAS[Math.floor(Math.random() * PERSONAS.length)].key;
}

export function loadSettings() {
  const stored = safeParse(localStorage.getItem(APP.storage.settings)) || {};
  const storedProxy = typeof stored.proxyUrl === 'string' ? stored.proxyUrl.trim() : '';
  const retired = (APP.defaults.retiredProxyUrls || []).map((url) => url.replace(/\/+$/, ''));
  const proxyIsRetired = retired.includes(storedProxy.replace(/\/+$/, ''));
  const settings = {
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
        : APP.defaults.temperature,
    proxyUrl: storedProxy && !proxyIsRetired ? storedProxy : (APP.defaults.proxyUrl || ''),
    accessCode:
      typeof stored.accessCode === 'string' && stored.accessCode.trim()
        ? stored.accessCode.trim()
        : (APP.defaults.accessCode || '')
  };

  if (proxyIsRetired) {
    stored.proxyUrl = settings.proxyUrl;
    try {
      localStorage.setItem(APP.storage.settings, JSON.stringify(stored));
    } catch {
      /* Storage may be full or blocked; the in-memory value is still correct. */
    }
  }

  return settings;
}

export function saveSettings(settings) {
  const normalized = {
    apiKey: (settings.apiKey || '').trim(),
    baseUrl: (settings.baseUrl || APP.defaults.baseUrl).trim().replace(/\/+$/, ''),
    model: (settings.model || APP.defaults.model).trim(),
    temperature: Math.max(0, Math.min(1.2, Number(settings.temperature) || 0)),
    proxyUrl: (settings.proxyUrl || '').trim().replace(/\/+$/, ''),
    accessCode: (settings.accessCode || '').trim()
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

function createSession(topic, topicImage, meta = {}) {
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
    subject: pick(meta.subject, SUBJECT_KEYS_SET, PRACTICE_DEFAULT.subject),
    difficulty: pick(meta.difficulty, DIFFICULTY_KEYS, PRACTICE_DEFAULT.difficulty),
    tags: normalizeTags(meta.tags),
    source: pick(meta.source, SOURCE_KEYS, 'builtin'),
    studentPersona: pick(meta.studentPersona ?? meta.persona, PERSONA_KEYS, randomPersona()),
    studentMode: pick(meta.studentMode, MODE_KEYS, PRACTICE_DEFAULT.mode),
    studentIntensity: pick(meta.studentIntensity, INTENSITY_KEYS, PRACTICE_DEFAULT.intensity),
    createdAt: now,
    updatedAt: now,
    hasTeacherSpeak: false,
    messages: [kickoff],
    report: null
  };
}

function restoreSession() {
  const stored = safeParse(localStorage.getItem(APP.storage.session));
  if (!stored || typeof stored !== 'object' || !stored.topic || !Array.isArray(stored.messages)) {
    return null;
  }
  const messages = stored.messages
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .filter((message) => (typeof message.content === 'string' && message.content.trim()) || message.images?.length)
    .map((message) => ({
      id: message.id || newId(),
      role: message.role,
      content: typeof message.content === 'string' ? message.content : '',
      images: Array.isArray(message.images) ? message.images.slice(0, APP.limits.maxImages) : [],
      hidden: Boolean(message.hidden),
      createdAt: message.createdAt || new Date().toISOString()
    }));
  const hasVisibleTeacherMessage = messages.some(
    (message) => message.role === 'user' && !message.hidden
  );

  return {
    id: typeof stored.id === 'string' ? stored.id : newId(),
    topic: String(stored.topic).slice(0, APP.limits.maxTopicChars),
    subject: pick(stored.subject, SUBJECT_KEYS_SET, PRACTICE_DEFAULT.subject),
    difficulty: pick(stored.difficulty, DIFFICULTY_KEYS, PRACTICE_DEFAULT.difficulty),
    tags: normalizeTags(stored.tags),
    source: pick(stored.source, SOURCE_KEYS, 'builtin'),
    studentPersona: pick(stored.studentPersona, PERSONA_KEYS, randomPersona()),
    studentMode: pick(stored.studentMode, MODE_KEYS, PRACTICE_DEFAULT.mode),
    studentIntensity: pick(stored.studentIntensity, INTENSITY_KEYS, PRACTICE_DEFAULT.intensity),
    createdAt: stored.createdAt || new Date().toISOString(),
    updatedAt: stored.updatedAt || new Date().toISOString(),
    hasTeacherSpeak: Boolean(stored.hasTeacherSpeak) || hasVisibleTeacherMessage,
    messages,
    report: stored.report && typeof stored.report === 'object' ? stored.report : null
  };
}

export class ClassroomStore {
  constructor() {
    const session = restoreSession();
    this.settings = loadSettings();
    this.practice = loadPractice();
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

  get hasTeacherSpeak() {
    return Boolean(this.session?.hasTeacherSpeak);
  }

  start(topic, topicImage, meta = {}) {
    if (!this.canTransition(STATUS.TEACHING)) return;
    this.state.session = createSession(topic, topicImage, {
      ...this.practice,
      ...meta
    });
    this.state.status = STATUS.TEACHING;
    this.persist();
    this.emit();
  }

  updatePractice(practice) {
    this.practice = savePractice({ ...this.practice, ...practice });
    this.emit();
  }

  updateSessionMeta(patch = {}) {
    const session = this.session;
    if (!session) return;
    if (patch.subject != null) {
      session.subject = pick(patch.subject, SUBJECT_KEYS_SET, session.subject);
    }
    if (patch.difficulty != null) {
      session.difficulty = pick(patch.difficulty, DIFFICULTY_KEYS, session.difficulty);
    }
    if (patch.tags != null) session.tags = normalizeTags(patch.tags);
    if (patch.source != null) session.source = pick(patch.source, SOURCE_KEYS, session.source);
    if (patch.studentPersona != null) {
      session.studentPersona = pick(patch.studentPersona, PERSONA_KEYS, session.studentPersona);
    }
    if (patch.studentMode != null) {
      session.studentMode = pick(patch.studentMode, MODE_KEYS, session.studentMode);
    }
    if (patch.studentIntensity != null) {
      session.studentIntensity = pick(
        patch.studentIntensity,
        INTENSITY_KEYS,
        session.studentIntensity
      );
    }
    this.touch();
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
    if (role === 'user') this.session.hasTeacherSpeak = true;
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
