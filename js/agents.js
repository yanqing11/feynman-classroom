import {
  APP,
  METRICS,
  STUDENT_PROMPT,
  TUTOR_PROMPT,
  TEACHER_PROMPT,
  ASSIST_MODE_OVERRIDE,
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

/* -------------------------------------------------------------------------- */
/* Student output post-detection rules (防滥用检测)                            */
/* -------------------------------------------------------------------------- */

const ANSWER_LEAK_PATTERNS = [
  /答案是/,
  /所以\s*x\s*=/,
  /最终结果/,
  /综上/,
  /因此答案是/,
  /我们可以得出/
];

const ANSWER_VALUE_PATTERN = /x\s*=\s*-?\d+(?:\.\d+)?/;
const ROLE_CONTAMINATION_PATTERNS = [
  /作为\s*AI/,
  /我是一个语言模型/,
  /你的讲解有以下问题/,
  /我建议你/,
  /^\s*```json\s*$/im,
  /^#{1,6}\s/m
];

const STUCK_PATTERN =
  /(我不会|不知道|卡住|卡壳|没思路|不会做|给点提示|提示一下|帮帮我|想不出来|教教我)/;
const HINT_REQUEST_PATTERN = /(提示|给点提示|提示一下|翻书|看看书|书上)/;

/**
 * Count Chinese characters (rough — CJK + full-width punctuation).
 */
function countChineseChars(text) {
  const matches = String(text || '').match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g);
  return matches ? matches.length : 0;
}

/**
 * Detect issues in student agent output before showing it to the user.
 * Returns { passed, issues[], retryHint } — if issues is non-empty, the
 * caller should retry generation with the retryHint appended to the system
 * message.
 */
function checkStudentOutput(output, previousOutput = '') {
  const text = String(output || '').trim();
  const issues = [];
  let retryHint = '';

  // Detection 1: Answer leak
  if (ANSWER_LEAK_PATTERNS.some((re) => re.test(text)) || ANSWER_VALUE_PATTERN.test(text)) {
    issues.push('answer_leak');
    retryHint = '注意：你刚才的回复包含了答案或解题步骤，这是被禁止的。请只输出一个疑问或一句复述。';
  }

  // Detection 2: Length overflow (100 chars with 20% tolerance = 120)
  const charCount = countChineseChars(text);
  if (charCount > 120) {
    issues.push('length_overflow');
    retryHint = '注意：你刚才的回复太长了，请缩短到 1～2 句话，不超过 80 个汉字。';
  }

  // Detection 3: Role contamination
  if (ROLE_CONTAMINATION_PATTERNS.some((re) => re.test(text))) {
    issues.push('role_contamination');
    retryHint = '注意：你刚才的回复包含了评判性内容或格式异常，这不符合小问的学生角色。请只以学生的口吻说一句话。';
  }

  // Detection 4: Consecutive same-pattern (not blocking, just a hint)
  if (previousOutput) {
    const prevStart = previousOutput.slice(0, 6);
    const currStart = text.slice(0, 6);
    if (prevStart === currStart && prevStart.length >= 3) {
      // Non-blocking: we flag it but don't retry
      issues.push('consecutive_pattern');
    }
  }

  const blockingIssues = issues.filter((i) => i !== 'consecutive_pattern');
  return {
    passed: blockingIssues.length === 0,
    issues,
    retryHint,
    consecutivePattern: issues.includes('consecutive_pattern')
  };
}

const SAFE_FALLBACK_REPLY = '老师，我有点听糊涂了，你能换个方式再讲讲吗？';
const MAX_OUTPUT_RETRIES = 2;

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
  } else if (mode.key === 'assist') {
    lines.push(
      '【提问模式：简易辅助模式】你的疑问要从老师上一句讲解里自然生长。在遵守所有学生规则的前提下，如果老师明确请求你帮忙检查或确认，你可以在不给出最终答案的前提下，用学生的口吻指出你"觉得有点不对劲的地方"。如果老师连续 2 次表达"不知道怎么讲"，你可以用更温和的语气引导老师开口。'
    );
    lines.push(ASSIST_MODE_OVERRIDE);
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

  const roundNumber = humanTurnCount(session);

  const roundPrompt = hasTeacherSpeak
    ? `\n\n【当前轮次：第 ${roundNumber} 轮】${roundNumber <= 2 ? '（开场期：优先用举例型或原理型追问，语气更轻柔。）' : roundNumber <= 5 ? '（深入期：可以引入条件变化型、反例检验型追问。）' : roundNumber <= 8 ? '（收束期：追问逐步减少，可以开始用复述确认代替新提问。）' : '（建议收束：不再主动开启新方向的追问，可以暗示老师收尾。）'}`
    : '';

  // AI-plagiarism detection: check if the teacher's last message looks like copied AI output
  const plagiarismPrompt = hasTeacherSpeak ? detectAiplagiarism(session) : '';

  const stagePrompt = hasTeacherSpeak
    ? `
\n【系统提示：当前是阶段 B（hasTeacherSpeak = true）】\n老师已经开口讲解。继续遵守防越界铁律：不自己推理、不计算、不判断对错、不替老师分析式子；一次只问一个问题，疑问只能来自老师上一句话。${roundPrompt}${plagiarismPrompt}`
    : `
\n【系统提示：当前是阶段 A（hasTeacherSpeak = false）】\n课堂刚开始，还没有老师真正的讲解内容。你只能从下面两句里逐字选一句输出，不能增删、改写任何字，也不要加引号：\n老师，我准备好了，你来讲吧。\n老师，我听着，你开始讲。\n不要提问、不要猜、不要拆解知识点、不要主动发起任何问题。`;

  const stuckPrompt = !hasTeacherSpeak || !teacherSeemsStuck(session)
    ? ''
    : teacherAskedForHint(session)
      ? `

【系统提示：老师要提示】
老师已经明确要提示，视为老师已经同意，不用再问"要不要看"。你可以直接给一个半成品线索（类比、反例或某一步的起点），并说明这是"我在书上看到的"或"我自己瞎猜的"，不要说成是你自己分析出来的结论；仍然不要说最终答案，也不要把剩余步骤推导完；说完停下来等老师接话。`
      : `

【系统提示：老师可能卡住了】
老师刚刚在向你求助。你仍然不能替老师解题或给答案。先问老师要不要看你在书上找到的一个提示；只有老师同意后，才给一个半成品线索（类比、反例或某一步的起点），并说明这是"我在书上看到的"或"我自己瞎猜的"，不要说成是你自己分析出来的结论；不要说最终答案，也不要把剩余步骤推导完。老师拒绝就不要再提。`;

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

/**
 * Build the message list for 小理 (AI 家教).
 * The first round is diagnosis only; later rounds teach one point then ask
 * exactly one question. The hidden kickoff message acts as the first user turn.
 */
export function buildTutorMessages(session) {
  const history = session.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: apiContent(message) }));

  let trimmed = trimHistory(history, APP.limits.historyChars);
  if (!trimmed.length || trimmed[0].role === 'assistant') {
    trimmed = [{ role: 'user', content: kickoffMessage(session.topic, 'tutor') }, ...trimmed];
  }

  const subject = subjectInfo(session.subject);
  const tags = normalizeTags(session.tags);
  const context = [];
  if (subject) context.push(`【学段】${subject.stage}数学（${subject.label}）。用这个学段听得懂的话讲。`);
  if (tags.length) context.push(`【知识点】${tags.join('、')}。`);

  const firstRound = humanTurnCount(session) === 0;
  const roundPrompt = firstRound
    ? `\n【当前轮次：第一轮 · 诊断】学生刚说出想学的主题。先只用一句话确认你明白他想学什么，再问他“已经知道什么、哪里最想弄懂”，问完就停下来等他回答。这一轮不要讲解，也不要给答案。`
    : `\n【当前轮次：第 ${humanTurnCount(session) + 1} 轮 · 讲解 + 提问】先用大白话讲清一个关键点，配一个具体数字或生活例子；然后只提一个问题，让他用刚学的内容回答或质疑。问完就停，不要自问自答。`;

  const system = `${TUTOR_PROMPT}

【本次学习主题】
${session.topic}

${context.join('\n')}${roundPrompt}`;

  return [{ role: 'system', content: system }, ...trimmed];
}

/**
 * Detect if the teacher's latest message looks like copied AI output.
 * Returns a system prompt fragment if detected, empty string otherwise.
 */
function detectAiplagiarism(session) {
  const lastUser = lastUserMessage(session);
  if (!lastUser) return '';

  const content = lastUser.content || '';
  const charCount = countChineseChars(content);

  // Check for AI-like patterns: very long + highly structured
  const hasStructureWords = /(首先|其次|然后|最后|综上所述|总而言之)/.test(content);
  const hasCompleteSolution = /(解：|解法|步骤[一二三123]|因此.*[=＝])/.test(content);
  const isVeryLong = charCount > 300;

  if (isVeryLong && hasStructureWords && hasCompleteSolution) {
    return `

【系统提示：检测到老师可能复制了 AI 生成的话术】
老师的上一条消息很长、结构非常工整，且包含完整的解题步骤，可能是直接复制了 AI 生成的内容而不是自己讲的。请用你的学生口吻温和地提醒老师用自己的话重新讲，例如："老师，你讲得好多呀，不过感觉好正式哦——你能用你自己的话再跟我说一遍吗？我怕我听不太懂这种说法。"不要直接指控老师。`;
  }

  return '';
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
    .map((item) => normalizeItem(item, ['title', 'type', 'evidence', 'why', 'fix', 'exercise', 'nextGoal', 'zpd']))
    .filter(Boolean)
    .slice(0, 5);

  const nextSteps = (Array.isArray(object.nextSteps) ? object.nextSteps : [])
    .map((item) => normalizeItem(item, ['title', 'zpd', 'action', 'example']))
    .filter(Boolean)
    .slice(0, 4);

  const strengths = (Array.isArray(object.strengths) ? object.strengths : [])
    .map((item) => (typeof item === 'string' ? item.trim() : clean(item?.text)))
    .filter(Boolean)
    .slice(0, 3);

  if (!misconceptions.length) {
    misconceptions.push({
      title: '这轮的有效证据还不多',
      type: '步骤缺失',
      evidence: '老师目前的讲解还比较短，暂时没有足够证据定位具体缺口。',
      why: '对话轮数少时，很难判断是表达省略，还是理解上真的断了。',
      fix: '再讲 2–3 轮，把每一步的"为什么"说出来，再让老师看一次。',
      zpd: '边缘掌握'
    });
  }

  for (const gap of misconceptions) {
    const title = gap.title || '这个缺口';
    if (!gap.type) gap.type = '步骤缺失';
    if (!gap.zpd) gap.zpd = '边缘掌握';
    if (!gap.exercise) {
      gap.exercise = `用 1 分钟把「${title}」重新讲一遍，并补上每一步的依据。`;
    }
    if (!gap.nextGoal) {
      gap.nextGoal = `下一次讲课先补上「${title}」的依据，再进入新题。`;
    }
  }

  for (const step of nextSteps) {
    if (!step.zpd) step.zpd = '边缘掌握';
  }

  if (!nextSteps.length) {
    nextSteps.push(
      {
        title: '先讲“为什么”，再讲“怎么做”',
        zpd: '边缘掌握',
        action: '每写一个步骤，先停一秒，用一句大白话补上依据。',
        example: '下次可以这样说：“这一步我用了等式两边同时加同一个数，等式仍然成立。”'
      },
      {
        title: '用一个具体数字验证',
        zpd: '未触及',
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
  /**
   * Get the previous assistant output for consecutive-pattern detection.
   * Returns the last visible assistant message content before the current turn.
   */
  _previousOutput(session) {
    const messages = visibleMessages(session);
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].content || '';
    }
    return '';
  }

  /**
   * Non-streaming completion for retry attempts. Collects the full text
   * without calling onDelta, so the user doesn't see a rejected stream.
   */
  async _completeQuiet(messages, settings, signal) {
    return completeChat({
      settings,
      messages,
      maxTokens: APP.limits.studentMaxTokens,
      temperature: settings.temperature ?? APP.defaults.temperature,
      signal
    });
  }

  async reply({ session, settings, signal, onDelta }) {
    const messages = buildStudentMessages(session);
    const prevOutput = this._previousOutput(session);
    let fullOutput = '';

    // First attempt: stream to the user, but also collect the full text.
    const wrappedOnDelta = (delta) => {
      fullOutput += delta;
      if (onDelta) onDelta(delta);
    };

    await streamChat({
      settings,
      messages,
      maxTokens: APP.limits.studentMaxTokens,
      temperature: settings.temperature ?? APP.defaults.temperature,
      signal,
      onDelta: wrappedOnDelta
    });

    // Post-detection: check the completed output.
    const result = checkStudentOutput(fullOutput, prevOutput);

    if (result.passed) {
      return fullOutput;
    }

    // If consecutive pattern is the only issue, we still show the output
    // (it's non-blocking). We just note it for the next turn.
    if (result.issues.length === 1 && result.consecutivePattern) {
      return fullOutput;
    }

    // Blocking issue detected: we need to retry.
    // The streamed output is already visible to the user via onDelta,
    // but the caller (app.js) will replace the message with the retry result
    // via finalizeMessageElement. We do silent retries here.
    for (let attempt = 0; attempt < MAX_OUTPUT_RETRIES; attempt++) {
      const retryMessages = [...messages];
      // Append the retry hint to the system message
      if (retryMessages[0]?.role === 'system') {
        retryMessages[0] = {
          ...retryMessages[0],
          content: retryMessages[0].content + '\n\n' + result.retryHint
        };
      }

      try {
        const retryOutput = await this._completeQuiet(retryMessages, settings, signal);
        const retryResult = checkStudentOutput(retryOutput, prevOutput);
        if (retryResult.passed || (retryResult.issues.length === 1 && retryResult.consecutivePattern)) {
          // Success: replace the visible output by calling onDelta with
          // the correction. The caller handles UI replacement.
          return retryOutput;
        }
      } catch {
        // If retry fails (e.g. network), fall through to safe fallback.
        break;
      }
    }

    // All retries exhausted: return safe fallback.
    return SAFE_FALLBACK_REPLY;
  }
}

export class TutorAgent {
  /**
   * 小理 teaches one small point, then asks one question. Output is streamed
   * straight to the chat; no student-style abuse checks apply here.
   */
  async reply({ session, settings, signal, onDelta }) {
    let fullOutput = '';
    const wrappedOnDelta = (delta) => {
      fullOutput += delta;
      if (onDelta) onDelta(delta);
    };

    await streamChat({
      settings,
      messages: buildTutorMessages(session),
      maxTokens: APP.limits.tutorMaxTokens,
      temperature: settings.temperature ?? APP.defaults.temperature,
      signal,
      onDelta: wrappedOnDelta
    });

    const text = clean(fullOutput);
    if (!text) throw new ApiError('小理这次没有回应，请再试一次。');
    return text;
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
