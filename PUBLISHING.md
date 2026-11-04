# 发布手册 · Git / GitHub / GitHub Pages

> 这份文件先于任何 Git 命令创建，用于审阅将要执行的步骤。  
> 原请求中的仓库地址是占位符 `[PASTE REPOSITORY ADDRESS]`，所以下面的远程命令使用 `<owner>/<repo>`；在拿到真实地址之前不会执行 `push`。

## 0. 两个必须先说明的限制

1. **我不能代替你注册 GitHub 账号。** 注册需要你的邮箱、邮箱验证码、人机验证，并需要你本人同意 GitHub 服务条款。请打开 <https://github.com/signup> 自行完成；建议随后开启两步验证。
2. **不要把密码或访问令牌粘贴到对话或项目文件里。** 认证应通过浏览器登录（`gh auth login`）或系统凭据管理器（Git Credential Manager）完成。本项目不会读取、写入或提交任何令牌。

## 1. 发布前预检

### 1.1 结构

```text
index.html              ← 必须在仓库根目录
styles.css
app.js
js/*.js
assets/favicon.svg
.nojekyll
```

### 1.2 相对路径

`index.html` 中的资源必须形如：

```html
<link rel="stylesheet" href="./styles.css">
<script type="module" src="./app.js"></script>
<link rel="icon" href="./assets/favicon.svg">
```

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
git add .
git commit -m "Describe the change"
git push
```

GitHub Pages 会自动重新发布。JS/CSS 有更新时，建议在 `index.html` 的资源引用后加版本参数（例如 `./app.js?v=20261103`），避免浏览器缓存旧文件。

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
| 课堂共享代理 | <https://feynman-proxy.yangqingliu64.workers.dev> |
| 代理健康检查 | <https://feynman-proxy.yangqingliu64.workers.dev/health> |

## 10. 课堂共享代理（Cloudflare Worker）

学生默认不需要 API Key：网页把请求发给 Worker，Worker 用 Secret 里的真实 Key 转发给 OpenRouter。

部署（Token 从本地文件读取，不写进命令历史、不打印）：

```powershell
$env:CLOUDFLARE_API_TOKEN = (Get-Content '<本地 Token 文件>' -Raw).Trim()
$env:CLOUDFLARE_ACCOUNT_ID = '<Cloudflare Account ID>'
cd worker
npx -y wrangler@latest deploy
```

写入密钥（输入不回显）：

```powershell
npx -y wrangler@latest secret put UPSTREAM_KEY   # OpenRouter Key
npx -y wrangler@latest secret put ACCESS_CODE    # 课堂访问码
```

当前配置：

| 项 | 值 |
| --- | --- |
| Worker 名称 | `feynman-proxy` |
| workers.dev 子域 | `yangqingliu64` |
| 允许来源 | `https://yanqing11.github.io`、本地 `127.0.0.1:8000` / `localhost:8000` |
| 允许模型 | `z-ai/glm-5.3-flash`、`mistralai/mistral-small-3.2-24b-instruct`、`deepseek/deepseek-chat-v3-0324`、`qwen/qwen3.7-flash` |
| 限流 | 每 IP 每分钟 30 次；每日额度默认关闭 |
| 单次 token 上限 | 2000 |

访问码写在 `js/config.js` 的 `defaults.accessCode`（会随网页公开，只是防扫站的软门槛）。真正的保护是来源校验、限流和模型白名单。

> **网络可达性提醒**：`*.workers.dev` 在中国大陆常被 DNS 污染，若学生打不开代理，需要给 Worker 绑定一个自己的域名（Cloudflare → Workers → feynman-proxy → Settings → Domains & Routes → Add custom domain），或把代理迁到其他可达主机。网页本身在 GitHub Pages 上通常可访问。

## 如需把提交作者改成你自己的姓名与邮箱

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
git commit --amend --reset-author --no-edit
git push --force-with-lease
```

注意：`--force-with-lease` 会改写公开历史，仅在确认没有其他人基于该提交工作时使用。
