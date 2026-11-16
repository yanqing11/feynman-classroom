# Netlify Edge Function 共享代理

这个目录是 `worker/` 的 Netlify 替代方案。目的是让中国大陆的学生在不翻墙的情况下也能连上共享代理，因为 `*.workers.dev` 常被 DNS 污染，而 `*.netlify.app` 通常可以直连。

## 结构

```text
netlify.toml
netlify/
├── edge-functions/
│   └── chat.js        # POST /v1/chat/completions
└── public/
    └── index.html     # 代理状态页，不是课堂页面
```

课堂页面仍然在 GitHub Pages：<https://yanqing11.github.io/feynman-classroom/>

## 环境变量

在 Netlify 站点后台 **Site configuration → Environment variables** 设置：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `UPSTREAM_KEY` | 是 | OpenRouter（或其他兼容服务）的真实 Key，只放在 Netlify |
| `UPSTREAM_BASE` | 否 | 默认 `https://openrouter.ai/api/v1` |
| `ACCESS_CODE` | 否 | 课堂访问码，前端用 `x-access-code` 发送 |
| `ALLOWED_ORIGINS` | 否 | 逗号分隔，建议 `https://yanqing11.github.io,http://127.0.0.1:8000,http://localhost:8000` |
| `ALLOWED_MODELS` | 否 | 逗号分隔，留空则不限制；建议只放课堂用到的模型 |
| `RATE_LIMIT_PER_MINUTE` | 否 | 每 IP 每分钟请求数，默认 30 |
| `MAX_TOKENS` | 否 | 单次请求 token 上限，默认 2000 |
| `SITE_URL` | 否 | 发给 OpenRouter 的 `HTTP-Referer` |

## 部署

首次部署需要 Netlify 账号和 Personal Access Token。Token 只放在本地文件，不要提交到 Git，也不要发在聊天里。

```powershell
# Token 从本地文件读取，不打印
$env:NETLIFY_AUTH_TOKEN = (Get-Content '<本地 token 文件>' -Raw).Trim()
$env:NETLIFY_SITE_ID = '<Netlify site id>'

cd D:\Feynman
npx -y netlify-cli@latest deploy --prod
```

部署完成后，把 `js/config.js` 的 `defaults.proxyUrl` 改成：

```js
proxyUrl: 'https://<站点名>.netlify.app/v1'
```

前端会在后面自动拼 `/chat/completions`，所以这里必须以 `/v1` 结尾。

## 验证

```powershell
# 健康检查
curl.exe -sS https://<站点名>.netlify.app/v1/chat/completions

# 访问码错误应返回 401
curl.exe -sS -X POST https://<站点名>.netlify.app/v1/chat/completions `
  -H "Content-Type: application/json" `
  -H "Origin: https://yanqing11.github.io" `
  -H "x-access-code: wrong" `
  -d '{"model":"qwen/qwen3-vl-30b-a3b-instruct","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'

# 正常请求应返回 200，stream=true 时应返回 text/event-stream
```

## 注意

- Netlify 新站点可能默认开启 **SSO / Visitor access**，导致所有请求返回 401 登录跳转。部署后先访问站点首页；如果出现 Netlify 登录页，需要在站点设置里关闭访问保护，或调用 API 把 `sso_login` 设为 `false`。
- Edge Function 的限流是**单实例内存计数**，只能挡住短时间高频刷接口，不是严格的全局限流。真正的额度保护靠访问码、模型白名单和 token 上限。
- 免费套餐有请求数和带宽限制；课堂规模上来后需要观察 Netlify 用量。
- `UPSTREAM_KEY` 只存在 Netlify 环境变量里，网页和 Git 仓库里都没有。
