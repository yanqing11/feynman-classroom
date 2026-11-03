# 架构说明 · Feynman Classroom

> 目标：让“讲出来”这件事足够低摩擦，让“看见自己的逻辑缺口”足够具体。

## 1. 设计约束

| 约束 | 决策 |
| --- | --- |
| 必须能发布到 GitHub Pages | 纯静态：`index.html` + `styles.css` + ES Modules，无构建步骤 |
| 不把 API Key 写进仓库 | BYOK：访问者在设置中输入，仅存 `localStorage` |
| 课堂流畅 | 学生回复流式输出；教师报告一次生成 |
| 数学场景 | 纯文本公式约定 + 图片/手写，避免依赖外部公式 CDN |
| 未来上平板 | 所有输入先抽象为“消息 + 附件”，便于替换采集层 |
| 隐私 | 无后端、无分析、无第三方字体/CDN；数据只在本机与模型服务商之间流动 |

## 2. 运行时拓扑

```text
┌──────────────────────────── 浏览器（静态站点） ────────────────────────────┐
│                                                                            │
│  index.html / styles.css                                                   │
│        │                                                                   │
│        ▼                                                                   │
│  app.js  ── UI 状态机、事件、渲染、弹窗、图片压缩                            │
│    │                                                                       │
│    ├── store.js      会话 + 设置 + localStorage + 状态迁移                   │
│    ├── agents.js     StudentAgent / TeacherAgent + 上下文构造 + 报告归一化    │
│    ├── api.js        fetch + SSE 流式解析 + JSON 模式 + 错误映射              │
│    ├── speech.js     Web Speech API                                       │
│    └── canvas.js     Pointer Events 手写板                                  │
│                                                                            │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ HTTPS（BYOK，浏览器直连）
                                ▼
                 ┌─────────────────────────────────┐
                 │ OpenRouter / OpenAI-compatible  │
                 │ Chat Completions API            │
                 │  · StudentAgent → stream: true  │
                 │  · TeacherAgent → JSON mode     │
                 └─────────────────────────────────┘
```

没有应用服务器。若未来需要隐藏 Key、统一计费或接入私有模型，只需在浏览器与模型之间加一层代理，前端 `api.js` 的接口保持不变。

## 3. 两个 Agent

### 3.1 StudentAgent（面向用户）

- 人设：初中生「小问」，基础差、好奇、慢半拍。
- 职责：针对老师刚讲的内容追问；装傻、要例子、要求补步骤；发现可疑处用困惑反问。
- 硬约束：不给答案、不总结全题、不编造步骤、不用 LaTeX。
- 调用：`POST /chat/completions`，`stream: true`，`temperature 0.75`，`max_tokens 420`。
- 输入上下文：
  - `system`：Prompt + 当前主题 + 边界；
  - 历史消息：人类老师 = `user`，小问 = `assistant`；
  - 图片：以 `image_url` data URL 形式附在对应 `user` 消息里。

### 3.2 TeacherAgent（后台评审）

- 人设：经验丰富、鼓励型数学教研老师「陈老师」。
- 职责：只评价**人类老师**的讲解，指出概念、步骤、表达上的缺口，给出下一次的示范话术。
- 硬约束：不重讲题目；只引用对话证据；证据不足时保守评分；严格 JSON。
- 调用：`stream: false`，`temperature 0.3`，`max_tokens 1600`，`response_format: json_object`。
- 输入上下文：
  - `system`：评审 Prompt；
  - `user`：带说话人标签的完整对话 + 主题 + 有效轮数 + 图片；
  - 明确提示“小问的提问不参与评分”。

### 3.3 为什么不是一个大 Agent

- **角色冲突**：同一个模型既要“装不懂”又要“专业评审”，容易在对话中泄漏答案。
- **成本与延迟**：学生每轮都要回复；教师只在按钮触发时运行。分离后可以各自选择模型与参数。
- **可测试性**：两个 Prompt 可以独立回归；教师报告可以不依赖学生人设的稳定性。
- **可替换性**：未来可以把 StudentAgent 换成更便宜的模型，把 TeacherAgent 换成更强的模型。

## 4. 前端状态流

### 4.1 状态机

```text
        ┌────────┐   开始讲课    ┌──────────┐
        │  HOME  │ ───────────▶ │ TEACHING │
        └────────┘              └──────────┘
             ▲                    │      ▲
             │ 结束 / 重新开始      │      │ 关闭报告 / 出错 / 取消
             │                    ▼      │
        ┌────────┐  报告成功   ┌───────────┐
        │ REPORT │ ◀────────── │ EVALUATING │
        └────────┘             └───────────┘
             │                       │
             └──── 继续讲一会儿 ──────┘
```

| 状态 | 界面 | 允许的动作 |
| --- | --- | --- |
| `home` | 主题输入卡 | 开始讲课、设置 |
| `teaching` | 对话界面 | 发送、图片/手写/语音、呼叫老师、结束 |
| `evaluating` | 报告弹窗 loading | 等待、关闭（取消请求） |
| `report` | 报告弹窗内容 | 继续讲、复制、重新开始 |

`store.js` 用 `ALLOWED` 表校验迁移，非法迁移只记录警告，不破坏当前会话。

### 4.2 子状态：`busy`

`busy` 不是页面状态，而是“学生 Agent 正在生成”的 UI 锁：

- 输入框禁用、发送按钮变成「停止」；
- 呼叫老师禁用；
- 首个 token 到达前显示“小问正在想”；
- 用户点「停止」触发 `AbortController.abort()`，已生成的部分保留。

### 4.3 关键界面序列

```text
主题输入 ──▶ Chat ──▶ Teacher Report Modal
   │            │              │
   │            ├─ 图片预览      ├─ 三维评分
   │            ├─ 手写板        ├─ 理解缺口
   │            └─ 语音输入      ├─ 下一次这样讲
   │                           └─ 复制 / 继续 / 重开
   └─ 示例主题 / 题目图片
```

## 5. 请求生命周期

### 5.1 开始讲课

```text
用户输入 topic [+ image]
  → store.start(topic, image)
      · 创建 session
      · 写入一条 hidden user 消息（开场指令 + 题目图片）
  → UI 切到 Chat
  → StudentAgent 生成开场白
```

隐藏的开场消息保证：

- 模型知道“老师已经选了主题”；
- 题目图片进入学生上下文；
- 界面不重复显示一条“我选择了主题……”的机械消息。

### 5.2 每一轮讲解

```text
用户发送 text + images
  → store.addMessage('user', ...)
  → POST /chat/completions (stream)
  → 首个 delta：创建 assistant 消息
  → 后续 delta：静默追加 + 局部更新 DOM（不整页重渲染）
  → 完成：trim、persist、移除光标
```

### 5.3 呼叫老师

```text
点击「呼叫 AI 老师点评」
  → 状态 teaching → evaluating
  → 打开报告弹窗（loading）
  → 构造 transcript（只含 user/assistant，按预算截断）
  → 非流式请求 + JSON mode
  → parseReport() 归一化
  → store.setReport() + 渲染
  → 状态 evaluating → report
```

错误路径：

- 取消/关闭弹窗：abort 请求，状态回到 `teaching`；
- 解析失败/网络失败：弹窗显示错误卡片 + 「再试一次」，状态回到 `teaching`；
- 图片导致模型不支持：自动去掉图片重试一次。

## 6. 上下文管理

### 6.1 学生上下文

- 以字符预算（默认 24,000）从最近消息向前累积，至少保留 6 条。
- 图片按约 1,600 字符估算，避免图片很多时挤掉文字。
- 裁剪后若首条是 `assistant`，补回开场 `user`，保证角色序列合法。
- 不把教师报告注入学生上下文，避免学生“知道答案”后不再追问。

### 6.2 教师上下文

- 只取**可见**消息，隐藏开场不进入 transcript（主题单独给出）。
- 每条加 `老师：` / `小问：` 标签，防止模型搞混说话人。
- 最多保留约 30,000 字符；优先保留最近内容。
- 图片最多 3 张（含题目图片），并在文本中标注 `[附图片]`。
- 有效轮数 < 3 时，运行时追加“证据有限、最高 75 分”的约束。

### 6.3 为什么不用向量记忆

当前场景是单次、短时的讲课会话，完整转录比 RAG 更可靠，也更便宜。未来长课程可以引入滚动摘要：

```text
最近 N 轮原文 + 更早内容的摘要 + 关键错误列表
```

## 7. 报告与评分

### 7.1 Schema

```json
{
  "overallScore": 0,
  "scores": {
    "conceptMastery": 0,
    "logicIntegrity": 0,
    "clarity": 0
  },
  "verdict": "",
  "strengths": [],
  "misconceptions": [
    { "title": "", "evidence": "", "why": "", "fix": "" }
  ],
  "nextSteps": [
    { "title": "", "action": "", "example": "" }
  ],
  "encouragement": ""
}
```

### 7.2 分数计算

```text
overall = round(conceptMastery × 0.4 + logicIntegrity × 0.4 + clarity × 0.2)
```

客户端会重新夹取到 0–100，并在模型漏字段时补齐默认值。少于 3 轮有效讲解时显示「证据有限 · 已保守评分」。

### 7.3 防幻觉

- Prompt 要求“只引用对话中的证据”；
- 没有明显错误时，允许给一条“还可以更严谨”的温和建议；
- 归一化层不补造具体错误，只给通用但可执行的回退建议；
- UI 明确标注“AI 生成，仅用于学习诊断”。

## 8. 持久化与隐私

| 数据 | 位置 | 生命周期 |
| --- | --- | --- |
| API Key | `localStorage` | 用户点击「清除 Key」或清除浏览器数据 |
| 设置（模型、温度、Base URL） | `localStorage` | 同上 |
| 当前会话（文字 + 图片） | `localStorage` | 刷新可恢复；结束讲课时删除 |
| 报告 | 会话内 | 随会话删除 |

存储降级策略：

1. 正常写入；
2. 超出配额时，去掉图片再写一次，并提示“图片没有随对话保存”；
3. 仍失败则删除旧会话，提示无法自动保存。

安全边界：

- 代码库中没有 Key、Token、`.env` 或私有路径；
- `.gitignore` 覆盖 `.env*`、`config.local.js`、`secrets.*`、`*.pem`、`*.key`；
- CSP 限制脚本只能来自本站，连接只允许 HTTPS / 本地开发地址；
- 用户内容通过 `textContent` 或先转义再插值，避免 XSS；
- 无 `eval`、无动态 HTML 注入、无第三方脚本。

## 9. 多模态演进：从“网页打字”到“平板语音 + 手写”

这是原型里最大的技术跳跃。当前版本已经把手写和语音做成**可替换的采集层**，但没有把它们伪装成“完整的手写 OCR + 语音评分”。下面是可落地的分阶段方案。

### 9.1 统一消息模型

所有输入都归一化为：

```ts
type Attachment =
  | { kind: 'image'; dataUrl: string; source: 'upload' | 'camera' | 'canvas'; }
  | { kind: 'audio'; blobId: string; durationMs: number; transcript?: string; }
  | { kind: 'ink'; dataUrl: string; strokes?: Stroke[]; }

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments: Attachment[];
  createdAt: string;
  meta?: { inputMode: 'type' | 'voice' | 'handwriting' | 'mixed'; };
};
```

当前实现：

- `upload` / `camera` / `canvas` → 压缩为 JPEG data URL；
- `voice` → Web Speech API 转成文字，进入 `text`；
- 手写 → canvas 导出 PNG，作为 `image` 附件。

这样教师 Agent 今天就能“看到”手写截图；未来接入 OCR 后，只需在消息里追加 `latex` 字段，不需要改 UI。

### 9.2 采集层接口

```ts
interface CaptureSource<T> {
  start(): Promise<void>;
  stop(): Promise<T>;
  cancel(): void;
  onUpdate?(partial: T): void;
}
```

- `KeyboardSource`：textarea。
- `SpeechSource`：Web Speech API（当前）→ MediaRecorder + 流式 STT（未来）。
- `InkSource`：Pointer Events + `<canvas>`（当前）→ 保留原始 stroke 点、压感、倾斜（未来）。
- `CameraSource`：`<input capture>` → `getUserMedia` + 边缘检测/裁切（未来）。

### 9.3 手写：从“截图”到“结构化笔迹”

当前：

- Pointer Events 统一鼠标 / 触控 / Apple Pencil；
- `pressure` 影响线宽；
- 高 DPI 缩放；
- 导出白底 PNG，作为视觉模型的图片输入。

下一步：

1. **保留原始 stroke**：`{x, y, pressure, tilt, time}`，存 IndexedDB，而不是只存 PNG。
2. **在线识别**：使用 Mathpix / MyScript / 自建 CNN-Transformer，把笔迹转 LaTeX。
3. **双通道输入**：图片给视觉模型，LaTeX 给文本模型；两者不一致时让教师 Agent 指出“你写的和你说的不一致”。
4. **可回放**：报告里可以回放学生写某一步时的笔顺，用于诊断“会算但写乱”的问题。
5. **橡皮/撤销的语义**：当前是像素级；未来保留 stroke 级操作，方便重新识别。

### 9.4 语音：从“转文字”到“讲法诊断”

当前：

- Web Speech API 实时转写，直接落到输入框；
- 只保留文本，不保留音频。

下一步：

1. **音频留存（可选）**：MediaRecorder 录 webm/opus，存 IndexedDB，默认 24 小时后清理。
2. **流式 STT**：Whisper streaming / 云厂商实时 ASR，带时间戳与置信度。
3. **副语言特征**：语速、停顿、重复、填充词（“呃”“然后”），作为“表达清晰度”的辅助信号。
4. **可解释**：报告中引用“你在 00:42 停顿了 4 秒，然后跳过了‘为什么’”，而不是只给一个分数。
5. **隐私开关**：默认只传文字；音频上传需要用户显式开启。

### 9.5 视觉与 OCR

- 题目图片：压缩后作为 `image_url` 发送给视觉模型；
- 手写截图：同上传路径；
- 未来服务端 OCR：把图片转成“题目文本 + 手写 LaTeX”，再与用户口述文本对齐；
- 对不支持视觉的模型：自动退回文字 + “（图片未读取）”提示，不静默失败。

### 9.6 存储升级

`localStorage` 适合短文本，不适合音频/笔迹。未来：

```text
IndexedDB
  ├── sessions (metadata)
  ├── messages (text)
  └── blobs (images / audio / ink)
```

同步策略：

- 本地优先；
- 需要跨设备时，再引入可选账号与加密同步；
- 服务端只存加密 blob，Key 由客户端管理。

### 9.7 从 BYOK 到代理服务

当前直连模型服务商，优点是零后端、零成本托管；缺点是 Key 暴露在浏览器、无法统一计费、部分服务商 CORS 不支持。

升级路径（不改变前端调用面）：

```text
浏览器 ──POST /api/chat──▶ 轻量代理（Cloudflare Worker / Vercel Function）
                              ├── 注入服务端 Key
                              ├── 鉴权 / 配额 / 限流
                              ├── 内容安全
                              └── 转发 SSE
```

`api.js` 只需要把 `baseUrl` 指向 `/api`，请求/流式解析逻辑不变。

### 9.8 多模态融合评审（未来）

```text
文字转录 ─┐
语音特征 ─┼─▶ 证据对齐层 ─▶ TeacherAgent ─▶ 报告
手写 LaTeX ┘
```

对齐层的职责：

- 把“口述的第 3 步”与“手写的第 3 行”对应起来；
- 发现“说的和写的不一致”；
- 给每条证据附上时间戳 / 图片区域，报告可点击回看。

这比单纯把三种输入拼进 Prompt 更可靠，也能控制 token 成本。

## 10. 可靠性与性能

- **流式**：学生回复首 token 即显示，降低等待焦虑。
- **局部更新**：每个 delta 只更新当前气泡，不重渲染整个列表。
- **持久化节流**：流式过程中不写 `localStorage`，结束后写一次。
- **图片压缩**：最长边 1400 px，JPEG 0.82，减少带宽与存储。
- **请求取消**：`AbortController` 覆盖学生生成与教师评审；关闭弹窗即取消。
- **JSON 兼容**：`response_format` 不被支持时自动降级重试。
- **错误分层**：401/402/403/404/429/5xx 分别给出可操作提示；CORS 单独提示。
- **无障碍**：焦点陷阱、Esc 关闭、`aria-live` 对话区、跳过链接、减少动态偏好。

## 11. 测试清单

- [ ] `index.html` 在仓库根目录，所有资源为相对路径。
- [ ] 无 Key 时开始讲课 → 自动打开设置；保存后自动继续。
- [ ] 学生开场白只问不答；连续 3 轮上下文不串角色。
- [ ] 发送图片 / 手写 / 语音后，消息与上下文一致。
- [ ] 呼叫老师 → loading → 报告；关闭弹窗会取消请求。
- [ ] 报告 JSON 缺字段 / 分数越界 / 代码围栏 → 仍能渲染。
- [ ] 刷新页面 → 恢复会话；结束讲课 → 清除会话但保留 Key。
- [ ] 无 Key、错误 Key、错误模型、断网 → 提示可理解且可恢复。
- [ ] 移动端 390×844、平板 820×1180、桌面 1440×900 布局正常。
- [ ] Git 预检：无 `.env`、无 Token、无个人路径、无私有数据。

## 12. 已知边界

- 纯前端直连依赖服务商 CORS；OpenAI 官方端点通常不允许浏览器直连，OpenRouter 可以。
- 语音识别质量取决于浏览器与网络；不支持时只隐藏能力，不影响文字课堂。
- 手写目前是“图片”，不是“可计算的公式”；复杂公式的识别需要 OCR 服务。
- 教师报告是形成性评价，不是高利害考试评分。
- `localStorage` 约 5 MB；大量图片会自动降级，长期课程应迁移 IndexedDB。
