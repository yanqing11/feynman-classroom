import fs from 'node:fs';
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

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportReportImageBtn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const png = fs.readFileSync(await download.path());
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(1080);
  expect(png.readUInt32BE(20)).toBeGreaterThan(1080);

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
  expect(data.shortcuts?.length).toBeGreaterThan(0);
  for (const shortcut of data.shortcuts || []) {
    const response = await request.get(shortcut.url.replace('./', '/').split('?')[0]);
    expect(response.ok()).toBeTruthy();
  }
  for (const screenshot of data.screenshots || []) {
    const response = await request.get(screenshot.src.replace('./', '/'));
    expect(response.ok()).toBeTruthy();
  }
});

test('PWA 真正离线：清掉 HTTP 缓存后仍能加载打包资源', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return true;
  });
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        for (const name of await caches.keys()) {
          const keys = await (await caches.open(name)).keys();
          if (keys.some((request) => /\/assets\/app\.[A-Z0-9]+\.js$/.test(request.url))) return true;
        }
        return false;
      })
    )
    .toBe(true);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.locator('#startBtn')).toBeVisible();
  const styled = await page.locator('.home-screen').evaluate(
    (node) => getComputedStyle(node).maxWidth !== 'none'
  );
  expect(styled).toBeTruthy();
});

test('深色主题次要文字对比度不低于 4.5:1', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('feynman.settings.v1', JSON.stringify({ theme: 'dark' }));
  });
  await page.reload();

  const result = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const luminance = (hex) => {
      const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return channels
        .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    };
    const faint = styles.getPropertyValue('--faint').trim();
    const card = styles.getPropertyValue('--card').trim();
    const [high, low] = [luminance(faint), luminance(card)].sort((a, b) => b - a);
    return { faint, card, ratio: (high + 0.05) / (low + 0.05) };
  });
  expect(result.ratio).toBeGreaterThanOrEqual(4.5);
});

test('可见中文文本不小于 12px', async ({ page }) => {
  const small = await page.evaluate(() => {
    const found = [];
    for (const node of document.querySelectorAll('body *')) {
      if (!node.getClientRects().length) continue;
      const own = [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent.trim())
        .join(' ');
      if (!/[\u4e00-\u9fff]/.test(own)) continue;
      const size = parseFloat(getComputedStyle(node).fontSize);
      if (size < 12) found.push({ text: own.slice(0, 32), size });
    }
    return found;
  });
  expect(small).toEqual([]);
});

test('备份 JSON 可以导入并合并学习档案', async ({ page }) => {
  const backup = {
    app: 'Feynman Classroom',
    schema: 1,
    exportedAt: new Date().toISOString(),
    settings: { theme: 'light', model: 'backup-model' },
    practice: { subject: 'primary', difficulty: 'basic' },
    history: [
      {
        id: 'restored-record',
        topic: '分数除法恢复测试',
        subject: 'primary',
        difficulty: 'basic',
        tags: ['分数除法'],
        source: 'custom',
        endedAt: new Date().toISOString(),
        turns: 1,
        questions: 1,
        report: null,
        stuckPoints: [{ turn: 1, at: new Date().toISOString() }],
        messages: [{ role: 'user', content: '我把分数平均分成三份。' }]
      }
    ],
    questions: []
  };

  await page.locator('#settingsBtn').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#importDataFile').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });

  await expect(page.locator('#settingsStatus')).toContainText('导入完成');
  await expect(page.locator('#settingsStatus')).toContainText('档案新增 1 条');
  const stored = await page.evaluate(() => ({
    history: JSON.parse(localStorage.getItem('feynman.history.v1') || '[]'),
    settings: JSON.parse(localStorage.getItem('feynman.settings.v1') || '{}')
  }));
  expect(stored.history).toHaveLength(1);
  expect(stored.history[0].topic).toBe('分数除法恢复测试');
  expect(stored.settings.model).toBe('backup-model');
});

test('PWA 快捷方式直达开课与学习档案', async ({ page }) => {
  await page.goto('/?history=1');
  await expect(page.locator('#historyModal')).toBeVisible();
  await page.locator('#historyModal button.modal-close').click();

  await page.goto('/?start=1');
  await expect(page.locator('#topicInput')).toBeFocused();
});
