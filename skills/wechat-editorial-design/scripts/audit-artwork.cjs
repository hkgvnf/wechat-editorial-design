#!/usr/bin/env node
'use strict';

// Source-level screening only. CSS masks, compositing and editorial judgment need visual review.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { readConfig, localUrl, ready, writeJson } = require('./lib.cjs');

function sourceBytes(url) {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    if (comma < 0) throw new Error('Invalid data URI.');
    const header = url.slice(0, comma), data = url.slice(comma + 1);
    return /;base64$/i.test(header) ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data));
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'file:' || (parsed.hostname && parsed.hostname !== 'localhost')) throw new Error('Only local files and data URIs are inspected; remote sources are not fetched.');
  return fs.readFileSync(fileURLToPath(parsed));
}

function backgroundRgb(value) {
  const match = /^#([a-f\d]{6})$/i.exec(value || '');
  if (!match) throw new Error('background must be a six-digit hex color, for example #143a3f.');
  return [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16));
}

async function inspectPixels(bytes, background, threshold) {
  const { data, info } = await sharp(bytes, { limitInputPixels: 64000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = { transparent: 0, translucent: 0, opaque: 0, pixelCount: info.width * info.height };
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) alpha.transparent++;
    else if (data[i] === 255) alpha.opaque++;
    else alpha.translucent++;
  }
  alpha.hasTransparency = alpha.transparent + alpha.translucent > 0;
  const coords = new Map();
  const add = (x, y) => coords.set(`${x},${y}`, [x, y]);
  for (let i = 0; i < 64; i++) {
    const x = Math.round(i * (info.width - 1) / 63), y = Math.round(i * (info.height - 1) / 63);
    add(x, 0); add(x, info.height - 1); add(0, y); add(info.width - 1, y);
  }
  const samples = Array.from(coords.values()).map(([x, y]) => {
    const offset = (y * info.width + x) * 4, rgba = Array.from(data.subarray(offset, offset + 4));
    const channelDifference = Math.max(...rgba.slice(0, 3).map((channel, i) => Math.abs(channel - background[i])));
    return { x, y, rgba, channelDifference, opaqueMismatch: rgba[3] === 255 && channelDifference > threshold };
  });
  const mismatchCount = samples.filter(sample => sample.opaqueMismatch).length;
  return {
    width: info.width, height: info.height, alpha,
    border: { sampleCount: samples.length, opaqueSampleCount: samples.filter(sample => sample.rgba[3] === 255).length, opaqueMismatchCount: mismatchCount, channelThreshold: threshold, samples },
    warnings: mismatchCount ? ['Opaque source border differs from the configured base color. Inspect the rendered boundary: masks, opacity, artwork detail or gradients may explain this warning.'] : []
  };
}

async function auditArtwork(configFile) {
  const { config, base } = readConfig(configFile);
  const background = backgroundRgb(config.background);
  const threshold = config.borderChannelThreshold === undefined ? 12 : Number(config.borderChannelThreshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) throw new Error('borderChannelThreshold must be between 0 and 255.');
  const target = config.target || '#poster', artSelector = config.artSelector || 'img.art', ignoreSelector = config.ignoreSelector || '.logo';
  const browser = await chromium.launch({ headless: true });
  let collected, readinessWarning = null;
  try {
    const page = await browser.newPage({ viewport: { width: config.viewportWidth || 1080, height: 900 }, deviceScaleFactor: 1 });
    await page.route(/^https?:/, route => route.abort());
    await page.goto(localUrl(base, config.html, config.query || ''), { waitUntil: 'load' });
    try { await ready(page); } catch (error) { readinessWarning = error.message; }
    const root = page.locator(target);
    if (await root.count() !== 1) throw new Error('target must match exactly one element: ' + target);
    if (!await root.isVisible()) throw new Error('Target is not visible: ' + target);
    collected = await root.evaluate((element, options) => {
      const targetBox = element.getBoundingClientRect();
      const result = { visible: [], ignoredCount: 0, hiddenCount: 0 };
      const nodes = [...(element.matches(options.artSelector) ? [element] : []), ...element.querySelectorAll(options.artSelector)];
      for (const image of nodes) {
        if (options.ignoreSelector && image.closest(options.ignoreSelector)) { result.ignoredCount++; continue; }
        if (!(image instanceof HTMLImageElement)) continue;
        const box = image.getBoundingClientRect();
        let left = Math.max(box.left, targetBox.left), top = Math.max(box.top, targetBox.top);
        let right = Math.min(box.right, targetBox.right), bottom = Math.min(box.bottom, targetBox.bottom), hidden = false;
        const effects = [];
        for (let parent = image; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
          if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') hidden = true;
          if (Number(style.opacity) !== 1) effects.push({ effect: 'opacity', value: style.opacity });
          for (const property of ['maskImage', 'webkitMaskImage', 'clipPath', 'filter', 'mixBlendMode']) {
            const value = style[property];
            if (value && value !== 'none' && value !== 'normal') effects.push({ effect: property, value: value.startsWith('url(') ? 'url(...)' : value });
          }
          if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
          if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
        }
        if (hidden || right <= left || bottom <= top) { result.hiddenCount++; continue; }
        result.visible.push({
          index: result.visible.length + 1, src: image.currentSrc || image.src, alt: image.alt,
          assetId: image.dataset.assetId || null, allowRepeatReason: (image.getAttribute('data-allow-repeat') || '').trim() || null,
          loaded: image.complete && image.naturalWidth > 0, cssEffects: effects,
          box: { x: box.left - targetBox.left, y: box.top - targetBox.top, width: box.width, height: box.height }
        });
      }
      return result;
    }, { artSelector, ignoreSelector });
  } finally { await browser.close(); }

  const artwork = [], pixelCache = new Map();
  for (const item of collected.visible) {
    const record = { ...item, src: item.src.startsWith('data:') ? item.src.slice(0, item.src.indexOf(',') + 1) + '[embedded]' : item.src };
    try {
      const bytes = sourceBytes(item.src);
      record.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      record.sourceBytes = bytes.length;
      if (!pixelCache.has(record.sha256)) pixelCache.set(record.sha256, await inspectPixels(bytes, background, threshold));
      Object.assign(record, pixelCache.get(record.sha256));
    } catch (error) { record.inspectionError = error.message; }
    artwork.push(record);
  }
  const sourceGroups = new Map();
  for (const item of artwork) {
    if (!item.sha256) continue;
    if (!sourceGroups.has(item.sha256)) sourceGroups.set(item.sha256, []);
    sourceGroups.get(item.sha256).push(item);
  }
  const duplicateGroups = Array.from(sourceGroups, ([sha256, items]) => ({
    sha256, occurrences: items.map(item => ({ index: item.index, alt: item.alt, src: item.src, allowRepeatReason: item.allowRepeatReason })),
    acknowledged: items.filter(item => !item.allowRepeatReason).length <= 1
  })).filter(group => group.occurrences.length > 1);
  const report = {
    mode: 'visible-image-source-screening-only', target, artSelector, ignoreSelector,
    background: config.background, borderChannelThreshold: threshold,
    visibleArtworkCount: artwork.length, ignoredCount: collected.ignoredCount, hiddenCount: collected.hiddenCount,
    duplicateGroupCount: duplicateGroups.length,
    unacknowledgedDuplicateGroupCount: duplicateGroups.filter(group => !group.acknowledged).length,
    borderWarningCount: artwork.filter(item => item.warnings?.length).length,
    inspectionErrorCount: artwork.filter(item => item.inspectionError).length,
    readinessWarning, duplicateGroups, artwork,
    finalVisualInspectionRequired: true,
    manualChecks: [
      'This report does not produce an automated aesthetic pass. Inspect a full-length render and actual phone-size images.',
      'Only visible img elements within the single target are screened; other covers, hidden variants, CSS backgrounds, SVG elements and canvas are outside scope.',
      'Exact source bytes identify repeated sources even when renamed or cropped with CSS. Re-encoded, edited or pre-cropped near-duplicates require a contact-sheet review.',
      'Visibility checks cover CSS hiding and bounding-box clipping, not full pixel occlusion, empty masks or every blend effect.',
      'Border samples use raw source RGBA, not the final composition. A warning is not proof of an ugly seam; no warning is not proof of good integration.',
      'Check every transition, all four image edges and corners, lighting, texture, perspective, repeated motifs and relationship to the surrounding copy.',
      'Remote sources are blocked and never fetched. Resolve inspection errors before treating the source inventory as complete.'
    ]
  };
  writeJson(path.join(path.resolve(base, config.outputDir || 'output'), 'artwork-report.json'), report);
  return report;
}

module.exports = { auditArtwork };
if (require.main === module) {
  if (process.argv.length !== 3) { console.error('Usage: node audit-artwork.cjs artwork.json'); process.exitCode = 1; }
  else auditArtwork(process.argv[2]).then(report => {
    console.log(JSON.stringify(report, null, 2));
    if (report.unacknowledgedDuplicateGroupCount || report.inspectionErrorCount || report.readinessWarning) process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
