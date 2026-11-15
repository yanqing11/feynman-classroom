/**
 * 自定义题库：文字录入和图片识题保存的题目都放在本机。
 *
 * 优先使用 IndexedDB；浏览器禁用或空间不足时退回 localStorage。
 * 图片以 data URL 保存，不会上传服务器。
 */

import { APP, normalizeTags, subjectInfo } from './config.js';

const DB_NAME = 'feynman-classroom';
const DB_VERSION = 1;
const STORE_NAME = 'questions';
const MAX_QUESTIONS = 300;

let dbPromise = null;

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('subject', 'subject');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function readFallback() {
  try {
    const raw = JSON.parse(localStorage.getItem(APP.storage.bank) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeFallback(items) {
  try {
    localStorage.setItem(APP.storage.bank, JSON.stringify(items));
  } catch {
    throw new Error('本机存储空间不足，题库没有保存成功。可以先导出备份，再删除一些题目。');
  }
}

function sanitizeImage(value) {
  if (typeof value !== 'string') return '';
  const image = value.trim();
  if (!image) return '';
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(image) ? image : '';
}

function normalizeQuestion(input) {
  const now = new Date().toISOString();
  const topic = typeof input?.topic === 'string' ? input.topic.trim().slice(0, APP.limits.maxTopicChars) : '';
  return {
    id: input?.id || newId(),
    topic,
    subject: subjectInfo(input?.subject) ? input.subject : 'junior',
    difficulty: ['basic', 'medium', 'hard'].includes(input?.difficulty) ? input.difficulty : 'medium',
    tags: normalizeTags(input?.tags),
    note: typeof input?.note === 'string' ? input.note.trim().slice(0, 1200) : '',
    image: sanitizeImage(input?.image),
    source: ['builtin', 'ocr'].includes(input?.source) ? input.source : 'custom',
    createdAt: input?.createdAt || now,
    updatedAt: now
  };
}

export function questionKey(item) {
  const subject = subjectInfo(item?.subject) ? item.subject : 'junior';
  const topic = typeof item?.topic === 'string' ? item.topic : '';
  return `${subject}|${topic.replace(/\s+/g, '').replace(/[，。！？、；：,.!?;:]/g, '').toLowerCase()}`;
}

function sortItems(items) {
  return items
    .filter((item) => item && typeof item.topic === 'string' && item.topic.trim())
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function idbAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
  });
}

async function idbPut(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(item);
    transaction.oncomplete = () => resolve(item);
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed'));
  });
}

async function idbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB delete failed'));
  });
}

export async function listQuestions() {
  try {
    return sortItems(await idbAll());
  } catch {
    return sortItems(readFallback());
  }
}

export async function getQuestion(id) {
  const items = await listQuestions();
  return items.find((item) => item.id === id) || null;
}

export async function saveQuestion(input) {
  const item = normalizeQuestion(input);
  try {
    const all = await idbAll();
    if (!input?.id && all.length >= MAX_QUESTIONS) {
      const keep = new Set(sortItems(all).slice(0, MAX_QUESTIONS - 1).map((entry) => entry.id));
      for (const entry of all) {
        if (!keep.has(entry.id)) await idbDelete(entry.id);
      }
    }
    return await idbPut(item);
  } catch {
    const items = readFallback().filter((entry) => entry.id !== item.id);
    items.unshift(item);
    writeFallback(items.slice(0, MAX_QUESTIONS));
    return item;
  }
}

export async function deleteQuestion(id) {
  try {
    await idbDelete(id);
  } catch {
    const items = readFallback().filter((entry) => entry.id !== id);
    writeFallback(items);
  }
}

export function buildQuestionsExport(items) {
  const questions = (Array.isArray(items) ? items : []).map((item) => ({
    key: questionKey(item),
    topic: typeof item?.topic === 'string' ? item.topic : '',
    subject: subjectInfo(item?.subject) ? item.subject : 'junior',
    difficulty: ['basic', 'medium', 'hard'].includes(item?.difficulty) ? item.difficulty : 'medium',
    tags: normalizeTags(item?.tags),
    note: typeof item?.note === 'string' ? item.note : '',
    image: sanitizeImage(item?.image),
    source: ['builtin', 'ocr'].includes(item?.source) ? item.source : 'custom',
    createdAt: item?.createdAt || new Date().toISOString()
  }));
  return {
    app: 'feynman-classroom',
    kind: 'question-bank',
    version: 1,
    exportedAt: new Date().toISOString(),
    count: questions.length,
    questions
  };
}

export async function importQuestions(payload) {
  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.questions)
      ? payload.questions
      : null;
  if (!rawList) throw new Error('文件格式不对：需要包含 questions 数组。');

  const existing = await listQuestions();
  const seen = new Set(existing.map((item) => questionKey(item)));
  const room = Math.max(0, MAX_QUESTIONS - existing.length);
  let added = 0;
  let skipped = 0;
  let invalid = 0;
  let limited = 0;

  for (const raw of rawList) {
    if (!raw || typeof raw.topic !== 'string' || !raw.topic.trim()) {
      invalid += 1;
      continue;
    }
    const key = questionKey(raw);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    if (added >= room) {
      limited += 1;
      continue;
    }
    const item = normalizeQuestion({ ...raw, id: undefined });
    if (!item.topic) {
      invalid += 1;
      continue;
    }
    await saveQuestion(item);
    seen.add(key);
    added += 1;
  }

  return {
    added,
    skipped,
    invalid,
    limited,
    total: existing.length + added,
    max: MAX_QUESTIONS
  };
}
