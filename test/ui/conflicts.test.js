// 合併衝突處理：Log 操作列、提交視窗的衝突群組與右鍵選單、衝突清單分頁、三方合併分頁（整段、逐行、手動編輯、復原）
// （對應 docs/TESTING.md「合併衝突」）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./host');

let pg;
let app;
let page;
let cv;
let cvView;
let web;

const read = (p) => fs.readFileSync(path.join(web, p), 'utf8');
/** 目前的衝突檔案（git status 的 u 記錄） */
const conflicted = () =>
  h
    .git(web, 'status', '--porcelain=v2')
    .split('\n')
    .filter((l) => l.startsWith('u '))
    .map((l) => l.split(' ').pop());

before(async () => {
  pg = h.makePlayground();
  web = `${pg}/web-app`;
  // 先收起 web-app 未提交的修改，衝突的處理才不會和它混在一起
  h.git(web, 'stash', '-q');
  app = await h.launch(pg);
  page = app.page;
  cvView = await app.commitView();
  cv = cvView.page;
});
after(async () => app && (await app.close()));

/** 讓 Log 與提交視窗讀取最新狀態 */
async function refresh() {
  const n = cvView.posted.commitState ?? 0;
  app.fireWatchers();
  await cv.locator('.commit-pane:not(.stash-pane) .commit-toolbar [title="Refresh"]').click();
  await h.until(() => (cvView.posted.commitState ?? 0) > n, 30000);
}

/** 開新分頁前先關掉舊的，lastPanel 才會拿到這次開的 */
async function nextPanel(open) {
  const n = app.calls.panels.length;
  await open();
  await h.until(() => app.calls.panels.length > n, 30000);
  return app.lastPanel();
}

const conflictRow = (name) => cv.locator('.commit-tree .tree-row', { hasText: name }).first();

test('合併後有衝突：Log 操作列顯示衝突數與「解決衝突…」；提交視窗列出衝突種類', async () => {
  assert.throws(() => h.git(web, 'merge', 'conflict/theme'));
  assert.deepEqual(conflicted().sort(), ['src/legacy.ts', 'src/theme.ts']);
  await refresh();
  await app.waitOps(true);
  await h.eventually(async () => {
    const bar = await page.locator('.log-ops').innerText();
    assert.match(bar, /web-app: Merge in progress · 2 conflicts/);
    assert.match(bar, /Resolve Conflicts…/);
  });
  await h.eventually(async () => {
    const rows = await h.texts(cv.locator('.commit-tree .tree-row'));
    assert.ok(rows.some((r) => /^Merge Conflicts.*Resolve…/.test(r)), rows.join(' / '));
    assert.ok(rows.some((r) => /theme\.ts.*both modified/.test(r)), rows.join(' / '));
    assert.ok(rows.some((r) => /legacy\.ts.*deleted by them/.test(r)), rows.join(' / '));
  });
});

let list;

test('衝突清單分頁：我的／他們的狀態；一邊刪除的檔案採用我的', async () => {
  list = await nextPanel(() => cv.locator('.commit-resolve').click());
  await h.eventually(async () => {
    const rows = await h.texts(list.page.locator('.conflicts-row'));
    assert.equal(rows.length, 2, rows.join(' / '));
    assert.ok(rows.some((r) => /legacy\.ts.*Modified.*Deleted/.test(r)), rows.join(' / '));
    assert.ok(rows.some((r) => /theme\.ts.*Modified.*Modified/.test(r)), rows.join(' / '));
  });
  await list.page.locator('.conflicts-row', { hasText: 'legacy.ts' }).click();
  // 一邊刪除的衝突不能逐行合併
  assert.equal(await list.page.locator('.conflicts-actions .button.primary').isDisabled(), true);
  await list.page.locator('.conflicts-actions .button', { hasText: 'Accept Yours' }).click();
  await h.until(() => !conflicted().includes('src/legacy.ts'));
  assert.equal(read('src/legacy.ts'), 'export const legacy = false;\n');
  await h.eventually(async () => assert.equal(await list.page.locator('.conflicts-row').count(), 1));
});

let merge;

test('三方合併：整段與不衝突的變更、統計', async () => {
  merge = await nextPanel(() => list.page.locator('.conflicts-row', { hasText: 'theme.ts' }).dblclick());
  const p = merge.page;
  await p.waitForSelector('.merge-grid .merge-input');
  assert.match(await p.locator('.merge-heads').innerText(), /Yours\s*main[\s\S]*Result[\s\S]*Theirs\s*conflict\/theme/);
  assert.equal(await p.locator('.merge-counter').innerText(), '1 conflict left · 2 non-conflicting changes');
  // 結果欄一開始是共同祖先的內容
  const result = () => p.evaluate(() => [...document.querySelectorAll('.merge-input')].map((a) => a.value).join('\n'));
  assert.match(await result(), /theme = "light"[\s\S]*fontSize = 14[\s\S]*radius = 4/);
  await p.locator('button', { hasText: 'Apply Non-Conflicting Changes' }).click();
  assert.match(await result(), /fontSize = 13[\s\S]*radius = 6/);
  assert.equal(await p.locator('.merge-counter').innerText(), '1 conflict left');
  // 整段：左右都按 ≫ → 兩段都放進結果，左邊在前
  await p.locator('.merge-gutter.ours .merge-btn.apply').click();
  await p.locator('.merge-gutter.theirs .merge-btn.apply').click();
  assert.match(await result(), /theme = "system";\nexport const contrast = "auto";\nexport const theme = "dark";\nexport const accent = "#0af";/);
  assert.equal(await p.locator('.merge-counter').innerText(), 'All conflicts resolved');
});

test('三方合併：復原與重做（按鈕、Ctrl+Z）；手動打字後按 ≫ 會蓋掉', async () => {
  const p = merge.page;
  await p.keyboard.press('Control+z');
  await p.keyboard.press('Control+z');
  assert.equal(await p.locator('.merge-counter').innerText(), '1 conflict left');
  await p.keyboard.press('Control+Shift+z');
  assert.equal(await p.locator('.merge-gutter.theirs .merge-btn.apply').count(), 1, '重做一步：只剩右邊的按鈕');
  await p.locator('[title^="Undo"]').click();
  assert.equal(await p.locator('.merge-gutter.ours .merge-btn.apply').count(), 1);
  // 還沒決定的衝突區塊手動打字後，按 ≫ 會以套用的結果蓋掉
  const input = p.locator('.merge-cell.result.conflict .merge-input');
  await input.click();
  await p.keyboard.type('typed ');
  assert.match(await p.locator('.merge-cell.result .merge-input').nth(1).inputValue(), /typed /);
  await p.locator('.merge-gutter.ours .merge-btn.apply').click();
  assert.equal(await p.locator('.merge-cell.result .merge-input').nth(1).inputValue(), 'export const theme = "system";\nexport const contrast = "auto";');
  await p.keyboard.press('Control+z');
  await p.keyboard.press('Control+z');
  assert.equal(await p.locator('.merge-cell.result .merge-input').nth(1).inputValue(), 'export const theme = "light";\nexport const contrast = "normal";');
});

test('三方合併：逐行模式各行自己的 ≫ ✕；結果欄可直接打字並復原', async () => {
  const p = merge.page;
  await p.locator('.merge-line-toggle').click();
  assert.equal(await p.locator('.merge-line-toggle').getAttribute('aria-pressed'), 'true');
  // 衝突區塊兩邊各兩行 → 各兩組按鈕
  assert.equal(await p.locator('.merge-gutter.ours .merge-btn.apply').count(), 2);
  assert.equal(await p.locator('.merge-gutter.theirs .merge-btn.apply').count(), 2);
  // 左邊第 1 行 ≫、右邊第 2 行 ≪，其餘 ✕
  await p.locator('.merge-gutter.ours .merge-gutter-line').nth(0).locator('.apply').click();
  await p.locator('.merge-gutter.ours .merge-gutter-line').nth(1).locator('.ignore').click();
  await p.locator('.merge-gutter.theirs .merge-gutter-line').nth(0).locator('.ignore').click();
  await p.locator('.merge-gutter.theirs .merge-gutter-line').nth(1).locator('.apply').click();
  const conflictInput = p.locator('.merge-cell.result.resolved .merge-input').first();
  assert.equal(await conflictInput.inputValue(), 'export const theme = "system";\nexport const accent = "#0af";');
  assert.equal(await p.locator('.merge-counter').innerText(), 'All conflicts resolved');
  // 手動編輯
  await conflictInput.click();
  await p.keyboard.press('End');
  await p.keyboard.type(' // edited');
  assert.match(await conflictInput.inputValue(), /accent = "#0af"; \/\/ edited$/);
  await p.keyboard.press('Control+z');
  assert.doesNotMatch(await p.locator('.merge-cell.result .merge-input').nth(1).inputValue(), /edited/);
  await p.keyboard.press('Control+Shift+z');
  assert.match(await p.evaluate(() => [...document.querySelectorAll('.merge-input')].map((a) => a.value).join('\n')), /edited/);
});

test('套用：寫入結果並標記已解決；衝突清單出現「繼續合併」，按下完成合併', async () => {
  const p = merge.page;
  await p.locator('.push-footer .button.primary', { hasText: 'Apply' }).click();
  await h.until(() => conflicted().length === 0);
  assert.equal(
    read('src/theme.ts'),
    '// theme settings\nexport const theme = "system";\nexport const accent = "#0af"; // edited\n\nexport const fontSize = 13;\nexport const lineHeight = 1.5;\nexport const radius = 6;\n',
  );
  await h.until(() => merge.panel.disposed);
  await h.eventually(async () => assert.equal(await list.page.locator('.conflicts-continue').innerText(), 'Continue Merge'));
  await list.page.locator('.conflicts-continue').click();
  await h.until(() => h.git(web, 'log', '-1', '--format=%P').split(' ').length === 2, 30000);
  await app.waitOps(false);
  await list.page.close();
});

test('cherry-pick 衝突：提交視窗右鍵「標記為已解決」（仍有衝突標記時要確認）、「採用他們的」刪除檔案', async () => {
  h.git(web, 'reset', '-q', '--hard', 'HEAD~1');
  assert.throws(() => h.git(web, 'cherry-pick', 'conflict/theme'));
  await refresh();
  await h.eventually(async () => assert.ok(await conflictRow('theme.ts').count()));
  await conflictRow('theme.ts').click({ button: 'right' });
  const items = await h.texts(cv.locator('.context-menu .menu-item'));
  for (const s of ['Merge…', 'Resolve Conflicts…', 'Accept Yours', 'Accept Theirs', 'Mark as Resolved']) assert.ok(items.some((x) => x.startsWith(s)), `${s}：${items.join(' / ')}`);
  await h.menu(cv, 'Mark as Resolved');
  await cv.waitForSelector('.confirm-dialog');
  assert.match(await cv.locator('.confirm-dialog').innerText(), /conflict markers/);
  await cv.locator('.confirm-dialog .button.secondary').click();
  await cv.waitForTimeout(300);
  assert.ok(conflicted().includes('src/theme.ts'), '取消後仍是衝突');
  await conflictRow('legacy.ts').click({ button: 'right' });
  await h.menu(cv, 'Accept Theirs');
  await h.until(() => !conflicted().includes('src/legacy.ts'));
  assert.equal(fs.existsSync(path.join(web, 'src/legacy.ts')), false, '他們刪除了這個檔案');
  // 用他們的版本解決 theme.ts，再從 Log 操作列繼續
  await refresh();
  await conflictRow('theme.ts').click({ button: 'right' });
  await h.menu(cv, 'Accept Theirs');
  await h.until(() => conflicted().length === 0);
  assert.match(read('src/theme.ts'), /theme = "dark"/);
  await app.waitOps(true);
  await page.locator('.log-ops .link', { hasText: 'Continue' }).click();
  await h.until(() => h.git(web, 'log', '-1', '--format=%s') === 'feat(ui): default to dark theme', 30000);
});

test('沒有 webview 錯誤（Log、提交視窗、對話框分頁）', () => {
  assert.deepEqual(app.pageErrors(), []);
});
