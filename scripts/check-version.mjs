// 檢查 package.json 的版本是否符合 VS Code Marketplace 的版號規則，並判斷發佈類型
// 用法：node scripts/check-version.mjs
//
// 規則（https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions）：
//   - 只接受 major.minor.patch；Marketplace 不支援 semver 預發布標籤（1.4.0-beta.1 這類）
//   - minor 為偶數＝正式版（1.4.x、1.6.x），奇數＝預發布版（1.5.x、1.7.x）
//   - 正式版與預發布版的版號不可重複；VS Code 會自動更新到版號最高的版本
// 從 1.4.0 起適用（1.1.0、1.3.0 只發在 GitHub Releases，當時還沒有這個規則）
//
// 不符合時以非 0 結束；在 GitHub Actions 中會寫入 prerelease=true|false 到 $GITHUB_OUTPUT，並顯示提醒
import { appendFileSync, readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!m) {
  console.error(
    `package.json 的版本 ${version} 不符合 major.minor.patch。` +
      'Marketplace 不支援預發布標籤（如 -beta.1），預發布版請改用奇數 minor（如 1.5.0）。',
  );
  process.exit(1);
}

const prerelease = Number(m[2]) % 2 === 1;
const channel = prerelease ? '預發布版（minor 為奇數）' : '正式版（minor 為偶數）';
const text = `版本 ${version} 發佈時會是${channel}`;
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=版本 ${version}::${text}`);
else console.log(text);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `prerelease=${prerelease}\n`);
