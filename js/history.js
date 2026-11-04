/**
 * 学习档案：把每次讲课的主题、轮数和诊断报告存进浏览器，
 * 用来做跨课时的长期学情追踪。
 *
 * 数据只保存在本机 localStorage，不上传服务器；不保存图片。
 */

import { APP, METRICS } from './config.js';

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

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return null;
  return round(numbers.reduce((total, value) => total + value, 0) / numbers.length);
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

function sanitizeReport(report) {
  if (!report || typeof report !== 'object') return null;
  const scores = {};
  for (const metric of METRICS) {
    const value = Number(report.scores?.[metric.key]);
    scores[metric.key] = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
  }
  const overall = Number(report.overallScore);
  return {
    overallScore: Number.isFinite(overall) ? Math.max(0, Math.min(100, Math.round(overall))) : null,
    scores,
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
  list = list.map((record) => ({ ...record, messages: [] }));
  if (tryStore(list)) return list;

  // 还不够就只保留最近 20 课。
  list = list.slice(0, 20);
  if (tryStore(list)) return list;

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
    startedAt: session.createdAt || endedAt,
    endedAt,
    turns,
    questions,
    model,
    report: sanitizeReport(session.report),
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
  const activeDays = new Set(
    records
      .map((record) => String(record.endedAt || '').slice(0, 10))
      .filter(Boolean)
  );

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

/** 把报告转成可复制的纯文本，历史详情里用。 */
export function reportToText(record) {
  if (!record?.report) return '';
  const { report } = record;
  const lines = [`学习诊断报告 · ${record.topic}`, `综合评分：${report.overallScore ?? '—'}%`];
  for (const metric of METRICS) {
    lines.push(`${metric.label}：${report.scores?.[metric.key] ?? '—'}%`);
  }
  if (report.verdict) lines.push('', `老师总评：${report.verdict}`);
  if (report.misconceptions?.length) {
    lines.push('', '关键理解缺口：');
    report.misconceptions.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title || ''}${item.fix ? `（${item.fix}）` : ''}`);
    });
  }
  if (report.nextSteps?.length) {
    lines.push('', '下一次可以这样讲：');
    report.nextSteps.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title || ''}${item.action ? `：${item.action}` : ''}`);
    });
  }
  return lines.join('\n');
}
