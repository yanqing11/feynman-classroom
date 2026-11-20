# 发布手册 · Git / GitHub / GitHub Pages

> 这份文件先于任何 Git 命令创建，用于审阅将要执行的步骤。  
> 原请求中的仓库地址是占位符 `[PASTE REPOSITORY ADDRESS]`，所以下面的远程命令使用 `<owner>/<repo>`；在拿到真实地址之前不会执行 `push`。

## 0. 两个必须先说明的限制

1. **我不能代替你注册 GitHub 账号。** 注册需要你的邮箱、邮箱验证码、人机验证，并需要你本人同意 GitHub 服务条款。请打开 <https://github.com/signup> 自行完成；建议随后开启两步验证。
2. **不要把密码或访问令牌粘贴到对话或项目文件里。** 认证应通过浏览器登录（`gh auth login`）或系统凭据管理器（Git Credential Manager）完成。本项目不会读取、写入或提交任何令牌。

## 1. 发布前预检

### 1.1 结构

```text
index.html              ← 必须在仓库根目录，引用 assets/ 下带哈希的构建产物
styles.css / app.js     ← 源文件
js/*.js                 ← 含按需加载的 speech.js / canvas.js / report-image.js
manifest.json           ← PWA 清单（快捷方式 + 安装截图）
sw.js                   ← 离线 Service Worker，含构建时生成的预缓存清单
assets/                 ← app.<hash>.js、分包、styles.<hash>.css、图标、PWA 截图
.nojekyll
```

### 1.2 相对路径

`index.html` 中的资源必须形如：

```html
<link rel="stylesheet" href="./assets/styles.<hash>.css">
<script type="module" src="./assets/app.<hash>.js"></script>
<link rel="icon" href="./assets/favicon.svg">
<link rel="manifest" href="./manifest.json">
```

`npm run build` 会自动改写这两处引用，并同步更新 `sw.js` 里的 `BUILD_ASSETS` 预缓存清单。

不能出现以 `/` 开头的站点根路径、本机绝对路径、`file:///...` 或写死的 `https://<user>.github.io/<repo>/...`。

### 1.3 密钥与隐私扫描（PowerShell）

```powershell
# 1) 明确列出将被提交的文件（排除 .gitignore 忽略项）
git ls-files

# 2) 扫描常见密钥/令牌/私钥/个人路径特征
git grep -n -I -E "sk-or-v1-[A-Za-z0-9]|sk-proj-[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|api[_-]?key[[:space:]]*[:=][[:space:]]*['\"][^'\"]+|C:\\\\Users\\\\|/Users/[A-Za-z0-9._-]+/" -- .

# 3) 确认敏感文件没有被跟踪
git ls-files | Select-String -Pattern "\.env|config\.local\.js|secrets\.|\.pem$|\.key$"
```

预期：

- 第 1 条只出现项目源码与文档；
- 第 2 条只可能命中文档中的“示例模式”，不出现真实 Key；
- 第 3 条没有输出（`.gitignore` 已覆盖）。

### 1.4 手动确认

- [ ] `index.html` 在根目录。
- [ ] 资源路径全部相对。
- [ ] 没有 `.env`、`config.local.js`、`node_modules`、日志、截图中的个人信息。
- [ ] 没有真实姓名、邮箱、学号、手机号、家庭住址、学校内部链接。
- [ ] 没有把 API Key 写进 `js/config.js`、`README.md` 或任何示例。
- [ ] 没有本机私有绝对路径（用户目录、本地盘符路径等）。
- [ ] 没有第三方统计、追踪像素或外部字体。

## 2. 初始化并提交（本地，安全）

在项目根目录执行：

```bash
git init -b main
git add .
git status --short
git diff --cached --stat
git commit -m "Build Feynman Classroom: two-agent math learning app"
```

如果还没有配置提交身份，先设置（使用你自己的 GitHub 用户名与邮箱）：

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

> 这里使用仓库级配置，不会修改全局 Git 设置。提交作者信息会出现在公开仓库中，请使用你愿意公开的邮箱。

## 3. 创建空仓库并连接

### 方式 A：网页创建（推荐给第一次使用的人）

1. 打开 <https://github.com/new>。
2. Repository name 填 `<repo>`。
3. 选择 Public。
4. **不要**勾选 “Add a README file”“Add .gitignore”“Choose a license”（保持空仓库）。
5. 创建后复制仓库地址，例如 `https://github.com/<owner>/<repo>.git`。

然后：

```bash
git remote add origin https://github.com/<owner>/<repo>.git
git remote -v
git push -u origin main
```

推送时如果弹出登录窗口，请使用浏览器登录或系统凭据管理器；**不要在终端、对话或文件里粘贴令牌**。

### 方式 B：GitHub CLI（需要先安装 `gh` 并登录）

```bash
gh auth login          # 选择 GitHub.com → HTTPS → Login with a web browser
gh repo create <repo> --public --source=. --remote=origin
git push -u origin main
```

当前环境没有安装 `gh`，所以本次没有执行这些命令。

## 4. 配置 GitHub Pages

### 网页操作

1. 打开 `https://github.com/<owner>/<repo>/settings/pages`。
2. **Build and deployment → Source** 选择 **Deploy from a branch**。
3. **Branch** 选择 **main**，文件夹选择 **/(root)**。
4. 点击 **Save**。
5. 等待 “Your site is live at …” 出现（通常 30–90 秒）。

### CLI 操作（仓库已存在、已认证）

首次启用：

```bash
gh api --method POST repos/<owner>/<repo>/pages \
  -f source.branch=main \
  -f source.path=/
```

已启用后修改：

```bash
gh api --method PUT repos/<owner>/<repo>/pages \
  -f source.branch=main \
  -f source.path=/
```

查看状态：

```bash
gh api repos/<owner>/<repo>/pages
```

## 5. 最终地址

| 项目 | URL |
| --- | --- |
| 仓库 | `https://github.com/<owner>/<repo>` |
| GitHub Pages | `https://<owner>.github.io/<repo>/` |
| 自定义域名（可选） | 在 Pages 设置中填写，并按提示配置 DNS |

`index.html` 在根目录、资源使用相对路径，因此子路径部署不需要额外配置。

## 6. 发布后验证

- [ ] 打开 Pages URL，首页正常渲染，无 404。
- [ ] DevTools → Console 无 CSP / MIME / 模块加载错误。
- [ ] 打开设置，填入 Key，测试连接成功。
- [ ] 开始讲课 → 小问只追问，不给答案。
- [ ] 讲 2–3 轮 → 呼叫老师 → 报告正常显示。
- [ ] 刷新页面 → 会话恢复；结束讲课 → 会话清空、Key 保留。
- [ ] 手机与平板检查布局、手写板、语音权限。
- [ ] 分享链接后，确认没有把 Key 或对话写进 URL。

## 7. 以后更新

```bash
npm install          # 首次或依赖变化时
npm run build        # 重新生成 assets/ 下的分包与哈希文件，并更新 index.html + sw.js
npm run screenshots  # 仅在首页视觉变化时重新生成 PWA 安装截图
npm run test:e2e     # 用系统 Edge 跑端到端测试；CI 自动改用 Chromium
git add .
git commit -m "Describe the change"
git push
```

GitHub Pages 会自动重新发布，不需要额外的构建配置。仓库的 `.github/workflows/verify.yml` 也会在每次 push / PR 上重复 `npm run build`，并用 `git diff --exit-code -- assets index.html sw.js` 阻止忘记构建的提交。

资源引用使用 `assets/app.<hash>.js`、`assets/styles.<hash>.css` 以及按需加载的 `*-<hash>.js` 分包：哈希随内容变化，旧缓存会自动失效，因此不需要手动加 `?v=` 版本参数。**务必将构建后的 `assets/` 产物和 `sw.js` 一起提交**，否则线上会 404 或离线失效。

## 8. 回滚

```bash
git log --oneline
git revert <commit>
git push
```

不要使用 `git push --force` 覆盖公开历史，除非你明确知道后果。

## 9. 本次实际执行范围

已完成：

- 创建静态项目文件，`index.html` 位于仓库根目录，资源全部使用相对路径；
- 在浏览器中验证首页、开课、多轮对话、呼叫老师、报告评分、手写板、题目图片、结束讲课、刷新恢复；
- 在 390 px 手机宽度和 1440 px 桌面宽度下检查，无横向溢出，控制台无错误；
- 运行 `node --check` 与密钥/隐私扫描，未发现真实密钥；
- 执行 `git init -b main`、`git add .`，并创建本地提交 `6df8b1c`；
- 使用中性作者 `Feynman Classroom <feynman-classroom@users.noreply.github.com>`（本机未配置 Git 身份）；
- 通过 Git Credential Manager 以 GitHub 账号 `yanqing11` 完成设备码授权；
- 执行 `git push -u origin main`，远端 `refs/heads/main` 指向 `6df8b1c`；
- 通过 GitHub Pages API 启用发布：分支 `main`、目录 `/`，构建状态 `built`；
- 验证线上首页与全部资源均返回 HTTP 200，控制台无错误。

线上地址：

| 项目 | URL |
| --- | --- |
| 仓库 | <https://github.com/yanqing11/feynman-classroom> |
| GitHub Pages | <https://yanqing11.github.io/feynman-classroom/> |
| 课堂共享代理（默认） | <https://feynman-classroom-proxy.netlify.app/v1> |
| 代理健康检查 | <https://feynman-classroom-proxy.netlify.app/v1/chat/completions> |
| 备用代理（Worker） | <https://feynman-proxy.yangqingliu64.workers.dev> |

## 10. 课堂共享代理

学生默认不需要 API Key：网页把请求发给代理，代理用环境变量里的真实 Key 转发给 OpenRouter。

### 10.1 默认：Netlify Edge Function

`*.workers.dev` 在中国大陆经常被 DNS 污染，学生打不开；`*.netlify.app` 通常可以直连。因此默认代理是 Netlify：

```text
https://feynman-classroom-proxy.netlify.app/v1
```

代码在 `netlify/`，详细说明见 [`netlify/README.md`](netlify/README.md)。

部署（Token 从本地文件读取，不写进命令历史、不打印）：

```powershell
$env:NETLIFY_AUTH_TOKEN = (Get-Content '<本地 Netlify Token 文件>' -Raw).Trim()
$env:NETLIFY_SITE_ID = '<Netlify Site ID>'
cd D:\Feynman
npx -y netlify-cli@latest deploy --prod --no-build --dir netlify/public
```

当前配置：

| 项 | 值 |
| --- | --- |
| Netlify 站点 | `feynman-classroom-proxy` |
| 代理地址 | `https://feynman-classroom-proxy.netlify.app/v1` |
| 运行方式 | Netlify Edge Function（`netlify/edge-functions/chat.js`） |
| 允许来源 | `https://yanqing11.github.io`、本地 `127.0.0.1:8000` / `localhost:8000` |
| 允许模型 | `qwen/qwen3-vl-30b-a3b-instruct`、`qwen/qwen3-vl-8b-instruct`、`mistralai/mistral-small-3.2-24b-instruct`、`deepseek/deepseek-chat-v3-0324` |
| 限流 | 每 IP 每分钟 30 次（单实例内存计数，软限流） |
| 单次 token 上限 | 2000 |

> **注意**：Netlify 新站点可能默认开启 SSO 保护，导致所有请求返回 401 登录跳转。需要在站点设置里关闭 SSO / Visitor access，或用 API 设置 `sso_login: false`。

### 10.2 备用：Cloudflare Worker

`worker/` 目录保留一个功能等价的 Worker，接口与 Netlify 版本一致，可作为备份。

部署：

```powershell
$env:CLOUDFLARE_API_TOKEN = (Get-Content '<本地 Cloudflare Token 文件>' -Raw).Trim()
$env:CLOUDFLARE_ACCOUNT_ID = '<Cloudflare Account ID>'
cd worker
npx -y wrangler@latest deploy
```

写入密钥（输入不回显）：

```powershell
npx -y wrangler@latest secret put UPSTREAM_KEY   # OpenRouter Key
npx -y wrangler@latest secret put ACCESS_CODE    # 课堂访问码
```

Worker 名称 `feynman-proxy`，地址 `https://feynman-proxy.yangqingliu64.workers.dev`。如果以后绑定了自己的域名，把 `js/config.js` 的 `defaults.proxyUrl` 换过去即可。

访问码写在 `js/config.js` 的 `defaults.accessCode`（会随网页公开，只是防扫站的软门槛）。真正的保护是来源校验、限流和模型白名单。

## 如需把提交作者改成你自己的姓名与邮箱

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
git commit --amend --reset-author --no-edit
git push --force-with-lease
```

注意：`--force-with-lease` 会改写公开历史，仅在确认没有其他人基于该提交工作时使用。

## 11. 第二轮优化记录

本轮在同一站点上完成并随本次提交发布：

- **真正的离线**：`sw.js` 在安装时按 `BUILD_ASSETS` 预缓存全部 JS/CSS（含语音、手写板、报告渲染分包），已用「清 HTTP 缓存 + 断网刷新」的端到端用例验证。
- **对比度与字号**：深色主题 `--faint` 调到 `#85938b`（对卡片背景 4.95:1）；所有中文标签与说明不低于 12px，装饰性英文 kicker 例外。
- **备份导入**：设置里新增「导入备份 JSON」，档案按 ID 合并、题库按 ID 合并，API Key 不被覆盖；同时新增多标签页数据变更提示。
- **PWA**：清单加入 `shortcuts`（开课 / 档案）与 `screenshots`；截图由 `npm run screenshots` 生成。
- **构建与测试**：esbuild 拆分首屏与懒加载分包；CI 校验构建产物一致性；E2E 覆盖 PNG 真实下载、离线、深色对比度、中文字号、备份导入和 PWA 快捷方式，共 8 项全部通过。

## 12. 本机数据库

本轮新增统一的浏览器 IndexedDB 数据库，不引入后端：

- **数据库**：`feynman-classroom` v2，五张对象仓库 `questions / history / sessions / drafts / kv`；原有的 v1 题库仓库会被就地升级，题目不会丢失。
- **迁移**：首次打开时把旧 `localStorage` 的题库、档案、当前课堂、草稿和设置标记一次性写入数据库；已有记录不覆盖，迁移标记存在 `kv` 表。
- **兼容**：`store.js` / `history.js` 的同步 API 不变，采用内存缓存 + `localStorage` 镜像 + 数据库双写；数据库不可用时自动退回原有逻辑。
- **状态面板**：设置 → 数据管理新增「本机数据库」，显示库版本与各表记录数，可手动刷新。
- **验证**：E2E 增加数据库结构、迁移、课堂恢复、档案同步写入 / 清空与状态面板用例，全套 12 项通过。

## 13. 教师视角学情面板

本轮在「学习档案」顶部新增本地教师视角，不改零后端架构：

- **一句话结论**：自动汇总近五次均分、与前五次的分差、最薄弱知识点、反复出现的理解缺口和需要重讲的课时数。
- **行动卡片**：优先补的知识点、反复出现的理解缺口、来自低分课的下一次教学动作；每张卡片可点开对应诊断报告。
- **辅助视图**：四维指标趋势（综合 + 三维）、课时质量分布、卡点学科分布；支持一键复制可发给老师的学情摘要。
- **数据来源**：全部由当前筛选范围内的本机档案计算，学科、主题、档案和 API Key 都不会因此上传。
- **验证**：新增学情汇总 E2E 用例，全套 13 项通过。

## 14. 教师视角学情面板增强

在原有面板上补充老师最需要的「变化、证据、定位、转发」四件事，仍然只用本机档案：

- **时间对比**：一句话结论增加「近 7 天讲了 X 课，平均 Y%」；面板新增本周 / 上周的课时、均分、卡点对比条，均分变化直接标出升降。
- **学生原话证据**：薄弱知识点、理解缺口、教学动作和重点课时都附上学生最后一次可见发言的引用，老师可直接看到「孩子当时怎么说的」。
- **重点课时筛选**：按知识点下拉和 `全部 / 需重讲 / 待巩固 / 已掌握` 分数段快速筛选，按分数从低到高列出最多 6 节课，点开即看完整诊断。
- **一键周报**：`复制周报` 生成本周学情周报 Markdown，含本周对比、本周课程、优先补的知识点、需要关注的理解缺口和下周教学动作，可直接转发给家长或真人老师。
- **验证**：原有用例扩展覆盖 7 天对比、原话引用、筛选与周报复制，全套 13 项通过。

## 15. 学情报告导出

把教师学情面板的结论变成可以直接转发的本机文件，不新增任何依赖或网络请求：

- **Markdown 文件**：`导出摘要 .md` 保存学情摘要，`导出周报 .md` 保存本周周报，文件名带时间戳，内容与「复制」按钮一致。
- **学情长图 PNG**：`导出长图` 按需加载 `js/teacher-image.js`，用 Canvas 绘制 1080px 宽长图，包含一句话结论、本周 / 上周对比、表现趋势、课时质量分布、优先补的知识点、理解缺口和下周教学动作，学生原话一并呈现在图上。
- **构建**：`scripts/build.mjs` 的清理规则纳入 `teacher-image`，分包与 `sw.js` 预缓存列表由构建脚本自动更新。
- **验证**：教师面板 E2E 增加三种下载断言（Markdown 文件名与内容、PNG 魔数与 1080px 宽度），全套 13 项通过。

## 16. 深度学情分析

在教师面板末尾新增「深度学情分析」区，并同步进摘要、周报与长图导出：

- **掌握度随时间趋势**：SVG 折线画出最近 12 节有诊断记录的「概念掌握」与「综合评分」，按时间从早到晚，悬停可看每课数值。
- **三维能力雷达**：SVG 雷达同时叠加总体平均与最近 5 课，快速看出哪一项能力在变化。
- **卡点题目复盘**：档案只保存手动标记的卡点（`turn` + 时间），没有逐题对错数据；这里把每个卡点映射回当时的提问与学生回答，再按提问文本聚合成「反复卡住的题」，并明确标注为推导结果，不冒充自动判题。
- **下一步教学建议**：综合近 7 天走势、最弱维度、反复卡点、低分课与薄弱知识点生成 4 条以内可执行建议。
- **导出同步**：学情摘要、本周周报 Markdown 与 1080px 长图都带上卡点题目与建议，长图高度按内容自适应。
- **验证**：教师面板 E2E 增加图表数量、卡点题目、建议文案及导出内容断言，全套 13 项通过。
