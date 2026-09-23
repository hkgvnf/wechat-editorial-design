#!/usr/bin/env node
'use strict';
const sharp = require('sharp');

async function inspect(file) {
  const meta = await sharp(file).metadata();
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0, partial = 0, opaque = 0, opaqueWhite = 0;
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4, a = data[i + 3];
    if (!a) transparent++; else if (a < 255) partial++; else opaque++;
    if (a === 255 && data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250) opaqueWhite++;
    if (a) { minX = Math.min(x, minX); minY = Math.min(y, minY); maxX = Math.max(x, maxX); maxY = Math.max(y, maxY); }
  }
  return { width: info.width, height: info.height, originalHasAlpha: !!meta.hasAlpha, transparent, partial, opaque, opaqueWhite, contentBounds: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, note: 'Counts cannot distinguish a white wordmark from a white backing. Inspect visually on light and dark backgrounds; do not remove white pixels automatically.' };
}
module.exports = { inspect };
if (require.main === module) {
  if (!process.argv[2]) { console.error('Usage: node inspect-logo.cjs original-logo.png'); process.exit(1); }
  inspect(process.argv[2]).then(x => console.log(JSON.stringify(x, null, 2))).catch(e => { console.error(e.message); process.exitCode = 1; });
}
