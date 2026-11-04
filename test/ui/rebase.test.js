// 互動式 rebase 與進行中的操作（對應 docs/TESTING.md「互動式 rebase」「進行中的操作」）
'use strict';
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const h = require('./host');

let pg;
let app;
let page;
let api;

before(async () => {
  pg = h.makePlayground();
  api = `${pg}/api-server`;
  app = await h.launch(pg);
  page = app.page;
});
after(async () => app && (await app.close()));
// 測試失敗時不留下進行中的 rebase，避免連帶後面的測試
afterEach(() => {
  if (api && rebasing()) h.git(api, 'rebase', '--abort');
  for (const p of app?.calls.panels ?? []) if (!p.disposed) p.dispose();
});

async function refresh() {
  app.fireWatchers();
  await page.waitForTimeout(900);
  await page.waitForFunction(() => !document.querySelector('.progress.active'));
}
const subjects = (n) => h.git(api, 'log', '--format=%s', `-${n}`).split('\n');

/** 是否有進行中的 rebase（看 .git 裡的狀態資料夾，不依賴 git 訊息的語言） */
const rebasing = () => fs.existsSync(`${api}/.git/rebase-merge`) || fs.existsSync(`${api}/.git/rebase-apply`);

/** 等 rebase 執行完（分頁關閉、沒有進行中的 rebase）；Windows 上 git 較慢，不能只看 log */
async function finished(d) {
  await h.until(() => d.panel.disposed, 60000);
  await h.until(() => !rebasing(), 60000);
}

/** 從指定 commit 開啟互動式 rebase 分頁 */
async function openRebase(subject) {
  for (const p of app.calls.panels) if (!p.disposed) p.dispose();
  const n = app.calls.panels.length;
  await (await h.logRow(page, subject)).click({ button: 'right' });
  await h.menu(page, 'Interactively Rebase from Here');
  await h.until(() => app.calls.panels.length > n);
  const d = await app.lastPanel();
  await d.page.waitForSelector('.rebase-row');
  return d;
}

test('reword、squash（未提交的變更自動儲藏並還原）', async () => {
  const dirty = h.git(api, 'status', '--porcelain');
  const d = await openRebase('feat(auth): add API keys');
  const rows = await h.texts(d.page.locator('.rebase-row'));
  assert.equal(rows.length, 4, rows.join(' / '));
  assert.match(rows[0], /docs: describe key rotation/);
  await d.page.locator('.rebase-row').nth(0).click();
  await d.page.keyboard.press('r');
  await d.page.locator('.rebase-message').fill('docs: key rotation (rewritten)\n\n#123 keep this line');
  await d.page.locator('.rebase-row').nth(1).click();
  await d.page.keyboard.press('s');
  await d.page.locator('.button.primary').click();
  await finished(d);
  assert.deepEqual(subjects(3), ['docs: key rotation (rewritten)', 'feat(sdk): add client package', 'feat(auth): add API keys']);
  assert.match(h.git(api, 'log', '-1', '--format=%B'), /#123 keep this line/);
  assert.equal(h.git(api, 'status', '--porcelain'), dirty, '未提交的變更還在');
  await refresh();
});

test('調整順序（Alt+↑）與 drop', async () => {
  const d = await openRebase('feat(auth): add API keys');
  // 由新到舊顯示：把 sdk 移到最上面（變成最新）
  await d.page.locator('.rebase-row', { hasText: 'add client package' }).click();
  await d.page.keyboard.press('Alt+ArrowUp');
  await d.page.locator('.rebase-row', { hasText: 'add API keys' }).click();
  await d.page.keyboard.press('d');
  await d.page.locator('.button.primary').click();
  await finished(d);
  assert.deepEqual(subjects(2), ['feat(sdk): add client package', 'docs: key rotation (rewritten)']);
  await refresh();
});

test('edit 停下：Log 上方出現進行中列，按「繼續」完成', async () => {
  const d = await openRebase('docs: key rotation (rewritten)');
  await d.page.locator('.rebase-row', { hasText: 'key rotation' }).click();
  await d.page.keyboard.press('e');
  await d.page.locator('.button.primary').click();
  await h.until(() => rebasing(), 40000);
  await app.waitOps(true);
  assert.match(await page.locator('.log-ops').innerText(), /api-server.*Rebase/);
  await page.locator('.log-ops .link', { hasText: 'Continue' }).click();
  await h.until(() => !rebasing(), 40000);
  await app.waitOps(false);
  assert.deepEqual(fs.readdirSync(`${api}/.git`).filter((n) => n.startsWith('wright-')), [], '沒有殘留的暫存檔');
});

test('滑鼠拖曳列調整順序', async () => {
  // 前面的測試已改寫歷史：從 docs 開始有兩筆可以調整
  const d = await openRebase('docs: key rotation (rewritten)');
  assert.ok((await d.page.locator('.rebase-row').count()) >= 2);
  const first = await d.page.locator('.rebase-row').first().innerText();
  const last = d.page.locator('.rebase-row').last();
  await last.dragTo(d.page.locator('.rebase-row').first());
  await d.page.waitForTimeout(200);
  assert.notEqual(await d.page.locator('.rebase-row').first().innerText(), first, '拖曳後順序改變');
  d.panel.dispose();
});

test('分支在對話框開啟後變動：拒絕開始並重新載入清單', async () => {
  const d = await openRebase('feat(sdk): add client package');
  h.git(api, 'commit', '-q', '--allow-empty', '-m', 'sneaky commit');
  await d.page.locator('.button.primary').click();
  await h.until(() => app.calls.warnings.some((w) => /branch changed/.test(w)));
  // 等清單重新載入完成（包含新提交），否則下一個測試開始時重新載入可能還在進行
  await h.until(() => d.panel.webview.html.includes('sneaky commit'));
  assert.equal(subjects(1)[0], 'sneaky commit', '新提交沒有被丟掉');
});

test('detached HEAD 時拒絕', async () => {
  h.git(api, 'checkout', '-q', '--detach');
  await refresh();
  const n = app.calls.panels.length;
  await (await h.logRow(page, 'feat(sdk): add client package')).click({ button: 'right' });
  await h.menu(page, 'Interactively Rebase from Here');
  await h.until(() => app.calls.warnings.some((w) => /detached/.test(w)));
  assert.equal(app.calls.panels.length, n);
  h.git(api, 'checkout', '-q', 'main');
});

test('沒有 webview 錯誤（Log、提交視窗、對話框分頁）', () => {
  assert.deepEqual(app.pageErrors(), []);
});
