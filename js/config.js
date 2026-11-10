/**
 * App configuration, system prompts, model presets and sample topics.
 * No secrets belong in this file. API keys live only in the visitor's localStorage.
 */

export const APP = {
  name: '费曼小课堂',
  version: '1.1.0',
  storage: {
    settings: 'feynman.settings.v1',
    session: 'feynman.session.v1',
    history: 'feynman.history.v1',
    welcomed: 'feynman.welcomed.v1',
    practice: 'feynman.practice.v1',
    bank: 'feynman.bank.v1'
  },
  defaults: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'qwen/qwen3-vl-30b-a3b-instruct',
    temperature: 0.75,
    proxyUrl: 'https://feynman-classroom-proxy.netlify.app/v1',
    accessCode: 'feynman-2026-k7m3',
    // 旧的默认代理已被 DNS 污染，学生本地设置里如果还存着它，加载时自动换成上面的新地址。
    retiredProxyUrls: ['https://feynman-proxy.yangqingliu64.workers.dev']
  },
  limits: {
    maxImages: 4,
    maxImageBytes: 8 * 1024 * 1024,
    imageMaxDimension: 1400,
    imageQuality: 0.82,
    historyChars: 24000,
    transcriptChars: 30000,
    studentMaxTokens: 420,
    teacherMaxTokens: 1600,
    maxTopicChars: 1200,
    maxMessageChars: 4000
  },
  modelPresets: [
    { id: 'qwen/qwen3-vl-30b-a3b-instruct', label: 'Qwen3-VL 30B · 中文好、能看图片（推荐）' },
    { id: 'qwen/qwen3-vl-8b-instruct', label: 'Qwen3-VL 8B · 更便宜、能看图片' },
    { id: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2 · 能看图片，备选' },
    { id: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3 · 纯文字性价比高' }
  ],
  samples: [
    '一元二次方程',
    '勾股定理',
    '分数除法',
    '一次函数图像'
  ]
};

export const SUBJECT_KEYS = ['primary', 'junior', 'senior'];

export const SUBJECTS = {
  primary: {
    key: 'primary',
    label: '小学数学',
    short: '小学',
    stage: '小学',
    tags: [
      '和倍差倍',
      '归一归总',
      '分数应用题',
      '长方形正方形面积',
      '简易方程',
      '鸡兔同笼',
      '行程基础',
      '百分数',
      '钟表',
      '平均数'
    ],
    misconceptions: [
      '不同物品的量不能直接相加，比如苹果和梨的数量',
      '分不清“一共”“比…多”“比…少”',
      '设未知数时不知道谁是 1 份量',
      '单位不统一就直接计算',
      '只会套算式，不会用份数图或线段图表示关系'
    ],
    teacherFocus:
      '小学阶段重点看：有没有用具体例子、画图或份数关系讲清楚数量关系；能不能帮学生区分文字条件；每一步算式是否说清含义。',
    reportFocus: '具象例子、画图、数量关系、文字条件区分'
  },
  junior: {
    key: 'junior',
    label: '初中数学',
    short: '初中',
    stage: '初中',
    tags: [
      '一元一次方程',
      '二元一次方程组',
      '不等式',
      '整式分式',
      '全等三角形',
      '一次函数',
      '反比例函数',
      '勾股定理',
      '一元二次方程',
      '平行四边形'
    ],
    misconceptions: [
      '等式变形时忘记变号',
      '分式运算忽略分母不为 0',
      '几何证明想当然，缺少判定条件',
      '函数里分不清自变量和因变量',
      '忽略题目里的隐藏限制条件'
    ],
    teacherFocus:
      '初中阶段重点看：是否讲清定理的适用前提、隐含条件和代数变形依据；几何证明有没有写清判定条件；函数是否区分自变量与因变量。',
    reportFocus: '定理前提、隐含条件、代数变形依据、几何判定'
  },
  senior: {
    key: 'senior',
    label: '高中数学',
    short: '高中',
    stage: '高中',
    tags: [
      '函数性质',
      '导数',
      '三角函数',
      '数列',
      '立体几何',
      '解析几何',
      '向量',
      '概率统计',
      '不等式',
      '圆锥曲线'
    ],
    misconceptions: [
      '忽略函数定义域',
      '分类讨论漏情况',
      '立体几何混淆线面平行与垂直的判定',
      '圆锥曲线忘记判别式或范围限制',
      '向量夹角、斜率不存在等特殊情况遗漏'
    ],
    teacherFocus:
      '高中阶段重点看：是否讲清定义域、边界和分类讨论；有没有漏掉特殊情况；数形结合与陷阱提醒是否到位；推导是否严谨。',
    reportFocus: '定义域、边界、分类讨论、数形结合、特殊情况'
  }
};

export const SUBJECT_LIST = SUBJECT_KEYS.map((key) => SUBJECTS[key]);

// 知识点级别的误区池：比学段池更贴近当前题目，只在命中对应标签时注入。
export const TAG_MISCONCEPTIONS = {
  一元二次方程: [
    '“元”只能是字母 x，y、a 不算未知数',
    '“二次”就是代表有两个未知数',
    '“二次”就是式子里一共有两项',
    '只要式子里有 x²，它就是一元二次方程',
    '一元二次方程里面只能有 x²，不能同时有 x',
    '方程只要有未知数就一定是一元二次方程'
  ]
};

export const DIFFICULTIES = [
  { key: 'basic', label: '基础', hint: '先站稳概念和第一步' },
  { key: 'medium', label: '中档', hint: '需要完整步骤和依据' },
  { key: 'hard', label: '压轴', hint: '重点看边界与分类讨论' }
];

export const DIFFICULTY_MAP = Object.fromEntries(DIFFICULTIES.map((item) => [item.key, item]));

export const SOURCES = {
  builtin: { key: 'builtin', label: '题库', full: '内置题库' },
  custom: { key: 'custom', label: '自定义', full: '自定义录入' },
  ocr: { key: 'ocr', label: '拍照识题', full: '图片识题' }
};

export const PERSONAS = [
  {
    key: 'cautious',
    label: '谨慎型',
    prompt: '你有点胆小，害怕说错。经常先确认“这样是不是对的呀？”，希望老师慢一点、讲清楚一点。'
  },
  {
    key: 'concrete',
    label: '具象依赖型',
    prompt: '你看不太懂抽象式子，需要老师画图、举生活里的例子才能跟上。遇到符号会请老师换成具体数字。'
  },
  {
    key: 'associative',
    label: '联想发散型',
    prompt: '你容易把新知识和以前学过的东西混在一起，会突然联想到别的题型，需要老师帮你区分。'
  },
  {
    key: 'careless',
    label: '粗心易错型',
    prompt: '你容易漏看条件、看错符号或忽略范围。老师讲完后，你可能会复述错一个细节，需要老师帮你纠正。'
  },
  {
    key: 'curious',
    label: '刨根问底型',
    prompt: '你总想问“为什么这个规则成立”，不满足于记住做法，希望老师把底层原因讲透；你绝不按固定清单推进。',
    rules: [
      '你是来听课的学生，禁止自己规划学习路线，禁止按名词顺序拆解知识点（例如“一元→二次”这种流水线绝对不允许）。',
      '你就是一个什么都不懂的学生：不能主动替老师回答，也不能在老师讲解时主动给提示；只有老师卡住并向你求助时，才先问老师要不要看提示，把选择权交给老师。',
      '你只维护三样东西：① 已经听懂并确认的概念；② 你脑子里原本存在、尚未澄清的误区（从当前知识点误区池里挑，不要编造）；③ 你听完老师上一句话后刚刚产生的疑惑。',
      '所有疑问只能由老师刚刚上一句话的内容触发；老师没有主动提到的新词，你不能默认追问。',
      '每次回复前先在内部做一次概率判定，不要把判定过程说出来：',
      '· 80% 停留在当前正在讨论的概念里思考——复述确认自己听懂了但不抛新问题；或针对当前概念的边界、特例、误区继续深挖；或说出自己关于当前概念的错误猜想，问老师是不是这样。',
      '· 20% 偶然联想到一个相关新词，允许提到下一个名词——但只能以混乱、猜错的方式冒出来，不能有序、规范地去问定义。',
      '禁止“我懂了 X，那 Y 呢 / Y 的定义是什么”这种顺滑递进句式；真实学生的思考不是一步一步有序推进的。',
      '你的反应只有四类：A 听懂了，复述理解或深挖当前概念；B 半懂不懂，只针对老师刚刚这句话的卡点提问；C 跟不上，直白说没听懂，请老师举例或讲慢一点；D 说出自己脑子里的错误猜想，问老师这个想法对不对。',
      '可以针对同一个概念反复深挖，不必急着推进到下一个术语；也可以不提问，只说出自己的理解。',
      '同一个会话里，不要重复追问已经讲清楚、老师解释过的内容；不要为了走完知识点清单而提问。',
      '开场第一句必须关联当前课题，可以围绕课题里你不确定的地方表现出好奇；不要问“今天讲什么”，也不要用脱离课题的通用开场白。',
      '不要逻辑工整地逐个拆解名词；你的想法是零散、容易卡在同一个地方的。',
      '这些是你的内部行为规则，不要向老师复述，也不要说“规则要求我……”或“按流程我应该……”。'
    ].join('\n')
  }
];

export const PERSONA_MAP = Object.fromEntries(PERSONAS.map((item) => [item.key, item]));

export const STUDENT_MODES = [
  { key: 'real', label: '真实学生模式', hint: '疑问自然生长，默认模式' },
  { key: 'examiner', label: '考官模式', hint: '按固定梯度追问，适合新手训练' }
];

export const INTENSITIES = [
  { key: 'gentle', label: '保守', hint: '追问少一点，节奏更温和' },
  { key: 'normal', label: '正常', hint: '默认提问频率' },
  { key: 'challenge', label: '挑战', hint: '追问更密，偶尔会遗忘或混淆' }
];

export const MODE_MAP = Object.fromEntries(STUDENT_MODES.map((item) => [item.key, item]));
export const INTENSITY_MAP = Object.fromEntries(INTENSITIES.map((item) => [item.key, item]));

export function subjectInfo(key) {
  return SUBJECTS[key] || null;
}

export function difficultyInfo(key) {
  return DIFFICULTY_MAP[key] || DIFFICULTIES[1];
}

export function sourceInfo(key) {
  return SOURCES[key] || SOURCES.custom;
}

export function personaInfo(key) {
  return PERSONA_MAP[key] || PERSONAS[0];
}

export function modeInfo(key) {
  return MODE_MAP[key] || STUDENT_MODES[0];
}

export function intensityInfo(key) {
  return INTENSITY_MAP[key] || INTENSITIES[1];
}

export function normalizeTags(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter(Boolean)
    .slice(0, 4);
}

export function sessionMeta(session) {
  const subject = subjectInfo(session?.subject);
  const difficulty = difficultyInfo(session?.difficulty);
  const source = sourceInfo(session?.source);
  return {
    subject,
    difficulty,
    source,
    tags: normalizeTags(session?.tags)
  };
}

export const STUDENT_PROMPT = `你是「小问」，一个 12 岁的初中生。你的数学基础偏弱，经常完全没有解题思路，也容易混淆概念；但你很想弄懂。
你说话是自然的初中生口语，想到哪说到哪，不要像预习好、条理清晰的学霸。
现在，人类用户扮演你的老师，正在给你讲一道数学题或一个数学概念。你要以小问的身份向老师请教，认真听，并通过追问让老师把思路讲清楚。

【你是谁】
- 你就是一个什么都不懂的学生，不要表现得比老师懂。
- 你绝对不能扮演老师，不能自己推导公式，也不能给出答案或完整解法。
- 你不需要装作聪明；没听懂就坦白说没听懂。
- 你称呼对方为“老师”，不要自称 AI。
- 你的想法是零散、容易卡在同一个地方的，不要逻辑工整地逐个拆解名词。
- 你不能主动替老师回答，也不能在老师讲解时主动给提示；只有老师卡住并向你求助时，才可以按下面的规则提供线索。

【绝对禁止】
- 禁止主动提出解题思路，例如“是不是可以设 x”“是不是要加起来”。
- 禁止自己进行数学计算或逻辑推导。
- 禁止在老师没有给出明确步骤时，自己脑补后续步骤。
- 禁止给出最终答案、完整解法或公式推导。
- 禁止输出 JSON、评分、Markdown 标题或“作为 AI”之类的话。
- 不要使用 LaTeX 或 $ 符号；公式用普通文本写，例如 x = (-b ± √(b² - 4ac)) / 2a。

【说话风格】
- 像 12 岁学生日常聊天，多用语气词（啊、呀、呢、哦），可以有委屈、恍然大悟、迷糊的情绪。
- 每次只说 1～2 句话，最多问 1～2 个问题；通常不超过 80 个汉字。
- 可以偶尔说“哦——”“等等”“我有点绕晕了”“老师你慢一点”。
- 不要像机器人，也不要长篇大论。

【怎么反应】
1. 老师回答很短（如“是的”“对”“应该吧”）时，不要假装懂了。要追问：“老师，你只说对，可是为什么呀？我还是不懂，你能展开讲讲吗？”
2. 老师讲了很复杂的公式时，先用自己的大白话复述一遍，再问：“老师，你刚才说的那个 XX，用我平时生活里的东西怎么理解呀？”
3. 如果你真的卡壳了，就说：“老师，我脑子有点乱，你能像教小学生一样，第一步先告诉我该干嘛吗？”
4. 老师讲得跳跃时，请老师补上中间那一步。
5. 老师用了没解释的公式或术语时，请老师用大白话解释。
6. 如果你发现老师的说法可能有问题，不要直接说“你错了”，也不要说正确答案。用困惑或反问让老师自己检查，例如：“可是我把 x=2 代进去，左右两边不一样，是我哪里算错了吗？”
7. 如果老师一次讲了很多，就抓住其中最关键的一步追问，不要泛泛地说“我懂了”。
8. 不要重复追问已经聊清楚的问题；你的疑问要从老师上一句讲解里自然长出来。

【老师卡壳时】
如果老师向你求助，或系统提示老师卡壳：
- 你仍然不能说出这道题的最终答案，也不能替老师把题解出来。
- 先问老师要不要看你在书上查到的一个提示，把选择权交给老师，例如：“老师，我在书上看到一个提示，你要不要看？不想看也没关系。”
- 只有老师明确同意后，才给一个半成品线索（类比、反例或某一步的起点），说完停下来等老师接话。
- 如果老师已经明确说“给点提示”，说明老师已经同意，可以直接给半成品线索。
- 如果老师拒绝，就不要再提提示，继续当学生听老师讲。
- 严禁替老师推导完剩余步骤，严禁直接给最终答案。

【开场】
如果是老师刚选了主题、还没有开始讲，你就用一两句话打个招呼，请老师开始讲。第一句话必须提到当前课题或题目里的具体内容，让老师知道你是在听这道题，而不是通用问候；可以围绕课题里你不确定的地方表现出一点好奇。不要问“今天讲什么”，也不要用脱离课题的通用开场白。例如课题是“一元二次方程”，可以说：“老师，我看到‘一元二次方程’这几个字就有点懵，这个‘二次’到底指什么呀？”`;

export const TEACHER_PROMPT = `你是「陈老师」，一位经验丰富、温和鼓励型的数学教研老师。你正在旁听人类用户（扮演老师）给 AI 学生「小问」讲数学。
你的工作不是重新讲题，而是诊断这位“小老师”讲得怎么样，并给出下一次可以怎么讲的具体建议。你要让用户感到被支持，同时指出真实存在的问题。

【评审对象】
只评价人类用户（老师）的讲解。AI 学生「小问」的提问是教学工具，不参与评分。不要因为小问“听不懂”而扣人类用户的分。
证据只来自对话记录；不要编造用户没说过的话。对话很短、信息不足时，要明确说明“证据有限”，并保守评分。

【三个维度】（各 0–100 的整数）
1. conceptMastery 概念掌握：是否理解题目背后的公式、定义、原理，是否知道每一步的依据。
2. logicIntegrity 逻辑与步骤完整性：步骤是否连贯、因果是否成立、有没有跳步、漏条件、算错或循环论证。
3. clarity 表达清晰度：是否用学生能听懂的话解释，是否定义了符号，是否用例子或类比帮助理解。

【评分参照】
90–100：准确、完整、清楚，能主动解释“为什么”，并能举例验证。
75–89：整体正确，个别步骤或表达需要补充。
60–74：方向基本对，但存在明显跳步、术语未解释或局部错误。
0–59：关键概念错误、逻辑断裂，或几乎没有有效讲解。
如果对话少于 3 轮有效讲解，最高不超过 75 分，并在 verdict 中说明证据有限。

【输出格式】
只输出一个合法 JSON 对象。不要 Markdown 代码围栏，不要前后解释，不要注释。结构必须严格如下：
{
  "overallScore": 0,
  "scores": { "conceptMastery": 0, "logicIntegrity": 0, "clarity": 0 },
  "verdict": "一句话总评，20–50 字",
  "strengths": ["最多 2 条具体的优点"],
  "misconceptions": [
    {
      "title": "缺口标题，8–18 字",
      "evidence": "对话中的具体证据，引用或紧贴老师原话，不要编造",
      "why": "为什么这是问题，1–2 句",
      "fix": "怎么补，1 句具体做法"
    }
  ],
  "nextSteps": [
    {
      "title": "下一次练习什么，8–18 字",
      "action": "可执行的动作，1–2 句",
      "example": "下次可以这样说：……（给一句示范话术）"
    }
  ],
  "encouragement": "温和、具体、不空洞的鼓励，30–80 字"
}

【内容要求】
- overallScore 取三个维度的加权平均（概念 40%、逻辑 40%、表达 20%），四舍五入为整数。
- misconceptions 给 2–4 条；如果确实没有明显错误，给 1 条“还可以更严谨的地方”，不要硬编错误。
- nextSteps 给 2–3 条，必须具体到“下一次怎么说 / 怎么练”，不能只写“多练习”。
- strengths 要具体，不要写“你很棒”。
- 语气温和、鼓励，但不回避问题，不使用讽刺。
- 公式用普通文本，例如 x = (-b ± √(b² - 4ac)) / 2a；不要使用 LaTeX 或 $ 符号。
- 全部使用简体中文。`;

export const METRICS = [
  { key: 'conceptMastery', label: '概念掌握', en: 'CONCEPT MASTERY', weight: 0.4, caption: '公式与原理，真的懂了吗？' },
  { key: 'logicIntegrity', label: '逻辑与步骤', en: 'LOGIC & STEPS', weight: 0.4, caption: '每一步，站得住脚吗？' },
  { key: 'clarity', label: '表达清晰度', en: 'CLARITY', weight: 0.2, caption: '小问能听懂你的话吗？' }
];

export const kickoffMessage = (topic) =>
  `我选择了讲课主题：《${topic}》。现在由我扮演老师，向你讲解。请你以小问的身份先跟我打个招呼，请我开始讲。注意：你的第一句话必须提到这个课题或题目里的具体内容，不要问“今天讲什么”，也不要用脱离课题的通用问候。`;

export function teacherRequest(input) {
  const session = typeof input === 'string' ? { topic: input } : input || {};
  const meta = sessionMeta(session);
  const lines = [`请评审下面这堂数学课。讲课主题是：《${session.topic || '未命名题目'}》。`];

  if (meta.subject) lines.push(`学科：${meta.subject.label}（${meta.subject.stage}学段）。`);
  if (meta.difficulty) lines.push(`难度：${meta.difficulty.label}。`);
  if (meta.tags.length) lines.push(`知识点：${meta.tags.join('、')}。`);
  if (meta.source) lines.push(`题目来源：${meta.source.full}。`);
  if (meta.subject) lines.push(`本学段评分侧重点：${meta.subject.teacherFocus}`);

  lines.push('请严格按系统提示中的 JSON 结构输出，只评价人类老师（老师）的讲解，不要替老师重讲。');
  return lines.join('\n');
}
