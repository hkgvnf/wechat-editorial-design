#!/usr/bin/env node
'use strict';

// Conservative sampling for ordinary, opaque DOM text. This is not a WCAG audit.
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { readConfig, localUrl, ready, writeJson } = require('./lib.cjs');

function luminance(rgb) {
  const linear = rgb.map(n => { const s = n / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

async function audit(configFile) {
  const { config, base } = readConfig(configFile);
  if (!Array.isArray(config.targets) || !config.targets.length) throw new Error('targets must contain at least one selector.');
  const outputDir = path.resolve(base, config.outputDir || 'output');
  const browser = await chromium.launch({ headless: true });
  const targets = [];
  const manualChecks = [
    'Sampling covers ordinary opaque DOM text only; this report is not a global WCAG pass or certification.',
    'Inspect image, canvas, SVG, generated, form-control and embedded-document text manually.',
    'Inspect actual mobile size, thin strokes, text overlap, cropping and readability; a ratio alone is insufficient.',
    'A 3 CSS-pixel grid samples text line rectangles, including spaces. Tiny background details may be missed; decorative areas inside rectangles can cause conservative warnings.',
    'Text backgrounds are measured after hiding text paint, so text-on-text overlap needs manual review.',
    'Occlusion checks are limited to a line center inside the initial viewport; review overlaps across the complete long image.',
    'The 4.5 threshold is a uniform screening target; large-text exceptions and complete accessibility criteria are not evaluated.'
  ];
  try {
    for (const target of config.targets) {
      const page = await browser.newPage({ viewport: { width: target.viewportWidth || 1080, height: 900 }, deviceScaleFactor: 1 });
      await page.route(/^https?:/, route => route.abort());
      await page.goto(localUrl(base, config.html, target.query || ''), { waitUntil: 'load' });
      await ready(page);
      const item = page.locator(target.selector);
      if (await item.count() !== 1) throw new Error('Selector must match exactly one element: ' + target.selector);
      const outer = await item.boundingBox();
      if (!outer || outer.width <= 0 || outer.height <= 0) throw new Error('Target is not visible: ' + target.selector);
      const collected = await item.evaluate(root => {
        const bounds = root.getBoundingClientRect(), areas = [], skipped = [], warnings = new Set();
        function rgb(value) {
          const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value);
          if (!match) return null;
          return { color: match.slice(1, 4).map(Number), alpha: match[4] === undefined ? 1 : Number(match[4]) };
        }
        const media = root.querySelectorAll('img,svg,canvas,iframe,object,embed,input,textarea,select');
        if (root.matches('img,svg,canvas,iframe,object,embed,input,textarea,select') || media.length) warnings.add('Images, SVG/canvas, controls or embedded content are present; their text is outside this audit.');
        for (const el of [root, ...root.querySelectorAll('*')]) {
          for (const pseudo of ['::before', '::after', '::marker']) {
            const style = getComputedStyle(el, pseudo), content = style.content;
            if (content && !['none', 'normal', '""', "''"].includes(content)) warnings.add('Generated pseudo-element text/content is present; inspect it manually.');
          }
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent.replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const el = node.parentElement;
          if (!el || el.closest('script,style,template,noscript')) continue;
          const style = getComputedStyle(el), reasons = new Set();
          if (style.display === 'none' || style.visibility !== 'visible') continue;
          if (el.closest('svg,canvas,textarea,select,input')) reasons.add('non-HTML or control text');
          if (style.writingMode !== 'horizontal-tb') reasons.add('vertical text');
          if (style.textShadow !== 'none') reasons.add('text shadow');
          if (parseFloat(style.webkitTextStrokeWidth) > 0) reasons.add('text stroke');
          if (style.backgroundClip === 'text' || style.webkitBackgroundClip === 'text') reasons.add('background-clipped text');
          if (style.textDecorationLine !== 'none') reasons.add('text decoration');
          for (const pseudo of ['::first-letter', '::first-line']) {
            const variant = getComputedStyle(el, pseudo);
            if (['color', 'webkitTextFillColor', 'textShadow', 'webkitTextStrokeWidth', 'fontSize'].some(key => variant[key] !== style[key])) reasons.add('first-letter or first-line text styling');
          }
          const ink = rgb(style.webkitTextFillColor || style.color);
          if (!ink) reasons.add('non-rgb ink');
          else if (ink.alpha !== 1) reasons.add('semi-transparent text ink');
          const range = document.createRange();
          range.selectNodeContents(node);
          const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
          if (!rects.length) continue;
          for (let parent = el; parent; parent = parent.parentElement) {
            const s = getComputedStyle(parent), b = parent.getBoundingClientRect();
            if (Number(s.opacity) !== 1) reasons.add('ancestor or text opacity');
            if (s.filter !== 'none' || (s.backdropFilter && s.backdropFilter !== 'none')) reasons.add('filter or backdrop filter');
            if (s.mixBlendMode !== 'normal') reasons.add('mix-blend-mode');
            if (s.transform !== 'none' || (s.translate && s.translate !== 'none') || (s.rotate && s.rotate !== 'none') || (s.scale && s.scale !== 'none')) reasons.add('transformed text');
            if (s.perspective !== 'none') reasons.add('perspective');
            if (s.position === 'fixed' || s.position === 'sticky') reasons.add('fixed or sticky text context');
            if (s.clipPath !== 'none' || (s.maskImage && s.maskImage !== 'none') || (s.webkitMaskImage && s.webkitMaskImage !== 'none')) reasons.add('mask or clip-path');
            if (s.zoom && !['1', 'normal'].includes(s.zoom)) reasons.add('CSS zoom');
            if (s.animationName !== 'none' || s.transitionDuration.split(',').some(n => parseFloat(n) > 0)) reasons.add('animated or transitioning text context');
            if (s.clip !== 'auto') reasons.add('legacy clip');
            if (['hidden', 'clip', 'scroll', 'auto'].includes(s.overflowX) && rects.some(r => r.left < b.left - .5 || r.right > b.right + .5)) reasons.add('horizontal clipping');
            if (['hidden', 'clip', 'scroll', 'auto'].includes(s.overflowY) && rects.some(r => r.top < b.top - .5 || r.bottom > b.bottom + .5)) reasons.add('vertical clipping');
          }
          for (const rect of rects) {
            const area = { x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height };
            const localReasons = new Set(reasons);
            if (area.x < -.5 || area.y < -.5 || area.x + area.width > bounds.width + .5 || area.y + area.height > bounds.height + .5) localReasons.add('text extends outside target bounds');
            // Browser hit testing is only meaningful for currently visible viewport coordinates.
            if (rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth) {
              const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              if (top && top !== el && !el.contains(top) && !top.contains(el)) localReasons.add('possible overlapping element');
            }
            if (localReasons.size) skipped.push({ text: text.slice(0, 120), box: area, reasons: Array.from(localReasons) });
            else areas.push({ text: text.slice(0, 120), box: area, ink: ink.color, fontSize: style.fontSize });
          }
        }
        return { width: bounds.width, height: bounds.height, areas, skipped, warnings: Array.from(warnings) };
      });
      // Retain color/currentColor, backgrounds, layout and opacity. Only hide glyph paint.
      await page.addStyleTag({ content: '*,:before,:after,::marker{ -webkit-text-fill-color:transparent!important; -webkit-text-stroke-color:transparent!important; text-shadow:none!important; text-decoration-color:transparent!important; caret-color:transparent!important; }' });
      const png = await item.screenshot({ animations: 'disabled' });
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const sx = info.width / collected.width, sy = info.height / collected.height;
      const checked = [], skipped = collected.skipped;
      for (const area of collected.areas) {
        const box = area.box;
        let ratio = Infinity, samples = 0, alphaProblem = false;
        let worstBackground = null;
        const xs = [], ys = [];
        for (let x = box.x + Math.min(1.5, box.width / 2); x < box.x + box.width; x += 3) xs.push(x);
        for (let y = box.y + Math.min(1.5, box.height / 2); y < box.y + box.height; y += 3) ys.push(y);
        for (const y of ys) for (const x of xs) {
          const px = Math.floor(x * sx), py = Math.floor(y * sy);
          if (px < 0 || py < 0 || px >= info.width || py >= info.height) { alphaProblem = true; continue; }
          const offset = (py * info.width + px) * 4;
          if (data[offset + 3] !== 255) { alphaProblem = true; continue; }
          const background = [data[offset], data[offset + 1], data[offset + 2]];
          const value = contrast(area.ink, background);
          if (value < ratio) { ratio = value; worstBackground = background; }
          samples++;
        }
        if (alphaProblem || !samples) {
          skipped.push({ ...area, reasons: ['transparent screenshot background or out-of-bounds sampling'] });
        } else checked.push({ ...area, minimumRatio: Number(ratio.toFixed(3)), belowThreshold: ratio < 4.5, worstBackground, samples });
      }
      if (!checked.length) collected.warnings.push('No supported text areas were measured; absence of weak areas is not a pass.');
      if (skipped.length) collected.warnings.push('Some text areas were skipped; inspect their listed effects or clipping manually.');
      targets.push({ name: target.name || target.selector, selector: target.selector, viewportWidth: target.viewportWidth || 1080, supportedAreaCount: checked.length, minimumRatio: checked.length ? Math.min(...checked.map(a => a.minimumRatio)) : null, weakAreas: checked.filter(a => a.belowThreshold), checkedAreas: checked, skippedAreas: skipped, warnings: collected.warnings });
      await page.close();
    }
  } finally { await browser.close(); }
  const measuredMinima = targets.filter(t => t.minimumRatio !== null).map(t => t.minimumRatio);
  const report = { mode: 'sampled-opaque-html-text-only', threshold: 4.5, sampleStepCssPixels: 3, minimumRatio: measuredMinima.length ? Math.min(...measuredMinima) : null, supportedAreaCount: targets.reduce((n, t) => n + t.supportedAreaCount, 0), weakAreaCount: targets.reduce((n, t) => n + t.weakAreas.length, 0), manualChecks, targets };
  writeJson(path.join(outputDir, 'contrast-report.json'), report);
  return report;
}

module.exports = { audit };
if (require.main === module) {
  if (process.argv.length !== 3) { console.error('Usage: node audit-contrast.cjs render.json'); process.exitCode = 1; }
  else audit(process.argv[2]).then(report => {
    console.log(JSON.stringify(report, null, 2));
    if (report.weakAreaCount) process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
