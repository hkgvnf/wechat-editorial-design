'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function readConfig(file) {
  const absolute = path.resolve(file);
  return { config: JSON.parse(fs.readFileSync(absolute, 'utf8').replace(/^\uFEFF/, '')), base: path.dirname(absolute) };
}
function within(root, name) {
  const target = path.resolve(root, name);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative === '..') throw new Error('Output must be a file within outputDir: ' + name);
  return target;
}
function localUrl(base, file, query = '') {
  if (!file || /^[a-z]+:\/\//i.test(file)) throw new Error('Use a trusted local HTML file.');
  return pathToFileURL(path.resolve(base, file)).href + query;
}
async function ready(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(img => img.decode().catch(() => { throw new Error('Image failed: ' + img.getAttribute('src')?.slice(0, 100)); })));
  });
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
module.exports = { readConfig, within, localUrl, ready, writeJson };
