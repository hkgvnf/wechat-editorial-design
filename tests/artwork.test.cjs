'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');
const { auditArtwork } = require('../skills/wechat-editorial-design/scripts/audit-artwork.cjs');
const work = path.resolve(__dirname, '../test-output/artwork');
fs.mkdirSync(work, { recursive: true });
const script = path.resolve(__dirname, '../skills/wechat-editorial-design/scripts/audit-artwork.cjs');
function put(name, content) { const file = path.join(work, name); fs.writeFileSync(file, content); return file; }
function fixture(name, body, extra = {}) {
  const outside = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#143a3f"/></svg>').toString('base64');
  put(name + '.html', `<!doctype html><style>body{margin:0}#poster{width:320px;background:#143a3f}img{display:block;width:80px;height:60px}</style><main id="poster">${body}</main><aside><img class="art" src="${outside}"><img class="art" src="${outside}"></aside>`);
  return put(name + '.json', JSON.stringify({ html: name + '.html', target: '#poster', artSelector: 'img', ignoreSelector: '.logo', outputDir: name + '-report', viewportWidth: 400, background: '#143a3f', ...extra }));
}

test('byte-identical renamed art is flagged, hidden and out-of-target variants and logos are excluded', async () => {
  const png = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#143a3f' } }).png().toBuffer();
  put('original.png', png); put('copy.png', png);
  const file = fixture('duplicates', '<img class="art" src="original.png"><img class="art" src="copy.png"><img class="logo" src="original.png"><img class="logo" src="copy.png"><div style="display:none"><img src="original.png"></div><img style="opacity:0" src="original.png">');
  const report = await auditArtwork(file);
  assert.equal(report.visibleArtworkCount, 2);
  assert.equal(report.ignoredCount, 2);
  assert.equal(report.hiddenCount, 2);
  assert.equal(report.unacknowledgedDuplicateGroupCount, 1);
  assert.equal(report.borderWarningCount, 0);
  assert.equal(report.finalVisualInspectionRequired, true);
  const cli = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  assert.equal(cli.status, 1, cli.stderr);
});

test('explicit repetition is recorded with its reason; empty permission remains a failure', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#143a3f"/></svg>';
  put('art.svg', svg); put('renamed.svg', svg);
  const accepted = await auditArtwork(fixture('intentional', '<img src="art.svg"><img src="renamed.svg" data-allow-repeat="Opening motif returns as the closing signature.">'));
  assert.equal(accepted.duplicateGroupCount, 1);
  assert.equal(accepted.unacknowledgedDuplicateGroupCount, 0);
  assert.equal(accepted.duplicateGroups[0].occurrences[1].allowRepeatReason, 'Opening motif returns as the closing signature.');
  const rejected = await auditArtwork(fixture('empty-reason', '<img src="art.svg"><img src="renamed.svg" data-allow-repeat="   ">'));
  assert.equal(rejected.unacknowledgedDuplicateGroupCount, 1);
});

test('raw opaque border warns only and true alpha cutouts are recognized even with CSS compositing', async () => {
  put('light.png', await sharp({ create: { width: 80, height: 60, channels: 4, background: '#789399' } }).png().toBuffer());
  put('cutout.png', await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect x="10" y="10" width="60" height="40" fill="#efb45f"/></svg>')).png().toBuffer());
  const file = fixture('edges', '<img src="light.png" style="opacity:.8;mask-image:linear-gradient(to right,transparent,black)"><img src="cutout.png">');
  const report = await auditArtwork(file);
  assert.equal(report.borderWarningCount, 1);
  assert.equal(report.artwork[0].alpha.hasTransparency, false);
  assert.ok(report.artwork[0].border.opaqueMismatchCount > 0);
  assert.ok(report.artwork[0].cssEffects.some(effect => effect.effect === 'opacity'));
  assert.ok(report.artwork[0].cssEffects.some(effect => effect.effect === 'maskImage'));
  assert.equal(report.artwork[1].alpha.hasTransparency, true);
  assert.ok(report.artwork[1].alpha.transparent > 0);
  assert.ok(report.artwork[1].alpha.opaque > 0);
  assert.equal(report.artwork[1].border.opaqueMismatchCount, 0);
  const cli = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const permissive = await auditArtwork(fixture('threshold', '<img src="light.png">', { borderChannelThreshold: 255 }));
  assert.equal(permissive.borderWarningCount, 0);
});

test('embedded data URI participates in byte-based grouping and source bytes remain unchanged', async () => {
  const png = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#143a3f' } }).png().toBuffer();
  put('embedded.png', png);
  const report = await auditArtwork(fixture('embedded', `<img src="embedded.png"><img src="data:image/png;base64,${png.toString('base64')}">`));
  assert.equal(report.unacknowledgedDuplicateGroupCount, 1);
  assert.ok(report.artwork[1].src.endsWith('[embedded]'));
  assert.deepEqual(fs.readFileSync(path.join(work, 'embedded.png')), png);
});
