// 指令與其他：介面語言、檔案總管右鍵指令、取消儲藏分頁、顯示 Git 歷史、Blame、設定、diff 切換（對應 docs/TESTING.md 多個小節）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const h = require('./host');

let pg;
let app;
let page;
let api;
let web;

before(async () => {
  pg = h.makePlayground();
  api = `${pg}/api-server`;
  web = `${pg}/web-app`;
  app = await h.launch(pg, { config: { 'gitWorkbench.language': 'zh-tw' } });
  page = app.page;
});
after(async () => app && (await app.close()));

const fileUri = (p) => app.vscode.Uri.file(p);

test('介面語言 zh-tw：面板、選單、提交視窗都是中文', async () => {
  assert.equal(await page.locator('.toolbar-group .icon-button').nth(1).getAttribute('title'), '推送…');
  const chips = await h.texts(page.locator('.chip'));
  assert.deepEqual(chips, ['分支', '作者', '路徑', '日期']);
  await page.locator('.log-row:visible').first().click({ button: 'right' });
  const items = (await h.texts(page.locator('.context-menu .menu-item'))).join(' / ');
  assert.match(items, /揀選/);
  assert.doesNotMatch(items, /Cherry-Pick|Revert|Reset/);
  await page.keyboard.press('Escape');
  const cv = await app.commitView();
  await h.eventually(async () => {
    assert.deepEqual(await h.texts(cv.page.locator('.commit-tab')), ['提交', '儲藏']);
    assert.ok((await h.texts(cv.page.locator('.commit-tree .tree-row'))).some((r) => r.startsWith('變更')));
  });
  await cv.page.close();
});

test('切換語言為 en：面板以英文重新載入', async () => {
  const bundle = () => /id="l10n-bundle">([\s\S]*?)<\/script>/.exec(app.logView.webview.html)?.[1] ?? '';
  assert.match(bundle(), /推送/);
  await app.setConfig('gitWorkbench.language', 'en');
  await h.until(() => !/推送/.test(bundle()));
  await app.setConfig('gitWorkbench.language', 'zh-tw');
  await h.until(() => /推送/.test(bundle()));
});

test('面板內設定框：標題列齒輪打開，切換語言立即生效、其他設定寫入使用者設定', async () => {
  const bundle = () => /id="l10n-bundle">([\s\S]*?)<\/script>/.exec(app.logView.webview.html)?.[1] ?? '';
  await app.run('gitWorkbench.openSettings');
  await page.waitForSelector('.settings-popover select');
  assert.equal(await page.locator('#gwb-language').inputValue(), 'zh-tw');
  const options = await page.locator('#gwb-language option').allInnerTexts();
  assert.deepEqual(options.slice(1), ['English', '繁體中文']);
  await page.locator('#gwb-max').selectOption('100000');
  await h.until(() => app.calls.config['gitWorkbench.maxCommits'] === 100000);
  await page.locator('#gwb-auto').uncheck();
  await h.until(() => app.calls.config['gitWorkbench.autoRefresh'] === false);
  await page.locator('#gwb-language').selectOption('en');
  await h.until(() => app.calls.config['gitWorkbench.language'] === 'en' && !/推送/.test(bundle()));
  // 改回中文（直接寫設定，避免依賴重新載入後的頁面）
  await app.setConfig('gitWorkbench.language', 'zh-tw');
  await app.setConfig('gitWorkbench.autoRefresh', true);
  await page.keyboard.press('Escape');
});

test('標題列齒輪指令：打開面板內設定框', async () => {
  await page.evaluate(() => document.querySelector('.settings-popover')?.remove());
  await app.run('gitWorkbench.openSettings');
  await page.waitForSelector('.settings-popover');
  await page.locator('.settings-popover .link').last().click();
  await h.until(() => app.calls.executed.some((c) => c[0] === 'workbench.action.openSettings'));
});

test('顯示 Git 歷史：切到檔案所屬 repo 並以路徑篩選', async () => {
  await app.run('gitWorkbench.showHistory', fileUri(path.join(api, 'src/orders/pricing.ts')));
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => !document.querySelector('.progress.active'));
  const subjects = await h.texts(page.locator('.log-row:visible .cell-subject-text'));
  assert.ok(subjects.length >= 2 && subjects.every((s) => /pricing|hotfix order total/.test(s)), subjects.join(' / '));
  for (const c of await page.locator('.chip.active .chip-clear').all()) await c.click();
});

test('與分支或標籤比較：單一檔案直接開 diff；資料夾列出不同檔案', async () => {
  app.calls.picks.push((x) => /release\/1\.x/.test(x.label));
  await app.run('gitWorkbench.compareWithRef', fileUri(path.join(api, 'src/orders/pricing.ts')));
  await h.until(() => app.calls.executed.some((c) => c[0] === 'vscode.diff' && /release\/1\.x/.test(c[3])));
  app.calls.picks.push((x) => /v1\.0\.0/.test(x.label), () => false);
  const before = app.calls.quickPicks.length;
  await app.run('gitWorkbench.compareWithRef', fileUri(path.join(api, 'src')));
  await h.until(() => app.calls.quickPicks.length >= before + 2);
  const files = app.calls.quickPicks[app.calls.quickPicks.length - 1].join(' ');
  assert.match(files, /pricing\.ts/);
  assert.doesNotMatch(files, /README/);
});

test('取消儲藏分頁：選 stash 看檔案；以新分支取消儲藏', async () => {
  await app.run('gitWorkbench.unstash', fileUri(path.join(web, 'src')));
  const d = await app.lastPanel();
  // 清單與檔案都是非同步載入（Windows 上較慢）：等到內容出現，不用固定的等待時間
  await h.until(async () => (await h.texts(d.page.locator('.push-list > *'))).some((x) => /draft: new page/.test(x)), 30000);
  await h.until(async () => (await h.texts(d.page.locator('.push-files > *'))).join(' ').includes('App.css'), 30000);
  h.git(web, 'stash', '-q');
  await d.page.locator('.unstash-branch').fill('from-stash');
  await d.page.locator('.button.primary').click();
  // `git stash branch` 先切換分支、再套用儲藏：HEAD 變了不代表已經做完（Windows 上兩步之間間隔明顯），
  // 要等指令結束（分頁關閉）才檢查檔案
  await h.until(() => d.panel.disposed, 30000);
  assert.equal(h.git(web, 'rev-parse', '--abbrev-ref', 'HEAD'), 'from-stash');
  // 直接看檔案：使用者的 git 可能設定 status.showUntrackedFiles=no，status 不會列出未追蹤檔案
  assert.ok(require('node:fs').existsSync(path.join(web, 'src/Draft.tsx')), '儲藏中的未追蹤檔案已還原');
  assert.match(h.git(web, 'status', '--porcelain'), /App\.css/);
  await d.page.close();
});

test('儲藏變更（檔案總管）：無變更時提示', async () => {
  h.git(web, 'stash', '-q', '-u');
  const before = app.calls.infos.length;
  await app.run('gitWorkbench.stashChangesIn', fileUri(path.join(web, 'src')));
  await h.until(() => app.calls.infos.length > before);
  assert.match(app.calls.infos[app.calls.infos.length - 1], /沒有可儲藏的本機變更/);
});

test('切換 Git Blame：改變內建的 git.blame.editorDecoration.enabled', async () => {
  await app.run('gitWorkbench.toggleBlame');
  assert.equal(app.calls.config['git.blame.editorDecoration.enabled'], true);
  await app.run('gitWorkbench.toggleBlame');
  assert.equal(app.calls.config['git.blame.editorDecoration.enabled'], false);
});

test('Fetch 指令：多 repo 一次執行並彙整結果', async () => {
  const before = app.calls.status.length + app.calls.infos.length + app.calls.warnings.length;
  await app.run('gitWorkbench.fetch');
  await h.until(() => app.calls.status.length + app.calls.infos.length + app.calls.warnings.length > before, 15000);
});

test('沒有 webview 錯誤（Log、提交視窗、對話框分頁）', () => {
  assert.deepEqual(app.pageErrors(), []);
});
