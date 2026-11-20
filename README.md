# 费曼小课堂 · Feynman Classroom

> 把你会的东西，讲给一个听不懂的学生听。

一个**零后端**的静态数学学习应用，把**费曼学习法**和**苏格拉底式提问**变成一个可量化的练习：

学生扮演老师，把数学题的思路讲给 AI 学生「小问」听；小问只提问、不代答；卡住时，可以随时呼叫 AI 老师「陈老师」，拿到一份三维评分 + 理解缺口 + 下一次怎么讲的诊断报告。

```
主题输入  →  讲课对话  →  呼叫 AI 老师  →  量化诊断报告
   ↑                                              │
   └──────────── 换一个主题，重新开始 ────────────┘
```

**在线体验：<https://yanqing11.github.io/feynman-classroom/>**

## 这是什么

- **输出倒逼输入**：讲不清的地方，就是还没真正懂的地方。
- **两个 AI 角色**：面向学生的 `StudentAgent`（只追问，不给答案）与后台评审的 `TeacherAgent`（指出漏洞，给出下一步）。
- **可量化**：概念掌握、逻辑与步骤完整性、表达清晰度三个 0–100 的维度，加上具体缺口和可执行的练习建议。
- **三科独立**：小学数学 / 初中数学 / 高中数学各自拥有快捷知识点标签、误区池、追问风格和档案统计；一节课内可锁定学科。
- **自定义题库**：内置例题、手动录入、拍照识别都能进入同一套讲课 / 评分 / 档案流程；我的题库支持学科、难度、知识点、备注、编辑和删除。
- **多模态入口**：文字、图片、手写板、语音输入（Web Speech API）。只上传题目图片也能自动识别题目。
- **打开即用**：默认走课堂共享代理，学生不需要 API Key；也可以填自己的 Key 直连服务商（Key 默认保存在本机 `localStorage`，也可选择仅本次会话保存）。

## 快速开始

### 学生：直接打开链接

<https://yanqing11.github.io/feynman-classroom/>

不用填 Key，直接写主题 / 传题目图片就能开课。

### 老师：换成自己的 Key（可选）

推荐 [OpenRouter](https://openrouter.ai/keys)：一个 Key 可以调用 `qwen/qwen3-vl-30b-a3b-instruct` 等模型，并且允许浏览器直接请求（CORS）。在设置里填入 Key 后，请求会绕过共享代理、直接发往你选择的模型服务商。

### 本地开发

直接双击 `index.html` 可以浏览界面，但**语音输入和部分浏览器的 API 调用需要安全上下文**，建议起一个本地静态服务器：

```bash
npm install
npm run serve
# 打开 http://127.0.0.1:4173
```

修改 `app.js` / `styles.css` 等源文件后，发布前运行构建，把带哈希的压缩产物写入 `assets/` 并更新 `index.html` 和 `sw.js` 的预缓存清单：

```bash
npm run build
```

构建会按内容拆包：首屏只加载主包和共享包，语音、手写板、报告长图渲染器在首次使用时才下载。需要重新生成 PWA 安装截图时运行：

```bash
npm run screenshots
```

端到端测试默认使用系统 Microsoft Edge（无需额外下载浏览器），并会拦截模型请求；CI 环境会自动改用 Playwright 自带的 Chromium：

```bash
npm run test:e2e
```

每次推送 / PR 都会由 `.github/workflows/verify.yml` 执行 `npm run build` 并检查产物与提交一致，然后再跑端到端测试。

### 连接设置

点击右上角 **设置** 可以查看当前连接方式：

- 默认：课堂共享代理（不用 Key）；
- 自定义：填入自己的 API Key，请求直接发往你选择的模型服务商；
- 勾选「仅本次会话保存 Key」后，Key 只写入 `sessionStorage`，关闭浏览器后自动清除，不会落到 `localStorage`。

> 旧版默认代理（`*.workers.dev`）在大陆常被 DNS 污染。如果你之前打开过页面，浏览器里可能还存着旧地址；新版会自动把旧默认地址换成 Netlify 代理，你自定义过的代理地址不会被改动。

> 仓库里没有任何 API Key。共享代理的真正 Key 存放在 Netlify 环境变量中；自己的 Key 只存在于当前浏览器的 `localStorage`。

## 课堂共享代理

默认代理是 **Netlify Edge Function**：

```text
https://feynman-classroom-proxy.netlify.app/v1
```

选择 Netlify 是因为 `*.netlify.app` 在中国大陆通常可以直连，而 `*.workers.dev` 经常被 DNS 污染。

- 代码在 [`netlify/`](netlify/README.md)，部署与接线步骤见 [`netlify/README.md`](netlify/README.md)；
- 默认地址写在 `js/config.js` 的 `defaults.proxyUrl` 与 `defaults.accessCode`；
- 学生打开页面即可开课，不需要填写任何密钥。

`worker/` 目录保留了一个功能等价的 Cloudflare Worker 版本，作为备用部署方案，见 [`worker/README.md`](worker/README.md)。

## 功能

| 功能 | 说明 |
| --- | --- |
| 主题输入 | 文字主题 / 题目；支持导入题目图片、拍照识别并校对 |
| 学科与难度 | 小学数学 / 初中数学 / 高中数学；基础 / 中档 / 压轴；每科带一组可点选的快捷知识点标签（最多选 4 个） |
| 我的题库 | 题目、学科、难度、知识点、备注和图片存在本机，可搜索、载入、编辑、删除 |
| AI 学生小问 | 12 岁、基础很弱，只追问不给答案；五种人设（默认刨根问底型）、真实 / 考官模式和追问强度；阶段 A 只会逐字说两句等待语，老师真正开讲后才进入阶段 B |
| 对话界面 | 老师右侧、AI 学生左侧；支持多轮上下文 |
| 呼叫 AI 老师 | 对完整对话做结构化诊断，报告以独立弹窗展示 |
| 三维评分 | 概念掌握 40% + 逻辑与步骤 40% + 表达清晰度 20%；每个维度带对话证据与改进建议 |
| 理解缺口 | 每条包含证据、原因、怎么补；可一键针对缺口重新开课 |
| 下一次这样讲 | 带示范话术的具体建议，可一键复制 Markdown 报告 |
| 学习档案 | 首页入口；记录学科、主题、时间、三维分数，支持展开详情、课堂回放、单条删除与 Markdown 复制；卡点会单独汇总，可一键重讲 |
| 教师工作台 | 首页「教师工作台」或面板「打开工作台」进入独立全屏视图：两节课并排对比分数与三维维度、学情时间线点选填入对比、批量勾选导出摘要 Markdown、一键打印视图；全部基于本机档案，零后端 |
| 教师视角学情面板 | 档案顶部的学情速览：一句话结论、近 7 天 / 前 7 天对比、学生原话证据、近五次与三维趋势、课时质量分布、优先补的知识点、反复出现的理解缺口、下一次教学动作；深度分析含掌握度随时间趋势、三维能力雷达、由手动卡点推导的卡点题目复盘和下一步教学建议；可按知识点和分数段筛选重点课时；一键复制或导出学情摘要 / 本周周报 Markdown，一键导出 1080px 学情长图，点卡片直达对应诊断报告 |
| 报告导出 | 报告可复制 Markdown，也可导出 1080px 宽、至少 1200px 高的 PNG 长图，渲染器按需加载；方便发给老师或存档 |
| 备份与恢复 | 设置里可导出全部 JSON，也可导入备份：档案按记录 ID 合并，题库按题目 ID 合并；导入不会覆盖当前 API Key |
| 自动保存与恢复 | 当前对话与 `hasTeacherSpeak` 同步写入 `localStorage` 与本机数据库，刷新后可直接接着讲；界面会显示最近一次自动保存时间；也可以「放弃本次课堂」，确认后清空且不归档 |
| 本机数据库 | 浏览器 IndexedDB `feynman-classroom` v2，含 `questions / history / sessions / drafts / kv` 五张表；旧数据首次打开自动迁移，设置里可查看库状态与记录数 |
| 离线壳 | Service Worker 在安装时预缓存全部 JS/CSS 分包（含语音、手写板、报告渲染器），清掉 HTTP 缓存后断网仍可用；支持桌面图标与「开始讲课 / 学习档案」快捷方式 |
| 失败重试 | AI 请求失败时保留老师已发送的内容，给出友好提示和「重试」按钮 |
| 移动端 | 快捷标签自动换行、输入框与按钮全宽 / 加大触控面积 |
| 图片 | 题目拍照；只传图片也会自动识别成文字题目，再开始讲课 |
| 手写板 | Pointer Events，支持鼠标 / 触控 / Apple Pencil |
| 语音输入 | Web Speech API，中文识别，可中途停止 |
| 题库存储 | 我的题库写入统一的 IndexedDB 数据库，不可用时退回 `localStorage`；图片不离开本机 |
| 键盘 | `Ctrl/Cmd+Enter` 发送讲解或开始讲课、`Enter` 换行、`Esc` 关闭弹窗 |
| 多标签页 | 另一个标签页改动课堂 / 档案 / 设置时显示同步提示，避免两边静默互相覆盖 |
| 无障碍 | 课中流式输出不逐句播报，结束后统一播报；中文标签与说明字号不低于 12px，深色主题次要文字对比度 ≥ 4.5:1 |

## 文件结构

```text
.
├── index.html              # 页面入口（引用 assets/ 中带哈希的构建产物）
├── styles.css              # 纸张 / 墨水风格的设计系统（源文件）
├── app.js                  # UI 状态机、事件、渲染（源文件）
├── manifest.json           # PWA 清单（快捷方式 + 安装截图）
├── sw.js                   # 离线缓存 Service Worker（预缓存全部构建分包）
├── package.json            # 构建 / 本地预览 / E2E / 截图脚本
├── playwright.config.js
├── .github/workflows/verify.yml # CI：构建一致性 + E2E
├── scripts/                # esbuild 构建、静态服务器、图标与截图生成
├── tests/                  # Playwright 端到端测试
├── netlify.toml            # Netlify 站点配置（默认共享代理）
├── netlify/
│   ├── edge-functions/
│   │   └── chat.js         # /v1/chat/completions 代理
│   ├── public/index.html   # 代理状态页
│   └── README.md
├── worker/                 # Cloudflare Worker 备用代理
│   ├── index.js
│   ├── wrangler.toml
│   └── README.md
├── js/
│   ├── config.js           # 学科 / 难度 / 人设 / 模式配置、两个 System Prompt、模型预设
│   ├── builtin-questions.json # 精选题库（打开题库时按需加载）
│   ├── api.js              # OpenRouter / OpenAI-compatible 客户端（流式 + JSON）
│   ├── agents.js           # StudentAgent / TeacherAgent、学科上下文与报告归一化
│   ├── store.js            # 状态机、会话与课堂参数持久化、设置
│   ├── history.js          # 学习档案、知识点统计、教师学情汇总、深度分析与周报
│   ├── db.js               # 统一本机数据库（IndexedDB v2，五张表 + 一次性迁移）
│   ├── bank.js             # 我的题库（统一 IndexedDB + localStorage 回退）
│   ├── speech.js           # Web Speech API 封装（按需加载）
│   ├── canvas.js           # 手写板（Pointer Events + 压感，按需加载）
│   ├── report-image.js     # 报告 PNG 渲染器（按需加载）
│   └── teacher-image.js    # 教师学情长图 PNG 渲染器（按需加载）
├── assets/                 # 构建后的 app.<hash>.js / 分包 / styles.<hash>.css、图标与 PWA 截图
├── PROMPTS.md              # 两个 Agent 的完整 System Prompt 与报告 Schema
├── ARCHITECTURE.md         # 架构、上下文管理、多模态演进方案
├── PUBLISHING.md           # Git / GitHub / Pages 发布步骤
├── .nojekyll               # GitHub Pages 直接发布静态文件
└── .gitignore
```

所有资源路径都是相对的（`./assets/app.<hash>.js`、`./manifest.json` 等），因此可以直接部署到 `https://<user>.github.io/<repo>/` 这样的子路径。

## 配置

默认配置在 `js/config.js`：

| 项 | 默认值 |
| --- | --- |
| API Base URL | `https://openrouter.ai/api/v1` |
| 课堂共享代理 | `https://feynman-classroom-proxy.netlify.app/v1` |
| 模型 | `qwen/qwen3-vl-30b-a3b-instruct` |
| 温度 | `0.75` |
| 每轮学生回复上限 | `420` tokens |
| 报告上限 | `1600` tokens |
| 历史上下文预算 | 约 `24,000` 字符 |
| 图片上限 | 每轮 4 张，最长边 1400 px，JPEG 0.82 |

用户可以在设置里覆盖 Base URL、模型和温度，覆盖值只保存在本机。

## 数据与隐私

- 页面本身没有后端数据库、没有日志、没有分析、没有第三方字体或 CDN；唯一的数据库是浏览器本机 IndexedDB。
- 默认请求经过课堂共享代理：代理持有模型 Key，只转发对话内容，不落库。
- 自己填写的 API Key 默认存于 `localStorage`；勾选「仅本次会话保存」后改存 `sessionStorage`，关闭浏览器即清除。都不会写入代码、Git 仓库或部署产物。
- 当前对话、课堂参数和学习档案同时写入 `localStorage` 和本机 IndexedDB 数据库；同步读取仍走内存缓存 / `localStorage`，所以刷新后可以直接接着讲。结束讲课时当前会话转为学习档案，可随时清空（两处一起清）。
- 本机数据库名 `feynman-classroom`，版本 2，包含 `questions / history / sessions / drafts / kv` 五张表。旧版题库数据与 `localStorage` 档案、会话、草稿首次打开时一次性迁移进数据库，已有记录不会被覆盖。
- 导出的 JSON 备份会自动移除 API Key；导入时按记录 ID 合并档案与题库，不会覆盖本机现有 Key，导入结果同步写入数据库。
- 我的题库、学习档案和当前课堂都优先存于 IndexedDB（不可用时回退 `localStorage`），包括题目图片；所有数据都不会上传到本站服务器。
- 图片在浏览器内压缩后发送给模型服务商；只用于识别题目或回答，不经过本站服务器。
- 若浏览器存储空间不足，应用会保留文字并丢弃图片，同时在界面提示。
- 报告由 AI 生成，仅用于学习诊断，不替代真人老师的判断。

## 部署到 GitHub Pages

完整命令见 [`PUBLISHING.md`](./PUBLISHING.md)。

核心步骤：

1. 运行 `npm install && npm run build`，把源文件构建成 `assets/` 下带哈希的静态资源。
2. 把仓库根目录的静态文件（含 `index.html`、`assets/`、`manifest.json`、`sw.js`）推送到 `main`。
3. 仓库 **Settings → Pages → Build and deployment**：
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/(root)**
4. 等待 Actions 完成，访问 `https://<username>.github.io/<repo>/`。

因为项目使用相对路径，不需要配置构建命令或 `base` 路径；GitHub Pages 本身不做构建，所以本地构建产物必须一起提交。

## 浏览器支持

- **推荐**：Chrome / Edge（桌面与 Android）、Safari（macOS / iPadOS，手写与语音体验最佳）。
- 语音输入依赖 Web Speech API，需要 HTTPS 或 `localhost`。
- 使用纯前端直连时，只有支持 CORS 的服务商可用；OpenRouter 是最省心的选择。
- 模型是否支持图片取决于所选模型；不支持时会退回纯文字上下文。

## 设计说明

界面刻意避开常见的「紫色渐变 AI 聊天框」：使用暖纸色、墨绿、砖红和衬线标题，把对话做成一张课堂记录纸；报告做成一张带印章的诊断单。所有图标为内联 SVG，没有外部依赖。

## License

MIT（可自行替换）。
