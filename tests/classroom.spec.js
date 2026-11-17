import { test, expect } from '@playwright/test';

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS'
};

const REPORT = {
  verdict: '你把分数除法的意义讲清楚了，下一步把单位和“平均分”说透。',
  encouragement: '继续保持，把每一步的理由讲出来就更好了。',
  scores: { conceptMastery: 86, logicIntegrity: 78, clarity: 82 },
  dimensions: {
    conceptMastery: { evidence: '说出了平均分成三份。', advice: '补上每份占整体的几分之几。' },
    logicIntegrity: { evidence: '步骤基本完整。', advice: '每步都写清楚为什么。' },
    clarity: { evidence: '语言自然。', advice: '最后用一句话收束。' }
  },
  misconceptions: [
    {
      title: '把除数的份数当成被除数',
      why: '平均分的是 3/4 米，而不是 3。',
      fix: '先用线段图表示 3/4 米，再平均分成三份。'
    }
  ],
  nextSteps: [
    { title: '用线段图再讲一次', action: '画出 3/4 米，标出平均分成三份后的每一份。' }
  ]
};

function sseBody(text) {
  const chunks = text.match(/.{1,6}/gu) || [text];
  const lines = chunks.map(
    (chunk) => `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`
  );
  lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
  lines.push('data: [DONE]\n\n');
  return lines.join('');
}

function studentReply(messages) {
  const userText = [...(messages || [])]
    .reverse()
    .find((message) => message.role === 'user');
  const text = String(userText?.content || '');
  if (text.includes('阶段 A')) return '老师，我准备好了，你来讲吧。';
  if (text.includes('重点重讲')) return '老师，这次我想听你把这处再讲细一点。';
  if (text.includes('平均分成三份')) return '老师，为什么要平均分成三份，再算每一份呀？';
  return '老师，我准备好了，你来讲吧。';
}

test.beforeEach(async ({ page }) => {
  await page.route('**/chat/completions', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: SSE_HEADERS });
      return;
    }
    const payload = request.postDataJSON() || {};
    if (payload.stream) {
      await route.fulfill({
        status: 200,
        headers: SSE_HEADERS,
        body: sseBody(studentReply(payload.messages))
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*'
      },
      body: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify(REPORT) } }]
      })
    });
  });

  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('feynman.onboarding.v1', '1');
  });
  await page.reload();
});

test('完整课堂：讲课 → 标记卡点 → 诊断报告 → 档案复习与重讲', async ({ page }) => {
  await page.locator('#topicInput').fill('把 3/4 米长的绳子平均分成三份，每份多长？');
  await page.locator('#startBtn').click();

  await expect(page.locator('#chatScreen')).toBeVisible();
  await expect(page.getByText('老师，我准备好了，你来讲吧。')).toBeVisible();

  await page.locator('#messageInput').fill('我先把 3/4 米平均分成三份，再算每一份是多少。');
  await page.locator('#sendBtn').click();
  await expect(page.getByText('老师，为什么要平均分成三份，再算每一份呀？')).toBeVisible();

  await page.locator('#markStuckBtn').click();
  await expect(page.locator('#stuckBadge')).toContainText('卡点 1');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#endAndReportBtn').click();

  await expect(page.locator('#reportContent')).toBeVisible();
  await expect(page.locator('#reportVerdict')).toContainText('分数除法的意义');
  await expect(page.locator('#metricGrid .metric-card')).toHaveCount(3);
  await expect(page.locator('#exportReportImageBtn')).toBeVisible();

  await page.locator('#restartFromReportBtn').click();
  await expect(page.locator('#homeScreen')).toBeVisible();

  await page.locator('#historyBtn').click();
  await expect(page.locator('#historyModal')).toBeVisible();
  await expect(page.locator('#historyList')).toContainText('把 3/4 米长的绳子');
  await expect(page.locator('#historyStuckReview .stuck-review-card')).toHaveCount(1);

  await page.getByRole('button', { name: '重讲这处' }).click();
  await expect(page.locator('#chatScreen')).toBeVisible();
  await expect(page.getByText('这次我想重点重讲第 1 次讲解的卡点：')).toBeVisible();
  await expect(page.getByText('老师，这次我想听你把这处再讲细一点。')).toBeVisible();
});

test('仅本次会话保存 API Key 时不写入 localStorage', async ({ page }) => {
  await page.locator('#settingsBtn').click();
  await expect(page.locator('#settingsModal')).toBeVisible();

  await page.locator('#apiKeyInput').fill('sk-session-only-test');
  await page.locator('#sessionOnlyKey').check();
  await page.locator('#saveSettingsBtn').click();

  await expect(page.locator('#settingsModal')).toBeHidden({ timeout: 5000 });
  const stored = await page.evaluate(() => ({
    settings: JSON.parse(localStorage.getItem('feynman.settings.v1') || '{}'),
    sessionKey: sessionStorage.getItem('feynman.apiKey.session.v1')
  }));
  expect(stored.settings.apiKey).toBe('');
  expect(stored.sessionKey).toBe('sk-session-only-test');
});

test('PWA 清单与图标可访问', async ({ page, request }) => {
  const manifest = await request.get('/manifest.json');
  expect(manifest.ok()).toBeTruthy();
  const data = await manifest.json();
  expect(data.name).toContain('费曼小课堂');
  for (const icon of data.icons) {
    const response = await request.get(icon.src.replace('./', '/'));
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('image/png');
  }
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', './manifest.json');
});
