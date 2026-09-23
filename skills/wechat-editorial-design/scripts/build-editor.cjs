#!/usr/bin/env node
'use strict';

// Build a portable editor from a trusted, authored article fragment. No network calls.
// DOMPurify is embedded for draft/paste defense; this is not an untrusted HTML sandbox.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.ico': 'image/x-icon'
};
const IMG = /<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

function decodeHtml(value) {
  return value.replace(/&(?:#(x[\da-f]+|\d+)|amp|quot|apos|lt|gt);/gi, (whole, numeric) => {
    if (numeric) {
      const n = /^x/i.test(numeric) ? parseInt(numeric.slice(1), 16) : Number(numeric);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[whole.toLowerCase()] || whole;
  });
}

function attrsFor(tag) {
  const attrs = [];
  const body = tag.replace(/^<img\b/i, '').replace(/\/?\s*>$/, '');
  for (const m of body.matchAll(ATTR)) attrs.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? null });
  return attrs;
}

function imageData(src, articleDir) {
  if (/^data:image\//i.test(src)) return src;
  if (/^(?:https?:)?\/\//i.test(src)) throw new Error('Remote image is not embedded. Download an authorized local copy first: ' + src);
  let absolute;
  if (/^file:/i.test(src)) absolute = fileURLToPath(src);
  else {
    if (/^[a-z][a-z\d+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) throw new Error('Unsupported image source: ' + src);
    const local = decodeURIComponent(src.split(/[?#]/, 1)[0]);
    absolute = path.resolve(articleDir, local);
  }
  const mime = MIME[path.extname(absolute).toLowerCase()];
  if (!mime) throw new Error('Unsupported image format: ' + absolute);
  return 'data:' + mime + ';base64,' + fs.readFileSync(absolute).toString('base64');
}

function embedArticle(article, articleDir) {
  if (/<\/?(?:html|head|body|script|iframe|object|embed)\b/i.test(article) || /<link\b/i.test(article)) {
    throw new Error('article must be a trusted HTML fragment, without document tags, scripts, frames or linked resources.');
  }
  if (/<source\b/i.test(article)) throw new Error('Use ordinary img elements instead of picture/source responsive assets.');
  const manifest = {};
  const occurrences = new Map();
  const html = article.replace(IMG, tag => {
    const attrs = attrsFor(tag);
    const get = name => attrs.find(a => a.name.toLowerCase() === name)?.value;
    const src = decodeHtml(get('src') || '');
    if (!src) throw new Error('Every img needs a non-empty src.');
    let id = decodeHtml(get('data-asset-id') || '');
    if (!id) {
      const hash = crypto.createHash('sha256').update(src).digest('hex').slice(0, 12);
      const count = (occurrences.get(hash) || 0) + 1;
      occurrences.set(hash, count);
      id = 'asset-' + hash + (count > 1 ? '-' + count : '');
    }
    if (Object.hasOwn(manifest, id)) throw new Error('Duplicate data-asset-id: ' + id);
    const data = imageData(src, articleDir);
    Object.defineProperty(manifest, id, { value: data, enumerable: true });
    const kept = attrs.filter(a => !['src', 'srcset', 'data-asset-id'].includes(a.name.toLowerCase()));
    const serialized = kept.map(a => a.value === null ? ' ' + a.name : ' ' + a.name + '="' + escapeHtml(decodeHtml(a.value)) + '"').join('');
    return '<img' + serialized + ' src="' + escapeHtml(data) + '" data-asset-id="' + escapeHtml(id) + '">';
  });
  // Inline styles are portable, but URL backgrounds need to be embedded by the author.
  for (const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    if (!/^\s*(?:data:|#)/i.test(match[1])) throw new Error('CSS url() must use an embedded data URI or fragment: ' + match[1]);
  }
  return { html, manifest };
}

function build(configPath) {
  const absoluteConfig = path.resolve(configPath);
  const base = path.dirname(absoluteConfig);
  const config = JSON.parse(fs.readFileSync(absoluteConfig, 'utf8').replace(/^\uFEFF/, ''));
  for (const key of ['title', 'summary', 'article', 'output', 'storageKey', 'assetVersion']) {
    if (typeof config[key] !== 'string' || (key !== 'summary' && !config[key].trim())) throw new Error('config.' + key + ' must be a ' + (key === 'summary' ? '' : 'non-empty ') + 'string.');
  }
  const articlePath = path.resolve(base, config.article);
  const output = path.resolve(base, config.output);
  if (output === articlePath || output === absoluteConfig) throw new Error('output must not overwrite the article or config source.');
  const embedded = embedArticle(fs.readFileSync(articlePath, 'utf8'), path.dirname(articlePath));
  const initial = {
    schemaVersion: 1, title: config.title, summary: config.summary,
    storageKey: config.storageKey, assetVersion: config.assetVersion,
    articleHtml: embedded.html, manifest: embedded.manifest
  };
  const assetDir = path.resolve(__dirname, '..', 'assets');
  const runtime = fs.readFileSync(path.join(assetDir, 'editor-runtime.js'), 'utf8');
  if (/<\/script\b/i.test(runtime)) throw new Error('Runtime contains a literal closing script tag.');
  const purifierPath = path.join(path.dirname(require.resolve('dompurify')), 'purify.min.js');
  const purifier = fs.readFileSync(purifierPath, 'utf8').replace(/<\/script/gi, '<\\/script');
  const replacements = {
    TITLE: escapeHtml(config.title), SUMMARY: escapeHtml(config.summary),
    ARTICLE: '', CONFIG: jsonForScript(initial), PURIFIER: purifier, RUNTIME: runtime
  };
  const html = fs.readFileSync(path.join(assetDir, 'editor-shell.html'), 'utf8').replace(/\{\{(TITLE|SUMMARY|ARTICLE|CONFIG|PURIFIER|RUNTIME)\}\}/g, (_, key) => replacements[key]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html, 'utf8');
  return { output, html, manifest: embedded.manifest };
}

module.exports = { build, embedArticle, jsonForScript };
if (require.main === module) {
  if (process.argv.length !== 3) {
    console.error('Usage: node build-editor.cjs path/to/editor.json');
    process.exitCode = 1;
  } else {
    try {
      const result = build(process.argv[2]);
      console.log(JSON.stringify({ output: result.output, embeddedImages: Object.keys(result.manifest).length }, null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
