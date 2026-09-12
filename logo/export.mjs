import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
const OUT = 'out';
const font = readFileSync('out-inter.woff2').toString('base64');
const read = f => readFileSync(`${OUT}/svg/${f}`, 'utf8');
const dims = svg => { const m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg); return [Number(m[1]), Number(m[2])]; };
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 2600, height: 1400 } })).newPage();

async function png(svgFile, width, outFile) {
  const svg = read(svgFile); const [w, h] = dims(svg); const height = Math.round(width * h / w);
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${width}px;height:${height}px}</style>${svg}`);
  await page.locator('svg').screenshot({ path: outFile, omitBackground: true });
}
mkdirSync(`${OUT}/png`, { recursive: true });
for (const s of [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024]) await png('nerdplexity-mark.svg', s, `${OUT}/png/nerdplexity-mark-${s}.png`);
for (const c of ['black', 'white']) for (const s of [256, 1024]) await png(`nerdplexity-mark-${c}.svg`, s, `${OUT}/png/nerdplexity-mark-${c}-${s}.png`);
for (const v of ['on-dark', 'on-light']) {
  for (const w of [600, 1200, 2400]) await png(`nerdplexity-lockup-${v}.svg`, w, `${OUT}/png/nerdplexity-lockup-${v}-${w}.png`);
  for (const w of [400, 800, 1600]) await png(`nerdplexity-lockup-compact-${v}.svg`, w, `${OUT}/png/nerdplexity-lockup-compact-${v}-${w}.png`);
}

// Preview sheet: every variant on the background it is made for.
const cell = (svg, width, bg) => `<div style="background:${bg};border-radius:18px;padding:48px;display:flex;align-items:center;justify-content:center"><div style="width:${width}px">${svg.replace(/width="[\d.]+" height="[\d.]+"/, 'width="100%" height="auto"')}</div></div>`;
const sheet = `<style>body{margin:0;background:#18181b;font-family:system-ui;color:#a1a1aa}.g{display:grid;grid-template-columns:repeat(3,auto);gap:24px;padding:40px;width:fit-content}p{margin:0 0 8px;font-size:14px}</style>
<div class="g">
${cell(read('nerdplexity-lockup-on-dark.svg'), 560, '#000')}${cell(read('nerdplexity-lockup-compact-on-dark.svg'), 400, '#000')}${cell(read('nerdplexity-mark.svg'), 160, '#000')}
${cell(read('nerdplexity-lockup-on-light.svg'), 560, '#fff')}${cell(read('nerdplexity-lockup-compact-on-light.svg'), 400, '#fff')}${cell(read('nerdplexity-mark-black.svg'), 160, '#fff')}
</div>`;
await page.setContent(sheet);
await page.locator('.g').screenshot({ path: `${OUT}/preview.png` });

// Check the editable Figma file renders with Inter as it will in Figma.
const editable = readFileSync(`${OUT}/figma/nerdplexity-editable.svg`, 'utf8');
await page.setContent(`<style>@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}body{margin:0;background:#888}svg{display:block;width:900px;height:auto}</style>${editable}`);
await page.evaluate(() => document.fonts.ready);
await page.locator('svg').screenshot({ path: 'editable-check.png' });
await browser.close();

// favicon.ico with PNG images at 16, 32, and 48 px.
const sizes = [16, 32, 48]; const images = sizes.map(s => readFileSync(`${OUT}/png/nerdplexity-mark-${s}.png`));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length; const entries = [];
sizes.forEach((s, i) => { const e = Buffer.alloc(16); e.writeUInt8(s, 0); e.writeUInt8(s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12); offset += images[i].length; entries.push(e); });
writeFileSync(`${OUT}/favicon.ico`, Buffer.concat([header, ...entries, ...images]));
console.log('exported');
