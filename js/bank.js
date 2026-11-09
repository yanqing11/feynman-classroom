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
  localStorage.setItem(APP.storage.bank, JSON.stringify(items));
}

function normalizeQuestion(input) {
  const now = new Date().toISOString();
  const topic = typeof input?.topic === 'string' ? input.topic.trim() : '';
  return {
    id: input?.id || newId(),
    topic,
    subject: subjectInfo(input?.subject) ? input.subject : 'junior',
    difficulty: ['basic', 'medium', 'hard'].includes(input?.difficulty) ? input.difficulty : 'medium',
    tags: normalizeTags(input?.tags),
    note: typeof input?.note === 'string' ? input.note.trim().slice(0, 1200) : '',
    image: typeof input?.image === 'string' ? input.image : '',
    source: input?.source === 'ocr' ? 'ocr' : 'custom',
    createdAt: input?.createdAt || now,
    updatedAt: now
  };
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
