/**
 * Production build: bundle + minify the ES modules, minify CSS, hash both,
 * and point index.html at the hashed files. The source files stay in the repo
 * so the app can still be edited without a build step during development.
 *
 * Run: npm run build
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const assetsDir = path.join(root, 'assets');
const indexPath = path.join(root, 'index.html');

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
}

function writeFresh(file, content) {
  fs.writeFileSync(file, content);
  return { file: path.basename(file), size: Buffer.byteLength(content) };
}

async function main() {
  const jsResult = await build({
    absWorkingDir: root,
    entryPoints: ['app.js'],
    bundle: true,
    format: 'esm',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    write: false
  });
  const jsCode = jsResult.outputFiles[0].contents;

  const cssResult = await build({
    absWorkingDir: root,
    entryPoints: ['styles.css'],
    bundle: false,
    minify: true,
    legalComments: 'none',
    write: false
  });
  const cssCode = cssResult.outputFiles[0].contents;

  const jsName = `app.${hash(jsCode)}.js`;
  const cssName = `styles.${hash(cssCode)}.css`;

  fs.mkdirSync(assetsDir, { recursive: true });
  for (const entry of fs.readdirSync(assetsDir)) {
    if (/^(?:app|styles)\.[a-f0-9]+\.(?:js|css)$/.test(entry)) {
      fs.rmSync(path.join(assetsDir, entry));
    }
  }

  const jsInfo = writeFresh(path.join(assetsDir, jsName), jsCode);
  const cssInfo = writeFresh(path.join(assetsDir, cssName), cssCode);

  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace(
    /<link rel="stylesheet" href="\.\/(?:styles\.css[^"]*|assets\/styles\.[a-f0-9]+\.css)">/,
    `<link rel="stylesheet" href="./assets/${cssName}">`
  );
  html = html.replace(
    /<script type="module" src="\.\/(?:app\.js[^"]*|assets\/app\.[a-f0-9]+\.js)"><\/script>/,
    `<script type="module" src="./assets/${jsName}"></script>`
  );
  fs.writeFileSync(indexPath, html);

  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
  console.log(`built assets/${jsInfo.file} (${kb(jsInfo.size)})`);
  console.log(`built assets/${cssInfo.file} (${kb(cssInfo.size)})`);
  console.log('updated index.html');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
