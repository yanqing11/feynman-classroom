/**
 * 学习档案：把每次讲课的主题、轮数和诊断报告存进浏览器，
 * 用来做跨课时的长期学情追踪。
 *
 * 数据只保存在本机 localStorage，不上传服务器；不保存图片。
 */

import {
  APP,
  METRICS,
  SUBJECT_LIST,
  difficultyInfo,
  normalizeTags,
  sourceInfo,
  subjectInfo
} from './config.js';
import { dbClear, dbDelete, dbGetAll, dbPutMany } from './db.js';

const MAX_RECORDS = 60;
const MAX_MESSAGE_CHARS = 8000;
const MAX_STORAGE_CHARS = 1_800_000;

// 同步读取仍来自内存缓存；IndexedDB 只在写入和水合时访问。
let historyCache = null;

function normalizeRecords(value) {
  return (Array.isArray(value) ? value : [])
    .filter((record) => record && typeof record.topic === 'string' && record.topic.trim())
    .sort((a, b) => String(b.endedAt || '').localeCompare(String(a.endedAt || '')));
}

function readHistory() {
  if (historyCache) return historyCache;
  historyCache = normalizeRecords(safeParse(localStorage.getItem(APP.storage.history)));
  return historyCache;
}

function snapshotHistory() {
  return readHistory().map((record) => ({ ...record }));
}

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function notifyStorageIssue(level, message) {
  try {
    window.dispatchEvent(
      new CustomEvent('feynman:storage-warning', {
        detail: { source: 'history', level, message }
      })
    );
  } catch {
    /* Events are best-effort; saving must continue. */
  }
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return null;
  return round(numbers.reduce((total, value) => total + value, 0) / numbers.length);
}

function pad(number) {
  return String(number).padStart(2, '0');
}

/** 用本地日期做聚合键，避免跨时区时“今天”被算到另一天。 */
function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function validDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function trimMessages(messages) {
  const visible = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && !message.hidden && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => ({
      role: message.role,
      content: typeof message.content === 'string' ? message.content.trim() : ''
    }))
    .filter((message) => message.content);

  const kept = [];
  let total = 0;
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index];
    if (total + message.content.length > MAX_MESSAGE_CHARS) break;
    kept.unshift(message);
    total += message.content.length;
  }
  return kept;
}

function sanitizeStuckPoints(points) {
  return (Array.isArray(points) ? points : [])
    .slice(-20)
    .map((point) => ({
      turn: Math.max(0, Math.round(Number(point?.turn) || 0)),
      at: typeof point?.at === 'string' ? point.at : ''
    }))
    .filter((point) => point.turn > 0);
}

function sanitizeReport(report) {
  if (!report || typeof report !== 'object') return null;
  const scores = {};
  for (const metric of METRICS) {
    const value = Number(report.scores?.[metric.key]);
    scores[metric.key] = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
  }
  const overall = Number(report.overallScore);
  const dimensions = {};
  for (const metric of METRICS) {
    const note = report.dimensions?.[metric.key] || {};
    dimensions[metric.key] = {
      evidence: typeof note.evidence === 'string' ? note.evidence : '',
      advice: typeof note.advice === 'string' ? note.advice : ''
    };
  }
  return {
    overallScore: Number.isFinite(overall) ? Math.max(0, Math.min(100, Math.round(overall))) : null,
    scores,
    dimensions,
    verdict: typeof report.verdict === 'string' ? report.verdict : '',
    strengths: Array.isArray(report.strengths) ? report.strengths.slice(0, 3) : [],
    misconceptions: Array.isArray(report.misconceptions) ? report.misconceptions.slice(0, 5) : [],
    nextSteps: Array.isArray(report.nextSteps) ? report.nextSteps.slice(0, 4) : [],
    encouragement: typeof report.encouragement === 'string' ? report.encouragement : '',
    lowEvidence: Boolean(report.lowEvidence),
    generatedAt: typeof report.generatedAt === 'string' ? report.generatedAt : new Date().toISOString()
  };
}

export function loadHistory() {
  return snapshotHistory();
}

/** 让数据库里的档案与当前 localStorage 快照保持一致（异步，不阻断课堂）。 */
async function mirrorHistory(records) {
  try {
    const stored = await dbGetAll('history');
    const ids = new Set(records.map((record) => record.id));
    for (const item of stored) {
      if (!ids.has(item.id)) await dbDelete('history', item.id);
    }
    await dbPutMany('history', records);
  } catch {
    /* 数据库不可用时 localStorage 仍是完整档案。 */
  }
}

/** 数据库写入成功后更新同步缓存，避免调用方读到旧快照。 */
function commitHistory(records) {
  historyCache = records;
  void mirrorHistory(records);
  return snapshotHistory();
}

function persist(records) {
  let list = normalizeRecords(records).slice(0, MAX_RECORDS);

  const tryStore = (payload) => {
    try {
      const text = JSON.stringify(payload);
      if (text.length > MAX_STORAGE_CHARS) return false;
      localStorage.setItem(APP.storage.history, text);
      return true;
    } catch {
      return false;
    }
  };

  if (tryStore(list)) return commitHistory(list);

  // 空间不够时先丢最早的对话原文，只留下报告和统计。
  notifyStorageIssue('warn', '学习档案体积或本机空间不足，已自动省略较早的对话原文，只保留报告和统计。');
  list = list.map((record) => ({ ...record, messages: [] }));
  if (tryStore(list)) return commitHistory(list);

  // 还不够就只保留最近 20 课。
  notifyStorageIssue('critical', '学习档案空间不足，只保留了最近 20 课。请先导出备份，再清理旧档案。');
  list = list.slice(0, 20);
  if (tryStore(list)) return commitHistory(list);

  notifyStorageIssue('critical', '学习档案无法保存到本机。请先导出备份并清理旧档案，避免新记录继续丢失。');
  return snapshotHistory();
}

/**
 * 从数据库补齐档案：localStorage 被清理但数据库仍在时，已有档案不会丢失。
 * 应用启动时调用一次；同步调用方无需改动。
 */
export async function hydrateHistory() {
  readHistory();
  const stored = await dbGetAll('history');
  if (!stored.length) return snapshotHistory();

  const byId = new Map(readHistory().map((record) => [record.id, record]));
  let added = 0;
  for (const record of stored) {
    if (!record || typeof record.id !== 'string' || !record.id) continue;
    if (!byId.has(record.id)) {
      byId.set(record.id, record);
      added += 1;
    }
  }
  if (!added) return snapshotHistory();
  return persist([...byId.values()]);
}

/** 其他标签页改了 localStorage 后丢弃旧缓存。 */
export function refreshHistoryFromStorage() {
  historyCache = null;
}

/**
 * 把当前会话写入学习档案。同一节课多次调用会更新同一条记录。
 * 没有有效讲解轮数的空会话不记录。
 */
export function archiveSession(session, { model = '', endedAt = new Date().toISOString() } = {}) {
  if (!session || !session.topic || !Array.isArray(session.messages)) return null;

  const visible = session.messages.filter((message) => !message.hidden);
  const turns = visible.filter((message) => message.role === 'user').length;
  const questions = visible.filter((message) => message.role === 'assistant').length;
  if (turns < 1) return null;

  const record = {
    id: session.id,
    topic: String(session.topic).slice(0, APP.limits.maxTopicChars),
    subject: subjectInfo(session.subject) ? session.subject : null,
    difficulty: session.difficulty || null,
    tags: normalizeTags(session.tags),
    source: sourceInfo(session.source).key,
    studentPersona: session.studentPersona || null,
    studentMode: session.studentMode || 'real',
    studentIntensity: session.studentIntensity || 'normal',
    startedAt: session.createdAt || endedAt,
    endedAt,
    turns,
    questions,
    model,
    report: sanitizeReport(session.report),
    stuckPoints: sanitizeStuckPoints(session.stuckPoints),
    messages: trimMessages(session.messages)
  };

  const history = loadHistory();
  const index = history.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    record.startedAt = history[index].startedAt || record.startedAt;
    history.splice(index, 1);
  }
  history.unshift(record);
  persist(history);
  return record;
}

export function deleteRecord(id) {
  persist(loadHistory().filter((record) => record.id !== id));
}

export function deleteRecords(ids) {
  const remove = new Set(Array.isArray(ids) ? ids : []);
  if (!remove.size) return 0;
  const history = loadHistory();
  const kept = history.filter((record) => !remove.has(record.id));
  persist(kept);
  return history.length - kept.length;
}

export function clearHistory() {
  historyCache = [];
  try {
    localStorage.removeItem(APP.storage.history);
  } catch {
    /* Ignore. */
  }
  void dbClear('history');
}

/**
 * Merge a JSON backup into the local archive, keyed by record id. Records in
 * the backup win so a restored backup really restores the older snapshot.
 */
export function importRecords(records) {
  const current = loadHistory();
  const byId = new Map(current.map((record) => [record.id, record]));
  let added = 0;
  let updated = 0;

  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record.id !== 'string' || !record.id) continue;
    if (typeof record.topic !== 'string' || !record.topic.trim()) continue;

    const messages = trimMessages(record.messages);
    const clean = {
      ...record,
      id: record.id,
      topic: record.topic.trim().slice(0, APP.limits.maxTopicChars),
      subject: subjectInfo(record.subject) ? record.subject : null,
      difficulty: difficultyInfo(record.difficulty) ? record.difficulty : null,
      tags: normalizeTags(record.tags),
      source: sourceInfo(record.source).key,
      report: sanitizeReport(record.report),
      stuckPoints: sanitizeStuckPoints(record.stuckPoints),
      messages,
      turns: Number.isFinite(Number(record.turns))
        ? Math.max(0, Math.round(Number(record.turns)))
        : messages.filter((message) => message.role === 'user').length,
      questions: Number.isFinite(Number(record.questions))
        ? Math.max(0, Math.round(Number(record.questions)))
        : messages.filter((message) => message.role === 'assistant').length
    };

    if (byId.has(clean.id)) updated += 1;
    else added += 1;
    byId.set(clean.id, clean);
  }

  const list = persist([...byId.values()]);
  return { added, updated, total: list.length };
}

export function summarizeHistory(records) {
  const scored = records.filter((record) => record.report && Number.isFinite(record.report.overallScore));
  const scores = scored.map((record) => record.report.overallScore);
  const metricAverages = {};
  for (const metric of METRICS) {
    metricAverages[metric.key] = average(
      scored.map((record) => Number(record.report.scores?.[metric.key]))
    );
  }

  let weakest = null;
  let strongest = null;
  for (const metric of METRICS) {
    const value = metricAverages[metric.key];
    if (!Number.isFinite(value)) continue;
    if (!weakest || value < metricAverages[weakest.key]) weakest = metric;
    if (!strongest || value > metricAverages[strongest.key]) strongest = metric;
  }

  const recent = average(scores.slice(0, 5));
  const previous = average(scores.slice(5, 10));
  const delta = Number.isFinite(recent) && Number.isFinite(previous) ? recent - previous : null;

  const last7 = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const activeDays = new Set(records.map((record) => dayKey(record.endedAt)).filter(Boolean));

  return {
    sessions: records.length,
    scored: scored.length,
    averageOverall: average(scores),
    metricAverages,
    weakest,
    strongest,
    recent,
    previous,
    delta,
    activeDays: activeDays.size,
    last7Days: records.filter((record) => {
      const time = new Date(record.endedAt || 0).getTime();
      return Number.isFinite(time) && time >= last7;
    }).length,
    generatedAt: new Date().toISOString()
  };
}

/**
 * 学习节奏：按周排布最近三个月，并计算连续学习天数。
 * current 允许“今天还没练”时沿用昨天的连续记录，避免一天没结束就归零。
 */
export function summarizeActivity(records, { days = 84, now = Date.now() } = {}) {
  const weeks = Math.max(1, Math.min(52, Math.round(Number(days) / 7) || 12));
  const counts = new Map();
  for (const record of records) {
    const date = validDate(record?.endedAt);
    if (!date) continue;
    const key = dayKey(date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const weekday = (today.getDay() + 6) % 7; // 周一 = 0
  const start = new Date(today);
  start.setDate(today.getDate() - weekday - (weeks - 1) * 7);

  const series = [];
  for (let index = 0; index < weeks * 7; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dayKey(date);
    series.push({
      key,
      label: `${date.getMonth() + 1} 月 ${date.getDate()} 日`,
      count: counts.get(key) || 0,
      future: date.getTime() > today.getTime()
    });
  }

  let cursor = new Date(today);
  if (!counts.get(dayKey(cursor))) {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (counts.get(dayKey(yesterday))) cursor = yesterday;
  }
  let current = 0;
  while (counts.get(dayKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const sorted = [...counts.keys()].sort();
  let longest = 0;
  let run = 0;
  let previous = null;
  for (const key of sorted) {
    const date = new Date(`${key}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      run = previous !== null && Math.round((date.getTime() - previous) / 86400000) === 1
        ? run + 1
        : 1;
      longest = Math.max(longest, run);
      previous = date.getTime();
    }
  }

  const total = series.reduce((sum, day) => sum + day.count, 0);
  const activeDays = series.filter((day) => day.count > 0).length;
  const peak = series.reduce(
    (best, day) => (day.count > best.count ? day : best),
    { key: '', label: '', count: 0 }
  );

  return { weeks, series, current, longest, total, activeDays, peak };
}

/** 课堂互动习惯：平均轮数、追问数，以及人设/强度的使用分布。 */
export function summarizeInteractions(records) {
  const personas = new Map();
  const intensities = new Map();
  let turns = 0;
  let questions = 0;

  for (const record of records) {
    const recordTurns = Number(record?.turns);
    if (Number.isFinite(recordTurns)) turns += Math.max(0, recordTurns);
    const recordQuestions = Number(record?.questions);
    if (Number.isFinite(recordQuestions)) questions += Math.max(0, recordQuestions);

    const persona = record?.studentPersona || 'unknown';
    personas.set(persona, (personas.get(persona) || 0) + 1);
    const intensity = record?.studentIntensity || 'unknown';
    intensities.set(intensity, (intensities.get(intensity) || 0) + 1);
  }

  const sessions = records.length;
  const toList = (map) =>
    [...map.entries()]
      .map(([key, count]) => ({
        key,
        count,
        share: sessions ? Math.round((count / sessions) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return {
    sessions,
    turns,
    questions,
    avgTurns: sessions ? Math.round(turns / sessions) : null,
    avgQuestions: sessions ? Math.round(questions / sessions) : null,
    questionsPerTurn: turns ? Math.round((questions / turns) * 10) / 10 : null,
    personas: toList(personas),
    intensities: toList(intensities)
  };
}

/** 按学科拆分统计，供学习档案总览使用。 */
export function summarizeBySubject(records) {
  return SUBJECT_LIST.map((subject) => ({
    subject,
    summary: summarizeHistory(records.filter((record) => record.subject === subject.key))
  }));
}

/** 按知识点聚合平均分和练习次数，供薄弱点热力图使用。 */
export function summarizeTags(records) {
  const map = new Map();
  for (const record of records) {
    const score = Number(record.report?.overallScore);
    for (const tag of normalizeTags(record.tags)) {
      const key = `${record.subject || 'unsorted'}::${tag}`;
      if (!map.has(key)) {
        map.set(key, {
          tag,
          subject: record.subject || null,
          total: 0,
          count: 0,
          sessions: 0
        });
      }
      const item = map.get(key);
      item.sessions += 1;
      if (Number.isFinite(score)) {
        item.total += score;
        item.count += 1;
      }
    }
  }
  return [...map.values()]
    .map((item) => ({
      ...item,
      average: item.count ? Math.round(item.total / item.count) : null
    }))
    .sort((a, b) => {
      if (a.average == null && b.average == null) return b.sessions - a.sessions;
      if (a.average == null) return 1;
      if (b.average == null) return -1;
      return a.average - b.average;
    });
}

function tidyText(value, max = 140) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 从档案里取学生最后一次可见的发言，作为教师可直接引用的原话。 */
export function studentQuote(record, max = 120) {
  const visible = (Array.isArray(record?.messages) ? record.messages : [])
    .filter((message) => message && message.role === 'user' && !message.hidden)
    .map((message) => tidyText(message.content, max))
    .filter(Boolean);
  return visible.length ? visible[visible.length - 1] : '';
}

function weekStats(records, from, to) {
  const items = records.filter((record) => {
    const time = new Date(record.endedAt || 0).getTime();
    return Number.isFinite(time) && time >= from && time < to;
  });
  const scored = items.filter((record) => Number.isFinite(record.report?.overallScore));
  const stuck = items.reduce(
    (total, record) => total + (Array.isArray(record.stuckPoints) ? record.stuckPoints.length : 0),
    0
  );
  return {
    sessions: items.length,
    average: average(scored.map((record) => record.report.overallScore)),
    stuck
  };
}

function lowestScoredRecord(records, tag) {
  const matches = records.filter(
    (record) => Number.isFinite(record.report?.overallScore) && normalizeTags(record.tags).includes(tag)
  );
  return matches.sort((a, b) => a.report.overallScore - b.report.overallScore)[0] || null;
}

/**
 * 教师视角学情：把已有档案整理成「先看什么、先补什么」。
 * 所有结论都来自当前筛选范围内的记录，不新增任何网络请求。
 */
export function summarizeTeacherView(records) {
  const list = Array.isArray(records) ? records : [];
  const summary = summarizeHistory(list);
  const scored = list.filter(
    (record) => record.report && Number.isFinite(record.report.overallScore)
  );
  const recent = scored.slice(0, 5);
  const previous = scored.slice(5, 10);

  const metricTrends = {};
  for (const metric of METRICS) {
    const now = average(recent.map((record) => Number(record.report.scores?.[metric.key])));
    const before = average(previous.map((record) => Number(record.report.scores?.[metric.key])));
    metricTrends[metric.key] = {
      label: metric.label,
      current: now,
      previous: before,
      delta: Number.isFinite(now) && Number.isFinite(before) ? now - before : null
    };
  }

  const weakTags = summarizeTags(list)
    .filter((item) => Number.isFinite(item.average))
    .slice(0, 3)
    .map((item) => {
      const record = lowestScoredRecord(list, item.tag);
      return { ...item, record, quote: studentQuote(record) };
    });

  const misconceptionMap = new Map();
  for (const record of list) {
    for (const item of Array.isArray(record.report?.misconceptions) ? record.report.misconceptions : []) {
      const title = tidyText(item?.title || item?.type, 40) || '未命名理解缺口';
      const key = title.toLocaleLowerCase();
      if (!misconceptionMap.has(key)) {
        misconceptionMap.set(key, {
          title,
          count: 0,
          subjects: new Set(),
          evidence: '',
          why: '',
          fix: '',
          nextGoal: '',
          record
        });
      }
      const entry = misconceptionMap.get(key);
      entry.count += 1;
      if (record.subject) entry.subjects.add(record.subject);
      if (!entry.evidence) entry.evidence = tidyText(item?.evidence, 160);
      if (!entry.why) entry.why = tidyText(item?.why, 160);
      if (!entry.fix) entry.fix = tidyText(item?.fix, 160);
      if (!entry.nextGoal) entry.nextGoal = tidyText(item?.nextGoal, 160);
    }
  }
  const misconceptions = [...misconceptionMap.values()]
    .map((entry) => ({
      ...entry,
      subjects: [...entry.subjects],
      recordId: entry.record.id,
      recordTopic: entry.record.topic,
      quote: studentQuote(entry.record)
    }))
    .sort((a, b) => b.count - a.count || String(b.record.endedAt || '').localeCompare(String(a.record.endedAt || '')))
    .slice(0, 4);

  const bands = { retake: 0, reinforce: 0, mastered: 0 };
  for (const record of scored) {
    if (record.report.overallScore < 60) bands.retake += 1;
    else if (record.report.overallScore < 80) bands.reinforce += 1;
    else bands.mastered += 1;
  }

  const stuckBySubject = new Map();
  let stuckTotal = 0;
  for (const record of list) {
    const count = Array.isArray(record.stuckPoints) ? record.stuckPoints.length : 0;
    if (!count) continue;
    stuckTotal += count;
    const key = record.subject || 'unsorted';
    stuckBySubject.set(key, (stuckBySubject.get(key) || 0) + count);
  }
  const stuckSubjects = [...stuckBySubject.entries()]
    .map(([subject, count]) => ({ subject, count, label: subjectInfo(subject)?.short || '未分科' }))
    .sort((a, b) => b.count - a.count);

  const steps = [];
  for (const record of scored.slice(0, 8)) {
    for (const item of (Array.isArray(record.report.nextSteps) ? record.report.nextSteps : []).slice(0, 2)) {
      const title = tidyText(item?.title, 48);
      const action = tidyText(item?.action, 160);
      const example = tidyText(item?.example, 160);
      if (!title && !action) continue;
      steps.push({
        title: title || action,
        action,
        example,
        score: record.report.overallScore,
        recordId: record.id,
        recordTopic: record.topic,
        quote: studentQuote(record),
        record
      });
    }
  }
  const prioritySteps = steps
    .sort((a, b) => a.score - b.score || String(b.record.endedAt || '').localeCompare(String(a.record.endedAt || '')))
    .slice(0, 3);

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const week = {
    recent: weekStats(list, now - weekMs, now + 1),
    previous: weekStats(list, now - 2 * weekMs, now - weekMs)
  };

  const headlineParts = [];
  if (week.recent.sessions) {
    headlineParts.push(`近 7 天讲了 ${week.recent.sessions} 课`);
    if (Number.isFinite(week.recent.average)) {
      headlineParts.push(`平均 ${week.recent.average}%`);
    }
  }
  if (Number.isFinite(summary.recent)) headlineParts.push(`最近 5 课平均 ${summary.recent}%`);
  if (summary.delta !== null) {
    headlineParts.push(
      `比前 5 课${summary.delta >= 0 ? '提高' : '降低'} ${Math.abs(summary.delta)} 分`
    );
  }
  if (weakTags.length && Number.isFinite(weakTags[0].average)) {
    headlineParts.push(`最薄弱的知识点是「${weakTags[0].tag}」（平均 ${weakTags[0].average}%）`);
  }
  if (misconceptions.length && misconceptions[0].count > 1) {
    headlineParts.push(`「${misconceptions[0].title}」反复出现 ${misconceptions[0].count} 次`);
  }
  if (bands.retake) headlineParts.push(`${bands.retake} 课需要重讲`);
  const headline = headlineParts.length
    ? `${headlineParts.join('，')}。`
    : '诊断数据还不多。讲完一课并生成报告后，这里会给出学情结论。';

  return {
    sessions: list.length,
    scored: summary.scored,
    summary,
    metricTrends,
    weakTags,
    misconceptions,
    bands,
    stuckTotal,
    stuckSubjects,
    prioritySteps,
    week,
    headline
  };
}

/** 教师学情摘要的可复制文本，供设置里的「复制学情摘要」使用。 */
export function teacherViewToText(view) {
  if (!view || !view.sessions) return '暂无学情数据。';
  const lines = ['# 学情摘要 · 教师视角', '', view.headline, '', '## 三维表现'];
  for (const metric of METRICS) {
    const trend = view.metricTrends[metric.key];
    const value = Number.isFinite(trend.current) ? `${trend.current}%` : '—';
    const change =
      trend.delta === null ? '' : `（较前 5 课 ${trend.delta >= 0 ? '+' : ''}${trend.delta}）`;
    lines.push(`- ${metric.label}：${value}${change}`);
  }
  lines.push('', '## 优先补的知识点');
  if (view.weakTags.length) {
    for (const tag of view.weakTags) {
      lines.push(`- ${tag.tag}：平均 ${tag.average ?? '—'}%，练过 ${tag.sessions} 次`);
    }
  } else {
    lines.push('- 暂无带知识点的记录');
  }
  lines.push('', '## 反复出现的理解缺口');
  if (view.misconceptions.length) {
    for (const item of view.misconceptions) {
      lines.push(`- ${item.title}（${item.count} 次）`);
      if (item.evidence) lines.push(`  证据：${item.evidence}`);
      if (item.fix) lines.push(`  怎么补：${item.fix}`);
    }
  } else {
    lines.push('- 暂无记录到的理解缺口');
  }
  lines.push('', '## 下一次教学动作');
  if (view.prioritySteps.length) {
    for (const step of view.prioritySteps) {
      lines.push(`- ${step.title}：${step.action || step.example || '查看对应报告'}`);
    }
  } else {
    lines.push('- 暂无诊断建议');
  }
  lines.push('', `课时分布：需重讲 ${view.bands.retake} 课，待巩固 ${view.bands.reinforce} 课，已掌握 ${view.bands.mastered} 课。`);
  return lines.join('\n');
}

/** 可复制给家长或真人老师的本周学情周报，只使用本机档案。 */
export function teacherWeeklyReport(records) {
  const view = summarizeTeacherView(records);
  const list = Array.isArray(records) ? records : [];
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const thisWeek = list
    .filter((record) => {
      const time = new Date(record.endedAt || 0).getTime();
      return Number.isFinite(time) && time >= now - weekMs && time <= now;
    })
    .sort((a, b) => String(b.endedAt || '').localeCompare(String(a.endedAt || '')));

  const lines = [
    '# 本周学情周报',
    '',
    `生成时间：${new Date(now).toLocaleDateString('zh-CN')}`,
    '',
    view.headline,
    '',
    '## 本周对比',
    `近 7 天：${view.week.recent.sessions} 课 · 平均 ${
      Number.isFinite(view.week.recent.average) ? `${view.week.recent.average}%` : '—'
    } · 卡点 ${view.week.recent.stuck} 个`,
    `前 7 天：${view.week.previous.sessions} 课 · 平均 ${
      Number.isFinite(view.week.previous.average) ? `${view.week.previous.average}%` : '—'
    } · 卡点 ${view.week.previous.stuck} 个`,
    '',
    '## 本周课程'
  ];

  if (thisWeek.length) {
    for (const record of thisWeek) {
      const score = Number.isFinite(record.report?.overallScore)
        ? ` · ${record.report.overallScore}%`
        : '';
      const tags = normalizeTags(record.tags).join('、');
      lines.push(`- ${record.topic}${score}${tags ? ` · ${tags}` : ''}`);
    }
  } else {
    lines.push('- 本周还没有讲课记录');
  }

  lines.push('', '## 优先补的知识点');
  if (view.weakTags.length) {
    for (const tag of view.weakTags) {
      lines.push(`- ${tag.tag}：平均 ${tag.average ?? '—'}%，练过 ${tag.sessions} 次`);
      if (tag.quote) lines.push(`  学生原话：「${tag.quote}」`);
    }
  } else {
    lines.push('- 暂无带知识点的记录');
  }

  lines.push('', '## 需要关注的理解缺口');
  if (view.misconceptions.length) {
    for (const item of view.misconceptions) {
      lines.push(`- ${item.title}（出现 ${item.count} 次）`);
      if (item.quote) lines.push(`  学生原话：「${item.quote}」`);
      if (item.fix) lines.push(`  建议：${item.fix}`);
    }
  } else {
    lines.push('- 暂无记录到的理解缺口');
  }

  lines.push('', '## 下周教学动作');
  if (view.prioritySteps.length) {
    for (const step of view.prioritySteps) {
      lines.push(`- ${step.title}：${step.action || step.example || '见对应诊断报告'}`);
    }
  } else {
    lines.push('- 暂无诊断建议');
  }

  lines.push('', '数据来自本机浏览器档案，仅供教学参考。');
  return lines.join('\n');
}

/** 把报告转成 Markdown，历史详情和报告弹窗都复用它。 */
export function reportToText(record) {
  if (!record?.report) return '';
  const { report } = record;
  const subject = subjectInfo(record.subject);
  const difficulty = difficultyInfo(record.difficulty);
  const source = sourceInfo(record.source);
  const meta = [];
  if (subject) meta.push(subject.label);
  if (difficulty) meta.push(difficulty.label);
  if (record.tags?.length) meta.push(record.tags.join('、'));
  if (record.source) meta.push(source.full);

  const lines = [`# 学习诊断报告 · ${record.topic}`, ''];
  if (meta.length) lines.push(`**题目信息**：${meta.join(' · ')}`, '');
  lines.push(`**综合评分**：${report.overallScore ?? '—'}%`, '');
  lines.push('## 三维评分');
  for (const metric of METRICS) {
    const score = report.scores?.[metric.key];
    const note = report.dimensions?.[metric.key] || {};
    lines.push(`### ${metric.label}：${score ?? '—'}%`);
    if (note.evidence) lines.push(`- 对话证据：${note.evidence}`);
    if (note.advice) lines.push(`- 改进建议：${note.advice}`);
    lines.push('');
  }

  if (report.verdict) lines.push('## 老师总评', report.verdict, '');
  if (report.misconceptions?.length) {
    lines.push('## 关键理解缺口');
    report.misconceptions.forEach((item, index) => {
      lines.push(`${index + 1}. **${item.title || '理解缺口'}**`);
      if (item.type) lines.push(`   - 类型：${item.type}`);
      if (item.zpd) lines.push(`   - 最近发展区：${item.zpd}`);
      if (item.evidence) lines.push(`   - 证据：${item.evidence}`);
      if (item.why) lines.push(`   - 为什么：${item.why}`);
      if (item.fix) lines.push(`   - 怎么补：${item.fix}`);
      if (item.exercise) lines.push(`   - 1 分钟微练习：${item.exercise}`);
      if (item.nextGoal) lines.push(`   - 下次讲课目标：${item.nextGoal}`);
    });
    lines.push('');
  }
  if (report.nextSteps?.length) {
    lines.push('## 下一次可以这样讲');
    report.nextSteps.forEach((item, index) => {
      lines.push(`${index + 1}. **${item.title || '下一步'}**`);
      if (item.zpd) lines.push(`   - 最近发展区：${item.zpd}`);
      if (item.action) lines.push(`   - 动作：${item.action}`);
      if (item.example) lines.push(`   - 示范：${item.example}`);
    });
    lines.push('');
  }
  if (report.encouragement) lines.push('## 陈老师想说', report.encouragement);
  return lines.join('\n').trim();
}
