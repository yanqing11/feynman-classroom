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
  await expect(page.locator('.report-disclaimer')).toContainText('请不要直接复制 AI 生成内容作为作业答案');

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

test('首页明确工具定位与直接复制 AI 内容的风险提醒', async ({ page }) => {
  await expect(page.locator('#homeGuidance')).toBeVisible();
  await expect(page.locator('#homeGuidance')).toContainText('用来复盘，不用来代写作业');
  await expect(page.locator('#homeGuidance')).toContainText('暴露理解盲区');
  await expect(page.locator('#homeGuidance')).toContainText('不要直接复制 AI 生成的内容');
  await expect(page.locator('#homeGuidance')).toContainText('作业抄袭');
  await expect(page.locator('#homeGuidance')).toContainText('仍需学校与家庭共同引导');

  const sizes = await page.locator('#homeGuidance h2, #homeGuidance p').evaluateAll((nodes) =>
    nodes.map((node) => parseFloat(getComputedStyle(node).fontSize))
  );
  expect(sizes.length).toBeGreaterThan(0);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
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

test('本机数据库包含五张对象仓库，并在设置中显示状态', async ({ page }) => {
  await expect(page.locator('#dbStatus')).toContainText('已就绪', { timeout: 5000 });

  const info = await page.evaluate(async () => {
    const request = indexedDB.open('feynman-classroom');
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return { version: db.version, stores: [...db.objectStoreNames].sort() };
  });
  expect(info.version).toBeGreaterThanOrEqual(2);
  expect(info.stores).toEqual(['drafts', 'history', 'kv', 'questions', 'sessions']);

  await page.locator('#settingsBtn').click();
  await expect(page.locator('#dbStatus')).toContainText('题库');
  await page.locator('#dbRefreshBtn').click();
  await expect(page.locator('#dbStatus')).toContainText('已就绪');
});

test('首次打开会把旧 localStorage 数据迁移进数据库', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('feynman.onboarding.v1', '1');
    localStorage.setItem(
      'feynman.history.v1',
      JSON.stringify([
        {
          id: 'legacy-record',
          topic: '旧版档案迁移测试',
          subject: 'primary',
          endedAt: new Date().toISOString(),
          turns: 1,
          questions: 1,
          messages: [{ role: 'user', content: '旧档案' }]
        }
      ])
    );
    localStorage.setItem(
      'feynman.bank.v1',
      JSON.stringify([
        {
          id: 'legacy-question',
          topic: '旧版题库迁移测试',
          subject: 'primary',
          difficulty: 'basic',
          tags: [],
          source: 'custom',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ])
    );
  });

  try {
    await page.goto('/');
    await expect(page.locator('#dbStatus')).toContainText('档案 1 条', { timeout: 5000 });
    await expect(page.locator('#dbStatus')).toContainText('题库 1 道');

    const counts = await page.evaluate(async () => {
      const request = indexedDB.open('feynman-classroom');
      const db = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const all = (store) =>
        new Promise((resolve, reject) => {
          const query = db.transaction(store, 'readonly').objectStore(store).getAll();
          query.onsuccess = () => resolve(query.result || []);
          query.onerror = () => reject(query.error);
        });
      return { history: (await all('history')).length, questions: (await all('questions')).length };
    });
    expect(counts.history).toBe(1);
    expect(counts.questions).toBe(1);
  } finally {
    await context.close();
  }
});

test('localStorage 中的课堂丢失时可从本机数据库恢复', async ({ page }) => {
  await page.locator('#topicInput').fill('数据库恢复测试：分数平均分');
  await page.locator('#startBtn').click();
  await expect(page.locator('#chatScreen')).toBeVisible();

  const readSessions = () =>
    page.evaluate(async () => {
      const request = indexedDB.open('feynman-classroom');
      const db = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return new Promise((resolve, reject) => {
        const query = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
        query.onsuccess = () => resolve(query.result || []);
        query.onerror = () => reject(query.error);
      });
    });

  await expect.poll(async () => (await readSessions()).length).toBe(1);
  await page.evaluate(() => localStorage.removeItem('feynman.session.v1'));
  await page.reload();

  await expect(page.locator('#chatScreen')).toBeVisible();
  await expect(page.locator('#topbarTopic')).toContainText('数据库恢复测试');
});

test('教师视角学情面板汇总薄弱点、理解缺口与教学动作', async ({ page }) => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const records = [
    {
      id: 'teacher-1',
      topic: '分数除法',
      subject: 'primary',
      tags: ['分数除法'],
      source: 'custom',
      endedAt: new Date(now).toISOString(),
      turns: 3,
      questions: 5,
      stuckPoints: [{ turn: 1, at: new Date(now).toISOString() }],
      report: {
        overallScore: 58,
        scores: { conceptMastery: 52, logicIntegrity: 60, clarity: 62 },
        dimensions: {},
        misconceptions: [
          {
            title: '把除数的份数当成被除数',
            evidence: '把 3 当成了平均分的份数。',
            fix: '先画线段图表示 3/4 米。'
          }
        ],
        nextSteps: [{ title: '用线段图再讲一次', action: '画出 3/4 米，标出平均分成三份。' }],
        generatedAt: new Date(now).toISOString()
      },
      messages: [{ role: 'user', content: '我把 3/4 米平均分成三份。' }]
    },
    {
      id: 'teacher-2',
      topic: '分数加减',
      subject: 'primary',
      tags: ['分数加法'],
      source: 'custom',
      endedAt: new Date(now - day).toISOString(),
      turns: 2,
      questions: 2,
      stuckPoints: [{ turn: 2, at: new Date(now - day).toISOString() }],
      report: {
        overallScore: 72,
        scores: { conceptMastery: 70, logicIntegrity: 74, clarity: 72 },
        dimensions: {},
        misconceptions: [
          {
            title: '把除数的份数当成被除数',
            evidence: '又数成了 3 份。',
            fix: '用线段图对齐单位“1”。'
          }
        ],
        nextSteps: [{ title: '先通分再相加', action: '用同样的分母对齐每一份。' }],
        generatedAt: new Date(now - day).toISOString()
      },
      messages: [{ role: 'user', content: '分母不一样也能直接加吗？' }]
    }
  ];

  await page.evaluate((items) => {
    localStorage.setItem('feynman.history.v1', JSON.stringify(items));
  }, records);
  await page.reload();

  await page.locator('#historyBtn').click();
  await expect(page.locator('#teacherBlock')).toBeVisible();
  await expect(page.locator('#teacherInsight')).toContainText('最近 5 课平均 65%');
  await expect(page.locator('#teacherInsight')).toContainText('分数除法');
  await expect(page.locator('#teacherInsight')).toContainText('把除数的份数当成被除数');
  await expect(page.locator('#teacherInsight')).toContainText('用线段图再讲一次');
  await expect(page.locator('#teacherInsight')).toContainText('卡点分布');

  // 近 7 天对比与学生原话证据
  await expect(page.locator('.teacher-week')).toContainText('近 7 天对比');
  await expect(page.locator('.teacher-week')).toContainText('本周');
  await expect(page.locator('.teacher-week')).toContainText('2 课 · 65%');
  await expect(page.locator('.teacher-week')).toContainText('卡点 2 个');
  await expect(page.locator('#teacherInsight')).toContainText('「我把 3/4 米平均分成三份。」');

  // 按知识点 / 分数段筛选重点课时
  await expect(page.locator('.teacher-focus-row')).toHaveCount(2);
  await page.locator('.teacher-focus-select').selectOption('分数加法');
  await expect(page.locator('.teacher-focus-row')).toHaveCount(1);
  await expect(page.locator('.teacher-focus-row')).toContainText('分数加减');
  await page.locator('.teacher-focus-select').selectOption('all');
  await page.locator('.teacher-band-tabs .filter-tab[data-band="retake"]').click();
  await expect(page.locator('.teacher-focus-row')).toHaveCount(1);
  await expect(page.locator('.teacher-focus-row')).toContainText('分数除法');
  await page.locator('.teacher-band-tabs .filter-tab[data-band="all"]').click();
  await expect(page.locator('.teacher-focus-row')).toHaveCount(2);

  // 深度学情分析：趋势图、雷达图、卡点题目与教学建议
  await expect(page.locator('.teacher-deep')).toBeVisible();
  await expect(page.locator('.teacher-deep')).toContainText('掌握度随时间趋势');
  await expect(page.locator('.teacher-deep')).toContainText('三维能力雷达');
  expect(await page.locator('.teacher-deep svg').count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.teacher-deep')).toContainText('卡点题目复盘');
  await expect(page.locator('.teacher-deep')).toContainText('学生答：「我把 3/4 米平均分成三份。」');
  await expect(page.locator('.teacher-deep')).toContainText('下一步教学建议');
  await expect(page.locator('.teacher-deep')).toContainText('补概念掌握');

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#teacherCopyBtn').click();
  await expect(page.getByText('学情摘要已复制到剪贴板。')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('# 学情摘要 · 教师视角');
  expect(copied).toContain('把除数的份数当成被除数');
  expect(copied).toContain('## 反复卡住的提问');
  expect(copied).toContain('## 深度分析建议');

  await page.locator('#teacherWeekBtn').click();
  await expect(page.getByText('本周学情报告已复制。')).toBeVisible();
  const weekly = await page.evaluate(() => navigator.clipboard.readText());
  expect(weekly).toContain('# 本周学情周报');
  expect(weekly).toContain('近 7 天：2 课');
  expect(weekly).toContain('学生原话：「我把 3/4 米平均分成三份。」');
  expect(weekly).toContain('## 下周重点建议');

  // 导出学情摘要 Markdown 文件
  const mdPromise = page.waitForEvent('download');
  await page.locator('#teacherMdBtn').click();
  const md = await mdPromise;
  expect(md.suggestedFilename()).toMatch(/^feynman-teacher-.*\.md$/);
  const mdText = fs.readFileSync(await md.path(), 'utf8');
  expect(mdText).toContain('# 学情摘要 · 教师视角');
  expect(mdText).toContain('分数除法');
  expect(mdText).toContain('## 深度分析建议');

  // 导出本周周报 Markdown 文件
  const weeklyMdPromise = page.waitForEvent('download');
  await page.locator('#teacherWeekMdBtn').click();
  const weeklyMd = await weeklyMdPromise;
  expect(weeklyMd.suggestedFilename()).toMatch(/^feynman-weekly-.*\.md$/);
  const weeklyMdText = fs.readFileSync(await weeklyMd.path(), 'utf8');
  expect(weeklyMdText).toContain('# 本周学情周报');
  expect(weeklyMdText).toContain('学生原话：「我把 3/4 米平均分成三份。」');
  expect(weeklyMdText).toContain('## 下周重点建议');

  // 导出学情长图 PNG
  const imagePromise = page.waitForEvent('download');
  await page.locator('#teacherImageBtn').click();
  const image = await imagePromise;
  expect(image.suggestedFilename()).toMatch(/^feynman-teacher-.*\.png$/);
  const imagePng = fs.readFileSync(await image.path());
  expect(imagePng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(imagePng.readUInt32BE(16)).toBe(1080);
  expect(imagePng.readUInt32BE(20)).toBeGreaterThan(1080);
});

test('教师工作台：并排对比、时间线批量导出与打印视图', async ({ page }) => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const records = [
    {
      id: 'teacher-1',
      topic: '分数除法',
      subject: 'primary',
      tags: ['分数除法'],
      source: 'custom',
      endedAt: new Date(now).toISOString(),
      turns: 3,
      questions: 5,
      stuckPoints: [{ turn: 1, at: new Date(now).toISOString() }],
      report: {
        overallScore: 58,
        scores: { conceptMastery: 52, logicIntegrity: 60, clarity: 62 },
        dimensions: {},
        misconceptions: [{ title: '把除数的份数当成被除数', fix: '先画线段图。' }],
        nextSteps: [{ title: '用线段图再讲一次', action: '标出每一份。' }],
        generatedAt: new Date(now).toISOString()
      },
      messages: [{ role: 'user', content: '我把 3/4 米平均分成三份。' }]
    },
    {
      id: 'teacher-2',
      topic: '分数加减',
      subject: 'primary',
      tags: ['分数加法'],
      source: 'custom',
      endedAt: new Date(now - day).toISOString(),
      turns: 2,
      questions: 2,
      stuckPoints: [{ turn: 2, at: new Date(now - day).toISOString() }],
      report: {
        overallScore: 72,
        scores: { conceptMastery: 70, logicIntegrity: 74, clarity: 72 },
        dimensions: {},
        misconceptions: [{ title: '把除数的份数当成被除数', fix: '对齐单位“1”。' }],
        nextSteps: [{ title: '先通分再相加', action: '用同样的分母。' }],
        generatedAt: new Date(now - day).toISOString()
      },
      messages: [{ role: 'user', content: '分母不一样也能直接加吗？' }]
    }
  ];

  await page.evaluate((items) => {
    localStorage.setItem('feynman.history.v1', JSON.stringify(items));
  }, records);
  await page.reload();

  // 首页入口
  await page.locator('#homeWorkspaceBtn').click();
  await expect(page.locator('#teacherWorkspaceModal')).toBeVisible();
  await expect(page.locator('#teacherWorkspaceModal')).toContainText('教师工作台');
  await expect(page.locator('.workspace-compare-column')).toHaveCount(2);
  await expect(page.locator('.workspace-compare')).toContainText('综合评分 A − B：-14 分');
  await expect(page.locator('.workspace-timeline-row')).toHaveCount(2);
  await expect(page.locator('#workspaceSummary')).toContainText('最近 5 课平均 65%');

  // 并排对比：切换下拉后差值随之变化
  await page.locator('#workspaceCompareA').selectOption('teacher-2');
  await expect(page.locator('#workspaceCompareB')).toHaveValue('');
  await page.locator('#workspaceCompareB').selectOption('teacher-1');
  await expect(page.locator('.workspace-compare')).toContainText('综合评分 A − B：+14 分');

  // 时间线点击可依次填入 A / B
  await page.locator('.workspace-timeline-main').first().click();
  await expect(page.locator('#workspaceCompareA')).toHaveValue('teacher-1');
  await expect(page.locator('#workspaceCompareB')).toHaveValue('');
  await page.locator('.workspace-timeline-main').nth(1).click();
  await expect(page.locator('#workspaceCompareB')).toHaveValue('teacher-2');

  // 批量全选、导出所选 Markdown、清空选择
  await page.locator('#workspaceSelectAllBtn').click();
  await expect(page.locator('#workspaceBulkCount')).toHaveText('已选 2 课');
  await expect(page.locator('.workspace-timeline-row.is-selected')).toHaveCount(2);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#workspaceBatchMdBtn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^feynman-workspace-.*\.md$/);
  const mdText = fs.readFileSync(await download.path(), 'utf8');
  expect(mdText).toContain('# 教师工作台 · 所选课时');
  expect(mdText).toContain('# 学情摘要 · 教师视角');
  expect(mdText).toContain('分数除法');
  await page.locator('#workspaceClearBtn').click();
  await expect(page.locator('#workspaceBulkCount')).toHaveText('已选 0 课');
  await expect(page.locator('.workspace-timeline-row.is-selected')).toHaveCount(0);

  // 打印按钮调用 window.print，打印视图只保留工作台
  await page.evaluate(() => {
    window.__printCalls = 0;
    window.print = () => {
      window.__printCalls += 1;
    };
  });
  await page.locator('#workspacePrintBtn').click();
  expect(await page.evaluate(() => window.__printCalls)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  const printState = await page.evaluate(() => {
    const modal = document.getElementById('teacherWorkspaceModal');
    return {
      workspace: getComputedStyle(modal).display,
      backdrop: getComputedStyle(modal.querySelector('.modal-backdrop')).display,
      actions: getComputedStyle(modal.querySelector('.workspace-head-actions')).display,
      report: getComputedStyle(document.getElementById('reportModal')).display,
      timeline: getComputedStyle(document.getElementById('workspaceTimeline')).display
    };
  });
  expect(printState.workspace).not.toBe('none');
  expect(printState.backdrop).toBe('none');
  expect(printState.actions).toBe('none');
  expect(printState.report).toBe('none');
  expect(printState.timeline).not.toBe('none');
  await page.emulateMedia({ media: 'screen' });
});

test('档案导入与清空会同步写入本机数据库', async ({ page }) => {
  const backup = {
    app: 'Feynman Classroom',
    schema: 1,
    exportedAt: new Date().toISOString(),
    history: [
      {
        id: 'db-record',
        topic: '数据库同步测试',
        subject: 'primary',
        endedAt: new Date().toISOString(),
        turns: 1,
        questions: 1,
        messages: [{ role: 'user', content: '把分数平均分成三份。' }]
      }
    ]
  };

  const readHistory = () =>
    page.evaluate(async () => {
      const request = indexedDB.open('feynman-classroom');
      const db = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return new Promise((resolve, reject) => {
        const query = db.transaction('history', 'readonly').objectStore('history').getAll();
        query.onsuccess = () => resolve(query.result || []);
        query.onerror = () => reject(query.error);
      });
    });

  await page.locator('#settingsBtn').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#importDataFile').setInputFiles({
    name: 'db-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator('#settingsStatus')).toContainText('导入完成');
  await expect.poll(async () => (await readHistory()).length).toBe(1);
  expect((await readHistory())[0].topic).toBe('数据库同步测试');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#clearArchiveDataBtn').click();
  await expect.poll(async () => (await readHistory()).length).toBe(0);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('feynman.history.v1') || '[]'))).toEqual([]);
});
