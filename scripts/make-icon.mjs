#!/usr/bin/env node
// 由 assets/icon.svg 產生商店圖示 media/icon.png（256×256，透明圓角），用專案已安裝的 Playwright Chromium 繪製。
//   node scripts/make-icon.mjs
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SIZE = 256;
const svg = readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf8').replace(/width="128" height="128"/, `width="${SIZE}" height="${SIZE}"`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`);
await page.locator('svg').screenshot({ path: new URL('../media/icon.png', import.meta.url).pathname, omitBackground: true });
await browser.close();
console.log('已產生 media/icon.png');
