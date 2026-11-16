# 课堂共享代理（Cloudflare Worker）

这个 Worker 把真正的模型 API Key 藏在服务器端，学生打开网页就能上课，**不需要填写 Key**。

```
学生浏览器  →  Worker（持有 Key / 访问码 / 限流）  →  OpenRouter
```

## 它做了什么

| 能力 | 说明 |
| --- | --- |
| 密钥隔离 | Key 存在 Cloudflare Secret，前端与 Git 仓库都接触不到 |
| 流式转发 | 原样转发 `stream: true`，逐字回复不中断 |
| 来源校验 | `ALLOWED_ORIGINS` 限制只有你的 Pages 能调用 |
| 访问码 | `ACCESS_CODE` 作为软门槛，前端通过 `x-access-code` 发送 |
| 频率限制 | 每个 IP 每分钟请求数上限；可选用 KV 做每日额度 |
| 模型白名单 | `ALLOWED_MODELS` 防止学生换成昂贵的模型 |
| Token 上限 | `MAX_TOKENS` 限制单次回复长度，控制成本 |

> 访问码会写进公开网页，只能防扫描器，不能防有心人。真正的保护是 `ALLOWED_ORIGINS` + 限流 + 模型白名单。

## 部署步骤

前置：Node.js 18+。

```powershell
cd D:\Feynman\worker
npx wrangler login          # 浏览器里授权 Cloudflare 账号
npx wrangler secret put UPSTREAM_KEY    # 粘贴 OpenRouter Key，输入不会回显
npx wrangler secret put ACCESS_CODE     # 设置一个课堂访问码，例如 feynman-2026
npx wrangler deploy
```

部署成功后会打印一个地址，形如：

```
https://feynman-proxy.<your-subdomain>.workers.dev
```

## 接到网页上

1. 打开网页 → 设置 → 高级设置 → **课堂共享代理**，填入上面的地址；
2. 访问码填 `ACCESS_CODE` 的值；
3. API Key 可以留空；
4. 点「测试连接」，成功后保存。

如果希望**所有学生打开链接就自动带上**，把地址和访问码写进 `js/config.js`：

```js
defaults: {
  proxyUrl: 'https://feynman-proxy.<your-subdomain>.workers.dev',
  accessCode: 'feynman-2026',
  // ...
}
```

然后提交并推送，Pages 会自动更新。学生无需任何设置即可开课。

## 验证

```powershell
curl https://feynman-proxy.<your-subdomain>.workers.dev/health
```

应返回 `{"ok":true,...}`。

再测一次真实请求（PowerShell）：

```powershell
$body = @{
  model = 'deepseek/deepseek-chat-v3-0324'
  messages = @(@{ role = 'user'; content = '用一句话解释勾股定理' })
  max_tokens = 60
  stream = $false
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri 'https://feynman-proxy.<your-subdomain>.workers.dev/v1/chat/completions' `
  -Method Post -ContentType 'application/json' `
  -Headers @{ 'x-access-code' = 'feynman-2026' } `
  -Body $body
```

## 成本与额度

- Cloudflare Workers 免费版：每天 100,000 次请求，个人课堂完全够用；
- 你只为上游模型付费（OpenRouter 按 token 计费）；
- 建议把 `ALLOWED_MODELS` 设成便宜模型（示例中 Qwen3-VL + Mistral Small），并把 `MAX_TOKENS` 控制在 2000 以内；
- 想按学生限制每日次数：创建 KV 后打开 `DAILY_LIMIT_PER_IP`。注意 KV 免费版每天 1,000 次写入。

## 安全清单

- [ ] `UPSTREAM_KEY` 只通过 `wrangler secret put` 设置，没有写进任何文件
- [ ] `wrangler.toml` 与 `worker/` 已提交，但里面没有任何密钥
- [ ] `ALLOWED_ORIGINS` 只包含你的正式页面（和本地调试地址）
- [ ] `ALLOWED_MODELS` 白名单已设置
- [ ] 访问码已通过 `ACCESS_CODE` 设置，并同步到 `js/config.js`
- [ ] 在 Cloudflare 后台看过用量，确认没有异常调用

## 常见问题

**Q：学生打开提示「访问码不正确」？**
A：`js/config.js` 里的 `accessCode` 与 Worker 的 `ACCESS_CODE` 不一致，改一处后重新推送。

**Q：提示「这个来源不允许使用课堂代理」？**
A：把页面域名加进 `ALLOWED_ORIGINS`，重新 `npx wrangler deploy`。

**Q：提示「当前地区不支持这个模型」？**
A：部分 OpenAI / Google 模型会按地区限制，换用 Qwen3-VL、Mistral Small 或 DeepSeek 等模型。

**Q：想撤销某个 Key？**
A：到服务商后台吊销旧 Key，再 `npx wrangler secret put UPSTREAM_KEY` 写入新的，网页无需改动。
