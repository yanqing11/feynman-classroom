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

const MAX_RECORDS = 60;
const MAX_MESSAGE_CHARS = 8000;
const MAX_STORAGE_CHARS = 1_800_000;

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
  const stored = safeParse(localStorage.getItem(APP.storage.history));
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((record) => record && typeof record.topic === 'string' && record.topic.trim())
    .sort((a, b) => String(b.endedAt || '').localeCompare(String(a.endedAt || '')));
}

function persist(records) {
  let list = records.slice(0, MAX_RECORDS);

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

  if (tryStore(list)) return list;

  // 空间不够时先丢最早的对话原文，只留下报告和统计。
  notifyStorageIssue('warn', '学习档案体积或本机空间不足，已自动省略较早的对话原文，只保留报告和统计。');
  list = list.map((record) => ({ ...record, messages: [] }));
  if (tryStore(list)) return list;

  // 还不够就只保留最近 20 课。
  notifyStorageIssue('critical', '学习档案空间不足，只保留了最近 20 课。请先导出备份，再清理旧档案。');
  list = list.slice(0, 20);
  if (tryStore(list)) return list;

  notifyStorageIssue('critical', '学习档案无法保存到本机。请先导出备份并清理旧档案，避免新记录继续丢失。');
  return loadHistory();
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
  try {
    localStorage.removeItem(APP.storage.history);
  } catch {
    /* Ignore. */
  }
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
