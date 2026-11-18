/**
 * Regenerate the two PWA install screenshots from the local preview server.
 * Run: npm run screenshots
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}/`;

const server = spawn(process.execPath, ['scripts/serve.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: 'ignore'
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch {
      /* Not up yet. */
    }
    await delay(250);
  }
  throw new Error('Preview server did not start.');
}

async function shoot(width, height, file) {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.setItem('feynman.onboarding.v1', '1');
    localStorage.setItem('feynman.settings.v1', JSON.stringify({ theme: 'light' }));
  });
  await page.reload();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `assets/${file}` });
  await browser.close();
  console.log(`wrote assets/${file}`);
}

try {
  await waitForServer();
  await shoot(1280, 720, 'screenshot-wide.png');
  await shoot(390, 844, 'screenshot-narrow.png');
} finally {
  server.kill();
}
