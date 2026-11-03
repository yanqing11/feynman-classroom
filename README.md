# 费曼小课堂 · Feynman Classroom

> 把你会的东西，讲给一个听不懂的学生听。

一个**零后端、零构建**的静态数学学习应用，把**费曼学习法**和**苏格拉底式提问**变成一个可量化的练习：

学生扮演老师，把数学题的思路讲给 AI 学生「小问」听；小问只提问、不代答；卡住时，可以随时呼叫 AI 老师「陈老师」，拿到一份三维评分 + 理解缺口 + 下一次怎么讲的诊断报告。

```
主题输入  →  讲课对话  →  呼叫 AI 老师  →  量化诊断报告
   ↑                                              │
   └──────────── 换一个主题，重新开始 ────────────┘
```

## 这是什么

- **输出倒逼输入**：讲不清的地方，就是还没真正懂的地方。
- **两个 AI 角色**：面向学生的 `StudentAgent`（只追问，不给答案）与后台评审的 `TeacherAgent`（指出漏洞，给出下一步）。
- **可量化**：概念掌握、逻辑与步骤完整性、表达清晰度三个 0–100 的维度，加上具体缺口和可执行的练习建议。
- **多模态入口**：文字、图片、手写板、语音输入（Web Speech API）。
- **隐私优先**：没有服务器、没有数据库、没有分析脚本；API Key 只保存在访问者自己的 `localStorage` 中。

## 快速开始

### 1. 准备一个 API Key

推荐 [OpenRouter](https://openrouter.ai/keys)：一个 Key 可以调用 `openai/gpt-4o-mini` 和 `anthropic/claude-3-haiku`，并且允许浏览器直接请求（CORS）。

也可以使用任何兼容 **OpenAI Chat Completions** 的服务，只要它允许浏览器直连。

### 2. 在本地打开

直接双击 `index.html` 可以浏览界面，但**语音输入和部分浏览器的 API 调用需要安全上下文**，建议起一个本地静态服务器：

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

或者使用 Node：

```bash
npx serve .
```

### 3. 连接 AI

点击右上角 **设置**，填入 API Key、选择模型，点 **测试连接**，保存。

> 本项目不会内置、上传或记录任何 API Key。Key 只存在于当前浏览器的 `localStorage`，并直接发送给你选择的模型服务商。

## 功能

| 功能 | 说明 |
| --- | --- |
| 主题输入 | 文字主题 / 题目；支持导入题目图片 |
| AI 学生小问 | 口语化追问、装傻、要例子，**绝不直接给答案** |
| 对话界面 | 老师右侧、AI 学生左侧；支持多轮上下文 |
| 呼叫 AI 老师 | 对完整对话做结构化诊断，报告以独立弹窗展示 |
| 三维评分 | 概念掌握 40% + 逻辑与步骤 40% + 表达清晰度 20% |
| 理解缺口 | 每条包含证据、原因、怎么补 |
| 下一次这样讲 | 带示范话术的具体建议，可直接复制报告 |
| 图片 | 题目拍照、手写推导；有视觉能力的模型会读取图片 |
| 手写板 | Pointer Events，支持鼠标 / 触控 / Apple Pencil |
| 语音输入 | Web Speech API，中文识别，可中途停止 |
| 自动保存 | 当前对话存在 `localStorage`，刷新后可继续；结束讲课时清空 |
| 键盘 | `Enter` 发送、`Shift+Enter` 换行、`Ctrl/Cmd+Enter` 开始讲课、`Esc` 关闭弹窗 |

## 文件结构

```text
.
├── index.html              # 唯一的页面入口（必须位于仓库根目录）
├── styles.css              # 纸张 / 墨水风格的设计系统
├── app.js                  # UI 状态机、事件、渲染
├── js/
│   ├── config.js           # 应用配置、两个 System Prompt、模型预设
│   ├── api.js              # OpenRouter / OpenAI-compatible 客户端（流式 + JSON）
│   ├── agents.js           # StudentAgent / TeacherAgent、上下文与报告归一化
│   ├── store.js            # 状态机、会话持久化、设置
│   ├── speech.js           # Web Speech API 封装
│   └── canvas.js           # 手写板（Pointer Events + 压感）
├── assets/favicon.svg
├── PROMPTS.md              # 两个 Agent 的完整 System Prompt 与报告 Schema
├── ARCHITECTURE.md         # 架构、上下文管理、多模态演进方案
├── PUBLISHING.md           # Git / GitHub / Pages 发布步骤
├── .nojekyll               # GitHub Pages 直接发布静态文件
└── .gitignore
```

所有资源路径都是相对的（`./styles.css`、`./app.js`、`./assets/favicon.svg`），因此可以直接部署到 `https://<user>.github.io/<repo>/` 这样的子路径。

## 配置

默认配置在 `js/config.js`：

| 项 | 默认值 |
| --- | --- |
| API Base URL | `https://openrouter.ai/api/v1` |
| 模型 | `openai/gpt-4o-mini` |
| 温度 | `0.75` |
| 每轮学生回复上限 | `420` tokens |
| 报告上限 | `1600` tokens |
| 历史上下文预算 | 约 `24,000` 字符 |
| 图片上限 | 每轮 4 张，最长边 1400 px，JPEG 0.82 |

用户可以在设置里覆盖 Base URL、模型和温度，覆盖值只保存在本机。

## 数据与隐私

- 无后端、无数据库、无日志、无分析、无第三方字体或 CDN。
- API Key 仅存于 `localStorage`；不会写入代码、Git 仓库或部署产物。
- 对话同样仅存于 `localStorage`；点击「结束讲课」会删除当前会话。
- 图片在浏览器内压缩后，直接发送给模型服务商；不经过本站服务器。
- 若浏览器存储空间不足，应用会保留文字并丢弃图片，同时在界面提示。
- 报告由 AI 生成，仅用于学习诊断，不替代真人老师的判断。

## 部署到 GitHub Pages

完整命令见 [`PUBLISHING.md`](./PUBLISHING.md)。

核心步骤：

1. 把仓库根目录的静态文件推送到 `main`。
2. 仓库 **Settings → Pages → Build and deployment**：
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/(root)**
3. 等待 Actions 完成，访问 `https://<username>.github.io/<repo>/`。

因为项目使用相对路径，不需要配置构建命令或 `base` 路径。

## 浏览器支持

- **推荐**：Chrome / Edge（桌面与 Android）、Safari（macOS / iPadOS，手写与语音体验最佳）。
- 语音输入依赖 Web Speech API，需要 HTTPS 或 `localhost`。
- 使用纯前端直连时，只有支持 CORS 的服务商可用；OpenRouter 是最省心的选择。
- 模型是否支持图片取决于所选模型；不支持时会退回纯文字上下文。

## 设计说明

界面刻意避开常见的「紫色渐变 AI 聊天框」：使用暖纸色、墨绿、砖红和衬线标题，把对话做成一张课堂记录纸；报告做成一张带印章的诊断单。所有图标为内联 SVG，没有外部依赖。

## License

MIT（可自行替换）。
