// Git 記錄面板：篩選、選取、詳情、分頁、欄位（對應 docs/TESTING.md「Commit Log」「多選 commit」「多 repo」）
'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./host');

let pg;
let app;
let page;

before(async () => {
  pg = h.makePlayground();
  app = await h.launch(pg, { config: { 'gitWorkbench.issueLinks': [{ pattern: 'PROJ-(\\d+)', url: 'https://tracker.example.com/browse/PROJ-$1' }] } });
  page = app.page;
});
after(async () => app && (await app.close()));

/** 等 log 重新載入完成 */
async function settle() {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => !document.querySelector('.progress.active'));
  await page.waitForTimeout(150);
}
const visibleRows = () => page.locator('.log-row:visible');
const subjects = () => h.texts(page.locator('.log-row:visible .cell-subject-text'));
const row = (text) => h.logRow(page, text);
const chip = (name) => page.locator('.chip', { hasText: name });
const clearChip = async (name) => {
  await chip(name).locator('.chip-clear').click();
  await settle();
};
const search = async (text) => {
  const input = page.locator('.log-search input');
  await input.fill(text);
  await input.press('Enter');
  await settle();
};

/** 每個測試從乾淨的篩選開始（前一個測試失敗時不連帶影響） */
beforeEach(async () => {
  await page.keyboard.press('Escape');
  for (const b of await page.locator('.log-search .toggle-button.on').all()) await b.click();
  const input = page.locator('.log-search input');
  if (await input.inputValue()) {
    await input.fill('');
    await input.press('Escape');
  }
  for (const c of await page.locator('.chip.active .chip-clear').all()) await c.click();
  await settle();
});

test('合併顯示所有 repo 的 commit；同名 local／remote 合併標籤；tag', async () => {
  const all = (await visibleRows().allInnerTexts()).join('\n');
  for (const s of ['feat(auth): add API keys', 'feat(ui): dark mode toggle', 'feat: add formatter']) assert.ok(all.includes(s), s);
  assert.match(all, /origin & release\/1\.x/);
  assert.match(all, /v1\.1\.0/);
});

test('文字篩選、hash 前綴、regex', async () => {
  await search('pagination');
  const list = await subjects();
  assert.ok(list.length >= 2 && list.every((s) => /pagination/.test(s)), list.join(' / '));

  await search(h.git(`${pg}/api-server`, 'rev-parse', 'v1.1.0').slice(0, 8));
  assert.deepEqual(await subjects(), ['chore: drop legacy script']);

  const regex = page.locator('.log-search .toggle-button').first();
  await regex.click();
  await search('^fix\\(');
  const fixes = await subjects();
  assert.ok(fixes.length >= 3 && fixes.every((s) => s.startsWith('fix(')), fixes.join(' / '));
  await regex.click();
  await page.locator('.log-search input').press('Escape');
  await settle();
  assert.ok((await subjects()).length > 20);
});

test('User 篩選：me 代表 Alice', async () => {
  await chip('User').click();
  await page.locator('.picker-input').fill('me');
  await page.locator('.picker-input').press('Control+Enter');
  await settle();
  assert.deepEqual([...new Set(await h.texts(page.locator('.log-row:visible .cell-author')))], ['Alice Chen']);
  await clearChip('User');
  assert.ok(new Set(await h.texts(page.locator('.log-row:visible .cell-author'))).size > 1);
});

test('Branch 篩選：串接選單只顯示該 branch；HEAD 不在篩選中時提示', async () => {
  await chip('Branch').click();
  const top = await h.texts(page.locator('.context-menu[data-level="0"] .menu-item'));
  assert.ok(top[0].startsWith('Select…') && top.some((x) => x.startsWith('Local')) && top.some((x) => x.startsWith('Tags')), top.join(' / '));
  await page.locator('.context-menu[data-level="0"] .menu-item', { hasText: 'Local' }).hover();
  await page.locator('.context-menu[data-level="1"] .menu-item', { hasText: 'release/1.x' }).first().dispatchEvent('mousedown');
  await settle();
  const list = await subjects();
  assert.ok(list.includes('fix(release): hotfix order total rounding'), list.join(' / '));
  assert.ok(!list.includes('feat(auth): rotate API keys'));
  assert.ok(await page.locator('.log-hint:not(.hidden)').isVisible(), 'HEAD 提示');
  await page.locator('.log-hint .link', { hasText: 'Show all branches' }).click();
  await settle();
  assert.equal(await page.locator('.log-hint:not(.hidden)').count(), 0);
  assert.ok((await subjects()).includes('feat(auth): rotate API keys'));
});

test('Date 篩選：最近 7 天', async () => {
  await chip('Date').click();
  await h.menu(page, '7 days');
  await settle();
  const dates = await h.texts(page.locator('.log-row:visible .cell-date'));
  const limit = Date.now() - 8 * 86400000;
  assert.ok(dates.length > 0 && dates.every((d) => { const [y, m, day] = d.split(/[/ ]/).map(Number); return new Date(y, m - 1, day).getTime() > limit; }), dates.join(' / '));
  await clearChip('Date');
});

test('Paths：Ctrl+點選只看一個 repo；點色條顯示 repo 名稱欄', async () => {
  await chip('Paths').click();
  await page.locator('.context-menu .menu-item', { hasText: 'web-app' }).first().dispatchEvent('mousedown', { ctrlKey: true });
  await page.keyboard.press('Escape');
  await settle();
  const all = (await visibleRows().allInnerTexts()).join('\n');
  assert.ok(all.includes('dark mode toggle') && !all.includes('add API keys'), 'only web-app');
  await clearChip('Paths');

  // 點左側色條：加寬為 repo 名稱欄（graph 與標題往右移）
  const pad = () => page.locator('.log-row:visible .cell-subject').first().evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft));
  const before = await pad();
  const box = await visibleRows().first().boundingBox();
  await page.mouse.click(box.x + 3, box.y + box.height / 2);
  await page.waitForTimeout(300);
  assert.ok((await pad()) > before + 40, '名稱欄出現');
  await page.mouse.click(box.x + 3, box.y + box.height / 2);
  await page.waitForTimeout(300);
  assert.equal(await pad(), before);
});

test('選取 commit：右側列出檔案與詳情；issue 編號轉連結', async () => {
  await (await row('feat(auth): add API keys')).click();
  await page.waitForTimeout(600);
  assert.deepEqual(await h.texts(page.locator('.file-tree .tree-row .tree-label')), ['api-server', 'src/auth', 'keys.ts']);
  assert.match(await page.locator('.details-info').innerText(), /Bob Lin/);
  await page.locator('.details-info .issue-link', { hasText: 'PROJ-42' }).click();
  await h.until(() => JSON.stringify([app.calls.opened, app.calls.executed]).includes('PROJ-42'));
});

test('多選：Shift+點選顯示合併變更；右鍵可複製多個 hash', async () => {
  await (await row('feat(auth): rotate API keys')).click();
  await (await row('docs: describe key rotation')).click({ modifiers: ['Shift'] });
  await page.waitForTimeout(800);
  const files = (await h.texts(page.locator('.file-tree .tree-row .tree-label'))).join(' ');
  assert.match(files, /rotate\.ts/);
  assert.match(files, /auth\.md/);
  await (await row('docs: describe key rotation')).click({ button: 'right' });
  const items = await h.texts(page.locator('.context-menu .menu-item'));
  assert.ok(items.some((x) => /2/.test(x) && /Copy/.test(x)), items.join(' / '));
  await page.keyboard.press('Escape');
});

test('右鍵選單包含 IntelliJ 的 commit 操作', async () => {
  await (await row('feat(cache): try in-memory cache')).click();
  await (await row('feat(cache): try in-memory cache')).click({ button: 'right' });
  const items = (await h.texts(page.locator('.context-menu[data-level="0"] .menu-item'))).join(' / ');
  for (const s of ['Cherry-Pick', 'Revert Commit', 'Reset Current Branch to Here', 'New Branch', 'New Tag', 'Interactively Rebase from Here', 'Push All up to Here']) assert.ok(items.includes(s), `${s} 不在：${items}`);
  await page.keyboard.press('Escape');
});

test('Log 分頁：新增分頁各自保留篩選', async () => {
  await page.locator('[title="View options"]').click();
  await h.menu(page, 'New Log Tab');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.log-tab').count(), 2);
  await search('pagination');
  await page.locator('.log-tab').first().click();
  await settle();
  assert.equal(await page.locator('.log-search input').inputValue(), '');
  await page.locator('.log-tab').nth(1).click();
  await settle();
  assert.equal(await page.locator('.log-search input').inputValue(), 'pagination');
  await page.locator('.log-tab').nth(1).locator('.tab-close').click();
  await page.waitForTimeout(300);
  assert.ok(await page.locator('.log-tabs.hidden').count());
});

test('欄位：拖曳 Author 欄左緣調整寬度；👁 隱藏 Hash 欄', async () => {
  const width = () => page.locator('.log-row:visible .cell-author').first().evaluate((e) => e.offsetWidth);
  const before = await width();
  const box = await page.locator('.col-resizer').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y + 5, { steps: 4 });
  await page.mouse.up();
  const after = await width();
  assert.ok(after > before + 30, `${before} → ${after}`);
  await page.locator('[title="View options"]').click();
  await h.menu(page, 'Show Hash');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.ok(await page.locator('.hide-hash').count());
});

test('鍵盤：Shift+F10 開右鍵選單，方向鍵移動、Enter 執行、Esc 關閉', async () => {
  const subject = 'feat(auth): add API keys';
  await (await row(subject)).click();
  await page.waitForFunction((t) => [...document.querySelectorAll('.log-row.selected')].some((r) => r.style.display !== 'none' && r.textContent.includes(t)), subject);
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('.context-menu .menu-item.active');
  assert.match(await page.locator('.context-menu .menu-item.active').innerText(), /^Copy/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.context-menu').count(), 0);
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('End');
  assert.notEqual(await page.locator('.context-menu .menu-item.active').innerText(), 'Copy Revision Number');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('.context-menu .menu-item.active').innerText(), 'Copy Revision Number');
  await page.keyboard.press('Enter');
  const hash = h.git(`${pg}/api-server`, 'log', '-1', '--format=%H', '--grep=add API keys');
  await h.until(() => app.calls.clipboard === hash);
  assert.equal(await page.locator('.context-menu').count(), 0);
});

test('變更檔案列尾顯示狀態字母', async () => {
  await (await row('docs: rename orders guide')).click();
  await page.waitForTimeout(500);
  const letters = await h.texts(page.locator('.file-tree .status-letter'));
  assert.deepEqual(letters, ['R']);
  assert.equal(await page.locator('.file-tree .status-letter').first().getAttribute('aria-label'), 'Renamed');
});

test('沒有 webview 錯誤', () => {
  assert.deepEqual(h.pageErrors(app.log), []);
  assert.deepEqual(app.calls.errors, []);
});
