'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const sharp = require('sharp');
const skill = path.resolve(__dirname, '../skills/wechat-editorial-design');
const { build, embedArticle } = require(path.join(skill, 'scripts/build-editor.cjs'));
const { render } = require(path.join(skill, 'scripts/render-design.cjs'));
const { audit } = require(path.join(skill, 'scripts/audit-contrast.cjs'));
const { inspect } = require(path.join(skill, 'scripts/inspect-logo.cjs'));
const work = path.resolve(__dirname, '../test-output');
fs.mkdirSync(work, { recursive: true });
function put(name, text) { const p = path.join(work, name); fs.writeFileSync(p, text); return p; }
function config(name, obj) { return put(name, JSON.stringify(obj)); }
const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect x="20" y="20" width="80" height="60" fill="${color}"/></svg>`;

test('image inspection distinguishes alpha counts without modifying source pixels', async () => {
  const file = path.join(work, 'logo.png');
  await sharp(Buffer.from(svg('#123456'))).png().toFile(file);
  const before = fs.readFileSync(file);
  const info = await inspect(file);
  assert.ok(info.transparent > 0);
  assert.ok(info.opaque > 0);
  assert.equal(info.width, 240);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('render sizes are correct and real background screening flags weak text and unsupported opacity', async () => {
  put('contrast.html', '<!doctype html><meta charset="utf-8"><style>body{margin:0}#stage{width:320px;height:400px;background:#fff;padding:16px;box-sizing:border-box}p{font:20px sans-serif}</style><main id="stage"><p style="color:#112233">Strong text</p><p style="color:#dddddd">Weak text</p><p style="color:#112233;opacity:.4">Unsupported opacity</p></main>');
  const c = config('render.json', { html: 'contrast.html', outputDir: 'rendered', targets: [{ selector: '#stage', name: 'fixture', viewportWidth: 390 }] });
  const result = await render(c);
  assert.equal(result[0].width, 320);
  assert.equal(result[0].height, 400);
  assert.equal((await sharp(path.join(work, 'rendered/fixture.png')).metadata()).width, 320);
  const report = await audit(c);
  assert.ok(report.supportedAreaCount >= 2);
  assert.ok(report.targets[0].weakAreas.some(a => a.text.includes('Weak text')));
  assert.ok(!report.targets[0].weakAreas.some(a => a.text.includes('Strong text')));
  assert.ok(report.targets[0].skippedAreas.some(a => a.text.includes('Unsupported opacity')));
  const unsafe = config('outside.json', { html: 'contrast.html', outputDir: 'rendered', targets: [{ selector: '#stage', name: '../escape' }] });
  await assert.rejects(() => render(unsafe), /within outputDir/);
});

test('editor embeds images, preserves edits across updates, reads clipboard and downloads isolated drafts', async () => {
  put('art.svg', svg('#234b46'));
  put('article.html', '<section style="color:#234b46;background:#f6f2e9;padding:20px;font:17px/1.9 sans-serif"><img data-asset-id="hero" alt="illustration" src="art.svg" style="width:100%;height:auto"><p>Thank you, partners.</p></section>');
  const base = { title: 'A title </script>', summary: 'A summary </textarea>', article: 'article.html', output: 'editor.html', storageKey: 'test-partner-letter', assetVersion: 'v1' };
  const c = config('editor.json', base);
  const first = build(c);
  assert.equal(Object.keys(first.manifest).length, 1);
  assert.throws(() => embedArticle('<img src="https://example.invalid/a.png">', work), /Remote image/);
  assert.throws(() => embedArticle('<img data-asset-id="same" src="art.svg"><img data-asset-id="same" src="art.svg">', work), /Duplicate/);
  const server = http.createServer((req, res) => {
    const name = path.basename(decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    const file = path.join(work, name || 'editor.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.svg') ? 'image/svg+xml' : 'text/html;charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await page.goto(origin + '/editor.html');
    assert.equal(await page.locator('#titleInput').inputValue(), base.title);
    for (const width of [375, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'horizontal overflow at ' + width);
    }
    await page.locator('#article p').fill('Preserved manual edit.');
    await page.locator('#titleInput').fill('Edited title');
    await page.locator('#summaryInput').fill('Edited summary');
    await page.locator('[data-action="save"]').click();
    await page.reload();
    assert.equal(await page.locator('#article p').innerText(), 'Preserved manual edit.');
    put('art.svg', svg('#845422'));
    config('editor.json', { ...base, assetVersion: 'v2' });
    const second = build(c);
    assert.notEqual(second.manifest.hero, first.manifest.hero);
    await page.reload();
    assert.equal(await page.locator('#article img').getAttribute('src'), second.manifest.hero);
    assert.equal(await page.locator('#article p').innerText(), 'Preserved manual edit.');
    assert.equal(await page.locator('#titleInput').inputValue(), 'Edited title');
    assert.equal(await page.locator('#summaryInput').inputValue(), 'Edited summary');
    // A stored draft is restored through the same safe formatting allowlist.
    await page.evaluate(key => {
      const draft = JSON.parse(localStorage.getItem(key));
      draft.articleHtml += '<img src="invalid-local.png" onerror="window.draftExecuted=true"><iframe src="https://example.invalid"></iframe>';
      localStorage.setItem(key, JSON.stringify(draft));
    }, base.storageKey);
    await page.reload();
    assert.equal(await page.evaluate(() => window.draftExecuted), undefined);
    assert.equal(await page.locator('#article [onerror],#article iframe').count(), 0);
    assert.equal(await page.locator('#article p').innerText(), 'Preserved manual edit.');
    await page.locator('[data-action="copy-article"]').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === '正文已复制。');
    const clipboard = await page.evaluate(async () => {
      const entries = await navigator.clipboard.read();
      return { html: await (await entries[0].getType('text/html')).text(), text: await (await entries[0].getType('text/plain')).text() };
    });
    assert.ok(clipboard.text.includes('Preserved manual edit.'));
    assert.ok(clipboard.html.includes('data:image/svg+xml;base64,'));
    assert.ok(!clipboard.html.includes('copy-article'));
    await page.locator('[data-action="copy-title"]').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === '标题已复制。');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Edited title');
    // Force the browser compatibility path and inspect the actual clipboard again.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
    await page.locator('[data-action="copy-summary"]').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === '摘要已复制。');
    await page.evaluate(() => delete navigator.clipboard);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Edited summary');
    await page.locator('#article p').fill('Latest unsaved export.');
    const pending = page.waitForEvent('download');
    await page.locator('[data-action="download"]').click();
    await (await pending).saveAs(path.join(work, 'downloaded.html'));
    await page.goto(origin + '/downloaded.html');
    assert.equal(await page.locator('#article p').innerText(), 'Latest unsaved export.');
    await page.locator('[data-action="save"]').click();
    await page.goto(origin + '/editor.html');
    assert.equal(await page.locator('#article p').innerText(), 'Preserved manual edit.');
    // Check the other common delivery route separately, without HTTP origin storage.
    await page.goto(pathToFileURL(path.join(work, 'downloaded.html')).href);
    assert.equal(await page.locator('#article p').innerText(), 'Latest unsaved export.');
    assert.equal(await page.locator('#article img').evaluate(el => el.complete && el.naturalWidth > 0), true);
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
