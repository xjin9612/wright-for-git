// 從 CHANGELOG.md 取出指定版本的說明，輸出到 stdout（供 GitHub Release 使用）
// 用法：node scripts/release-notes.mjs <tag 或版本>，例如 v1.0.0 或 1.0.0
// 會同時檢查版本與 package.json 一致；找不到對應段落或內容為空時以非 0 結束，讓發佈失敗
import { readFileSync } from 'node:fs';

const arg = process.argv[2];
if (!arg) {
  console.error('用法：node scripts/release-notes.mjs <tag>');
  process.exit(2);
}
const version = arg.replace(/^v/, '');

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (pkg.version !== version) {
  console.error(`tag 版本 ${version} 與 package.json 的 ${pkg.version} 不一致`);
  process.exit(1);
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lines = changelog.split('\n');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 接受「## 1.0.0」「## [1.0.0]」「## v1.0.0 - 2026-10-31」等寫法
const heading = new RegExp(`^##\\s+\\[?v?${escaped}\\]?(\\s|$)`);
const start = lines.findIndex((l) => heading.test(l));
if (start === -1) {
  console.error(`CHANGELOG.md 找不到版本 ${version} 的段落（需要「## ${version}」標題）`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
if (end === -1) end = lines.length;
const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) {
  console.error(`CHANGELOG.md 中版本 ${version} 的段落是空的`);
  process.exit(1);
}
process.stdout.write(`${body}\n`);
