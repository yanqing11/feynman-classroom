/**
 * 本机数据库（IndexedDB）：费曼小课堂的唯一持久化数据库。
 *
 * 数据库名 feynman-classroom，版本 2，包含五张对象仓库：
 *   questions  自定义题库（题 ID 为主键）
 *   history    学习档案（记录 ID 为主键）
 *   sessions   当前课堂（会话 ID 为主键）
 *   drafts     草稿板（键为固定字符串）
 *   kv         设置、课堂参数、一次性标记等小数据
 *
 * 浏览器禁用 IndexedDB 时所有方法安全降级为空结果，调用方继续用
 * localStorage 回退，不会中断课堂。
 */

import { APP } from './config.js';

export const DB_NAME = 'feynman-classroom';
export const DB_VERSION = 2;
export const STORES = Object.freeze(['questions', 'history', 'sessions', 'drafts', 'kv']);

const MIGRATION_KEY = 'migration:v1';
export const DRAFT_KEY = 'draft';

let dbPromise = null;

export function isDatabaseAvailable() {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('数据库读取失败'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('数据库写入失败'));
    transaction.onabort = () => reject(transaction.error || new Error('数据库写入被中止'));
  });
}

/** 打开（并在首次使用时升级）数据库。整个应用共享同一个连接。 */
export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!isDatabaseAvailable()) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('questions')) {
        const questions = db.createObjectStore('questions', { keyPath: 'id' });
        questions.createIndex('updatedAt', 'updatedAt');
        questions.createIndex('subject', 'subject');
      }
      if (!db.objectStoreNames.contains('history')) {
        const history = db.createObjectStore('history', { keyPath: 'id' });
        history.createIndex('endedAt', 'endedAt');
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('数据库打开失败'));
    request.onblocked = () => reject(new Error('数据库被其他标签页占用'));
  });
  return dbPromise;
}

async function withStore(name, mode, action) {
  const db = await openDatabase();
  const transaction = db.transaction(name, mode);
  const value = action(transaction.objectStore(name));
  await transactionDone(transaction);
  return value;
}

export async function dbGet(store, key) {
  try {
    return await withStore(store, 'readonly', (objectStore) => requestResult(objectStore.get(key)));
  } catch {
    return null;
  }
}

export async function dbGetAll(store, { strict = false } = {}) {
  try {
    const result = await withStore(store, 'readonly', (objectStore) => requestResult(objectStore.getAll()));
    return Array.isArray(result) ? result : [];
  } catch (error) {
    if (strict) throw error;
    return [];
  }
}

export async function dbPut(store, value, { strict = false } = {}) {
  try {
    await withStore(store, 'readwrite', (objectStore) => objectStore.put(value));
    return true;
  } catch (error) {
    if (strict) throw error;
    return false;
  }
}

export async function dbPutMany(store, values) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return true;
  try {
    const db = await openDatabase();
    const transaction = db.transaction(store, 'readwrite');
    const objectStore = transaction.objectStore(store);
    for (const value of list) objectStore.put(value);
    await transactionDone(transaction);
    return true;
  } catch {
    return false;
  }
}

export async function dbDelete(store, key, { strict = false } = {}) {
  try {
    await withStore(store, 'readwrite', (objectStore) => objectStore.delete(key));
    return true;
  } catch (error) {
    if (strict) throw error;
    return false;
  }
}

export async function dbClear(store) {
  try {
    await withStore(store, 'readwrite', (objectStore) => objectStore.clear());
    return true;
  } catch {
    return false;
  }
}

export async function dbCount(store) {
  try {
    return await withStore(store, 'readonly', (objectStore) => requestResult(objectStore.count()));
  } catch {
    return 0;
  }
}

/** 供设置界面显示数据库状态。 */
export async function getDatabaseStats() {
  if (!isDatabaseAvailable()) return { available: false, name: DB_NAME, version: 0, counts: {} };
  try {
    const db = await openDatabase();
    const counts = {};
    for (const store of STORES) counts[store] = await dbCount(store);
    return { available: true, name: DB_NAME, version: db.version, counts };
  } catch {
    return { available: false, name: DB_NAME, version: 0, counts: {} };
  }
}

/**
 * 把旧版 localStorage 数据一次性搬进数据库。已经存在的记录不会被覆盖，
 * 因此用户清掉数据库但保留 localStorage 时仍可恢复；迁移标记写在 kv 表。
 */
export async function migrateLocalData() {
  if (!isDatabaseAvailable()) return { migrated: false, reason: 'unavailable' };
  try {
    if (await dbGet('kv', MIGRATION_KEY)) return { migrated: false, reason: 'already' };

    const summary = {
      bank: 0,
      history: 0,
      sessions: 0,
      drafts: 0,
      settings: 0,
      practice: 0,
      welcomed: 0,
      onboarding: 0,
      storageNotice: 0
    };

    const bank = safeParse(localStorage.getItem(APP.storage.bank));
    if (Array.isArray(bank)) {
      for (const item of bank) {
        if (!item || typeof item.id !== 'string' || !item.id) continue;
        if (await dbGet('questions', item.id)) continue;
        if (await dbPut('questions', item)) summary.bank += 1;
      }
    }

    const history = safeParse(localStorage.getItem(APP.storage.history));
    if (Array.isArray(history)) {
      for (const record of history) {
        if (!record || typeof record.id !== 'string' || !record.id) continue;
        if (await dbGet('history', record.id)) continue;
        if (await dbPut('history', record)) summary.history += 1;
      }
    }

    const session = safeParse(localStorage.getItem(APP.storage.session));
    if (session && typeof session.id === 'string' && Array.isArray(session.messages)) {
      if (!(await dbGet('sessions', session.id)) && (await dbPut('sessions', session))) {
        summary.sessions += 1;
      }
    }

    const draft = safeParse(localStorage.getItem(APP.storage.draft));
    if (draft && typeof draft === 'object') {
      if (!(await dbGet('drafts', DRAFT_KEY)) && (await dbPut('drafts', { key: DRAFT_KEY, value: draft }))) {
        summary.drafts += 1;
      }
    }

    const smallData = {
      settings: APP.storage.settings,
      practice: APP.storage.practice,
      welcomed: APP.storage.welcomed,
      onboarding: APP.storage.onboarding,
      storageNotice: APP.storage.storageNotice
    };
    for (const [key, storageKey] of Object.entries(smallData)) {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) continue;
      if (await dbGet('kv', key)) continue;
      if (await dbPut('kv', { key, value: safeParse(raw) ?? raw })) summary[key] += 1;
    }

    await dbPut('kv', { key: MIGRATION_KEY, value: new Date().toISOString() });
    return { migrated: true, summary };
  } catch {
    return { migrated: false, reason: 'error' };
  }
}
