#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { readConfig, within, localUrl, ready, writeJson } = require('./lib.cjs');

async function render(configFile) {
  const { config, base } = readConfig(configFile);
  if (!Array.isArray(config.targets) || !config.targets.length) throw new Error('targets must contain at least one selector.');
  const outputDir = path.resolve(base, config.outputDir || 'output');
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const target of config.targets) {
      const page = await browser.newPage({ viewport: { width: target.viewportWidth || 1080, height: 900 }, deviceScaleFactor: 1 });
      // Render only trusted local source and embedded/local assets; no remote requests.
      await page.route(/^https?:/, route => route.abort());
      await page.goto(localUrl(base, config.html, target.query || ''), { waitUntil: 'load' });
      await ready(page);
      const item = page.locator(target.selector);
      if (await item.count() !== 1) throw new Error('Selector must match exactly one element: ' + target.selector);
      const box = await item.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) throw new Error('Target is not visible: ' + target.selector);
      const file = within(outputDir, target.name + '.png');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const png = await item.screenshot({ path: file, animations: 'disabled' });
      if (target.jpeg !== false) await sharp(png).flatten({ background: config.background || '#ffffff' }).jpeg({ quality: 94 }).toFile(within(outputDir, target.name + '.jpg'));
      results.push({ name: target.name, selector: target.selector, width: Math.round(box.width), height: Math.round(box.height), png: path.relative(outputDir, file) });
      await page.close();
    }
  } finally { await browser.close(); }
  writeJson(path.join(outputDir, 'render-report.json'), results);
  return results;
}
module.exports = { render };
if (require.main === module) {
  if (!process.argv[2]) { console.error('Usage: node render-design.cjs render.json'); process.exit(1); }
  render(process.argv[2]).then(x => console.log(JSON.stringify(x, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
