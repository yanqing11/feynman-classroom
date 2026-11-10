import {
  APP,
  METRICS,
  STUDENT_PROMPT,
  TEACHER_PROMPT,
  difficultyInfo,
  intensityInfo,
  kickoffMessage,
  modeInfo,
  normalizeTags,
  personaInfo,
  sourceInfo,
  subjectInfo,
  TAG_MISCONCEPTIONS,
  teacherRequest
} from './config.js';
import { ApiError, completeChat, streamChat } from './api.js';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

function apiContent(message) {
  const text = message.content || '';
  const images = Array.isArray(message.images) ? message.images.filter(Boolean) : [];
  if (!images.length) return text;
  return [
    { type: 'text', text: text || '（老师上传了一张图片）' },
    ...images.map((url) => ({ type: 'image_url', image_url: { url } }))
  ];
}

function charLength(message) {
  const text = typeof message.content === 'string' ? message.content.length : 0;
  const images = Array.isArray(message.images) ? message.images.length * 1600 : 0;
  return text + images;
}

function trimHistory(messages, maxChars) {
  const kept = [];
  let total = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const length = charLength(message);
    if (kept.length >= 6 && total + length > maxChars) break;
    kept.unshift(message);
    total += length;
  }
  return kept;
}

function visibleMessages(session) {
  return session.messages.filter((message) => !message.hidden);
}

const STUCK_PATTERN =
  /(我不会|不知道|卡住|卡壳|没思路|不会做|给点提示|提示一下|帮帮我|想不出来|教教我)/;
const HINT_REQUEST_PATTERN = /(提示|给点提示|提示一下|翻书|看看书|书上)/;

function lastUserMessage(session) {
  return [...visibleMessages(session)].reverse().find((message) => message.role === 'user');
}

function teacherSeemsStuck(session) {
  const lastUser = lastUserMessage(session);
  return Boolean(lastUser && STUCK_PATTERN.test(lastUser.content || ''));
}

function teacherAskedForHint(session) {
  const lastUser = lastUserMessage(session);
  return Boolean(lastUser && HINT_REQUEST_PATTERN.test(lastUser.content || ''));
}

function studentClassContext(session) {
  const subject = subjectInfo(session.subject);
  const difficulty = difficultyInfo(session.difficulty);
  const source = sourceInfo(session.source);
  const persona = personaInfo(session.studentPersona);
  const mode = modeInfo(session.studentMode);
  const intensity = intensityInfo(session.studentIntensity);
  const tags = normalizeTags(session.tags);
  const lines = [];

  if (subject) {
    lines.push(
      `【当前学科】${subject.label}。你正在学${subject.stage}数学，这块内容对你来说很难，需要老师一步一步讲。`
    );
  }
  const tagMisconceptions = tags.flatMap((tag) => TAG_MISCONCEPTIONS[tag] || []);
  if (tagMisconceptions.length) {
    lines.push(
      `【当前知识点误区池】${tagMisconceptions.join('；')}。这些只是你脑子里存的错误想法，不是必须依次提问的清单；只在老师讲到相关地方时，自然冒出其中一种，不要逐条背诵。`
    );
  } else if (subject) {
    lines.push(
      `【本学段常见误区】${subject.misconceptions.join('；')}。不要逐条背诵，只在老师讲到相关地方时，自然表现出其中一种困惑。`
    );
  }
  if (persona.misconceptions?.length) {
    lines.push(
      `【人设常见误区】${persona.misconceptions.join('；')}。这些是你可能卡住的细节，不是固定提问清单；不要逐条问，也不要在老师没提到相关内容时硬套。`
    );
  }
  if (difficulty) lines.push(`【题目难度】${difficulty.label}：${difficulty.hint}。`);
  if (tags.length) lines.push(`【知识点】${tags.join('、')}。`);
  if (source) lines.push(`【题目来源】${source.full}。`);

  lines.push(`【这节课的学生人设】${persona.label}：${persona.prompt}`);

  if (mode.key === 'examiner') {
    lines.push(
      '【提问模式：考官模式】在不违反阶段锁的前提下，可以比真实学生更认真地核对每一步依据；但依然一次只问一个问题，不能按固定清单或固定梯度连环追问，也不能主动规划学习路线。'
    );
  } else {
    lines.push(
      '【提问模式：真实学生模式】你的疑问要从老师上一句讲解里自然生长，不按固定顺序。可以听懂后复述，可以半懂卡在一个点，可以完全跟不上请求简化，也可以说出自己的错误猜想。'
    );
  }

  if (intensity.key === 'gentle') {
    lines.push('【提问强度：保守】提问频率低一些，每次最多问一个问题；老师讲得清楚时，先用一句话复述，再决定要不要追问。');
  } else if (intensity.key === 'challenge') {
    lines.push(
      '【提问强度：挑战】追问更密一些，每个关键步骤都可以停一下问依据；偶尔会混淆前面讲过的内容，请老师帮你澄清。但不要故意刁难，也不要重复已经讲清楚的问题。'
    );
  } else {
    lines.push('【提问强度：正常】保持自然的提问频率，通常每次只抓一个最关键的点追问。');
  }

  if (persona.rules) {
    lines.push(`【人设行为规则：${persona.label}】\n${persona.rules}`);
    lines.push(
      '【规则优先级】人设规则和阶段锁优先于“考官模式”的任何追问安排；所有模式都不能按预设清单连环提问，疑问只能从老师上一句话里长出来。'
    );
  }

  return lines.join('\n');
}

export function humanTurnCount(session) {
  return visibleMessages(session).filter((message) => message.role === 'user').length;
}

export function buildStudentMessages(session) {
  const history = session.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: apiContent(message) }));

  let trimmed = trimHistory(history, APP.limits.historyChars);
  if (!trimmed.length || trimmed[0].role === 'assistant') {
    trimmed = [{ role: 'user', content: kickoffMessage(session.topic) }, ...trimmed];
  }

  const hasTeacherSpeak =
    Boolean(session.hasTeacherSpeak) ||
    visibleMessages(session).some((message) => message.role === 'user');

  const stagePrompt = hasTeacherSpeak
    ? `

【系统提示：当前是阶段 B（hasTeacherSpeak = true）】
老师已经开口讲解。继续遵守防越界铁律：不自己推理、不计算、不判断对错、不替老师分析式子；一次只问一个问题，疑问只能来自老师上一句话。`
    : `

【系统提示：当前是阶段 A（hasTeacherSpeak = false）】
课堂刚开始，还没有老师真正的讲解内容。你只能从下面两句里逐字选一句输出，不能增删、改写任何字，也不要加引号：
老师，我准备好了，你来讲吧。
老师，我听着，你开始讲。
不要提问、不要猜、不要拆解知识点、不要主动发起任何问题。`;

  const stuckPrompt = !hasTeacherSpeak || !teacherSeemsStuck(session)
    ? ''
    : teacherAskedForHint(session)
      ? `

【系统提示：老师要提示】
老师已经明确要提示，视为老师已经同意，不用再问“要不要看”。你可以直接给一个半成品线索（类比、反例或某一步的起点），并说明这是“我在书上看到的”或“我自己瞎猜的”，不要说成是你自己分析出来的结论；仍然不要说最终答案，也不要把剩余步骤推导完；说完停下来等老师接话。`
      : `

【系统提示：老师可能卡住了】
老师刚刚在向你求助。你仍然不能替老师解题或给答案。先问老师要不要看你在书上找到的一个提示；只有老师同意后，才给一个半成品线索（类比、反例或某一步的起点），并说明这是“我在书上看到的”或“我自己瞎猜的”，不要说成是你自己分析出来的结论；不要说最终答案，也不要把剩余步骤推导完。老师拒绝就不要再提。`;

  const system = `${STUDENT_PROMPT}

【当前讲课主题】
${session.topic}

${studentClassContext(session)}

【重要边界】
- 你只能以「小问」这个学生的身份说话。
- 你绝不能给出答案、解法或公式推导。
- 你看不到评分报告；不要假装自己知道老师讲得对不对。${stagePrompt}${stuckPrompt}`;

  return [{ role: 'system', content: system }, ...trimmed];
}

export function buildTeacherMessages(session, { includeImages = true } = {}) {
  const messages = visibleMessages(session);
  let budget = APP.limits.transcriptChars;
  const lines = [];
  const images = [];

  if (includeImages) {
    for (const message of session.messages) {
      if (message.role !== 'user' || !message.images?.length) continue;
      for (const url of message.images) {
        if (images.length >= 3) break;
        images.push(url);
      }
      if (images.length >= 3) break;
    }
  }

  for (const message of messages) {
    const label = message.role === 'user' ? '老师' : '小问';
    const text = clean(message.content) || (message.images?.length ? '（发来了一张图片）' : '');
    const attachment = message.images?.length ? ' [附图片]' : '';
    const line = `${label}：${text}${attachment}`;
    if (budget - line.length < 0 && lines.length > 10) break;
    lines.push(line);
    budget -= line.length + 1;
  }

  const transcript = lines.join('\n');
  const parts = [
    {
      type: 'text',
      text: `${teacherRequest(session)}

【对话记录开始】
${transcript}
【对话记录结束】

有效讲解轮数：${humanTurnCount(session)} 轮。
${humanTurnCount(session) < 3 ? '注意：有效讲解轮数较少，请说明证据有限，并保守评分（最高不超过 75）。' : ''}
${images.length ? `老师还上传了 ${images.length} 张题目 / 手写图片，图片附在下面。` : ''}`
    }
  ];

  if (images.length) {
    images.forEach((url, index) => {
      parts.push({ type: 'text', text: `图片 ${index + 1}：` });
      parts.push({ type: 'image_url', image_url: { url } });
    });
  }

  return [
    { role: 'system', content: TEACHER_PROMPT },
    { role: 'user', content: parts }
  ];
}

function clampScore(value, fallback = 0) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeItem(item, keys) {
  if (typeof item === 'string') {
    return keys.reduce((result, key, index) => {
      result[key] = index === 0 ? item.trim() : '';
      return result;
    }, {});
  }
  if (!item || typeof item !== 'object') return null;
  const result = {};
  for (const key of keys) {
    const value = item[key];
    result[key] = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
  }
  return Object.values(result).some(Boolean) ? result : null;
}

export function normalizeReport(raw, session) {
  const object = raw && typeof raw === 'object' ? raw : {};
  const sourceScores = object.scores && typeof object.scores === 'object' ? object.scores : {};
  const fallbackOverall = clampScore(object.overallScore, 0);

  const scores = {};
  for (const metric of METRICS) {
    const value = sourceScores[metric.key] ?? object[metric.key];
    scores[metric.key] = clampScore(value, fallbackOverall);
  }

  // The prompt defines overallScore as the weighted average of the three
  // dimensions. Recompute it so the headline number always matches the cards,
  // even when a model returns an inconsistent total.
  const overall = Math.round(
    METRICS.reduce((total, metric) => total + scores[metric.key] * metric.weight, 0)
  );

  const sourceDimensions =
    object.dimensions && typeof object.dimensions === 'object' ? object.dimensions : {};
  const dimensions = {};
  for (const metric of METRICS) {
    const note = sourceDimensions[metric.key];
    dimensions[metric.key] = {
      evidence: clean(note?.evidence),
      advice: clean(note?.advice)
    };
  }

  const misconceptions = (Array.isArray(object.misconceptions) ? object.misconceptions : [])
    .map((item) => normalizeItem(item, ['title', 'evidence', 'why', 'fix']))
    .filter(Boolean)
    .slice(0, 5);

  const nextSteps = (Array.isArray(object.nextSteps) ? object.nextSteps : [])
    .map((item) => normalizeItem(item, ['title', 'action', 'example']))
    .filter(Boolean)
    .slice(0, 4);

  const strengths = (Array.isArray(object.strengths) ? object.strengths : [])
    .map((item) => (typeof item === 'string' ? item.trim() : clean(item?.text)))
    .filter(Boolean)
    .slice(0, 3);

  if (!misconceptions.length) {
    misconceptions.push({
      title: '这轮的有效证据还不多',
      evidence: '老师目前的讲解还比较短，暂时没有足够证据定位具体缺口。',
      why: '对话轮数少时，很难判断是表达省略，还是理解上真的断了。',
      fix: '再讲 2–3 轮，把每一步的“为什么”说出来，再让老师看一次。'
    });
  }

  if (!nextSteps.length) {
    nextSteps.push(
      {
        title: '先讲“为什么”，再讲“怎么做”',
        action: '每写一个步骤，先停一秒，用一句大白话补上依据。',
        example: '下次可以这样说：“这一步我用了等式两边同时加同一个数，等式仍然成立。”'
      },
      {
        title: '用一个具体数字验证',
        action: '讲完结论后，代一个简单的数回去，检查左右是否相等。',
        example: '下次可以这样说：“我拿 x = 1 代进去验算一下，看看是不是真的成立。”'
      }
    );
  }

  const turns = session ? humanTurnCount(session) : 0;
  return {
    overallScore: overall,
    scores,
    dimensions,
    verdict: clean(object.verdict) || '这轮讲解已经有了一些骨架，下一步是把每一步的依据说得更清楚。',
    strengths,
    misconceptions,
    nextSteps,
    encouragement:
      clean(object.encouragement) ||
      '愿意把自己的思路讲出来，本身就是很重要的一步。下一次不用追求一次讲对，先把“为什么”说出来，就已经在进步了。',
    turns,
    lowEvidence: turns < 3,
    generatedAt: new Date().toISOString()
  };
}

export function parseReport(raw, session) {
  const text = clean(raw)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new ApiError('AI 老师没有返回可解析的报告，请再试一次。', { details: text.slice(0, 300) });
  }
  let object;
  try {
    object = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new ApiError('AI 老师的报告格式不完整，请再试一次。', {
      details: `${error.message}\n${text.slice(0, 300)}`
    });
  }
  return normalizeReport(object, session);
}

export class StudentAgent {
  async reply({ session, settings, signal, onDelta }) {
    const messages = buildStudentMessages(session);
    return streamChat({
      settings,
      messages,
      maxTokens: APP.limits.studentMaxTokens,
      temperature: settings.temperature ?? APP.defaults.temperature,
      signal,
      onDelta
    });
  }
}

export class TeacherAgent {
  async evaluate({ session, settings, signal }) {
    const hasImages = visibleMessages(session).some((message) => message.images?.length);
    let raw;
    try {
      raw = await completeChat({
        settings,
        messages: buildTeacherMessages(session, { includeImages: true }),
        maxTokens: APP.limits.teacherMaxTokens,
        temperature: 0.3,
        jsonMode: true,
        signal
      });
    } catch (error) {
      const canRetryWithoutImages =
        hasImages && error instanceof ApiError && (error.status === 400 || error.status === 404 || error.status === 422);
      if (!canRetryWithoutImages) throw error;
      raw = await completeChat({
        settings,
        messages: buildTeacherMessages(session, { includeImages: false }),
        maxTokens: APP.limits.teacherMaxTokens,
        temperature: 0.3,
        jsonMode: true,
        signal
      });
    }
    return parseReport(raw, session);
  }
}
